/**
 * @module settings/schema
 *
 * Zod schemas for Finch's settings. This file is the single source of
 * truth for the shape, types, and defaults of every user-configurable
 * setting.
 *
 * Consumers:
 * - `types.ts` re-exports the inferred TypeScript types.
 * - `defaults.ts` derives DEFAULT_SETTINGS by parsing an empty skeleton.
 * - `items.ts` references CONFIG directly for WXT storage item fallbacks.
 * - `browser-store.ts` flattens DEFAULT_SETTINGS for the module system.
 *
 * Default values are pulled from CONFIG so developers still tune
 * ship-time defaults from one file (`config/index.ts`).
 */

import { z } from "zod";
import { CONFIG } from "../../config/index.js";
import { LogLevel } from "@finch/logger";

// ── Leaf schemas ────────────────────────────────────────────────────

export const eventConfigSchema = z.object({
  enabled: z.boolean(),
  volume: z.number().min(0).max(100).optional(),
  pitch: z.number().min(0.5).max(2.0).optional(),
});

// ── Section schemas ─────────────────────────────────────────────────

export const generalSettingsSchema = z.object({
  masterVolume: z.number().min(0).max(100).default(CONFIG.settings.masterVolume),
  activeTheme: z.string().default(CONFIG.settings.activeTheme),
  muted: z.boolean().default(CONFIG.settings.muted),
  muteWhenBlurred: z.boolean().default(CONFIG.settings.muteWhenBlurred),
  logLevel: z.nativeEnum(LogLevel).default(CONFIG.settings.logLevel),
  logStreamEnabled: z.boolean().default(CONFIG.settings.logStreamEnabled),
  logServerUrl: z.string().default(CONFIG.settings.logServerUrl),
  enabledModules: z.array(z.string()).default([...CONFIG.settings.enabledModules]),
  showWhatsNewOnUpdate: z.boolean().default(CONFIG.settings.showWhatsNewOnUpdate),
});

export const soundSettingsSchema = z.object({
  events: z.record(z.string(), eventConfigSchema).default({}),
});

export const themeSettingsSchema = z.object({
  customThemes: z.array(z.string()).default([]),
});

export const hotkeySettingsSchema = z.object({
  bindings: z.record(z.string(), z.string()).default({
    "global:toggle-mute": "Alt+M",
    "global:toggle-mute-when-blurred": "Alt+Shift+M",
    "global:open-options": "Alt+I",
  }),
});

// ── Root schema ─────────────────────────────────────────────────────
//
// Section fields are NOT given `.default({})` because Zod v4's default
// expects the OUTPUT type (the fully-resolved object), not an empty
// input. Instead, `defaults.ts` passes `{ general: {}, sounds: {}, … }`
// so each section's per-field `.default()` values kick in during parsing.

export const finchSettingsSchema = z.object({
  general: generalSettingsSchema,
  sounds: soundSettingsSchema,
  themes: themeSettingsSchema,
  hotkeys: hotkeySettingsSchema,
});

// ── Inferred types ──────────────────────────────────────────────────

export type FinchSettings = z.infer<typeof finchSettingsSchema>;
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;
export type SoundSettings = z.infer<typeof soundSettingsSchema>;
export type ThemeSettings = z.infer<typeof themeSettingsSchema>;
export type HotkeySettings = z.infer<typeof hotkeySettingsSchema>;
export type EventConfig = z.infer<typeof eventConfigSchema>;
