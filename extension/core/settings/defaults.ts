/**
 * @module settings/defaults
 *
 * Default values for all Finch settings, derived from the Zod schema.
 *
 * Parsing an empty skeleton through `finchSettingsSchema` fills every
 * field with its `.default()` value, which comes from CONFIG. This
 * keeps the schema as the single source of truth for both types and
 * defaults — no manual synchronization needed.
 *
 * `FLAT_DEFAULTS` is the same data flattened to dot-notation keys, ready
 * to hand to `BrowserSettingsStore`. The flatten step happens once at
 * module load so the boot path is a single import, not a manual loop.
 */

import { finchSettingsSchema, type FinchSettings } from "./schema.js";
import { flattenSettings } from "./flatten.js";

/** Default values for all extension settings (nested shape). */
export const DEFAULT_SETTINGS: FinchSettings = finchSettingsSchema.parse({
  general: {},
  sounds: {},
  themes: {},
  hotkeys: {},
});

/**
 * Default values flattened to dot-notation keys for `BrowserSettingsStore`.
 *
 * Example: `{ "general.muted": false, "hotkeys.bindings.global:toggle-mute": "Alt+M", ... }`.
 * Empty sections (e.g., `sounds.events`) contribute no entries — the
 * store falls back to its `defaults[key]` lookup which returns
 * `undefined` for those, and consumers use registry-driven defaults
 * (see `getEventDefaults`).
 */
export const FLAT_DEFAULTS: Record<string, unknown> = flattenSettings(DEFAULT_SETTINGS);
