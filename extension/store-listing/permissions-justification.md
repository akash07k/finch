<!--
Per-permission justifications. Both Chrome Web Store and Firefox AMO
ask for these in the submission form. Copy the relevant paragraph
into the store's permissions field.

When adding or removing a permission from wxt.config.ts, update the
matching entry here in the same commit.
-->

# Permission justifications

Oriole requests the following browser APIs. Each one is used only to listen for the event the user chose to hear.

## `tabs`

Listens for tab lifecycle events: tab created, tab closed, tab activated, tab moved, tab attached, tab detached, tab title changed, tab audio started or stopped, tab muted or unmuted. Without this permission Oriole cannot play sounds for any tab-related event - which is more than half of the defaults.

## `bookmarks`

Listens for bookmark lifecycle events: bookmark added, bookmark removed, bookmark moved, bookmark changed, bookmark folder reordered. Used only to trigger the matching audio cue.

## `downloads`

Listens for download lifecycle events: download started, download complete, download failed, download paused, download resumed. Used only to trigger the matching audio cue. Oriole never reads download contents.

## `webNavigation`

Listens for navigation lifecycle events: navigation starting, navigation committed, DOM content loaded, page fully loaded, navigation errored. The page-loaded cue in particular is a core signal for screen-reader users.

## `storage`

Stores the user's configuration (volumes, per-event enable/disable, active theme, master mute state) in the browser's local extension storage. No syncing, no cloud - strictly `browser.storage.local`.

## `notifications`

Shows a short visual confirmation when the mute shortcut is pressed ("Oriole muted" / "Oriole unmuted"). Gives sighted users feedback for a shortcut that otherwise only produces audio silence.

## `idle`

Listens for system state changes: active, idle, locked. Lets Oriole play an audio cue when the computer wakes from sleep or when the session locks - a small accessibility assist for users who cannot rely on the visual lock screen to know the state changed.

## Optional permissions

The next three are declared under `optional_permissions` rather than the static list, so a fresh install does not ask for them. Oriole requests each one at runtime only when the user toggles on the matching Tier 2 event in the Sound Events tab. Declining the prompt leaves the event disabled.

## `history` (optional)

Listens for browser-history events (URL visited, entries removed). Off by default in Tier 2; users who enable them get audio confirmation that a history write or clear actually happened.

## `management` (optional)

Listens for extension lifecycle events (extension installed, extension uninstalled, extension enabled, extension disabled). Off by default in Tier 2.

## `cookies` (optional)

Listens for cookie-change events. Off by default in Tier 2; used only by power users who want audio confirmation of cookie writes or deletions.

## `offscreen` (Chrome only)

Chrome's MV3 service worker has no DOM and cannot play audio directly. Oriole creates a hidden offscreen document solely to host an `<audio>` element for playback. No UI, no user-visible window - purely an implementation detail of Chrome's service-worker model. Firefox builds do not include this permission because Firefox's background page already has DOM access.

## No host permissions

Oriole does not request `host_permissions` or any "access all websites" permission. It cannot read page content, inject scripts, observe network requests, or see form data.
