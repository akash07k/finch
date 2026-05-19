/**
 * @module options/tabs/GeneralTab
 *
 * General settings tab — master volume, active theme,
 * mute toggle, and module enable/disable toggles.
 *
 * Settings are read and written via typed WXT storage items
 * (see `core/settings/items.ts`). Changes take effect
 * immediately — the background script watches for storage changes.
 */

import { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "@/config/themes";
import { sendLog } from "@/core/messaging/send";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { announce } from "@/shared/a11y/announcer";
import { useConfirmAction } from "@/shared/hooks/use-confirm-action";
import {
  mutedItem,
  muteWhenBlurredItem,
  masterVolumeItem,
  activeThemeItem,
  enabledModulesItem,
  showWhatsNewOnUpdateItem,
} from "@/core/settings/items";

/** General settings tab — master volume, mute, theme selector, and module toggles. */
export function GeneralTab() {
  const [muted, setMuted] = useState(false);
  const [muteWhenBlurred, setMuteWhenBlurred] = useState(false);
  const [volume, setVolume] = useState(80);
  const [activeTheme, setActiveTheme] = useState(DEFAULT_THEME_ID);
  const [soundEngineEnabled, setSoundEngineEnabled] = useState(true);
  const [showWhatsNewOnUpdate, setShowWhatsNewOnUpdate] = useState(true);
  const generalResetRef = useRef<HTMLButtonElement>(null);
  const factoryResetRef = useRef<HTMLButtonElement>(null);

  const generalReset = useConfirmAction(generalResetRef, async () => {
    setMuted(false);
    setMuteWhenBlurred(false);
    setVolume(80);
    setActiveTheme(DEFAULT_THEME_ID);
    setSoundEngineEnabled(true);
    setShowWhatsNewOnUpdate(true);
    await Promise.all([
      mutedItem.setValue(false),
      muteWhenBlurredItem.setValue(false),
      masterVolumeItem.setValue(80),
      activeThemeItem.setValue(DEFAULT_THEME_ID),
      enabledModulesItem.setValue(["sound-engine"]),
      showWhatsNewOnUpdateItem.setValue(true),
    ]);
    announce("General settings reset to defaults", "polite");
    sendLog("warn", "General settings reset to defaults", { source: "options" });
  });

  const factoryReset = useConfirmAction(factoryResetRef, async () => {
    await browser.storage.local.clear();
    setMuted(false);
    setMuteWhenBlurred(false);
    setVolume(80);
    setActiveTheme(DEFAULT_THEME_ID);
    setSoundEngineEnabled(true);
    setShowWhatsNewOnUpdate(true);
    announce(
      "All settings reset to factory defaults. Reload the extension for full effect.",
      "assertive",
    );
    sendLog("warn", "Factory reset: all settings cleared", { source: "options" });
  });

  // Load settings on mount
  useEffect(() => {
    async function load() {
      try {
        setMuted(await mutedItem.getValue());
        setMuteWhenBlurred(await muteWhenBlurredItem.getValue());
        setVolume(await masterVolumeItem.getValue());
        setActiveTheme(await activeThemeItem.getValue());
        const modules = await enabledModulesItem.getValue();
        setSoundEngineEnabled(modules.includes("sound-engine"));
        setShowWhatsNewOnUpdate(await showWhatsNewOnUpdateItem.getValue());
      } catch {
        // Use defaults
      }
    }
    load();
  }, []);

  const handleMuteChange = (checked: boolean) => {
    const newMuted = !checked;
    setMuted(newMuted);
    mutedItem.setValue(newMuted);
    announce(newMuted ? "All sounds muted" : "Sounds unmuted", "polite");
    sendLog("info", `Setting changed: general.muted`, { key: "general.muted", value: newMuted });
  };

  /** Toggle "mute when browser is unfocused". */
  const handleMuteWhenBlurredChange = (checked: boolean) => {
    setMuteWhenBlurred(checked);
    muteWhenBlurredItem.setValue(checked);
    announce(checked ? "Mute when unfocused enabled" : "Mute when unfocused disabled", "polite");
    sendLog("info", `Setting changed: general.muteWhenBlurred`, {
      key: "general.muteWhenBlurred",
      value: checked,
    });
  };

  /** Update volume UI state on drag (does NOT save to storage yet). */
  const handleVolumeChange = (values: number[]) => {
    setVolume(values[0] ?? 80);
  };

  /** Save volume to storage when slider is released. */
  const handleVolumeCommit = (values: number[]) => {
    const newVolume = values[0] ?? 80;
    setVolume(newVolume);
    masterVolumeItem.setValue(newVolume);
    announce(`Volume set to ${newVolume} percent`, "polite");
    sendLog("info", `Setting changed: general.masterVolume`, {
      key: "general.masterVolume",
      value: newVolume,
    });
  };

  const handleThemeChange = (themeId: string) => {
    setActiveTheme(themeId);
    activeThemeItem.setValue(themeId);
    announce(`Theme changed to ${themeId}`, "polite");
    sendLog("info", `Setting changed: general.activeTheme`, {
      key: "general.activeTheme",
      value: themeId,
    });
  };

  /** Toggle the sound engine. Writes the full enabledModules array (not a boolean). */
  const handleSoundEngineToggle = (checked: boolean) => {
    setSoundEngineEnabled(checked);
    const modules = checked ? ["sound-engine"] : [];
    enabledModulesItem.setValue(modules);
    announce(checked ? "Sound engine enabled" : "Sound engine disabled", "polite");
    sendLog("info", `Setting changed: general.enabledModules`, {
      key: "general.enabledModules",
      value: modules,
    });
  };

  /** Toggle the post-update What's New page. */
  const handleWhatsNewToggle = (checked: boolean) => {
    setShowWhatsNewOnUpdate(checked);
    showWhatsNewOnUpdateItem.setValue(checked);
    announce(
      checked ? "What's New page enabled on update" : "What's New page disabled on update",
      "polite",
    );
    sendLog("info", `Setting changed: general.showWhatsNewOnUpdate`, {
      key: "general.showWhatsNewOnUpdate",
      value: checked,
    });
  };

  return (
    <div className="space-y-6 mt-4">
      <h2 className="text-xl font-semibold">General</h2>

      {/* Sound Controls — section so the heading is announced once on entry. */}
      <section
        aria-labelledby="general-sound-controls-heading"
        className="space-y-4 border rounded-lg p-4"
      >
        <h3 id="general-sound-controls-heading" className="text-sm font-semibold">
          Sound Controls
        </h3>

        {/* Mute Toggle */}
        <div className="flex items-center justify-between">
          <Label htmlFor="mute-toggle">Sound</Label>
          <Switch id="mute-toggle" checked={!muted} onCheckedChange={handleMuteChange} />
        </div>

        {/* Mute when browser is unfocused */}
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="mute-when-blurred-toggle">Mute when browser is unfocused</Label>
            <p id="mute-when-blurred-desc" className="text-sm text-muted-foreground">
              Stop playing sounds when you switch to another application. Sounds resume when you
              return to the browser.
            </p>
          </div>
          <Switch
            id="mute-when-blurred-toggle"
            aria-describedby="mute-when-blurred-desc"
            checked={muteWhenBlurred}
            onCheckedChange={handleMuteWhenBlurredChange}
          />
        </div>

        {/* Volume */}
        <div className="space-y-2">
          <Label htmlFor="volume-slider">Master Volume: {volume}%</Label>
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

        {/* Theme */}
        <div className="space-y-2">
          <Label htmlFor="theme-select">Sound Theme</Label>
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

      {/* Module Toggles */}
      <section
        aria-labelledby="general-modules-heading"
        className="space-y-4 border rounded-lg p-4"
      >
        <h3 id="general-modules-heading" className="text-sm font-semibold">
          Modules
        </h3>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="sound-engine-toggle">Sound Engine</Label>
            <p id="sound-engine-desc" className="text-sm text-muted-foreground">
              Plays audio cues for browser events like tab switching, page loading, and downloads.
            </p>
          </div>
          <Switch
            id="sound-engine-toggle"
            aria-describedby="sound-engine-desc"
            checked={soundEngineEnabled}
            onCheckedChange={handleSoundEngineToggle}
          />
        </div>
      </section>

      {/* Notifications — single toggle for now. Lives in General (not  */}
      {/* Logging) because it controls a user-facing notification, and  */}
      {/* users looking to silence the post-update page expect to find  */}
      {/* it next to other behavioural toggles like Sound Engine.       */}
      <section
        aria-labelledby="general-notifications-heading"
        className="space-y-4 border rounded-lg p-4"
      >
        <h3 id="general-notifications-heading" className="text-sm font-semibold">
          Notifications
        </h3>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="whats-new-toggle">Show What&apos;s New on update</Label>
            <p id="whats-new-desc" className="text-sm text-muted-foreground">
              Open a page describing new features when Finch updates to a new version.
            </p>
          </div>
          <Switch
            id="whats-new-toggle"
            aria-describedby="whats-new-desc"
            checked={showWhatsNewOnUpdate}
            onCheckedChange={handleWhatsNewToggle}
          />
        </div>
      </section>

      {!generalReset.pending ? (
        <Button
          variant="outline"
          onClick={() =>
            generalReset.requestConfirm(
              "Are you sure? Press Reset General Settings again to confirm.",
            )
          }
        >
          Reset General Settings
        </Button>
      ) : (
        <Button ref={generalResetRef} variant="destructive" onClick={generalReset.confirm}>
          Confirm Reset General Settings
        </Button>
      )}

      {!factoryReset.pending ? (
        <Button
          variant="outline"
          onClick={() =>
            factoryReset.requestConfirm("Are you sure? Press Factory Reset again to confirm.")
          }
        >
          Reset All Settings (Factory Reset)
        </Button>
      ) : (
        <Button ref={factoryResetRef} variant="destructive" onClick={factoryReset.confirm}>
          Confirm Factory Reset
        </Button>
      )}
    </div>
  );
}
