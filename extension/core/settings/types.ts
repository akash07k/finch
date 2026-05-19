/**
 * @module settings/types
 *
 * Re-exports the settings types inferred from the Zod schemas in
 * `schema.ts`. Existing imports (`from "./types.js"`) continue to work
 * without changes.
 */

export type {
  FinchSettings,
  GeneralSettings,
  SoundSettings,
  ThemeSettings,
  HotkeySettings,
  EventConfig,
} from "./schema.js";
