/**
 * @module popup/App
 *
 * Finch popup UI — the primary quick-access interface.
 *
 * Opens when the user clicks the extension icon in the toolbar.
 * Provides immediate access to:
 * - Mute toggle (Sound on/off)
 * - Master volume slider
 * - Theme switcher
 * - Pop out to persistent window
 * - Link to full settings (options page)
 *
 * All controls use shadcn/ui (Radix primitives) for built-in
 * ARIA support. Additional announcements are made via our
 * announcer utility for state changes that need explicit feedback.
 *
 * Uses `browser.*` APIs (WXT's cross-browser abstraction) instead
 * of `chrome.*` for Chrome + Firefox compatibility.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import hotkeys from "hotkeys-js";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink, Settings, Volume2, VolumeOff } from "lucide-react";
import { announce } from "@/shared/a11y/announcer";
import { sendLog } from "@/core/messaging/send";
import { useCycleTheme } from "@/shared/hooks/use-cycle-theme";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "@/config/themes";
import { mutedItem, masterVolumeItem, activeThemeItem } from "@/core/settings/items";

/**
 * Main popup component.
 *
 * Reads current settings from extension storage on mount,
 * and writes changes back immediately. Settings changes are
 * reflected in the sound engine in real-time.
 */
export default function App() {
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(80);
  const [activeTheme, setActiveTheme] = useState(DEFAULT_THEME_ID);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus the H1 on mount so screen readers hear the page name first.
  // The popup is small enough that landing on the heading and tabbing
  // forward is the right model — focusing the first control would skip
  // past the title.
  useEffect(() => {
    requestAnimationFrame(() => {
      headingRef.current?.focus();
    });
  }, []);

  // Load current settings from storage on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        setMuted(await mutedItem.getValue());
        setVolume(await masterVolumeItem.getValue());
        setActiveTheme(await activeThemeItem.getValue());
      } catch {
        // Storage might not be available yet — use defaults
      }
    }
    loadSettings();
  }, []);

  const handleCycleTheme = useCycleTheme(
    useCallback((themeId: string) => setActiveTheme(themeId), []),
  );

  // Register local keyboard shortcuts
  useEffect(() => {
    const originalFilter = hotkeys.filter;
    // Scope the filter override to ONLY the shortcuts we register here
    // (Alt+T, Shift+?). Replacing it wholesale with `() => true` would
    // let any future shortcut fire while the user is typing in an input.
    hotkeys.filter = (event) => {
      if (event.altKey && event.key.toLowerCase() === "t") return true;
      if (event.shiftKey && event.key === "?") return true;
      return originalFilter(event);
    };

    hotkeys("alt+t", (e) => {
      e.preventDefault();
      handleCycleTheme();
    });
    hotkeys("shift+/", (e) => {
      e.preventDefault();
      announce(
        "Alt+T cycles theme. Global shortcuts: Alt+M toggles mute, " +
          "Alt+Up/Down adjusts volume. Alt+Shift+I opens options.",
        "assertive",
      );
    });

    return () => {
      hotkeys.unbind("alt+t,shift+/");
      hotkeys.filter = originalFilter;
    };
  }, [handleCycleTheme]);

  /** Toggle mute and announce the change. */
  const handleMuteChange = (checked: boolean) => {
    const newMuted = !checked; // Switch shows "Sound on" when checked
    setMuted(newMuted);
    mutedItem.setValue(newMuted);
    announce(newMuted ? "All sounds muted" : "Sounds unmuted", "assertive");
    sendLog("info", newMuted ? "Sound muted via popup" : "Sound unmuted via popup");
  };

  /** Update volume UI state on drag (does NOT save to storage yet). */
  const handleVolumeChange = (values: number[]) => {
    setVolume(values[0] ?? 80);
  };

  /** Save volume to storage when user releases the slider. */
  const handleVolumeCommit = (values: number[]) => {
    const newVolume = values[0] ?? 80;
    setVolume(newVolume);
    masterVolumeItem.setValue(newVolume);
    announce(`Volume set to ${newVolume} percent`, "polite");
    if (newVolume === 0) {
      announce("Volume muted", "polite");
    }
  };

  /** Switch theme and save to storage. */
  const handleThemeChange = (themeId: string) => {
    setActiveTheme(themeId);
    activeThemeItem.setValue(themeId);
    announce(`Theme changed to ${themeId}`, "polite");
    sendLog("info", `Theme changed to ${themeId} via popup`);
  };

  /** Open the popup UI in a separate persistent window. */
  const handlePopOut = () => {
    browser.windows.create({
      url: browser.runtime.getURL("/popup.html"),
      type: "popup",
      width: 400,
      height: 500,
    });
    // Close the popup since we've opened a persistent window
    window.close();
  };

  /** Open the full options page in a new tab. */
  const handleOpenSettings = () => {
    browser.runtime.openOptionsPage();
    window.close();
  };

  return (
    <main
      aria-label="Finch controls"
      aria-keyshortcuts="Shift+? Alt+T"
      className="w-[320px] p-4 space-y-4"
    >
      <h1 ref={headingRef} tabIndex={-1} className="text-lg font-bold">
        Finch
      </h1>

      {/* Sound Controls — section so the heading is announced once on entry, */}
      {/* not on every nested control as fieldset/legend would force.       */}
      <section aria-labelledby="popup-controls-heading" className="space-y-4">
        <h2 id="popup-controls-heading" className="text-sm font-semibold">
          Sound Controls
        </h2>

        {/* Mute Toggle */}
        <div className="flex items-center justify-between">
          <label htmlFor="sound-toggle" className="flex items-center gap-2 text-sm font-medium">
            {muted ? (
              <VolumeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Volume2 className="h-4 w-4" aria-hidden="true" />
            )}
            Sound
          </label>
          <Switch id="sound-toggle" checked={!muted} onCheckedChange={handleMuteChange} />
        </div>

        {/* Volume Slider */}
        <div className="space-y-2">
          <label htmlFor="volume-slider" className="text-sm font-medium">
            Volume: {volume}%
          </label>
          <Slider
            id="volume-slider"
            aria-label="Master volume"
            aria-valuetext={`${volume} percent`}
            value={[volume]}
            min={0}
            max={100}
            step={1}
            onValueChange={handleVolumeChange}
            onValueCommit={handleVolumeCommit}
            disabled={muted}
          />
        </div>

        {/* Theme Switcher */}
        <div className="space-y-2">
          <label htmlFor="theme-select" className="text-sm font-medium">
            Sound Theme
          </label>
          <Select value={activeTheme} onValueChange={handleThemeChange}>
            <SelectTrigger id="theme-select" className="w-full">
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
      </section>

      {/* Utility Actions — plain div with role=group is semantically correct */}
      {/* for a button cluster (a fieldset would re-announce the legend on    */}
      {/* every button focus).                                                */}
      <div role="group" aria-label="Actions" className="flex gap-2 pt-2 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={handlePopOut}
          aria-label="Pop out into a separate window"
        >
          <ExternalLink className="h-4 w-4 mr-1" aria-hidden="true" />
          Pop out
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={handleOpenSettings}
          aria-label="Open full settings page"
        >
          <Settings className="h-4 w-4 mr-1" aria-hidden="true" />
          Settings
        </Button>
      </div>
    </main>
  );
}
