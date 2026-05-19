/**
 * @module settings/items
 *
 * Typed storage items using WXT's `storage.defineItem()`.
 *
 * Each item wraps a single `browser.storage.local` key with a typed
 * API (`getValue`, `setValue`, `watch`) and a compile-time fallback.
 * UI entry points (popup, options) import these items instead of
 * calling `browser.storage.local.get/set` with raw string keys.
 *
 * The background-script module system continues to use
 * {@link BrowserSettingsStore} — these items are for the UI layer only.
 */

import { storage } from "#imports";
import { CONFIG } from "../../config/index.js";
import type { LogLevel } from "@oriole/logger";

// ── General ──────────────────────────────────────────────────────────

export const mutedItem = storage.defineItem<boolean>("local:general.muted", {
  fallback: CONFIG.settings.muted,
});

export const muteWhenBlurredItem = storage.defineItem<boolean>("local:general.muteWhenBlurred", {
  fallback: CONFIG.settings.muteWhenBlurred,
});

export const masterVolumeItem = storage.defineItem<number>("local:general.masterVolume", {
  fallback: CONFIG.settings.masterVolume,
});

export const activeThemeItem = storage.defineItem<string>("local:general.activeTheme", {
  fallback: CONFIG.settings.activeTheme,
});

export const enabledModulesItem = storage.defineItem<string[]>("local:general.enabledModules", {
  fallback: [...CONFIG.settings.enabledModules],
});

export const showWhatsNewOnUpdateItem = storage.defineItem<boolean>(
  "local:general.showWhatsNewOnUpdate",
  { fallback: CONFIG.settings.showWhatsNewOnUpdate },
);

// ── Logging ──────────────────────────────────────────────────────────

export const logLevelItem = storage.defineItem<LogLevel>("local:general.logLevel", {
  fallback: CONFIG.settings.logLevel,
});

export const logStreamEnabledItem = storage.defineItem<boolean>("local:general.logStreamEnabled", {
  fallback: CONFIG.settings.logStreamEnabled,
});

export const logServerUrlItem = storage.defineItem<string>("local:general.logServerUrl", {
  fallback: CONFIG.settings.logServerUrl,
});

// ── Per-event sound config ───────────────────────────────────────────

export interface StoredEventConfig {
  enabled: boolean;
  volume: number;
  pitch: number;
}

/**
 * Build a storage item for a single event's config.
 *
 * Not pre-instantiated for every event — the event registry is large
 * and most events will never be customised. Call this from UI code
 * that needs to read/write a specific event's config.
 */
export function eventConfigItem(eventId: string) {
  return storage.defineItem<StoredEventConfig>(`local:sounds.events.${eventId}`);
}

// ── Onboarding ───────────────────────────────────────────────────────

export const onboardingSeenItem = storage.defineItem<boolean>("local:onboarding.seen", {
  fallback: false,
});
