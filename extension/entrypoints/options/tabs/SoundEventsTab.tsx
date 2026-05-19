/**
 * @module options/tabs/SoundEventsTab
 *
 * Sound Events settings tab — filterable table of browser events
 * supported on the current platform, with per-event controls:
 * enable/disable, volume, pitch, and preview.
 *
 * Uses a plain HTML table (not a grid) because each row is an independent
 * settings control, not a spreadsheet. NVDA reads row/column context
 * automatically with native tables.
 *
 * All interactive controls have aria-label with the event name
 * (e.g., "Volume for Tab Created") so screen readers provide
 * full context when tabbing through controls.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { sendLog, sendPreviewSound } from "@/core/messaging/send";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getEventDefaults } from "@/config/events";
import { Play } from "lucide-react";
import { announce } from "@/shared/a11y/announcer";
import { useConfirmAction } from "@/shared/hooks/use-confirm-action";
import { pickOptionalPermissions, requestPermissions } from "@/shared/permissions/request";
import { EVENT_REGISTRY } from "@/modules/sound-engine/event-registry";
import { eventConfigItem, type StoredEventConfig } from "@/core/settings/items";
import { validateEventConfig } from "@/core/settings/validate";
import type { EventDefinition } from "@/modules/sound-engine/types";

/** Events supported on the current browser (filtered at build time). */
const PLATFORM_EVENTS = EVENT_REGISTRY.filter((e) =>
  e.platforms.includes(import.meta.env.BROWSER === "firefox" ? "firefox" : "chrome"),
);

/**
 * Available tier filter options.
 *
 * The default three "Tier N" options each show exactly that tier —
 * no cumulative views — so the count denominator can be per-tier and
 * stay honest. "All tiers" is the opt-in escape hatch for users who
 * want to browse everything at once; it is NOT the default (the
 * default is `"1"` so a new install lands on the essential events).
 *
 * Label format matches docs/sound-themes.md section headers ("Tier 1:
 * Essential") so written doc and UI stay in sync. "All tiers" parallels
 * "Tier N" phrasing so NVDA reads a consistent axis within the radio
 * group instead of a second noun ("tier" vs "event") mid-list.
 */
const TIER_OPTIONS = [
  { value: "1", label: "Tier 1: Essential" },
  { value: "2", label: "Tier 2: Useful" },
  { value: "3", label: "Tier 3: Advanced" },
  { value: "all", label: "All tiers" },
] as const;

/** Count of events per tier — computed once at module load so the
 *  filtered denominator ("Showing X of Y essential events") doesn't
 *  recompute on every render. Keyed by the tier-filter value. */
const EVENTS_PER_TIER: Record<string, number> = {
  "1": PLATFORM_EVENTS.filter((e) => e.tier === 1).length,
  "2": PLATFORM_EVENTS.filter((e) => e.tier === 2).length,
  "3": PLATFORM_EVENTS.filter((e) => e.tier === 3).length,
  all: PLATFORM_EVENTS.length,
};

/** Short noun-phrase per tier for the count text ("20 of 20 essential
 *  events match"). Keyed by the tier-filter value. Empty string for
 *  "all" so the count-text helper drops the noun segment entirely —
 *  "Showing X of Y events" reads better than "Showing X of Y  events". */
const TIER_NOUN: Record<string, string> = {
  "1": "essential",
  "2": "useful",
  "3": "advanced",
  all: "",
};

/**
 * Build the result-count text shared by the visible div and the
 * debounced live region. The noun-less branch handles the "all"
 * tier case where TIER_NOUN is an empty string; collapsing that to a
 * distinct template avoids the double-space artefact that a naive
 * template string would produce.
 */
function countText(matched: number, total: number, noun: string, suffix: string): string {
  return noun
    ? `${matched} of ${total} ${noun} events${suffix}`
    : `${matched} of ${total} events${suffix}`;
}

