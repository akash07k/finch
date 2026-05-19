<!--
Long store-listing description used by Chrome Web Store (16,000 char limit) and
Firefox AMO (15,000 char limit). Plain text only; the stores do not render
markdown. Avoid code fences and tables.

Check character count before publishing:

    wc -c extension/store-listing/description.md
-->

# Finch - audio cues for browser events

Finch plays short audio cues when things happen in your browser. A tab opens. A download finishes. A page loads. A bookmark gets saved. Instead of waiting for a visual indicator or wondering whether an action went through, you hear it.

## Who this is for

The primary audience is blind and low-vision users. Screen readers announce content well, but they often miss the smaller state changes that sighted users pick up from visual motion: a download icon flashing, a tab indicator changing, a bookmark icon turning yellow. Finch fills that gap with short audio cues per event.

If you are not a screen-reader user, Finch is still useful as a non-visual channel for what your browser is doing. Useful when you have many tabs open, slow pages loading in the background, or downloads running while you work in another window.

## What you hear

64 events across three tiers. Pick the level of detail you want.

Tier 1 (Essential, 25 events, on by default): tab created, tab closed, tab switched, page loading, page loaded, navigation start, download start, download complete, download failed, bookmark added, bookmark removed, window opened, window closed, window focused, tab title changed, extension installed, and a handful more. The events most people want.

Tier 2 (Useful, 37 events, opt-in): tab muted or unmuted, tab pinned, tab zoomed, URL visited, history cleared, tab group created, system idle, system locked, omnibox interactions. Useful in specific workflows.

Tier 3 (Advanced, 2 events, hidden by default): events that fire often enough to be noisy but useful for very specific workflows.

Per-event debounce suppresses rapid duplicates from the same event firing in bursts, like a page rewriting its title several times during load.

## Configuration

The Sound Events tab in the options page lists every event with its own controls. For each event you can:

- Enable or disable the sound independently. Hate the page-loaded cue but love the download-complete one? Turn the loaded one off.
- Adjust volume from 0 to 100 percent.
- Adjust pitch from 0.5x to 2.0x.
- Preview the sound on demand without enabling the event first.

A master volume and a master mute apply across every event.

## Sound themes

Sounds are organised into themes. The extension ships with the Pulse theme, a set of short cues designed to sit comfortably under a screen reader's voice. Events without a dedicated sound in the active theme fall back to a sensible default based on the event's tier.

## Smart suppression

Browsers fire events in bursts. Clicking a link can produce navigation-starting, page-loading, navigation-committed, DOM-ready, and page-loaded in under a second - five events for one user action. Playing five sounds for one action would be overwhelming.

Finch includes:

- A global cooldown gate (~150 ms) that suppresses cascading events while still letting you hear the first one.
- Priority preemption so higher-priority events (errors, page-loaded) can still play inside the cooldown window, preempting lower-priority cues.
- Per-event debounce for events that rapid-fire on their own (tab title changes during a page load, for example).

You hear the meaningful events, not every twitch of the event stream.

## What Finch is not

Finch does not play music or continuous audio. It does not read page content; your screen reader handles that. It does not block ads, modify pages, inject scripts, or observe what you do on websites. It does not replace your browser's notification system; it sits alongside it as an audio channel where the browser provides visual cues.

## Privacy

No telemetry. No analytics. No crash reports. No accounts. No third-party services or CDN fetches at runtime. All settings live in the browser's own extension storage and never leave your machine. Sound files ship inside the extension package.

The extension includes an optional local log viewer for developers - runs on localhost:8089, off by default, never reachable from outside the machine. A normal user does not need to touch it.

## Keyboard shortcuts

Global, work from any tab:

- Alt + M - toggle mute
- Alt + Shift + O - open the options page

Inside the options page:

- Alt + T - cycle through sound themes
- Shift + ? - read a help announcement listing the available shortcuts

Tab navigation in the options page uses the standard WAI-ARIA pattern: Tab into the tab list, then Left or Right to move between General, Sound Events, Themes, and Logging.

## Accessibility

Accessibility is a hard gate for every change that touches the UI. Finch targets WCAG AA with WCAG AAA where practical. The popup and options use accessible React primitives, live-region announcements are throttled to avoid overwhelming screen readers, and every interactive control has an explicit accessible name.

## Browser compatibility

Chrome 140 or later. Firefox 142 or later.

## Open source

Finch is released under the GNU Affero General Public License v3.0. Source code, documentation, and release history are available on GitHub at [https://github.com/akash07k/finch](https://github.com/akash07k/finch).

Issue reports, theme submissions, and pull requests are welcome.
