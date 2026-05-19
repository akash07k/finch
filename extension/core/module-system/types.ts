/**
 * @module module-system/types
 *
 * Core type definitions for the Finch module system.
 *
 * Every feature (sound engine, inspector, DOM persist, bookmarks, AI,
 * and more) implements the FinchModule interface. This ensures consistent
 * lifecycle management, dependency resolution, and user-controllable
 * activation across all features.
 */

import type { Logger } from "@finch/logger";

/**
 * Base interface for all Finch feature modules.
 *
 * Each feature implements this interface to participate in the
 * module lifecycle: initialize → activate → deactivate → dispose.
 *
 * @example
 * ```ts
 * const soundEngine: FinchModule = {
 *   id: "sound-engine",
 *   name: "Sound Engine",
 *   version: "1.0.0",
 *   async initialize(context) { ... },
 *   async activate() { ... },
 *   async deactivate() { ... },
 *   async dispose() { ... },
 * };
 * ```
 */
export interface FinchModule {
  /** Unique module identifier (e.g., "sound-engine"). Used as a key everywhere. */
  readonly id: string;

  /** Human-readable module name for display in settings UI. */
  readonly name: string;

  /** Module version (semver). */
  readonly version: string;

  /**
   * IDs of modules this module depends on.
   * Dependencies are initialized first (topological order).
   * If a dependency is disabled, this module cannot be activated.
   */
  readonly dependencies?: string[];

  /**
   * Called once when the module is first loaded.
   * Use for one-time setup: register event listeners, initialize state.
   * Called in dependency order — dependencies are initialized before dependents.
   */
  initialize(context: ModuleContext): Promise<void>;

  /**
   * Called when the module is enabled by the user.
   * Start active functionality (e.g., begin listening to browser events).
   */
  activate(): Promise<void>;

  /**
   * Called when the module is disabled by the user.
   * Pause functionality and release non-essential resources.
   * Must be safe to call multiple times.
   */
  deactivate(): Promise<void>;

  /**
   * Called when the extension is shutting down.
   * Clean up ALL resources (listeners, timers, connections).
   * After this, the module will not be used again.
   */
  dispose(): Promise<void>;
}

/**
 * Context provided to modules during initialization.
 *
 * Modules access shared services exclusively through this context —
 * never via direct imports of other modules. This enforces loose
 * coupling and makes modules independently testable.
 */
export interface ModuleContext {
  /** Logger instance scoped to this module (tag = module ID). */
  logger: Logger;

  /** Message bus for inter-module communication. */
  messageBus: MessageBus;

  /** Settings store for reading/writing this module's configuration. */
  settings: SettingsStore;

  /** Platform information (Chrome/Firefox, OS, versions). */
  platform: PlatformInfo;
}

/**
 * Module lifecycle state.
 * Transitions: registered → initialized → active ↔ inactive → disposed.
 */
export type ModuleState =
  | "registered"
  | "initialized"
  | "active"
  | "inactive"
  | "disposed"
  | "error";

/**
 * Metadata tracked for each registered module.
 * Used by the loader and registry to manage lifecycle.
 */
export interface ModuleEntry {
  /** The module instance. */
  module: FinchModule;

  /** Current lifecycle state. */
  state: ModuleState;

  /** Error message if the module failed to initialize or activate. */
  error?: string;
}

// ----- Placeholder interfaces for cross-cutting concerns -----
// These will be fully defined in their own modules (message-bus, settings, platform).
// Defined here as minimal interfaces so the module system types are self-contained.

/**
 * Message bus for pub/sub inter-module communication.
 * Full implementation in core/message-bus/.
 */
export interface MessageBus {
  /** Publish a message to a channel. */
  publish(channel: string, data: unknown): void;

  /** Subscribe to a channel. Returns an unsubscribe function. */
  subscribe(channel: string, handler: (data: unknown) => void): () => void;
}

/**
 * Settings store for module configuration.
 * Full implementation in core/settings/.
 */
export interface SettingsStore {
  /** Get a setting value by key. */
  get<T>(key: string): Promise<T | undefined>;

  /** Set a setting value by key. */
  set<T>(key: string, value: T): Promise<void>;

  /** Watch for changes to a setting. Returns an unwatch function. */
  watch(key: string, handler: (newValue: unknown) => void): () => void;
}

/**
 * Platform information — which browser, OS, and capabilities.
 * Full implementation in shared/platform/.
 */
export interface PlatformInfo {
  /** Browser identifier. */
  browser: "chrome" | "firefox";

  /** Manifest version (always 3 for Finch). */
  manifestVersion: number;

  /** Browser version string. */
  browserVersion: string;

  /** Operating system. */
  os: "win" | "mac" | "linux" | "chromeos";
}
