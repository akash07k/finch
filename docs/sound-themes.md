# Sound themes

This document explains how to author a new sound theme for Oriole and what the contract is between a theme and the sound engine.

## What a theme is

A theme is a directory under `extension/public/sounds/<theme-id>/` containing:

- `theme.json` - the manifest. Maps event ids to sound file paths plus a small set of fallbacks.
- One or more `.ogg` audio files referenced by the manifest.

The theme manager loads the manifest at runtime, validates it, and uses it to answer "which sound plays for this event?". The fallback chain handles events the manifest doesn't explicitly map.

The extension currently ships with one theme: Pulse. The theme system is designed to support multiple themes; a future theme just adds a new directory and registers itself in `extension/config/themes.ts`.

## Manifest schema

```json
{
  "id": "pulse",
  "name": "Pulse",
  "description": "Short, non-intrusive cues that sit comfortably under a screen reader's voice.",
  "version": "1.0.0",
  "author": "Oriole",
  "license": "AGPL-3.0",
  "mappings": {
    "tabs.onCreated": "tab-created.ogg",
    "tabs.onRemoved": "tab-closed.ogg",
    "downloads.onCreated": "download-started.ogg",
    "...": "..."
  },
  "fallbacks": {
    "error": "error.ogg",
    "tier1": "generic-tier1.ogg",
    "tier2": "generic-tier2.ogg",
    "tier3": "generic-tier3.ogg",
    "info": "generic-info.ogg"
  }
}
```

Required fields: `id`, `name`, `description`, `version`, `mappings`, `fallbacks`. The validator in [`theme-schema.ts`](../extension/modules/sound-engine/theme-schema.ts) rejects manifests missing any of these.

`mappings` keys are event ids from [`event-registry.ts`](../extension/modules/sound-engine/event-registry.ts). Values are filenames relative to the theme directory.

`fallbacks` covers the cases where `mappings` doesn't have an entry - see the resolution order below.

## Fallback resolution

The theme manager resolves an event id to a sound file in this order:

1. **Direct mapping**: `mappings[eventId]` if present. Used most often.
2. **Error fallback**: `fallbacks.error` if the event has `isError: true` in its `EventDefinition`.
3. **Tier fallback**: `fallbacks.tier1`, `tier2`, or `tier3` based on the event's tier.
4. **Generic info fallback**: `fallbacks.info` as a last resort.
5. **null**: no sound available; the engine announces "Preview unavailable for X" via polite live region.

The fallback chain means a theme that maps only the most common events still produces sensible audio for the rest. Conversely, a theme that maps everything explicitly never falls through.

## Disabling fallbacks

Three ways to silence specific events:

- **Per-user, in the options page**: turn off the event's enable toggle.
- **Per-theme, by mapping to an empty string**: `"tabs.onActivated": ""` makes the theme manager treat the event as having no sound (skips fallback).
- **Theme-wide, by removing all fallbacks**: a manifest without a `fallbacks` block or with `null` fallback values means events without a direct mapping fall straight to "no sound". This is the "sounds only when explicitly mapped" theme.

## Sound file requirements

- **Format**: OGG Vorbis. Browsers support it natively, no codec dance required. The Pulse theme uses libvorbis quality 6 (~110 kbps for short clips).
- **Length**: 50 ms to 500 ms. Anything longer overlaps the next event in a cascade.
- **Sample rate**: 44.1 kHz. Standard, plays cleanly on any audio output.
- **Channels**: mono is fine for most events; stereo is fine if the sound design needs it.
- **Loudness**: aim for -23 LUFS integrated, with peaks under -3 dBTP. The per-event volume slider gives the user the final say, but a theme with wildly inconsistent loudness is hard to balance.
- **Headroom**: avoid hard limiting that pumps. The audio backend doesn't add any compression.

## File naming

Use the event-derived noun as the filename. `tabs.onCreated` → `tab-created.ogg`. `downloads.onChanged.resumed` → `download-resumed.ogg`. Hyphens, lowercase, no spaces. Keeps the directory listing readable.

For the fallback files, use the tier or category: `generic-tier1.ogg`, `error.ogg`, `generic-info.ogg`.

## Adding a new theme

1. Create `extension/public/sounds/<your-id>/`.
2. Add a `theme.json` with all required fields.
3. Add the audio files referenced by `mappings` and `fallbacks`.
4. Register the theme in [`extension/config/themes.ts`](../extension/config/themes.ts) by adding an entry to `BUILT_IN_THEMES`.
5. Run `pnpm test`. The "every default-enabled event has a mapping" contract test will fail if your manifest is missing a tier 1 event.
6. Run the extension and pick the new theme from the Themes tab in options.

## Authoring tips

- **Start with the essentials.** Map the 25 tier 1 events first; let the fallbacks cover the rest. You can map tier 2 and tier 3 events later.
- **Use the Preview button.** Each row in the Sound Events tab has a Preview button that plays the resolved sound. Use it to verify your mapping without enabling the event.
- **Test the cascade behaviour.** Open a few tabs in quick succession, navigate to a slow page, start a download. Listen for cooldown bunching. If a cue feels swallowed, check whether it's tier 2 or tier 3 (those get suppressed by tier 1 events in the cooldown window).
- **Test with a screen reader running.** Oriole's primary audience is NVDA / VoiceOver users. A cue that sounds great with a silent screen but blends into the screen reader's voice in real use is a fail.
- **Match the theme's character.** A theme of soft chimes shouldn't have one event using a sharp click. Inconsistency stands out.

## Built-in theme: Pulse

The Pulse theme uses 29 short cues, all in libvorbis-compressed OGG. Cohesive across the tier 1 set, with distinct sounds for the most common events. Source files were curated and re-encoded per the requirements above.

The fallback set is conservative: error fallback for any unmapped error event, generic tier sounds that gesture at the event family without being specific.

## Removing a theme

If you want a build of Oriole without Pulse (or any theme), remove its entry from `BUILT_IN_THEMES` and delete its directory. The theme manager skips themes it doesn't know about; the user just sees fewer entries in the theme picker.

The extension always falls back to "no sound" if no theme is active or no fallback resolves, so a build with zero themes is technically valid (and silent).
