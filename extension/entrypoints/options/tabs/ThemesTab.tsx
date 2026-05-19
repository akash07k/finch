/**
 * @module options/tabs/ThemesTab
 *
 * Themes settings tab — browse installed sound themes,
 * preview sounds, and import custom themes.
 *
 * For v1, only the built-in "Subtle" theme is available.
 * Custom theme import (via .zip) will be added in a future version.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { announce } from "@/shared/a11y/announcer";
import { sendLog } from "@/core/messaging/send";
import { useConfirmAction } from "@/shared/hooks/use-confirm-action";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "@/config/themes";
import { activeThemeItem } from "@/core/settings/items";

/** Themes settings tab — theme selector, active theme info, and custom theme import placeholder. */
export function ThemesTab() {
  const [activeTheme, setActiveTheme] = useState(DEFAULT_THEME_ID);
  const themeResetRef = useRef<HTMLButtonElement>(null);
  const themeReset = useConfirmAction(themeResetRef, async () => {
    const defaultTheme = BUILT_IN_THEMES.find((t) => t.id === DEFAULT_THEME_ID);
    setActiveTheme(DEFAULT_THEME_ID);
    await activeThemeItem.setValue(DEFAULT_THEME_ID);
    announce(`Theme reset to ${defaultTheme?.name ?? DEFAULT_THEME_ID} (default)`, "polite");
    sendLog("warn", `Theme reset to ${defaultTheme?.name ?? DEFAULT_THEME_ID} (default)`, {
      source: "options",
    });
  });

  // Load active theme from storage
  useEffect(() => {
    async function load() {
      try {
        setActiveTheme(await activeThemeItem.getValue());
      } catch {
        // Use default
      }
    }
    load();
  }, []);

  const handleThemeChange = (themeId: string) => {
    setActiveTheme(themeId);
    activeThemeItem.setValue(themeId);
    const theme = BUILT_IN_THEMES.find((t) => t.id === themeId);
    announce(`Theme changed to ${theme?.name ?? themeId}`, "polite");
    sendLog("info", `Theme changed to ${theme?.name ?? themeId}`, { themeId });
  };

  const activeThemeInfo = BUILT_IN_THEMES.find((t) => t.id === activeTheme);

  return (
    <div className="space-y-6 mt-4">
      <h2 className="text-xl font-semibold">Themes</h2>

      {/* Active Theme */}
      <section aria-labelledby="themes-active-heading" className="space-y-4 border rounded-lg p-4">
        <h3 id="themes-active-heading" className="text-sm font-semibold">
          Active Theme
        </h3>

        <div className="space-y-2">
          <Label htmlFor="active-theme">Sound Theme</Label>
          <Select value={activeTheme} onValueChange={handleThemeChange}>
            <SelectTrigger id="active-theme" className="w-full">
              <SelectValue placeholder="Select theme" />
            </SelectTrigger>
            <SelectContent>
              {BUILT_IN_THEMES.map((theme) => (
                <SelectItem key={theme.id} value={theme.id}>
                  {theme.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Theme details */}
        {activeThemeInfo && (
          <div className="space-y-1 text-sm">
            <p>
              <strong>Description:</strong> {activeThemeInfo.description}
            </p>
          </div>
        )}
      </section>

      {/* Custom Themes — placeholder for v1 */}
      <section aria-labelledby="themes-custom-heading" className="space-y-4 border rounded-lg p-4">
        <h3 id="themes-custom-heading" className="text-sm font-semibold">
          Custom Themes
        </h3>
        <p className="text-muted-foreground">
          Import custom sound themes from .zip files. Each theme contains a theme.json manifest and
          OGG sound files.
        </p>
        <div className="space-y-2">
          <Button variant="outline" disabled aria-describedby="import-theme-status">
            Import Theme (.zip)
          </Button>
          <p id="import-theme-status" className="text-sm text-muted-foreground">
            Coming in a future version.
          </p>
        </div>
      </section>

      <section aria-labelledby="themes-reset-heading" className="space-y-4">
        <h3 id="themes-reset-heading" className="sr-only">
          Reset
        </h3>
        {!themeReset.pending ? (
          <Button
            variant="outline"
            onClick={() =>
              themeReset.requestConfirm(
                "Are you sure? Press Reset Theme Settings again to confirm.",
              )
            }
          >
            Reset Theme Settings
          </Button>
        ) : (
          <Button ref={themeResetRef} variant="destructive" onClick={themeReset.confirm}>
            Confirm Reset Theme Settings
          </Button>
        )}
      </section>
    </div>
  );
}
