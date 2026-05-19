import {
  mkdirSync,
  appendFileSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { LogEntry } from "./types.js";

/** Configuration options for {@link SessionStore}. */
export interface SessionStoreConfig {
  /** Directory for session files (default: ~/.oriole-logs) */
  logDir?: string;
  /** Max session files to keep (default: 50) */
  maxSessions?: number;
}

/** Metadata for a single persisted log session. Returned by {@link SessionStore.listSessions}. */
export interface SessionInfo {
  /** Session filename (without path) */
  filename: string;
  /** Session start time as ISO string */
  startedAt: string;
  /** Number of entries in the session */
  entryCount: number;
}

const DEFAULT_LOG_DIR = join(homedir(), ".oriole-logs", "sessions");
const DEFAULT_MAX_SESSIONS = 50;

/**
 * Persists log entries to per-session JSONL files.
 * Each server start creates a new session file.
 * Old sessions are auto-cleaned based on maxSessions.
 */
export class SessionStore {
  private readonly logDir: string;
  private readonly maxSessions: number;
  private readonly sessionFile: string;
  private readonly sessionId: string;
  private entryCount = 0;

  /**
   * @param config - Optional configuration. Creates the log directory
   *   and prunes old sessions if count exceeds maxSessions.
   */
  constructor(config: SessionStoreConfig = {}) {
    this.logDir = config.logDir ?? DEFAULT_LOG_DIR;
    this.maxSessions = config.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.sessionId = new Date().toISOString().replace(/[:.]/g, "-");
    this.sessionFile = join(this.logDir, `${this.sessionId}.jsonl`);

    mkdirSync(this.logDir, { recursive: true });
    this.cleanOldSessions();
  }

  /**
   * Append a log entry to the current session file as a JSONL line.
   * @param entry - The log entry to persist.
   */
  append(entry: LogEntry): void {
    appendFileSync(this.sessionFile, JSON.stringify(entry) + "\n");
    this.entryCount++;
  }

  /**
   * List all available sessions, newest first.
   * @returns Array of SessionInfo objects sorted by descending start time.
   */
  listSessions(): SessionInfo[] {
    if (!existsSync(this.logDir)) return [];

    return readdirSync(this.logDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse()
      .map((filename) => {
        const filePath = join(this.logDir, filename);
        const content = readFileSync(filePath, "utf-8").trim();
        const entryCount = content ? content.split("\n").length : 0;

        return {
          filename,
          startedAt: this.filenameToDate(filename),
          entryCount,
        };
      });
  }

  /**
   * Load all entries from a specific session file.
   * @param filename - Session filename (basename only). Path traversal
   *   attempts return an empty array rather than throwing.
   * @returns Parsed log entries, or empty array if file is missing/invalid.
   */
  loadSession(filename: string): LogEntry[] {
    const filePath = resolve(this.logDir, filename);

    // Prevent path traversal — resolved path must stay within logDir.
    // A startsWith check would let `../sessions-evil/x.jsonl` slip through
    // when logDir is `.../sessions` because the sibling shares the prefix.
    // path.relative returns a `..`-prefixed (or absolute) string when the
    // target is outside the base, which catches the sibling case too.
    const resolvedBase = resolve(this.logDir);
    const rel = relative(resolvedBase, filePath);
    if (rel.startsWith("..") || isAbsolute(rel)) return [];

    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) return [];

    const entries: LogEntry[] = [];
    for (const line of content.split("\n")) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        // Skip malformed JSONL lines (partial writes, truncation)
      }
    }
    return entries;
  }

  /** Get the current session filename. */
  get currentSessionFile(): string {
    return `${this.sessionId}.jsonl`;
  }

  /** Get the current session entry count. */
  get currentEntryCount(): number {
    return this.entryCount;
  }

  private filenameToDate(filename: string): string {
    // Filename format: 2026-03-31T02-30-00-000Z.jsonl
    // Restore to: 2026-03-31T02:30:00.000Z
    const base = filename.replace(".jsonl", "");
    const parts = base.split("T");
    if (parts.length !== 2) return base;
    const timePart = parts[1]!
      .replace(/-/g, ":")
      .replace(/:(\d{3})Z$/, ".$1Z")
      .replace(/:(\d{3})$/, ".$1");
    return `${parts[0]}T${timePart}`;
  }

  private cleanOldSessions(): void {
    if (!existsSync(this.logDir)) return;

    const files = readdirSync(this.logDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort();

    const excess = files.length - this.maxSessions;
    if (excess <= 0) return;

    for (let i = 0; i < excess; i++) {
      unlinkSync(join(this.logDir, files[i]!));
    }
  }
}
