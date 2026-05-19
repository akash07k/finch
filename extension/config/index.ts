/**
 * @module config
 *
 * Centralized ship-time configuration for the Finch extension.
 *
 * This is the ONE file a developer opens to tune defaults that ship with
 * the extension. User-facing settings are stored in browser.storage.local
 * at runtime — this file controls the initial values before any user
 * customization.
 *
 * Library-level constants (logger transports, log server) are also here
 * so the extension can override library defaults from a single place.
 */

import { LogLevel } from "@finch/logger";

export const CONFIG = {
  /** Default user-facing settings (written to browser.storage.local on first install). */
  settings: {
    masterVolume: 80,
    activeTheme: "pulse",
    muted: false,
    muteWhenBlurred: false,
    logLevel: LogLevel.INFO,
    logStreamEnabled: false,
    logServerUrl: "ws://localhost:8089",
    enabledModules: ["sound-engine"],
    showWhatsNewOnUpdate: true,
  },

  /** Sound engine tuning. */
  soundEngine: {
    /**
     * Global cooldown in milliseconds. After any sound plays, all subsequent
     * events are suppressed until the cooldown expires. Prevents cascading
     * sounds when a single user action triggers multiple browser events
     * (e.g., Ctrl+T fires tab created + navigation + page load in quick succession).
     * Set to 0 to disable.
     */
    globalCooldownMs: 150,
  },

  /** Logger transport tuning (passed to transport constructors). */
  logger: {
    /** WebSocket transport: max buffered entries while disconnected. */
    wsBufferSize: 1000,
    /** WebSocket transport: initial reconnect delay in ms. */
    wsReconnectDelay: 1000,
    /** WebSocket transport: max reconnect delay in ms (exponential backoff cap). */
    wsMaxReconnectDelay: 30_000,
    /** IndexedDB transport: max stored entries before rotation. */
    idbMaxEntries: 10_000,
    /** IndexedDB transport: object store name. */
    idbStoreName: "logs",
    /** IndexedDB transport: check rotation every N writes. */
    idbRotationInterval: 100,
  },

  /** Log server tuning (passed to LogServer constructor). */
  logServer: {
    /** Max entries kept in memory for replay to new WebSocket clients. */
    bufferSize: 1000,
  },
} as const;