/** Sound Events settings tab — filterable table of all browser events with per-event controls. */
export function SoundEventsTab() {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("1");
  const [configs, setConfigs] = useState<Record<string, StoredEventConfig>>({});
  // Mirror of `configs` for handlers that need the latest value without
  // capturing a stale closure (e.g., a slider commit firing after a
  // toggle that flipped `enabled` in the same render cycle).
  const configsRef = useRef(configs);
  useEffect(() => {
    configsRef.current = configs;
  }, [configs]);
  const eventsResetRef = useRef<HTMLButtonElement>(null);
  const eventsReset = useConfirmAction(eventsResetRef, async () => {
    const defaults: Record<string, StoredEventConfig> = {};
    for (const event of PLATFORM_EVENTS) {
      defaults[event.id] = {
        enabled: getEventDefaults(event.id).enabled,
        volume: 100,
        pitch: 1.0,
      };
    }
    await Promise.all(PLATFORM_EVENTS.map((e) => eventConfigItem(e.id).removeValue()));
    setConfigs(defaults);
    announce("All sound event settings reset to defaults", "polite");
    sendLog("warn", "Sound event settings reset to defaults", { source: "options" });
  });

  // Debounced result count for the screen-reader live-region (see render below).
  // Sighted users see the live count update on every keystroke; SR users hear
  // ONE announcement after they pause typing for 250 ms.
  const [announcedMatchCount, setAnnouncedMatchCount] = useState<number | null>(null);

  // Load per-event configs from storage
  useEffect(() => {
    async function load() {
      const fallback = (id: string): StoredEventConfig => ({
        enabled: getEventDefaults(id).enabled,
        volume: 100,
        pitch: 1.0,
      });
      try {
        const entries = await Promise.all(
          PLATFORM_EVENTS.map(async (event) => {
            const value = await eventConfigItem(event.id).getValue();
            return [event.id, value ?? fallback(event.id)] as const;
          }),
        );
        setConfigs(Object.fromEntries(entries));
      } catch {
        setConfigs(Object.fromEntries(PLATFORM_EVENTS.map((e) => [e.id, fallback(e.id)])));
      }
    }
    load();
  }, []);

  // Filter events by search + tier. Per-tier means exactly ONE tier
  // is visible at a time; "all" is the explicit opt-in for every tier.
  const filteredEvents = useMemo(() => {
    const query = search.toLowerCase();
    // Load-bearing short-circuit: Number("all") === NaN, and
    // `event.tier !== NaN` is always true, so every event would be
    // filtered out if we dropped the `tierFilter !== "all"` guard.
    // Do not "simplify" the guard away.
    const tier = Number(tierFilter);
    return PLATFORM_EVENTS.filter((event) => {
      if (tierFilter !== "all" && event.tier !== tier) return false;

      // Search filter
      if (query) {
        return (
          event.label.toLowerCase().includes(query) ||
          event.category.toLowerCase().includes(query) ||
          event.id.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [search, tierFilter]);

  // Debounce the live-region announcement so SR users hear ONE update
  // after they pause typing, not one per keystroke. The visible count
  // (the #event-count div in the UI) updates immediately so sighted
  // users get instant feedback.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnnouncedMatchCount(filteredEvents.length);
    }, 250);
    return () => clearTimeout(timer);
  }, [filteredEvents.length]);

  /**
   * Save a single event config to storage after schema validation.
   * Invalid values (out-of-range volume or pitch from a slider bug)
   * are rejected with an assertive announcement so the user sees the
   * failure rather than silently inheriting a clamped value at read
   * time.
   */
  const saveEventConfig = (eventId: string, config: StoredEventConfig) => {
    const result = validateEventConfig(config);
    if (!result.ok) {
      announce(`Could not save: ${result.error}`, "assertive");
      sendLog("warn", "Rejected invalid event config", { eventId, error: result.error });
      return;
    }
    eventConfigItem(eventId).setValue(config);
  };

  /**
   * Toggle an event's enabled state.
   *
   * When enabling an event whose `permissions` overlap with the
   * extension's optional permissions (management / cookies / history),
   * request the runtime grant first. If the user denies, the toggle
   * does not flip — the cached state stays at its previous value and
   * storage is not written. Disabling never prompts.
   */
  const handleToggle = async (event: EventDefinition, checked: boolean) => {
    if (checked) {
      const needed = pickOptionalPermissions(event.permissions);
      if (needed.length > 0) {
        // EventDefinition.permissions is `string[]` (registry shape is
        // platform-agnostic), but chrome.permissions.Permissions expects
        // the typed ManifestPermission union. The cast is safe because
        // pickOptionalPermissions filters the input to OPTIONAL_PERMISSIONS.
        const granted = await requestPermissions({
          permissions: needed as chrome.runtime.ManifestPermissions[],
        });
        if (!granted) {
          // The Switch optimistically rendered the new "on" state from
          // its own internal value before our handler ran. Force a
          // re-render with the previous config so the visual toggle
          // snaps back, and tell the user assertively because the
          // visible toggle just lied to them.
          // `prev[event.id]` may be undefined if the toggle fires before
          // the load effect resolves; fall back to defaults so the entry
          // still has enabled/volume/pitch after the revert.
          setConfigs((prev) => ({
            ...prev,
            [event.id]: { ...(prev[event.id] ?? getEventDefaults(event.id)) },
          }));
          announce(
            `${event.label} requires the ${needed.join(", ")} permission. Not enabled.`,
            "assertive",
          );
          return;
        }
      }
    }
    setConfigs((prev) => {
      const current = prev[event.id] ?? getEventDefaults(event.id);
      const updated = { ...current, enabled: checked };
      // Persist inside the setter so the write sees the freshest config
      // even if a concurrent slider update landed between render and here.
      // saveEventConfig is idempotent (same key → same value), so a
      // strict-mode double-invoke is safe.
      saveEventConfig(event.id, updated);
      return { ...prev, [event.id]: updated };
    });
    announce(`${event.label} ${checked ? "enabled" : "disabled"}`, "polite");
  };

  /** Update volume UI state on drag (does NOT save to storage yet). */
  const handleVolume = (event: EventDefinition, values: number[]) => {
    const volume = values[0] ?? 100;
    setConfigs((prev) => {
      const current = prev[event.id] ?? getEventDefaults(event.id);
      return { ...prev, [event.id]: { ...current, volume } };
    });
  };

  /** Save volume to storage when slider is released. */
  const handleVolumeCommit = (event: EventDefinition, values: number[]) => {
    const volume = values[0] ?? 100;
    // Read from the ref so we get the latest enabled/pitch values, even
    // if a concurrent state update hasn't been reflected in this closure.
    const current = configsRef.current[event.id] ?? getEventDefaults(event.id);
    saveEventConfig(event.id, { ...current, volume });
  };

  /** Update pitch UI state on drag (does NOT save to storage yet). */
  const handlePitch = (event: EventDefinition, values: number[]) => {
    const pitch = values[0] ?? 1.0;
    setConfigs((prev) => {
      const current = prev[event.id] ?? getEventDefaults(event.id);
      return { ...prev, [event.id]: { ...current, pitch } };
    });
  };

  /** Save pitch to storage when slider is released. */
  const handlePitchCommit = (event: EventDefinition, values: number[]) => {
    const pitch = values[0] ?? 1.0;
    // Read from the ref so we get the latest enabled/volume values, even
    // if a concurrent state update hasn't been reflected in this closure.
    const current = configsRef.current[event.id] ?? getEventDefaults(event.id);
    saveEventConfig(event.id, { ...current, pitch });
  };

  /** Preview an event's sound. */
  const handlePreview = async (event: EventDefinition) => {
    announce(`Playing preview for ${event.label}`, "polite");
    sendLog("info", `Preview requested: ${event.label}`, { eventId: event.id });
    try {
      const result = await sendPreviewSound(event.id);
      if (!result.success) {
        announce(`Preview unavailable for ${event.label}`, "polite");
        sendLog("warn", `Preview failed: ${event.label}`, {
          eventId: event.id,
          error: result.error,
        });
      }
    } catch {
      announce(`Preview unavailable for ${event.label}`, "polite");
    }
  };

  /** Handle tier filter change.
   *
   * Clears the live-region count first so the polite queue is empty
   * when the debounced count update fires. Without the reset the
   * tier-change announcement and the count update can race in the
   * NVDA polite queue and one drops on the floor. The count change
   * alone tells the user what just happened ("20 of 20 useful events
   * match"), so no separate "Filter: ..." announcement is needed. */
  const handleTierChange = (value: string) => {
    setAnnouncedMatchCount(null);
    setTierFilter(value);
  };

  return (
    <div className="space-y-4 mt-4">
      <h2 className="text-xl font-semibold">Sound Events</h2>

      {/* Filters — section so the heading is announced once on entry. The */}
      {/* inner fieldset (tier-filter radio group) IS a real fieldset use.  */}
      <section
        aria-labelledby="sound-events-filters-heading"
        className="space-y-3 border rounded-lg p-4"
      >
        <h3 id="sound-events-filters-heading" className="text-sm font-semibold">
          Filters
        </h3>

        {/* Search */}
        <div className="space-y-1">
          <Label htmlFor="event-search">Search events</Label>
          <Input
            id="event-search"
            type="search"
            placeholder="Filter by name, category, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-describedby="event-count"
          />
        </div>

        {/* Tier filter */}
        <fieldset className="flex gap-4 items-center border-0 p-0 m-0">
          <legend className="text-sm font-medium">Tier</legend>
          {TIER_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="tier-filter"
                value={option.value}
                checked={tierFilter === option.value}
                onChange={() => handleTierChange(option.value)}
                className="w-4 h-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              />
              {option.label}
            </label>
          ))}
        </fieldset>

        {/* Result count — visible (sighted users get instant feedback). */}
        {/* The denominator is the per-tier total so the text stays      */}
        {/* honest when the user is viewing Tier 2 or Tier 3 in          */}
        {/* isolation: "Showing 12 of 30 useful events" not "of 64". For */}
        {/* the "all tiers" filter the denominator is the global total   */}
        {/* and the noun drops out of the template via countText.        */}
        {/* No role=status here so it does NOT announce on every         */}
        {/* keystroke.                                                    */}
        <div id="event-count" className="text-sm text-muted-foreground">
          Showing{" "}
          {countText(
            filteredEvents.length,
            EVENTS_PER_TIER[tierFilter]!,
            TIER_NOUN[tierFilter]!,
            "",
          )}
        </div>
        {/* Live-region announcement, debounced to 250ms so SR users hear  */}
        {/* ONE count update after they stop typing. announcedMatchCount   */}
        {/* starts as null so no announcement fires on initial mount.     */}
        {/* Phrasing mirrors the visible count so SR and sighted users    */}
        {/* get the same denominator — catches the "20 of 63 events"     */}
        {/* vs "20 of 20 essential events" mismatch that confused              */}
        {/* screen-reader users during testing.                  */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcedMatchCount !== null &&
            countText(
              announcedMatchCount,
              EVENTS_PER_TIER[tierFilter]!,
              TIER_NOUN[tierFilter]!,
              " match",
            )}
        </div>
      </section>

      {/* Events table */}
      <Table>
        <TableCaption className="sr-only">
          Sound event configuration. Each row controls one browser event.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Event</TableHead>
            <TableHead scope="col">Description</TableHead>
            <TableHead scope="col">Category</TableHead>
            <TableHead scope="col">Enabled</TableHead>
            <TableHead scope="col">Volume</TableHead>
            <TableHead scope="col">Pitch</TableHead>
            <TableHead scope="col">Preview</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredEvents.map((event) => {
            const config = configs[event.id] ?? {
              enabled: getEventDefaults(event.id).enabled,
              volume: 100,
              pitch: 1.0,
            };
            return (
              <TableRow key={event.id}>
                <TableHead scope="row">{event.label}</TableHead>
                <TableCell className="text-muted-foreground">{event.description}</TableCell>
                <TableCell className="capitalize">{event.category}</TableCell>
                <TableCell>
                  <Switch
                    aria-label={`Enable ${event.label}`}
                    checked={config.enabled}
                    onCheckedChange={(checked) => handleToggle(event, checked)}
                  />
                </TableCell>
                <TableCell className="min-w-[120px]">
                  <Slider
                    aria-label={`Volume for ${event.label}`}
                    aria-valuetext={`${config.volume} percent`}
                    value={[config.volume]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={(v) => handleVolume(event, v)}
                    onValueCommit={(v) => handleVolumeCommit(event, v)}
                    disabled={!config.enabled}
                  />
                </TableCell>
                <TableCell className="min-w-[120px]">
                  <Slider
                    aria-label={`Pitch for ${event.label}`}
                    aria-valuetext={`${config.pitch.toFixed(1)}x speed`}
                    value={[config.pitch]}
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    onValueChange={(v) => handlePitch(event, v)}
                    onValueCommit={(v) => handlePitchCommit(event, v)}
                    disabled={!config.enabled}
                  />
                </TableCell>
                <TableCell>
                  {/* Preview stays interactive regardless of config.enabled —
                      users routinely want to hear an event's sound before
                      deciding whether to enable it. handlePreview already
                      announces "Preview unavailable for X" via polite live
                      region if the theme has no mapping, so the no-sound
                      case is gracefully handled without needing to query
                      resolveSound from the UI layer. */}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Preview sound for ${event.label}`}
                    onClick={() => handlePreview(event)}
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Reset — two-step confirm to prevent accidentally wiping per-event */}
      {/* enable/disable, volume, and pitch overrides for every event.      */}
      {/* Wrapped in its own section landmark so region-hopping             */}
      {/* screen-reader users can jump to it instead of skipping past a     */}
      {/* stray button at the root level.                                   */}
      <section aria-labelledby="sound-events-reset-heading" className="space-y-4">
        <h3 id="sound-events-reset-heading" className="sr-only">
          Reset
        </h3>
        {!eventsReset.pending ? (
          <Button
            variant="outline"
            onClick={() =>
              eventsReset.requestConfirm(
                "Are you sure? Press Reset Sound Event Settings again to confirm.",
              )
            }
          >
            Reset Sound Event Settings
          </Button>
        ) : (
          <Button ref={eventsResetRef} variant="destructive" onClick={eventsReset.confirm}>
            Confirm Reset Sound Event Settings
          </Button>
        )}
      </section>
    </div>
  );
}
