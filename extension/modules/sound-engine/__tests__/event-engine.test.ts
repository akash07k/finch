import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEngine } from "../event-engine.js";
import type { EventDefinition } from "../types.js";
import type { MessageBus } from "../../../core/module-system/types.js";
import type { Logger } from "@oriole/logger";

/**
 * Mock browser API that simulates WXT's browser global.
 * Each namespace.event has an addListener method that stores callbacks.
 */
function createMockBrowser() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  function getOrCreateEvent(namespace: string, event: string) {
    const key = `${namespace}.${event}`;
    if (!listeners.has(key)) {
      listeners.set(key, []);
    }
    return {
      addListener: (fn: (...args: unknown[]) => void) => {
        listeners.get(key)!.push(fn);
      },
    };
  }

  /** Simulate firing a browser event. */
  function fireEvent(namespace: string, event: string, ...args: unknown[]) {
    const key = `${namespace}.${event}`;
    for (const listener of listeners.get(key) ?? []) {
      listener(...args);
    }
  }

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, namespace: string) {
      return new Proxy(
        {},
        {
          get(_t, event: string) {
            return getOrCreateEvent(namespace, event);
          },
        },
      );
    },
  };

  return {
    browser: new Proxy({} as Record<string, unknown>, handler),
    fireEvent,
    listeners,
  };
}

/** Creates a minimal mock logger. */
function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => createMockLogger(),
    addTransport: vi.fn(),
    flush: async () => {},
    dispose: async () => {},
  };
}

/** Creates a mock message bus that tracks published messages. */
function createMockBus(): MessageBus & { messages: { channel: string; data: unknown }[] } {
  const messages: { channel: string; data: unknown }[] = [];
  return {
    messages,
    publish: (channel: string, data: unknown) => {
      messages.push({ channel, data });
    },
    subscribe: () => () => {},
  };
}

describe("EventEngine", () => {
  let mockBrowser: ReturnType<typeof createMockBrowser>;
  let bus: ReturnType<typeof createMockBus>;
  let logger: Logger;
  let engine: EventEngine;

  beforeEach(() => {
    mockBrowser = createMockBrowser();
    bus = createMockBus();
    logger = createMockLogger();
    engine = new EventEngine(mockBrowser.browser, bus, logger);
  });

  it("registers a listener for a simple event", () => {
    const events: EventDefinition[] = [
      {
        id: "tabs.onCreated",
        namespace: "tabs",
        event: "onCreated",
        label: "Tab Created",
        description: "A new tab was created.",
        tier: 1,
        category: "tabs",
        platforms: ["chrome", "firefox"],

        permissions: [],
      },
    ];

    engine.registerAll(events, "chrome");

    expect(mockBrowser.listeners.get("tabs.onCreated")).toHaveLength(1);
  });

  it("publishes to message bus when event fires", () => {
    const events: EventDefinition[] = [
      {
        id: "tabs.onCreated",
        namespace: "tabs",
        event: "onCreated",
        label: "Tab Created",
        description: "A new tab was created.",
        tier: 1,
        category: "tabs",
        platforms: ["chrome", "firefox"],

        permissions: [],
      },
    ];

    engine.registerAll(events, "chrome");
    mockBrowser.fireEvent("tabs", "onCreated", { id: 42 });

    expect(bus.messages).toHaveLength(1);
    expect(bus.messages[0]!.channel).toBe("browser-event");
    expect(bus.messages[0]!.data).toMatchObject({ eventId: "tabs.onCreated" });
  });

  it("applies filter function for sub-events", () => {
    const events: EventDefinition[] = [
      {
        id: "tabs.onUpdated.loading",
        namespace: "tabs",
        event: "onUpdated",
        label: "Page Loading",
        description: "Tab started loading.",
        tier: 1,
        category: "tabs",
        platforms: ["chrome", "firefox"],

        permissions: [],
        filter: (_tabId: unknown, changeInfo: unknown) =>
          (changeInfo as { status?: string })?.status === "loading",
      },
    ];

    engine.registerAll(events, "chrome");

    // Fire with status "loading" — should publish
    mockBrowser.fireEvent("tabs", "onUpdated", 42, { status: "loading" }, {});
    expect(bus.messages).toHaveLength(1);

    // Fire with status "complete" — should NOT publish
    mockBrowser.fireEvent("tabs", "onUpdated", 42, { status: "complete" }, {});
    expect(bus.messages).toHaveLength(1); // still 1
  });

  it("skips events not supported on current platform", () => {
    const events: EventDefinition[] = [
      {
        id: "tabGroups.onCreated",
        namespace: "tabGroups",
        event: "onCreated",
        label: "Tab Group Created",
        description: "A tab group was created.",
        tier: 2,
        category: "tab-groups",
        platforms: ["chrome"], // Chrome only
        permissions: [],
      },
    ];

    engine.registerAll(events, "firefox"); // Running on Firefox

    // Should not have registered a listener
    expect(mockBrowser.listeners.get("tabGroups.onCreated") ?? []).toHaveLength(0);
  });

  it("handles multiple events on the same browser API", async () => {
    const events: EventDefinition[] = [
      {
        id: "tabs.onUpdated.loading",
        namespace: "tabs",
        event: "onUpdated",
        label: "Loading",
        description: "Loading.",
        tier: 1,
        category: "tabs",
        platforms: ["chrome"],

        permissions: [],
        filter: (_t: unknown, c: unknown) => (c as { status?: string })?.status === "loading",
      },
      {
        id: "tabs.onUpdated.complete",
        namespace: "tabs",
        event: "onUpdated",
        label: "Complete",
        description: "Complete.",
        tier: 1,
        category: "tabs",
        platforms: ["chrome"],

        permissions: [],
        filter: (_t: unknown, c: unknown) => (c as { status?: string })?.status === "complete",
      },
    ];

    engine.registerAll(events, "chrome");

    // Both listeners registered on the same browser event
    expect(mockBrowser.listeners.get("tabs.onUpdated")).toHaveLength(2);

    // Fire with "loading" — only the loading event publishes. The
    // event engine no longer applies a global cooldown (that lives in
    // SoundEngineModule), so back-to-back fires publish immediately.
    mockBrowser.fireEvent("tabs", "onUpdated", 1, { status: "loading" }, {});
    await Promise.resolve(); // flush the async handler microtask
    expect(bus.messages).toHaveLength(1);
    expect(bus.messages[0]!.data).toMatchObject({ eventId: "tabs.onUpdated.loading" });

    // Fire with "complete" — only the complete event publishes
    mockBrowser.fireEvent("tabs", "onUpdated", 1, { status: "complete" }, {});
    await Promise.resolve();
    expect(bus.messages).toHaveLength(2);
    expect(bus.messages[1]!.data).toMatchObject({ eventId: "tabs.onUpdated.complete" });
  });

  it("includes extracted data in the published message", () => {
    const events: EventDefinition[] = [
      {
        id: "tabs.onCreated",
        namespace: "tabs",
        event: "onCreated",
        label: "Tab Created",
        description: "A tab was created.",
        tier: 1,
        category: "tabs",
        platforms: ["chrome"],

        permissions: [],
        extractData: (tab: unknown) => ({
          tabId: (tab as { id?: number })?.id,
        }),
      },
    ];

    engine.registerAll(events, "chrome");
    mockBrowser.fireEvent("tabs", "onCreated", { id: 99 });

    expect(bus.messages[0]!.data).toMatchObject({
      eventId: "tabs.onCreated",
      extractedData: { tabId: 99 },
    });
  });
});
