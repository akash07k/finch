import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileWriter } from "../src/file-writer.js";
import type { LogEntry } from "../src/types.js";

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: "test-1",
    timestamp: "2026-03-30T13:51:00.331Z",
    level: 1,
    tag: "test",
    message: "hello",
    ...overrides,
  };
}

function tempPath(): string {
  return join(tmpdir(), `finch-test-${Date.now()}-${Math.random()}.log`);
}

describe("FileWriter", () => {
  const paths: string[] = [];

  afterEach(() => {
    for (const p of paths) {
      if (existsSync(p)) unlinkSync(p);
    }
    paths.length = 0;
  });

  it("creates the file on first write", () => {
    const path = tempPath();
    paths.push(path);
    const writer = new FileWriter(path);

    writer.write(makeEntry());
    writer.close();

    expect(existsSync(path)).toBe(true);
  });

  it("writes formatted log entries", () => {
    const path = tempPath();
    paths.push(path);
    const writer = new FileWriter(path);

    writer.write(makeEntry({ message: "test message" }));
    writer.close();

    const content = readFileSync(path, "utf-8");
    expect(content).toContain("test message");
    expect(content).toContain("INFO:");
  });

  it("appends multiple entries with newlines", () => {
    const path = tempPath();
    paths.push(path);
    const writer = new FileWriter(path);

    writer.write(makeEntry({ message: "first" }));
    writer.write(makeEntry({ message: "second" }));
    writer.close();

    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
  });

  it("can be closed and reopened", () => {
    const path = tempPath();
    paths.push(path);

    const writer1 = new FileWriter(path);
    writer1.write(makeEntry({ message: "before" }));
    writer1.close();

    const writer2 = new FileWriter(path);
    writer2.write(makeEntry({ message: "after" }));
    writer2.close();

    const content = readFileSync(path, "utf-8");
    expect(content).toContain("before");
    expect(content).toContain("after");
  });
});
