/**
 * @module config/events
 *
 * Per-event default configuration. Controls which events are enabled
 * out of the box and optional volume/pitch overrides.
 *
 * This is decoupled from the event registry (which defines what events
 * exist) so product decisions about defaults live in config, not in
 * the structural event definitions.
 *
 * Events not listed here default to `{ enabled: false }`.
 */

/** Default configuration for a single event. */
interface EventDefaults {
  /** Whether this event plays a sound by default. */
  enabled: boolean;
  /** Default volume override (0-100). Omit to use master volume. */
  volume?: number;
  /** Default pitch/playback rate (0.5-2.0). Omit for normal speed. */
  pitch?: number;
  /**
   * Debounce window in milliseconds. If the same event fires again
   * within this window, the subsequent firing is suppressed.
   * Useful for rapid-fire events like tabs.onUpdated or webNavigation.
   * Omit or set to 0 for no debounce.
   */
  debounceMs?: number;
}

/**
 * Ship-time defaults for all 63 browser events.
 *
 * To change which events are enabled by default, edit this object.
 * To add volume/pitch overrides, add the fields to the event entry:
 * ```
 * "downloads.onChanged.failed": { enabled: true, volume: 100 },
 * ```
 */
const EVENT_DEFAULTS: Readonly<Record<string, EventDefaults>> = {
  // ─── Tier 1: Essential (enabled by default) ───────────────────

  // Tabs
  "tabs.onCreated": { enabled: true },
  "tabs.onRemoved": { enabled: true },
  "tabs.onActivated": { enabled: true },
  // tabs.onUpdated.loading / .complete are disabled by default — the
  // webNavigation equivalents below own the navigation start/end signal,
  // so enabling both would just compete in the cooldown window.
  "tabs.onUpdated.loading": { enabled: false, debounceMs: 300 },
  "tabs.onUpdated.complete": { enabled: false, debounceMs: 300 },
  // Title fires multiple times per page load (loading state, real title,
  // notification badge updates) — disabled by default to keep navigation
  // feedback clean. Users who specifically want title-change cues can
  // opt in; the theme provides tab-title.ogg for them.
  "tabs.onUpdated.title": { enabled: true, debounceMs: 500 },
  "tabs.onMoved": { enabled: true },
  "tabs.onDetached": { enabled: true },
  "tabs.onAttached": { enabled: true },

  // Navigation — only the start, end, and error signals fire by default.
  // The mid-cascade phases (onCommitted, onDOMContentLoaded) and the
  // SPA pushState/replaceState event (onHistoryStateUpdated) are disabled
  // because they cluster within the cooldown window and produce no
  // information not already conveyed by onBeforeNavigate + onCompleted.
  "webNavigation.onBeforeNavigate": { enabled: true, debounceMs: 300 },
  "webNavigation.onCommitted": { enabled: false, debounceMs: 300 },
  "webNavigation.onDOMContentLoaded": { enabled: false, debounceMs: 300 },
  "webNavigation.onCompleted": { enabled: true, debounceMs: 300 },
  "webNavigation.onErrorOccurred": { enabled: true },
  "webNavigation.onHistoryStateUpdated": { enabled: false, debounceMs: 500 },

  // Bookmarks
  "bookmarks.onCreated": { enabled: true },
  "bookmarks.onRemoved": { enabled: true },
  "bookmarks.onChanged": { enabled: true },
  "bookmarks.onMoved": { enabled: true },

  // Downloads
  "downloads.onCreated": { enabled: true },
  "downloads.onChanged.complete": { enabled: true },
  "downloads.onChanged.paused": { enabled: true },
  "downloads.onChanged.resumed": { enabled: true },
  "downloads.onChanged.failed": { enabled: true },

  // Windows
  "windows.onCreated": { enabled: true },
  "windows.onRemoved": { enabled: true },
  // Split from the previous windows.onFocusChanged so each direction
  // can carry a distinct sound. Both default to enabled; users who
  // find focus-loss sounds noisy can disable onUnfocused from the
  // Sound Events tab without affecting the focus-gain cue.
  "windows.onFocused": { enabled: true, debounceMs: 200 },
  "windows.onUnfocused": { enabled: true, debounceMs: 200 },

  // Runtime
  "runtime.onInstalled": { enabled: true },
  "runtime.onStartup": { enabled: true },

  // Notifications (Firefox only)
  "notifications.onShown": { enabled: true },

  // ─── Tier 2: Useful (disabled by default) ─────────────────────

  // Tabs (extended)
  "tabs.onUpdated.url": { enabled: false },
  "tabs.onUpdated.pinned": { enabled: false },
  "tabs.onUpdated.audible": { enabled: false },
  "tabs.onUpdated.mutedInfo": { enabled: false },
  "tabs.onHighlighted": { enabled: false },
  "tabs.onReplaced": { enabled: false },
  "tabs.onZoomChange": { enabled: false },

  // Tab Groups (Chrome only)
  "tabGroups.onCreated": { enabled: false },
  "tabGroups.onRemoved": { enabled: false },
  "tabGroups.onUpdated": { enabled: false },
  "tabGroups.onMoved": { enabled: false },

  // History
  "history.onVisited": { enabled: false },
  "history.onVisitRemoved": { enabled: false },

  // Omnibox
  "omnibox.onInputStarted": { enabled: false },
  "omnibox.onInputEntered": { enabled: false },
  "omnibox.onInputCancelled": { enabled: false },

  // Idle
  "idle.onStateChanged.active": { enabled: false },
  "idle.onStateChanged.idle": { enabled: false },
  "idle.onStateChanged.locked": { enabled: false },

  // Permissions
  "permissions.onAdded": { enabled: false },
  "permissions.onRemoved": { enabled: false },

  // Management
  "management.onInstalled": { enabled: false },
  "management.onUninstalled": { enabled: false },
  "management.onEnabled": { enabled: false },
  "management.onDisabled": { enabled: false },

  // Navigation (extended)
  "webNavigation.onCreatedNavigationTarget": { enabled: false },
  "webNavigation.onReferenceFragmentUpdated": { enabled: false },

  // Other
  "commands.onCommand": { enabled: false },
  "notifications.onClicked": { enabled: false },
  "notifications.onClosed": { enabled: false },
  "cookies.onChanged": { enabled: false },
  "runtime.onUpdateAvailable": { enabled: false },

  // ─── Tier 3: Advanced (disabled by default) ───────────────────

  "runtime.onConnect": { enabled: false },
  "runtime.onSuspend": { enabled: false },
};

/**
 * Look up the default config for an event.
 * @param eventId - The event ID from the event registry.
 * @returns The default config for the event, or `{ enabled: false }` if not found.
 */
export function getEventDefaults(eventId: string): EventDefaults {
  return EVENT_DEFAULTS[eventId] ?? { enabled: false };
}
