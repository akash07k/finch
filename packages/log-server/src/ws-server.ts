import { EventEmitter } from "node:events";
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, resolve, relative, isAbsolute } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { LogEntry } from "./types.js";
import type { SessionStore } from "./session-store.js";

/** Configuration options for {@link LogServer}. */
export interface LogServerConfig {
  /** Port to listen on. Use 0 for a random available port. */
  port: number;
  /**
   * Network interface to bind to. Defaults to "127.0.0.1" so the server
   * is reachable only from this machine. Pass "0.0.0.0" or a specific
   * LAN address to expose the server to other devices (be aware: doing
   * so lets any process on the LAN forge log entries).
   */
  host?: string;
  /** Directory containing built web viewer files. If unset, no web UI is served. */
  webDir?: string;
  /** Max entries to keep in memory for replay to new clients (default: 1000) */
  bufferSize?: number;
  /**
   * Maximum WebSocket message payload in bytes (default: 1 MiB).
   * Log entries should be small; an oversized message indicates either
   * a misuse or a deliberate DoS attempt.
   */
  maxPayloadBytes?: number;
  /** Session store for persistence and session history. */
  sessionStore?: SessionStore;
}

const DEFAULT_BUFFER_SIZE = 1000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MAX_PAYLOAD = 1024 * 1024; // 1 MiB

/**
 * Inclusive upper bound for a valid LogLevel value. Mirrors
 * `LogLevel.FATAL` from `@oriole/logger` (0=DEBUG..4=FATAL).
 * Hardcoded so the log-server has no runtime dependency on the logger
 * package; the level enum has not changed since the project began and
 * the test suite would catch a drift.
 */
const MAX_LOG_LEVEL = 4;

/**
 * Runtime guard that an arbitrary JSON value matches the {@link LogEntry}
 * shape. Origin checks and the localhost bind already gate who can talk
 * to the server, but parsed payloads from a permitted origin still flow
 * through `emit("entry", ...)` into broadcast and into JSONL session
 * files. This drops anything that does not match the real entry shape
 * so a crafted message cannot land in a session log or be re-broadcast
 * to web clients with an unexpected shape.
 */
export function isValidLogEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return false;
  if (typeof v.timestamp !== "string") return false;
  // Level must be an integer in the valid LogLevel range. A bare
  // `typeof === "number"` would let NaN, Infinity, and out-of-range
  // values through, all of which render as unlabelled rows in the
  // web viewer.
  if (
    typeof v.level !== "number" ||
    !Number.isInteger(v.level) ||
    v.level < 0 ||
    v.level > MAX_LOG_LEVEL
  ) {
    return false;
  }
  if (typeof v.tag !== "string") return false;
  if (typeof v.message !== "string") return false;
  if (v.data !== undefined && (typeof v.data !== "object" || v.data === null)) return false;
  if (v.error !== undefined) {
    if (!v.error || typeof v.error !== "object") return false;
    const e = v.error as Record<string, unknown>;
    if (typeof e.name !== "string") return false;
    if (typeof e.message !== "string") return false;
    if (e.stack !== undefined && typeof e.stack !== "string") return false;
  }
  return true;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".map": "application/json",
};

/**
 * WebSocket server that receives JSON log entries from clients.
 * Emits "entry" events for each parsed log entry.
 * Optionally serves a static web viewer over HTTP on the same port.
 */
export class LogServer extends EventEmitter {
  private readonly config: LogServerConfig;
  private readonly bufferSize: number;
  private readonly entryBuffer: LogEntry[] = [];
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  /** @param config - Server configuration. Set port to 0 for a random available port. */
  constructor(config: LogServerConfig) {
    super();
    this.config = config;
    this.bufferSize = config.bufferSize ?? DEFAULT_BUFFER_SIZE;
  }

