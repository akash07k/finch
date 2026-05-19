import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModuleLoader } from "../loader.js";
import { ModuleRegistry } from "../registry.js";
import type { OrioleModule, ModuleContext } from "../types.js";

/**
 * Creates a mock module with spied lifecycle methods.
 * The `initOrder` array tracks the order modules are initialized,
 * which lets us verify topological sort correctness.
 */
function createMockModule(
  id: string,
  options?: {
    dependencies?: string[];
    initOrder?: string[];
    failOnInitialize?: boolean;
    failOnActivate?: boolean;
    failOnDispose?: boolean;
  },
): OrioleModule {
  return {
    id,
    name: `Test: ${id}`,
    version: "1.0.0",
    dependencies: options?.dependencies,
    initialize: vi.fn(async () => {
      if (options?.failOnInitialize) {
        throw new Error(`${id} failed to initialize`);
      }
      options?.initOrder?.push(id);
    }),
    activate: vi.fn(async () => {
      if (options?.failOnActivate) {
        throw new Error(`${id} failed to activate`);
      }
    }),
    deactivate: vi.fn(async () => {}),
    dispose: vi.fn(async () => {
      if (options?.failOnDispose) {
        throw new Error(`${id} failed to dispose`);
      }
    }),
  };
}

/** Creates a minimal mock ModuleContext for testing. */
function createMockContext(): ModuleContext {
  return {
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: () => createMockContext().logger,
      addTransport: () => {},
      flush: async () => {},
      dispose: async () => {},
    },
    messageBus: {
      publish: () => {},
      subscribe: () => () => {},
    },
    settings: {
      get: async () => undefined,
      set: async () => {},
      watch: () => () => {},
    },
    platform: {
      browser: "chrome",
      manifestVersion: 3,
      browserVersion: "120.0",
      os: "win",
    },
  };
}

