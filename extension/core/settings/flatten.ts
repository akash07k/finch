/**
 * @module settings/flatten
 *
 * Walk a nested settings object and produce a flat dot-notation map.
 *
 * The module system's `BrowserSettingsStore` operates on flat keys
 * (`general.muted`, `hotkeys.bindings.global:toggle-mute`) so each
 * setting becomes its own `browser.storage.local` row with its own
 * `storage.onChanged` event. This walker generates the flat default
 * map from the nested `DEFAULT_SETTINGS` so adding a new setting in
 * the schema flows through without a matching edit elsewhere.
 *
 * Leaves are anything that isn't a plain object — primitives, arrays,
 * and `null`. Arrays specifically must stay as leaves so multi-value
 * settings (e.g., `general.enabledModules`) survive the trip without
 * being expanded to `general.enabledModules.0`, `general.enabledModules.1`.
 */

/**
 * Flatten a nested object into `{ "a.b.c": value }` shape. Returns an
 * empty object when called with a non-object root. Top-level array
 * roots are returned as `{ "": [...] }` only when a prefix is set —
 * the bare call simply yields `{}` because there is no key to write
 * the array under.
 */
export function flattenSettings(
  obj: unknown,
  prefix = "",
): Record<string, unknown> {
  if (!isPlainObject(obj)) {
    return prefix ? { [prefix]: obj } : {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      Object.assign(result, flattenSettings(value, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
