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
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "@/config/themes";
import { activeThemeItem } from "@/core/settings/items";

/** Themes settings tab — theme selector, active theme info, and custom theme import placeholder. */
export function ThemesTab() {
  const [activeTheme, setActiveTheme] = useState(DEFAULT_THEME_ID);
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmResetRef = useRef<HTMLButtonElement>(null);

  // Auto-cancel reset confirmation after 5 seconds, focus the confirm button.
  // Same two-step pattern as the destructive Resets in the other tabs.
  useEffect(() => {
    if (!confirmReset) return;
    requestAnimationFrame(() => confirmResetRef.current?.focus());
    const timer = setTimeout(() => setConfirmReset(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

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

      {/* Reset — two-step confirm so a single accidental click can't wipe */}
      {/* the user's chosen theme. Wrapped in its own section landmark so  */}
      {/* region-hopping screen-reader users can jump to it instead of     */}
      {/* skipping past a stray button at the root level.                  */}
      <section aria-labelledby="themes-reset-heading" className="space-y-4">
        <h3 id="themes-reset-heading" className="sr-only">
          Reset
        </h3>
        {!confirmReset ? (
          <Button
            variant="outline"
            onClick={() => {
              setConfirmReset(true);
              announce("Are you sure? Press Reset Theme Settings again to confirm.", "assertive");
            }}
          >
            Reset Theme Settings
          </Button>
        ) : (
          <Button
            ref={confirmResetRef}
            variant="destructive"
            onClick={async () => {
              const defaultTheme = BUILT_IN_THEMES.find((t) => t.id === DEFAULT_THEME_ID);
              setActiveTheme(DEFAULT_THEME_ID);
              await activeThemeItem.setValue(DEFAULT_THEME_ID);
              announce(
                `Theme reset to ${defaultTheme?.name ?? DEFAULT_THEME_ID} (default)`,
                "polite",
              );
              sendLog(
                "warn",
                `Theme reset to ${defaultTheme?.name ?? DEFAULT_THEME_ID} (default)`,
                {
                  source: "options",
                },
              );
              setConfirmReset(false);
            }}
          >
            Confirm Reset Theme Settings
          </Button>
        )}
      </section>
    </div>
  );
}
