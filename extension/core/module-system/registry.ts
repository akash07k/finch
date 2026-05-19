/**
 * @module module-system/registry
 *
 * In-memory registry that tracks all registered modules and their states.
 *
 * The registry is deliberately simple — it's a typed Map wrapper.
 * It does NOT handle lifecycle (that's the loader's job) or
 * dependency resolution (also the loader). This separation keeps
 * each piece independently testable.
 */

import type { FinchModule, ModuleEntry, ModuleState } from "./types.js";

/**
 * Stores and retrieves module entries by ID.
 *
 * Modules are registered once during extension startup, then
 * the loader manages their lifecycle transitions (initialize,
 * activate, deactivate, dispose) by updating state through
 * the registry.
 *
 * @example
 * ```ts
 * const registry = new ModuleRegistry();
 * registry.register(soundEngineModule);
 * registry.setState("sound-engine", "initialized");
 * const entry = registry.get("sound-engine");
 * ```
 */
export class ModuleRegistry {
  /** Map of module ID → module entry. */
  private readonly modules = new Map<string, ModuleEntry>();

  /**
   * Register a new module.
   * Sets its initial state to "registered".
   *
   * @throws Error if a module with the same ID is already registered.
   */
  register(module: FinchModule): void {
    if (this.modules.has(module.id)) {
      throw new Error(`Module "${module.id}" is already registered.`);
    }

    this.modules.set(module.id, {
      module,
      state: "registered",
    });
  }

  /**
   * Get a module entry by ID.
   * Returns undefined if the module is not registered.
   */
  get(id: string): ModuleEntry | undefined {
    return this.modules.get(id);
  }

  /**
   * Check if a module is registered.
   */
  has(id: string): boolean {
    return this.modules.has(id);
  }

  /**
   * Get all registered module entries.
   */
  getAll(): ModuleEntry[] {
    return Array.from(this.modules.values());
  }

  /**
   * Get all registered module IDs.
   */
  getIds(): string[] {
    return Array.from(this.modules.keys());
  }

  /**
   * Update the lifecycle state of a module.
   *
   * @throws Error if the module is not registered.
   */
  setState(id: string, state: ModuleState): void {
    const entry = this.modules.get(id);
    if (!entry) {
      throw new Error(`Module "${id}" is not registered.`);
    }

    entry.state = state;
  }

  /**
   * Mark a module as errored with a message.
   * Sets state to "error" and stores the error message.
   *
   * @throws Error if the module is not registered.
   */
  setError(id: string, message: string): void {
    const entry = this.modules.get(id);
    if (!entry) {
      throw new Error(`Module "${id}" is not registered.`);
    }

    entry.state = "error";
    entry.error = message;
  }
}
