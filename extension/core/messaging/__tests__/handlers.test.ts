import { describe, it, expect, vi } from "vitest";
import type { Logger, LogEntry } from "@finch/logger";
import { createLogHandler } from "../handlers/log.js";
import { createConnectLogServerHandler } from "../handlers/connect-log-server.js";
import { createPreviewSoundHandler } from "../handlers/preview-sound.js";
import { createExportLogsHandler } from "../handlers/export-logs.js";
import { createClearLogsHandler } from "../handlers/clear-logs.js";

function fakeLogger(): Logger & {
  calls: { level: string; message: string; data?: unknown }[];
} {
  const calls: { level: string; message: string; data?: unknown }[] = [];
  const record =
    (level: string) =>
    (message: string, data?: unknown): void => {
      calls.push({ level, message, data });
    };
  const logger = {
    calls,
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    fatal: record("fatal"),
    child: () => logger,
    log: vi.fn(),
    addTransport: vi.fn(),
    removeTransport: vi.fn(),
    setLevel: vi.fn(),
    flush: vi.fn(),
    dispose: vi.fn(),
  } as unknown as Logger & { calls: typeof calls };
  return logger;
}

describe("createLogHandler", () => {
  it("forwards each level to the matching logger method", () => {
    const logger = fakeLogger();
    const handler = createLogHandler(logger);
    const ctx = { sender: {} as chrome.runtime.MessageSender };

    handler({ type: "LOG", level: "debug", message: "d" }, ctx);
    handler({ type: "LOG", level: "info", message: "i", data: { a: 1 } }, ctx);
    handler({ type: "LOG", level: "warn", message: "w" }, ctx);
    handler({ type: "LOG", level: "error", message: "e" }, ctx);
    handler({ type: "LOG", level: "fatal", message: "f" }, ctx);

    expect(logger.calls).toEqual([
      { level: "debug", message: "d", data: undefined },
      { level: "info", message: "i", data: { a: 1 } },
      { level: "warn", message: "w", data: undefined },
      { level: "error", message: "e", data: undefined },
      { level: "fatal", message: "f", data: undefined },
    ]);
  });

  it("returns success: true synchronously", () => {
    const handler = createLogHandler(fakeLogger());
    const ctx = { sender: {} as chrome.runtime.MessageSender };
    const result = handler({ type: "LOG", level: "info", message: "x" }, ctx);
    expect(result).toEqual({ success: true });
  });
});

describe("createClearLogsHandler", () => {
  it("clears the transport and logs an info entry", async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const transport = { clear } as never;
    const logger = fakeLogger();
    const handler = createClearLogsHandler(transport, logger);

    const result = await handler(
      { type: "CLEAR_LOGS" },
      { sender: {} as chrome.runtime.MessageSender },
    );
    expect(clear).toHaveBeenCalledOnce();
    expect(logger.calls).toEqual([
      { level: "info", message: "Logs cleared from IndexedDB", data: undefined },
    ]);
    expect(result).toEqual({ success: true });
  });

  it("returns the error message when clear() rejects", async () => {
    const transport = { clear: vi.fn().mockRejectedValue(new Error("idb closed")) } as never;
    const handler = createClearLogsHandler(transport, fakeLogger());

    const result = await handler(
      { type: "CLEAR_LOGS" },
      { sender: {} as chrome.runtime.MessageSender },
    );
    expect(result).toEqual({ success: false, error: "idb closed" });
  });
});

describe("createExportLogsHandler", () => {
  function transportWith(entries: LogEntry[]) {
    return { query: vi.fn().mockResolvedValue(entries) } as never;
  }

  it("renders JSON", async () => {
    const handler = createExportLogsHandler(transportWith([]));
    const result = await handler(
      { type: "EXPORT_LOGS", format: "json" },
      { sender: {} as chrome.runtime.MessageSender },
    );
    expect(result.success).toBe(true);
    expect(result.data).toBe("[]");
  });

  it("renders CSV", async () => {
    const handler = createExportLogsHandler(transportWith([]));
    const result = await handler(
      { type: "EXPORT_LOGS", format: "csv" },
      { sender: {} as chrome.runtime.MessageSender },
    );
    expect(result.success).toBe(true);
    expect(result.data?.startsWith("id,timestamp")).toBe(true);
  });

  it("renders HTML", async () => {
    const handler = createExportLogsHandler(transportWith([]));
    const result = await handler(
      { type: "EXPORT_LOGS", format: "html" },
      { sender: {} as chrome.runtime.MessageSender },
    );
    expect(result.success).toBe(true);
    expect(result.data?.includes("<!DOCTYPE html>")).toBe(true);
  });
});

describe("createPreviewSoundHandler", () => {
  it("returns an error when the sound engine has no theme manager yet", async () => {
    const handler = createPreviewSoundHandler({
      getThemeManager: () => null,
      getBackend: () => null,
      logger: fakeLogger(),
    });
    const result = await handler(
      { type: "PREVIEW_SOUND", eventId: "tabs.onCreated" },
      { sender: {} as chrome.runtime.MessageSender },
    );
    expect(result).toEqual({
      success: false,
      error: "Sound engine not initialized",
    });
  });

  it("returns an error for unknown event ids", async () => {
    const handler = createPreviewSoundHandler({
      getThemeManager: () => ({ resolveSound: vi.fn() }) as never,
      getBackend: () => ({ play: vi.fn() }) as never,
      logger: fakeLogger(),
    });
    const result = await handler(
      { type: "PREVIEW_SOUND", eventId: "no.such.event" },
      { sender: {} as chrome.runtime.MessageSender },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown event");
  });

  it("plays the resolved sound and reports backend result", async () => {
    const play = vi.fn().mockResolvedValue({ success: true, latencyMs: 5 });
    const resolveSound = vi.fn().mockReturnValue("/sound.ogg");
    const handler = createPreviewSoundHandler({
      getThemeManager: () => ({ resolveSound }) as never,
      getBackend: () => ({ play }) as never,
      logger: fakeLogger(),
    });

    const result = await handler(
      { type: "PREVIEW_SOUND", eventId: "tabs.onCreated" },
      { sender: {} as chrome.runtime.MessageSender },
    );

    expect(resolveSound).toHaveBeenCalledWith("tabs.onCreated", 1, false);
    expect(play).toHaveBeenCalledWith("/sound.ogg");
    expect(result).toEqual({ success: true, error: undefined });
  });
});

describe("createConnectLogServerHandler", () => {
  it("adds a WebSocket transport using the configured URL", async () => {
    const settings = {
      get: vi.fn().mockResolvedValue("ws://example:9999"),
      set: vi.fn(),
      watch: vi.fn(),
    } as never;
    const logger = fakeLogger();
    const addTransport = vi.spyOn(logger, "addTransport");

    const handler = createConnectLogServerHandler(logger, settings);
    const result = await handler(
      { type: "CONNECT_LOG_SERVER" },
      { sender: {} as chrome.runtime.MessageSender },
    );

    expect(addTransport).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
  });

  it("falls back to the default URL when settings has none", async () => {
    const settings = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
      watch: vi.fn(),
    } as never;
    const logger = fakeLogger();

    const handler = createConnectLogServerHandler(logger, settings);
    const result = await handler(
      { type: "CONNECT_LOG_SERVER" },
      { sender: {} as chrome.runtime.MessageSender },
    );
    expect(result.success).toBe(true);
  });
});
