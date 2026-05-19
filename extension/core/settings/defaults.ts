/**
 * @module settings/defaults
 *
 * Default values for all Finch settings, derived from the Zod schema.
 *
 * Parsing an empty skeleton through `finchSettingsSchema` fills every
 * field with its `.default()` value, which comes from CONFIG. This
 * keeps the schema as the single source of truth for both types and
 * defaults — no manual synchronization needed.
 */

import { finchSettingsSchema, type FinchSettings } from "./schema.js";

/** Default values for all extension settings. */
export const DEFAULT_SETTINGS: FinchSettings = finchSettingsSchema.parse({
  general: {},
  sounds: {},
  themes: {},
  hotkeys: {},
});
