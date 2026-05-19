import { describe, it, expect, beforeEach } from "vitest";
import { ModuleRegistry } from "../registry.js";
import type { FinchModule } from "../types.js";

/**
 * Creates a minimal mock module for testing.
 * Only the properties needed by the registry are included.
 */
function createMockModule(id: string, overrides?: Partial<FinchModule>): FinchModule {
  return {
    id,
    name: `Test Module: ${id}`,
    version: "1.0.0",
    initialize: async () => {},
    activate: async () => {},
    deactivate: async () => {},
    dispose: async () => {},
    ...overrides,
  };
}

describe("ModuleRegistry", () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
  });

  it("starts empty", () => {
    expect(registry.getAll()).toHaveLength(0);
  });

  it("registers a module", () => {
    const module = createMockModule("sound-engine");
    registry.register(module);

    expect(registry.has("sound-engine")).toBe(true);
  });

  it("retrieves a registered module entry", () => {
    const module = createMockModule("sound-engine");
    registry.register(module);

    const entry = registry.get("sound-engine");
    expect(entry).toBeDefined();
    expect(entry!.module.id).toBe("sound-engine");
    expect(entry!.state).toBe("registered");
  });

  it("returns undefined for unregistered module", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered modules", () => {
    registry.register(createMockModule("module-a"));
    registry.register(createMockModule("module-b"));
    registry.register(createMockModule("module-c"));

    const all = registry.getAll();
    expect(all).toHaveLength(3);
  });

  it("throws when registering duplicate module ID", () => {
    registry.register(createMockModule("sound-engine"));

    expect(() => registry.register(createMockModule("sound-engine"))).toThrow(/already registered/);
  });

  it("updates module state", () => {
    registry.register(createMockModule("sound-engine"));
    registry.setState("sound-engine", "initialized");

    expect(registry.get("sound-engine")!.state).toBe("initialized");
  });

  it("throws when setting state for unregistered module", () => {
    expect(() => registry.setState("nonexistent", "initialized")).toThrow(/not registered/);
  });

  it("sets error on module entry", () => {
    registry.register(createMockModule("sound-engine"));
    registry.setError("sound-engine", "Failed to initialize");

    const entry = registry.get("sound-engine")!;
    expect(entry.state).toBe("error");
    expect(entry.error).toBe("Failed to initialize");
  });

  it("returns module IDs", () => {
    registry.register(createMockModule("a"));
    registry.register(createMockModule("b"));

    expect(registry.getIds()).toEqual(["a", "b"]);
  });
});
