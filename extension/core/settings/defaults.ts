/**
 * @module settings/defaults
 *
 * Default values for all Oriole settings, derived from the Zod schema.
 *
 * Parsing an empty skeleton through `orioleSettingsSchema` fills every
 * field with its `.default()` value, which comes from CONFIG. This
 * keeps the schema as the single source of truth for both types and
 * defaults — no manual synchronization needed.
 */

import { orioleSettingsSchema, type OrioleSettings } from "./schema.js";

/** Default values for all extension settings. */
export const DEFAULT_SETTINGS: OrioleSettings = orioleSettingsSchema.parse({
  general: {},
  sounds: {},
  themes: {},
  hotkeys: {},
});
