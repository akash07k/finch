/**
 * @module settings/validate
 *
 * Schema-backed validators for write boundaries. The Zod schema in
 * `schema.ts` validates once at boot (to derive defaults) and then
 * sits idle — these helpers run it again on user-supplied input so
 * garbage values can't reach storage and silently feed the sound
 * engine.
 *
 * Per-event configs are the most exposed surface because the Sound
 * Events tab writes them directly from slider state. A slider bug
 * that produced `volume: 999` used to land in storage unchecked;
 * `validateEventConfig` clamps it through the schema's bounds and
 * surfaces a clear error to the caller.
 */

import { eventConfigSchema, type EventConfig } from "./schema.js";
import type { StoredEventConfig } from "./items.js";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validate a per-event config before persisting it. Accepts the
 * UI-side shape (`StoredEventConfig` — required `volume` and `pitch`)
 * and returns the schema-checked value, or an error message suitable
 * for live-region announcement.
 *
 * The schema treats `volume` and `pitch` as optional because the
 * registry default fills in missing values; the storage shape
 * always carries them.
 */
export function validateEventConfig(
  value: StoredEventConfig,
): ValidationResult<EventConfig> {
  const result = eventConfigSchema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, error: formatZodError(result.error) };
}

function formatZodError(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
