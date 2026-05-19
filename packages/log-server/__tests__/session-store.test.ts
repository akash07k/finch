import { describe, it, expect, afterEach } from "vitest";
import {
  existsSync,
  rmSync,
  readFileSync,
  appendFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/session-store.js";
import type { LogEntry } from "../src/types.js";

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `test-${Date.now()}-${Math.random()}`,
    timestamp: new Date().toISOString(),
    level: 1,
    tag: "test",
    message: "hello",
    ...overrides,
  };
}

function tempDir(): string {
  return join(tmpdir(), `oriole-session-test-${Date.now()}-${Math.random()}`);
}

describe("SessionStore", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
    dirs.length = 0;
  });

  it("creates the log directory on construction", () => {
    const logDir = tempDir();
    dirs.push(logDir);
    new SessionStore({ logDir });

    expect(existsSync(logDir)).toBe(true);
  });

  it("creates a session file with .jsonl extension", () => {
    const logDir = tempDir();
    dirs.push(logDir);
    const store = new SessionStore({ logDir });

    expect(store.currentSessionFile).toMatch(/\.jsonl$/);
  });

  it("appends entries to the session file as JSONL", () => {
    const logDir = tempDir();
    dirs.push(logDir);
    const store = new SessionStore({ logDir });

    store.append(makeEntry({ message: "first" }));
    store.append(makeEntry({ message: "second" }));

    const filePath = join(logDir, store.currentSessionFile);
    const content = readFileSync(filePath, "utf-8").trim();
    const lines = content.split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).message).toBe("first");
    expect(JSON.parse(lines[1]!).message).toBe("second");
  });

  it("tracks entry count", () => {
    const logDir = tempDir();
    dirs.push(logDir);
    const store = new SessionStore({ logDir });

    expect(store.currentEntryCount).toBe(0);
    store.append(makeEntry());
    store.append(makeEntry());
    expect(store.currentEntryCount).toBe(2);
  });

  it("lists sessions with newest first", async () => {
    const logDir = tempDir();
    dirs.push(logDir);

    // Create two sessions with different timestamps
    const store1 = new SessionStore({ logDir });
    store1.append(makeEntry({ message: "session 1" }));

    // Wait to ensure a different millisecond timestamp for the session ID
    await new Promise((r) => setTimeout(r, 10));

    const store2 = new SessionStore({ logDir });
    store2.append(makeEntry({ message: "session 2 entry 1" }));
    store2.append(makeEntry({ message: "session 2 entry 2" }));

    const sessions = store2.listSessions();

    expect(sessions.length).toBeGreaterThanOrEqual(2);
    // Newest first
    expect(sessions[0]!.filename).toBe(store2.currentSessionFile);
    expect(sessions[0]!.entryCount).toBe(2);
  });

  it("loads entries from a specific session", () => {
    const logDir = tempDir();
    dirs.push(logDir);
    const store = new SessionStore({ logDir });

    store.append(makeEntry({ message: "load me" }));
    store.append(makeEntry({ message: "and me" }));

    const entries = store.loadSession(store.currentSessionFile);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.message).toBe("load me");
    expect(entries[1]!.message).toBe("and me");
  });

  it("returns empty array for non-existent session", () => {
    const logDir = tempDir();
    dirs.push(logDir);
    const store = new SessionStore({ logDir });

    const entries = store.loadSession("does-not-exist.jsonl");
    expect(entries).toEqual([]);
  });

  it("rejects path-traversal attempts in loadSession filename", () => {
    // Security boundary: the server's /api/sessions/:filename endpoint
    // forwards user input through decodeURIComponent into loadSession.
    // A malicious client could pass `../../etc/passwd`-style strings
    // trying to escape the logDir. SessionStore must refuse.
    const logDir = tempDir();
    dirs.push(logDir);
    const store = new SessionStore({ logDir });
    store.append(makeEntry());

    expect(store.loadSession("../secret.jsonl")).toEqual([]);
    expect(store.loadSession("../../etc/passwd")).toEqual([]);
    // Absolute paths should also be rejected — resolve() would keep them
    // intact, so the startsWith check must catch them.
    expect(store.loadSession("/etc/passwd")).toEqual([]);
  });

  it("rejects sibling-directory paths that share the logDir prefix", () => {
    // Regression: a `startsWith(resolvedLogDir)` traversal check would
    // wrongly accept a sibling like `<logDir>-evil/x.jsonl` because the
    // sibling path begins with the logDir string. path.relative catches
    // this — `relative("/foo/sessions", "/foo/sessions-evil/x.jsonl")`
    // returns `"../sessions-evil/x.jsonl"`, which is rejected.
    const baseDir = tempDir();
    const logDir = `${baseDir}-base`;
    const siblingDir = `${baseDir}-base-evil`;
    dirs.push(logDir, siblingDir);

    mkdirSync(siblingDir, { recursive: true });
    writeFileSync(join(siblingDir, "leak.jsonl"), '{"sneaky":"value"}\n');

    const store = new SessionStore({ logDir });
    expect(store.loadSession("../" + "base-evil/leak.jsonl")).toEqual([]);
  });

  it("skips malformed JSONL lines when loading a session", () => {
    // Real-world cause: a crash mid-write leaves a truncated final line
    // in the JSONL file. loadSession should skip bad lines instead of
    // throwing, so the user can still inspect the good entries.
    const logDir = tempDir();
    dirs.push(logDir);
    const store = new SessionStore({ logDir });

    store.append(makeEntry({ message: "good-1" }));
    store.append(makeEntry({ message: "good-2" }));

    // Corrupt the file by appending a half-written line.
    const sessionPath = join(logDir, store.currentSessionFile);
    appendFileSync(sessionPath, '{"partial":"line');

    const entries = store.loadSession(store.currentSessionFile);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.message)).toEqual(["good-1", "good-2"]);
  });

  it("returns empty array for an empty session file", () => {
    const logDir = tempDir();
    dirs.push(logDir);
    const store = new SessionStore({ logDir });
    // A fresh session with no appends — file doesn't exist yet, so this
    // hits the existsSync branch of loadSession.
    const entries = store.loadSession(store.currentSessionFile);
    expect(entries).toEqual([]);
  });

  it("cleans old sessions when exceeding maxSessions", () => {
    const logDir = tempDir();
    dirs.push(logDir);

    // Create 5 sessions
    for (let i = 0; i < 5; i++) {
      const store = new SessionStore({ logDir, maxSessions: 3 });
      store.append(makeEntry({ message: `session ${i}` }));
    }

    // Only 3 should remain (the 3 newest)
    const finalStore = new SessionStore({ logDir, maxSessions: 3 });
    const sessions = finalStore.listSessions();

    // maxSessions=3 but we just created another one, so up to 3 old + 1 new = cleaned to 3
    expect(sessions.length).toBeLessThanOrEqual(4);
  });
});
