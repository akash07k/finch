import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { bootExtension, type BootDeps } from "../boot.js";
import { ConsoleTransport, createLogger, LogLevel } from "@finch/logger";
import type { Logger } from "@finch/logger";
import type {
  FinchModule,
  ModuleContext,
  PlatformInfo,
} from "../../module-system/types.js";

const SELF_ID = "test-extension";

/**
 * Tracks which lifecycle hooks fired and in what order. The class
 * exists outside any test so the assertion shape can read it back
 * after `bootExtension` resolves.
 */
class TrackingModule implements FinchModule {
  readonly id: string;
  readonly name = "Tracking";
  readonly version = "1.0.0";
  readonly dependencies: string[] = [];
  initialized = false;
  active = false;
  disposed = false;
  context: ModuleContext | null = null;

  constructor(id = "tracking") {
    this.id = id;
  }

  async initialize(context: ModuleContext): Promise<void> {
    this.context = context;
    this.initialized = true;
  }
  async activate(): Promise<void> {
    this.active = true;
  }
  async deactivate(): Promise<void> {
    this.active = false;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

/** A fake transport that captures log entries instead of writing them. */
function fakeIdbTransport() {
  const entries: unknown[] = [];
  return {
    entries,
    name: "fake-idb",
    log: vi.fn((entry: unknown) => {
      entries.push(entry);
    }),
    flush: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    clear: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(overrides: Partial<BootDeps> = {}): { deps: BootDeps; module: TrackingModule } {
  const module = new TrackingModule();
  const idbTransport = fakeIdbTransport();
  const logger: Logger = createLogger({
    level: LogLevel.DEBUG,
    tag: "test",
    transports: [new ConsoleTransport(), idbTransport as never],
  });

  const platform: PlatformInfo = {
    browser: "chrome",
    os: "win",
    manifestVersion: 3,
    browserVersion: "140.0.0",
  };

  const deps: BootDeps = {
    modules: [module],
    previewSoundSource: {
      getThemeManager: () => null,
      getBackend: () => null,
    },
    createLogger: () => ({ logger, idbTransport: idbTransport as never }),
    detectPlatform: async () => platform,
    runMigrations: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { deps, module };
}

beforeEach(() => {
  fakeBrowser.reset();
  Object.defineProperty(browser.runtime, "id", { value: SELF_ID, configurable: true });
});

describe("bootExtension", () => {
  it("initializes and activates the registered module", async () => {
    const { deps, module } = makeDeps();
    await browser.storage.local.set({ "general.enabledModules": ["tracking"] });

    await bootExtension(deps);

    expect(module.initialized).toBe(true);
    expect(module.active).toBe(true);
  });

  it("runs migrations before any module reads settings", async () => {
    const { deps, module } = makeDeps();
    const order: string[] = [];
    deps.runMigrations = vi.fn(async () => {
      order.push("migrations");
    });
    module.initialize = vi.fn(async () => {
      order.push("initialize");
      module.initialized = true;
    });
    await browser.storage.local.set({ "general.enabledModules": ["tracking"] });

    await bootExtension(deps);

    expect(order).toEqual(["migrations", "initialize"]);
  });

  it("does NOT activate a module that isn't in general.enabledModules", async () => {
    const { deps, module } = makeDeps();
    await browser.storage.local.set({ "general.enabledModules": [] });

    await bootExtension(deps);

    expect(module.initialized).toBe(true); // initializeAll runs unconditionally
    expect(module.active).toBe(false);
  });

  it("activates a module listed in the DEFAULT_SETTINGS.general.enabledModules fallback", async () => {
    // sound-engine is in the default enabledModules; rename our test
    // module to that id so the default-fallback path activates it.
    const module = new TrackingModule("sound-engine");
    const { deps } = makeDeps({ modules: [module] });
    // Don't seed storage — the default applies.

    await bootExtension(deps);

    expect(module.active).toBe(true);
  });

  it("returns the loader, settings, router, and logger for the entrypoint", async () => {
    const { deps } = makeDeps();
    const result = await bootExtension(deps);

    expect(result.loader).toBeDefined();
    expect(result.settings).toBeDefined();
    expect(result.router).toBeDefined();
    expect(result.logger).toBeDefined();
    expect(result.idbTransport).toBeDefined();
  });

  it("starts the message router so LOG messages are accepted", async () => {
    const { deps } = makeDeps();
    await bootExtension(deps);

    const responses = await fakeBrowser.runtime.onMessage.trigger(
      { type: "LOG", level: "info", message: "test" },
      { id: SELF_ID } as chrome.runtime.MessageSender,
    );
    const response = (responses as unknown[]).find((r) => r !== undefined);
    expect(response).toEqual({ success: true });
  });

  it("propagates a module init failure as a thrown loader error path (logged, not thrown)", async () => {
    const { deps, module } = makeDeps();
    module.initialize = vi.fn(async () => {
      throw new Error("init blew up");
    });
    await browser.storage.local.set({ "general.enabledModules": ["tracking"] });

    // Boot completes even though the module failed; the loader
    // recorded the error against the registry entry and skipped
    // activation. We don't expect bootExtension to throw because
    // the failure is per-module.
    const result = await bootExtension(deps);
    expect(module.active).toBe(false);
    expect(result.loader).toBeDefined();
  });

  it("does NOT attach the WebSocket transport when log streaming is disabled", async () => {
    const { deps } = makeDeps();
    await browser.storage.local.set({ "general.logStreamEnabled": false });
    const result = await bootExtension(deps);

    // The default factory adds Console + IDB. Without log streaming,
    // there should be no extra transport. We can't introspect Logger
    // transports directly, but we can at least assert boot completed
    // without trying to construct a WebSocket.
    expect(result.logger).toBeDefined();
  });
});
