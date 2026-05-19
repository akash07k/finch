<!--
Long store-listing description used by Chrome Web Store (16,000 char limit) and
Firefox AMO (15,000 char limit). Plain text only; the stores do not render
markdown. Avoid code fences and tables.

Check character count before publishing:

    wc -c extension/store-listing/description.md
-->

# Finch — a songbird for your browser

Finch plays short audio cues when things happen in your browser. A tab opens. A download finishes. A page loads. A bookmark gets saved. Instead of checking the screen for visual indicators, you hear it.

Named after the bird. Finches are small songbirds known for their varied, distinctive calls — each species has its own song. This extension works the same way: each browser event gets its own short, recognizable sound.

## Who this is for

The primary audience is blind and low-vision users. Screen readers announce page content well, but they miss the smaller state changes that sighted users catch from visual motion: a download icon flashing, a tab indicator changing, a bookmark turning yellow. Finch fills that gap with short audio cues.

If you're not a screen-reader user, Finch is still useful as ambient feedback for what your browser is doing — handy when pages load in background tabs, downloads run while you work in another window, or you have too many tabs to track visually.

## What you hear

63 events across three tiers. Pick the detail level you want.

Tier 1 — Essential (26 events enabled by default): tab created, tab closed, tab switched, page loading, page loaded, navigation error, download started, download complete, download failed, bookmark added, bookmark removed, window opened, window closed, window focused, tab title changed, extension installed, and more. The events most people want out of the box.

Tier 2 — Useful (37 events, opt-in): tab muted/unmuted, tab pinned, tab zoomed, URL visited, history cleared, tab group changes, system idle, system locked, omnibox interactions, cookie changes. Useful for specific workflows; each one requires a one-time permission prompt.

Tier 3 — Advanced (2 events, off by default): events that fire frequently enough to be noisy. Useful for debugging or very specific monitoring needs.

Per-event debounce suppresses rapid duplicates — a page rewriting its title several times during load only triggers one cue.

## Configuration

The Sound Events tab in the options page lists every event with individual controls:

- Enable or disable each event independently.
- Volume from 0% to 100%.
- Pitch from 0.5x to 2.0x.
- Preview any sound without enabling the event.

A master volume and master mute apply across all events. A separate "mute when unfocused" toggle silences cues whenever no browser window has focus — useful if you switch to another application and don't want stray sounds.

## Sound themes

Sounds are organized into themes. Finch ships with the Pulse theme — short, clean cues designed to sit under a screen reader's voice without competing. Events that don't have a dedicated sound in the active theme fall back to a tier-based default.

Custom theme import is planned for a future release.

## Smart suppression

Browsers fire events in bursts. Clicking a link can produce navigation-starting, page-loading, navigation-committed, DOM-ready, and page-loaded in under a second — five events for one user action. Playing all five sounds would be overwhelming.

Finch handles this with:

- A global cooldown (~150 ms) that suppresses cascading events while letting you hear the first one.
- Priority preemption: higher-priority events (errors, page-loaded) can break through the cooldown window.
- Per-event debounce for events that rapid-fire on their own.

You hear the meaningful events, not every internal state change.

## What Finch is not

Finch does not play music or continuous audio. It does not read page content — your screen reader handles that. It does not block ads, modify pages, inject scripts, or observe what you do on websites. It does not request access to any website's content. It listens to browser API events (tabs, bookmarks, downloads, navigation) and plays a short sound. That's it.

## Privacy

No telemetry. No analytics. No crash reports. No accounts. No third-party services. No CDN fetches. All settings are stored locally in the browser's own extension storage and never leave your machine. Sound files ship inside the extension package.

An optional local log server for developers runs on localhost:8089 and is off by default.

## Keyboard shortcuts

Global (work from any tab or window):

- Alt+M — toggle mute
- Alt+Shift+M — toggle mute-when-unfocused
- Alt+Shift+I — open the options page

Inside the popup and options page:

- Alt+T — cycle through sound themes
- Shift+? — hear the available shortcuts read aloud

Tab navigation in options follows the standard WAI-ARIA pattern: Tab into the tab list, Left/Right to switch between General, Sound Events, Themes, and Logging.

## Accessibility

Accessibility is a hard requirement, not a nice-to-have. Finch targets WCAG AA with WCAG AAA contrast ratios. The popup and options page use accessible React primitives (Radix UI), live-region announcements for state changes, and explicit accessible names on every interactive control. All destructive actions (reset, clear logs) require a two-step confirmation.

## Browser compatibility

Chrome 140 or later. Firefox 142 or later.

## Open source

Finch is released under the GNU Affero General Public License v3.0 (AGPL-3.0). Source code, documentation, and releases are on [GitHub](https://github.com/akash07k/finch).

Issue reports, theme contributions, and pull requests are welcome.
