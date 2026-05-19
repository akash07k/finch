import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { Command } from "commander";
import { LogServer } from "./ws-server.js";
import { FileWriter } from "./file-writer.js";
import { SessionStore } from "./session-store.js";
import { formatForTerminal } from "./terminal-formatter.js";
import type { LogEntry } from "./types.js";

const LEVEL_MAP: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

/** Typed options produced by {@link parseCliArgs} and consumed by {@link startServer}. */
export interface CliOptions {
  /** WebSocket port to listen on (default: 8089). */
  port: number;
  /** Optional path to also write formatted logs to a file. */
  file?: string;
  /** Minimum numeric log level to display (0=DEBUG, 4=FATAL; default: 0). */
  level: number;
  /** Optional tag prefix filter. */
  tag?: string;
  /** Whether to enable coloured terminal output (default: false). */
  color: boolean;
  /** In-memory replay buffer size (default: 1000). */
  bufferSize: number;
  /** Override for the session storage directory. */
  logDir?: string;
  /** Maximum number of session files to retain (default: 50). */
  maxSessions: number;
}

/**
 * Parse raw CLI arguments into typed {@link CliOptions}.
 * Exported separately so tests can invoke the parser without spawning a server.
 *
 * @param argv - Raw argument strings, typically process.argv.slice(2).
 * @returns Fully typed options with all defaults applied.
 */
export function parseCliArgs(argv: string[]): CliOptions {
  const program = new Command();

  program
    .name("oriole-log-server")
    .description("Accessible log viewer and WebSocket server for @oriole/logger")
    .version("0.0.1")
    .option("-p, --port <number>", "WebSocket port", "8089")
    .option("-f, --file <path>", "Also write logs to a file")
    .option(
      "-l, --level <level>",
      "Minimum level to display (debug, info, warn, error, fatal)",
      "debug",
    )
    .option("-t, --tag <prefix>", "Filter by tag prefix")
    .option("--color", "Enable colored output", false)
    .option("-b, --buffer-size <number>", "In-memory buffer size (0 for unlimited)", "1000")
    .option("--log-dir <path>", "Session storage directory (default: ~/.oriole-logs)")
    .option("--max-sessions <number>", "Max session files to keep", "50");

  program.parse(argv, { from: "user" });
  const opts = program.opts();

  return {
    port: Number(opts.port),
    file: opts.file as string | undefined,
    level: LEVEL_MAP[opts.level as string] ?? 0,
    tag: opts.tag as string | undefined,
    color: Boolean(opts.color),
    bufferSize: Number(opts.bufferSize),
    logDir: opts.logDir as string | undefined,
    maxSessions: Number(opts.maxSessions),
  };
}

/**
 * Start the log server with the given options.
 * Installs a SIGINT handler for graceful shutdown.
 *
 * @param options - Parsed CLI options (see {@link parseCliArgs}).
 */
export async function startServer(options: CliOptions): Promise<void> {
  // Resolve web viewer directory.
  // Primary: dist/web/ relative to the package root (works in both prod and dev).
  // Fallback: web/ adjacent to thisDir (only in prod where dist/bin.js sits next to dist/web/).
  // Dev mode (tsx src/cli.ts): thisDir is src/, so builtWebDir is src/web/
  //   which has unbuilt .tsx files — distWebDir always wins in dev.
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const distWebDir = join(thisDir, "..", "dist", "web");
  const builtWebDir = join(thisDir, "web");
  const webDir = existsSync(join(distWebDir, "index.html"))
    ? distWebDir
    : existsSync(join(builtWebDir, "index.html"))
      ? builtWebDir
      : null;
  const hasWebViewer = webDir !== null;

  // Create session store for persistence
  const sessionStore = new SessionStore({
    logDir: options.logDir,
    maxSessions: options.maxSessions,
  });

  const server = new LogServer({
    port: options.port,
    webDir: hasWebViewer ? webDir! : undefined,
    bufferSize: options.bufferSize,
    sessionStore,
  });
  const fileWriter = options.file ? new FileWriter(options.file) : null;

  server.on("entry", (entry: LogEntry) => {
    // Always persist to session file (before filtering)
    sessionStore.append(entry);

    if (entry.level < options.level) return;
    if (options.tag && !entry.tag.startsWith(options.tag)) return;

    console.log(formatForTerminal(entry));
    server.broadcast(entry);

    if (fileWriter) {
      fileWriter.write(entry);
    }
  });

  const port = await server.start();
  console.log(`oriole-log-server listening on ws://localhost:${port}`);
  if (hasWebViewer) {
    console.log(`Web viewer: http://localhost:${port}`);
  }
  console.log(`Session: ${sessionStore.currentSessionFile}`);

  process.on("SIGINT", async () => {
    fileWriter?.close();
    await server.stop();
    process.exit(0);
  });
}
