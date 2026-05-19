/**
 * @module sound-engine/event-engine
 *
 * Generic router that reads the event registry and wires browser API
 * listeners. For each event it:
 *
 * 1. Checks platform support
 * 2. Attaches a listener to the browser API
 * 3. Applies the optional filter for sub-events
 * 4. Runs an optional custom handler (which can suppress or override sound)
 * 5. Extracts data for logging
 * 6. Publishes a `BrowserEventMessage` on the message bus
 *
 * The router does NOT decide whether a sound should play. All gating
 * logic — mute, per-event enabled, cooldown, debounce — lives in
 * `SoundEngineModule.handleBrowserEvent()`. This separation guarantees
 * that disabled events cannot poison the cooldown window, because the
 * cooldown is updated only after a sound actually plays.
 */

import type { EventDefinition } from "./types.js";
import type { MessageBus } from "../../core/module-system/types.js";
import type { Logger } from "@oriole/logger";

/**
 * Data published to the message bus for each browser event.
 * The sound engine reads this to decide which sound to play.
 */
export interface BrowserEventMessage {
  /** The event definition ID (e.g., "tabs.onCreated"). */
  eventId: string;

  /** Data extracted from the event arguments (for logging). */
  extractedData: Record<string, unknown>;

  /** Timestamp when the event fired. */
  timestamp: string;

  /** If set by a custom handler, override the resolved sound filename. */
  soundOverride?: string;

  /** Extra data from a custom handler, merged into the log entry. */
  handlerData?: Record<string, unknown>;
}

/** Channel name used for browser event messages on the message bus. */
export const BROWSER_EVENT_CHANNEL = "browser-event";

/**
 * Reads event definitions and wires browser API listeners.
 *
 * The browser object is injected (not imported globally) so we can
 * mock it in tests. In production, WXT provides the `browser` global.
 *
 * @example
 * ```ts
 * const engine = new EventEngine(browser, messageBus, logger);
 * engine.registerAll(EVENT_REGISTRY, platform.browser);
 * ```
 */
export class EventEngine {
  private readonly browser: Record<string, unknown>;
  private readonly messageBus: MessageBus;
  private readonly logger: Logger;

  /** Stored listener references for cleanup on dispose. */
  private registeredListeners: {
    eventApi: {
      addListener: (fn: (...args: unknown[]) => void) => void;
      removeListener: (fn: (...args: unknown[]) => void) => void;
    };
    handler: (...args: unknown[]) => void;
  }[] = [];

  /**
   * @param browser - The browser global object (injected for testability).
   * @param messageBus - Message bus used to publish browser-event messages.
   * @param logger - Logger for debug and warning output.
   */
  constructor(browser: Record<string, unknown>, messageBus: MessageBus, logger: Logger) {
    this.browser = browser;
    this.messageBus = messageBus;
    this.logger = logger;
  }

  /**
   * Register listeners for all provided event definitions.
   *
   * Skips events that are not supported on the current platform.
   * Multiple definitions can share the same browser API event
   * (e.g., tabs.onUpdated.loading and tabs.onUpdated.complete
   * both listen to tabs.onUpdated, but with different filters).
   *
   * @param events - Event definitions to register.
   * @param currentPlatform - The browser we're running on ("chrome" or "firefox").
   */
  registerAll(events: EventDefinition[], currentPlatform: "chrome" | "firefox"): void {
    for (const definition of events) {
      // Skip events not supported on this platform
      if (!definition.platforms.includes(currentPlatform)) {
        this.logger.debug(`Skipping ${definition.id}: not supported on ${currentPlatform}`);
        continue;
      }

      // Access the browser API: browser[namespace][event]
      const namespace = this.browser[definition.namespace] as Record<string, unknown> | undefined;
      if (!namespace) {
        this.logger.warn(`Namespace "${definition.namespace}" not available`, {
          event: definition.id,
        });
        continue;
      }

      const eventApi = namespace[definition.event] as
        | {
            addListener: (fn: (...args: unknown[]) => void) => void;
            removeListener: (fn: (...args: unknown[]) => void) => void;
          }
        | undefined;
      if (!eventApi || typeof eventApi.addListener !== "function") {
        this.logger.warn(`Event "${definition.event}" not available on "${definition.namespace}"`, {
          event: definition.id,
        });
        continue;
      }

      // Register the listener, keeping a reference for dispose()
      const handler = (...args: unknown[]) => {
        this.handleEvent(definition, args).catch((error: unknown) => {
          this.logger.error(
            `Unhandled error in event handler for ${definition.id}`,
            error instanceof Error ? error : undefined,
          );
        });
      };
      try {
        eventApi.addListener(handler);
      } catch {
        this.logger.warn(`Failed to attach listener for "${definition.id}"`, {
          event: definition.id,
        });
        continue;
      }
      this.registeredListeners.push({ eventApi, handler });

      this.logger.debug(`Registered listener for ${definition.id}`);
    }
  }

  /**
   * Remove all registered browser API listeners.
   * Called during module dispose to prevent listener leaks.
   */
  dispose(): void {
    for (const { eventApi, handler } of this.registeredListeners) {
      try {
        eventApi.removeListener(handler);
      } catch {
        // Event API may not support removeListener or may already be torn down
      }
    }
    this.logger.debug(`Removed ${this.registeredListeners.length} event listeners`);
    this.registeredListeners = [];
  }

  /**
   * Handle a browser event firing: apply filter, run optional handler,
   * extract data, publish to the message bus. Suppression decisions
   * live downstream in SoundEngineModule, NOT here.
   */
  private async handleEvent(definition: EventDefinition, args: unknown[]): Promise<void> {
    // Apply filter if defined (for sub-events like tabs.onUpdated.loading)
    if (definition.filter && !definition.filter(...args)) {
      return;
    }

    // Run custom handler if defined — handler may suppress the event
    // or override the sound file. Suppression here is intentional
    // (registry-defined behavior, not user preference) so it does not
    // need to interact with the cooldown gate.
    let soundOverride: string | undefined;
    let handlerData: Record<string, unknown> | undefined;

    if (definition.handler) {
      try {
        const result = await definition.handler(...args);
        if (result) {
          if (result.suppress) {
            this.logger.debug(`Suppressed by handler: ${definition.id}`, {
              suppression: "handler",
              eventId: definition.id,
            });
            return;
          }
          soundOverride = result.soundOverride;
          handlerData = result.data;
        }
      } catch (error) {
        this.logger.warn(`Handler error for ${definition.id}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Extract data for logging
    const extractedData = definition.extractData?.(...args) ?? {};

    // Publish to the message bus
    const message: BrowserEventMessage = {
      eventId: definition.id,
      extractedData,
      timestamp: new Date().toISOString(),
      soundOverride,
      handlerData,
    };

    this.messageBus.publish(BROWSER_EVENT_CHANNEL, message);
  }
}