describe("ModuleLoader", () => {
  let registry: ModuleRegistry;
  let loader: ModuleLoader;
  let context: ModuleContext;

  beforeEach(() => {
    registry = new ModuleRegistry();
    context = createMockContext();
    loader = new ModuleLoader(registry, context);
  });

  describe("initializeAll", () => {
    it("initializes a single module", async () => {
      const module = createMockModule("a");
      registry.register(module);

      await loader.initializeAll();

      expect(module.initialize).toHaveBeenCalledOnce();
      expect(registry.get("a")!.state).toBe("initialized");
    });

    it("initializes modules in dependency order", async () => {
      const initOrder: string[] = [];

      // c depends on b, b depends on a
      const a = createMockModule("a", { initOrder });
      const b = createMockModule("b", { dependencies: ["a"], initOrder });
      const c = createMockModule("c", { dependencies: ["b"], initOrder });

      registry.register(c);
      registry.register(a);
      registry.register(b);

      await loader.initializeAll();

      expect(initOrder).toEqual(["a", "b", "c"]);
    });

    it("handles independent modules in any order", async () => {
      const initOrder: string[] = [];

      const a = createMockModule("a", { initOrder });
      const b = createMockModule("b", { initOrder });

      registry.register(a);
      registry.register(b);

      await loader.initializeAll();

      // Both initialized, order doesn't matter for independent modules
      expect(initOrder).toHaveLength(2);
      expect(initOrder).toContain("a");
      expect(initOrder).toContain("b");
    });

    it("detects circular dependencies", async () => {
      const a = createMockModule("a", { dependencies: ["b"] });
      const b = createMockModule("b", { dependencies: ["a"] });

      registry.register(a);
      registry.register(b);

      await expect(loader.initializeAll()).rejects.toThrow(/circular dependency/i);
    });

    it("skips dependents when a dependency fails to initialize", async () => {
      const a = createMockModule("a", { failOnInitialize: true });
      const b = createMockModule("b", { dependencies: ["a"] });

      registry.register(a);
      registry.register(b);

      await loader.initializeAll();

      expect(registry.get("a")!.state).toBe("error");
      expect(registry.get("b")!.state).toBe("error");
      expect(b.initialize).not.toHaveBeenCalled();
    });

    it("logs an error via the context logger when a module fails to initialize", async () => {
      // Regression guard: the init failure must surface through the
      // logger, not only through registry.setError, so an operator
      // watching the log stream sees the failure without having to
      // introspect registry state.
      const errorSpy = vi.spyOn(context.logger, "error");
      const a = createMockModule("a", { failOnInitialize: true });
      registry.register(a);

      await loader.initializeAll();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"a" failed to initialize'),
        expect.any(Error),
      );
    });

    it("throws for missing dependency", async () => {
      const a = createMockModule("a", { dependencies: ["nonexistent"] });
      registry.register(a);

      await expect(loader.initializeAll()).rejects.toThrow(/not registered/i);
    });
  });

  describe("activate / deactivate", () => {
    it("activates an initialized module", async () => {
      const module = createMockModule("a");
      registry.register(module);
      await loader.initializeAll();

      await loader.activate("a");

      expect(module.activate).toHaveBeenCalledOnce();
      expect(registry.get("a")!.state).toBe("active");
    });

    it("deactivates an active module", async () => {
      const module = createMockModule("a");
      registry.register(module);
      await loader.initializeAll();
      await loader.activate("a");

      await loader.deactivate("a");

      expect(module.deactivate).toHaveBeenCalledOnce();
      expect(registry.get("a")!.state).toBe("inactive");
    });

    it("cannot activate a module whose dependency is not active", async () => {
      const a = createMockModule("a");
      const b = createMockModule("b", { dependencies: ["a"] });

      registry.register(a);
      registry.register(b);
      await loader.initializeAll();

      // a is initialized but not active
      await expect(loader.activate("b")).rejects.toThrow(/dependency.*not active/i);
    });

    it("activates when dependency is already active", async () => {
      const a = createMockModule("a");
      const b = createMockModule("b", { dependencies: ["a"] });

      registry.register(a);
      registry.register(b);
      await loader.initializeAll();
      await loader.activate("a");

      await loader.activate("b");

      expect(registry.get("b")!.state).toBe("active");
    });

    it("cascade deactivates dependents when deactivating a dependency", async () => {
      const a = createMockModule("a");
      const b = createMockModule("b", { dependencies: ["a"] });
      const c = createMockModule("c", { dependencies: ["b"] });

      registry.register(a);
      registry.register(b);
      registry.register(c);
      await loader.initializeAll();
      await loader.activate("a");
      await loader.activate("b");
      await loader.activate("c");

      // Deactivating a should cascade to b and c
      const cascaded = await loader.deactivate("a");

      expect(registry.get("a")!.state).toBe("inactive");
      expect(registry.get("b")!.state).toBe("inactive");
      expect(registry.get("c")!.state).toBe("inactive");
      expect(cascaded).toContain("b");
      expect(cascaded).toContain("c");
    });

    it("returns list of cascade-deactivated module IDs", async () => {
      const a = createMockModule("a");
      const b = createMockModule("b", { dependencies: ["a"] });

      registry.register(a);
      registry.register(b);
      await loader.initializeAll();
      await loader.activate("a");
      await loader.activate("b");

      const cascaded = await loader.deactivate("a");

      expect(cascaded).toEqual(["b"]);
    });
  });

  describe("dispose", () => {
    it("disposes all modules", async () => {
      const a = createMockModule("a");
      const b = createMockModule("b");

      registry.register(a);
      registry.register(b);
      await loader.initializeAll();

      await loader.disposeAll();

      expect(a.dispose).toHaveBeenCalledOnce();
      expect(b.dispose).toHaveBeenCalledOnce();
      expect(registry.get("a")!.state).toBe("disposed");
      expect(registry.get("b")!.state).toBe("disposed");
    });

    it("logs a warning and still disposes remaining modules when one dispose throws", async () => {
      // Regression guard: a throw from module.dispose() must not
      // silence the failure (was the case before — only the state
      // was updated, no log entry) and must not halt disposal of
      // other modules (best-effort behaviour).
      const warnSpy = vi.spyOn(context.logger, "warn");
      const a = createMockModule("a", { failOnDispose: true });
      const b = createMockModule("b");

      registry.register(a);
      registry.register(b);
      await loader.initializeAll();

      await loader.disposeAll();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"a" failed to dispose cleanly'),
        expect.objectContaining({ error: expect.stringContaining("failed to dispose") }),
      );
      // Both must still reach disposed state — one failure doesn't block others.
      expect(registry.get("a")!.state).toBe("disposed");
      expect(registry.get("b")!.state).toBe("disposed");
      expect(b.dispose).toHaveBeenCalledOnce();
    });
  });
});
