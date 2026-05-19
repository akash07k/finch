/**
 * @module sound-engine/theme-schema
 *
 * Type definitions and validation for sound theme packs.
 *
 * Each theme is a directory containing a theme.json manifest and
 * sound files (OGG format). The manifest maps event IDs to sound
 * filenames and provides fallbacks for unmapped events.
 *
 * Built-in themes live in extension/public/sounds/.
 * Custom themes (planned, not yet implemented) will be stored in
 * IndexedDB and imported by the user as .zip files.
 */

/**
 * The theme.json manifest that describes a sound theme pack.
 *
 * @example
 * ```json
 * {
 *   "name": "Subtle",
 *   "description": "Soft clicks and gentle chimes.",
 *   "author": "Finch",
 *   "version": "1.0.0",
 *   "mappings": {
 *     "tabs.onCreated": "tab-created.ogg",
 *     "tabs.onRemoved": "tab-closed.ogg"
 *   },
 *   "fallbacks": {
 *     "tier1": "generic-info.ogg",
 *     "tier2": "generic-info.ogg",
 *     "tier3": "generic-info.ogg",
 *     "error": "generic-error.ogg"
 *   }
 * }
 * ```
 */
export interface ThemeManifest {
  /** Theme display name. */
  name: string;

  /** Short description of the theme's character. */
  description: string;

  /** Author or source attribution. */
  author: string;

  /** Theme version (semver). */
  version: string;

  /**
   * Event ID to sound file mapping.
   * Keys are event IDs from the registry (e.g., "tabs.onCreated").
   * Values are filenames relative to the theme directory.
   */
  mappings: Record<string, string>;

  /**
   * Fallback sounds for events not explicitly mapped.
   * Used when an event fires but has no specific sound in `mappings`.
   */
  fallbacks?: ThemeFallbacks;
}

/**
 * Fallback sound mappings for unmapped events.
 * Keyed by event tier or error category.
 */
export interface ThemeFallbacks {
  /** Fallback for unmapped Tier 1 (essential) events. */
  tier1?: string;

  /** Fallback for unmapped Tier 2 (useful) events. */
  tier2?: string;

  /** Fallback for unmapped Tier 3 (advanced) events. */
  tier3?: string;

  /** Fallback for error-related events (navigation errors, download failures). */
  error?: string;

  /** Generic info fallback when no tier-specific fallback exists. */
  info?: string;
}

/**
 * Validation errors found in a theme.json manifest.
 */
export interface ThemeValidationError {
  /** Which field has the error. */
  field: string;

  /** Human-readable error message. */
  message: string;
}

/**
 * Validates a theme manifest object.
 *
 * Checks that all required fields are present, types are correct,
 * and mappings reference valid filenames (non-empty strings).
 * Does NOT check if the sound files actually exist on disk —
 * that's the loader's job.
 *
 * @param data - The parsed theme.json content to validate.
 * @returns Array of validation errors (empty if valid).
 */
export function validateThemeManifest(data: unknown): ThemeValidationError[] {
  const errors: ThemeValidationError[] = [];

  if (typeof data !== "object" || data === null) {
    return [{ field: "root", message: "Theme manifest must be a JSON object." }];
  }

  const manifest = data as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ["name", "description", "author", "version"];
  for (const field of requiredStrings) {
    if (typeof manifest[field] !== "string" || (manifest[field] as string).trim() === "") {
      errors.push({ field, message: `"${field}" must be a non-empty string.` });
    }
  }

  // Mappings must be an object with string values
  if (typeof manifest.mappings !== "object" || manifest.mappings === null) {
    errors.push({ field: "mappings", message: '"mappings" must be an object.' });
  } else {
    const mappings = manifest.mappings as Record<string, unknown>;
    for (const [key, value] of Object.entries(mappings)) {
      if (typeof value !== "string" || value.trim() === "") {
        errors.push({
          field: `mappings.${key}`,
          message: `Mapping "${key}" must be a non-empty filename string.`,
        });
      }
    }
  }

  // Fallbacks are optional, but if present must have string values
  if (manifest.fallbacks !== undefined) {
    if (typeof manifest.fallbacks !== "object" || manifest.fallbacks === null) {
      errors.push({ field: "fallbacks", message: '"fallbacks" must be an object if provided.' });
    } else {
      const fallbacks = manifest.fallbacks as Record<string, unknown>;
      const validKeys = ["tier1", "tier2", "tier3", "error", "info"];
      for (const [key, value] of Object.entries(fallbacks)) {
        if (!validKeys.includes(key)) {
          errors.push({
            field: `fallbacks.${key}`,
            message: `Unknown fallback key "${key}". Valid keys: ${validKeys.join(", ")}.`,
          });
        }
        if (typeof value !== "string" || value.trim() === "") {
          errors.push({
            field: `fallbacks.${key}`,
            message: `Fallback "${key}" must be a non-empty filename string.`,
          });
        }
      }
    }
  }

  return errors;
}