  /** Number of currently connected WebSocket clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Start the HTTP and WebSocket server.
   * @returns The actual bound port (useful when config.port was 0).
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer((req, res) => this.handleHttp(req, res));
      this.wss = new WebSocketServer({
        server: this.httpServer,
        maxPayload: this.config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD,
        // Reject WebSocket upgrades from origins that don't look local.
        // Non-browser clients (Node ws, curl) don't send Origin and are
        // allowed through — see isAllowedOrigin for the rules.
        verifyClient: ({ origin }, callback) => {
          if (LogServer.isAllowedOrigin(origin)) {
            callback(true);
          } else {
            callback(false, 403, "Forbidden origin");
          }
        },
      });

      this.wss.on("connection", (ws) => {
        this.clients.add(ws);

        // Replay buffered entries to new clients
        for (const entry of this.entryBuffer) {
          ws.send(JSON.stringify(entry));
        }

        ws.on("error", () => {
          // Absorb connection-level errors to prevent process crash.
          // The "close" event fires after "error" and handles cleanup.
        });

        ws.on("message", (data) => {
          try {
            const parsed: unknown = JSON.parse(data.toString());
            if (!isValidLogEntry(parsed)) {
              // Drop silently — even a permitted origin can send a
              // malformed payload, and emitting one would put a
              // non-LogEntry value into broadcast and session files.
              return;
            }
            this.emit("entry", parsed);
          } catch {
            // Ignore invalid JSON — don't crash the server
          }
        });

        ws.on("close", () => {
          this.clients.delete(ws);
        });
      });

      this.httpServer.on("error", reject);

      // Bind to localhost-only by default so the server isn't reachable
      // from other machines on the LAN. Operators who want to expose
      // the server can override via config.host.
      const host = this.config.host ?? DEFAULT_HOST;
      this.httpServer.listen(this.config.port, host, () => {
        const addr = this.httpServer!.address();
        const port = typeof addr === "object" && addr ? addr.port : this.config.port;
        resolve(port);
      });
    });
  }

  /**
   * Decide whether an incoming WebSocket upgrade's Origin is acceptable.
   *
   * - **No Origin header** (Node ws, curl, server-to-server): allowed.
   *   The browser is what enforces Origin; absence implies a non-browser
   *   client where this defense is moot.
   * - **Same-origin (loopback host)**: allowed. The shipped web viewer
   *   loaded from http://localhost:8089 has Origin http://localhost:8089
   *   and must connect to the WS on the same port.
   * - **Browser extensions** (chrome-extension://, moz-extension://):
   *   allowed. Oriole's WebSocketTransport runs from one of these
   *   origins.
   * - **Anything else**: rejected. A malicious page on evil.com can
   *   still attempt to open a WebSocket to localhost (CORS does not
   *   apply to WebSockets), so this check is the actual gate.
   */
  static isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    if (origin.startsWith("chrome-extension://")) return true;
    if (origin.startsWith("moz-extension://")) return true;
    try {
      const url = new URL(origin);
      // IPv6 hostnames are returned with brackets ("[::1]") by Node's URL
      // parser; strip them so the comparison is straightforward.
      const host = url.hostname.replace(/^\[|\]$/g, "");
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    } catch {
      return false;
    }
  }

  /** Stop the server and disconnect all clients. */
  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          if (this.httpServer) {
            this.httpServer.close(() => resolve());
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Broadcast a log entry to all connected WebSocket clients and buffer for replay.
   * @param entry - The log entry to broadcast and buffer.
   */
  broadcast(entry: LogEntry): void {
    // Buffer for new clients that connect later
    this.entryBuffer.push(entry);
    if (this.entryBuffer.length > this.bufferSize) {
      this.entryBuffer.shift();
    }

    const json = JSON.stringify(entry);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(json);
      }
    }
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const reqUrl = req.url ?? "/";

    // API endpoints for session management
    if (reqUrl === "/api/sessions") {
      return this.handleSessionList(res);
    }
    if (reqUrl.startsWith("/api/sessions/")) {
      const filename = reqUrl.slice("/api/sessions/".length);
      return this.handleSessionLoad(res, filename);
    }
    if (reqUrl === "/api/config") {
      return this.handleConfig(res);
    }

    if (!this.config.webDir) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("oriole-log-server is running. No web viewer built.");
      return;
    }

    const url = reqUrl === "/" ? "/index.html" : reqUrl;
    const filePath = join(this.config.webDir, url);

    // Path traversal protection — ensure resolved path stays within webDir.
    // A startsWith check would let a sibling directory with the same prefix
    // slip through (e.g., webDir `.../web` vs requested `.../web-evil/x`).
    // path.relative returns a `..`-prefixed (or absolute) string when the
    // target is outside the base, which catches the sibling case too.
    const resolvedPath = resolve(filePath);
    const resolvedWebDir = resolve(this.config.webDir);
    const rel = relative(resolvedWebDir, resolvedPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    if (!existsSync(filePath)) {
      // SPA fallback — serve index.html for unknown routes
      const indexPath = join(this.config.webDir, "index.html");
      if (existsSync(indexPath)) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(readFileSync(indexPath));
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(readFileSync(filePath));
  }

  private handleSessionList(res: ServerResponse): void {
    const store = this.config.sessionStore;
    if (!store) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions: [], currentSession: null }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        sessions: store.listSessions(),
        currentSession: store.currentSessionFile,
      }),
    );
  }

  private handleSessionLoad(res: ServerResponse, filename: string): void {
    const store = this.config.sessionStore;
    if (!store) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session store not available" }));
      return;
    }

    const entries = store.loadSession(decodeURIComponent(filename));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ entries }));
  }

  private handleConfig(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        bufferSize: this.bufferSize,
        currentSession: this.config.sessionStore?.currentSessionFile ?? null,
      }),
    );
  }
}
