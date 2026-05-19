import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { MessageRouter } from "../router.js";
import type { ExtensionResponse } from "../types.js";

const SELF_ID = "test-extension";

beforeEach(() => {
  fakeBrowser.reset();
  Object.defineProperty(browser.runtime, "id", { value: SELF_ID, configurable: true });
});

async function dispatch(
  message: unknown,
  sender: Partial<chrome.runtime.MessageSender> = { id: SELF_ID },
): Promise<unknown[]> {
  return fakeBrowser.runtime.onMessage.trigger(
    message,
    sender as chrome.runtime.MessageSender,
  );
}

function firstResponse(results: unknown[]): unknown {
  return results.find((r) => r !== undefined);
}

describe("MessageRouter", () => {
  it("routes a registered sync message to its handler", async () => {
    const router = new MessageRouter();
    const handler = vi.fn().mockReturnValue({ success: true });
    router.register("LOG", handler);
    router.start();

    const message = { type: "LOG", level: "info", message: "hi" };
    const results = await dispatch(message);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0]).toEqual(message);
    expect(firstResponse(results)).toEqual({ success: true });
  });

  it("awaits an async handler before responding", async () => {
    const router = new MessageRouter();
    let resolve!: (value: ExtensionResponse) => void;
    const pending = new Promise<ExtensionResponse>((r) => {
      resolve = r;
    });
    router.register("CLEAR_LOGS", () => pending);
    router.start();

    const responsePromise = dispatch({ type: "CLEAR_LOGS" });
    resolve({ success: true });
    expect(firstResponse(await responsePromise)).toEqual({ success: true });
  });

  it("converts a thrown error into an ExtensionResponse", async () => {
    const router = new MessageRouter();
    router.register("LOG", () => {
      throw new Error("boom");
    });
    router.start();

    const response = firstResponse(
      await dispatch({ type: "LOG", level: "info", message: "x" }),
    ) as ExtensionResponse;
    expect(response.success).toBe(false);
    expect(response.error).toBe("boom");
  });

  it("converts an async rejection into an ExtensionResponse", async () => {
    const router = new MessageRouter();
    router.register("EXPORT_LOGS", async () => {
      throw new Error("idb closed");
    });
    router.start();

    const response = firstResponse(
      await dispatch({ type: "EXPORT_LOGS", format: "json" }),
    ) as ExtensionResponse;
    expect(response.success).toBe(false);
    expect(response.error).toBe("idb closed");
  });

  it("ignores messages from foreign extensions", async () => {
    const router = new MessageRouter();
    const handler = vi.fn().mockReturnValue({ success: true });
    router.register("LOG", handler);
    router.start();

    const results = await dispatch(
      { type: "LOG", level: "info", message: "x" },
      { id: "other-extension" },
    );
    expect(handler).not.toHaveBeenCalled();
    expect(firstResponse(results)).toBeUndefined();
  });

  it("ignores messages with unknown type", async () => {
    const router = new MessageRouter();
    const handler = vi.fn().mockReturnValue({ success: true });
    router.register("LOG", handler);
    router.start();

    const results = await dispatch({ type: "UNKNOWN" });
    expect(handler).not.toHaveBeenCalled();
    expect(firstResponse(results)).toBeUndefined();
  });

  it("ignores messages without a type field", async () => {
    const router = new MessageRouter();
    const handler = vi.fn();
    router.register("LOG", handler);
    router.start();

    await dispatch({ payload: "no type" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("stop() removes the listener", async () => {
    const router = new MessageRouter();
    const handler = vi.fn().mockReturnValue({ success: true });
    router.register("LOG", handler);
    router.start();
    router.stop();

    await dispatch({ type: "LOG", level: "info", message: "x" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("start() is idempotent — a second call doesn't double-register", async () => {
    const router = new MessageRouter();
    const handler = vi.fn().mockReturnValue({ success: true });
    router.register("LOG", handler);
    router.start();
    router.start();

    await dispatch({ type: "LOG", level: "info", message: "x" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("re-registering a type replaces the previous handler", async () => {
    const router = new MessageRouter();
    const first = vi.fn().mockReturnValue({ success: true });
    const second = vi.fn().mockReturnValue({ success: true, data: "second" });
    router.register("LOG", first);
    router.register("LOG", second);
    router.start();

    const response = firstResponse(
      await dispatch({ type: "LOG", level: "info", message: "x" }),
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(response).toEqual({ success: true, data: "second" });
  });

  it("passes the sender on the message context", async () => {
    const router = new MessageRouter();
    const handler = vi.fn().mockReturnValue({ success: true });
    router.register("LOG", handler);
    router.start();

    const sender = { id: SELF_ID, url: "options.html" } as chrome.runtime.MessageSender;
    await dispatch({ type: "LOG", level: "info", message: "x" }, sender);

    expect(handler.mock.calls[0]![1]).toEqual({ sender });
  });
});
