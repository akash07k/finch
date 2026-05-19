import { useCallback } from "react";
import { BUILT_IN_THEMES } from "@/config/themes";
import { activeThemeItem } from "@/core/settings/items";
import { announce } from "@/shared/a11y/announcer";
import { sendLog } from "@/core/messaging/send";

/**
 * Returns a stable callback that cycles through built-in themes.
 *
 * Used by the popup and options page for the Alt+T shortcut. Reads the
 * current theme from storage (not React state) so it works correctly
 * even if the theme was changed from another context between presses.
 */
export function useCycleTheme(onThemeChanged?: (themeId: string) => void) {
  return useCallback(async () => {
    const current = await activeThemeItem.getValue();
    const themeIds = BUILT_IN_THEMES.map((t) => t.id);
    const nextIndex = (themeIds.indexOf(current) + 1) % themeIds.length;
    const next = themeIds[nextIndex]!;
    await activeThemeItem.setValue(next);
    onThemeChanged?.(next);
    announce(`Theme changed to ${next}`, "polite");
    sendLog("info", `Theme cycled to ${next}`);
  }, [onThemeChanged]);
}
