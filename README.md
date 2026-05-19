# Finch

**Hear your browser.** Finch plays short audio cues when things happen — a tab opens, a download finishes, a page loads, a bookmark gets added. Built for screen-reader users who miss the visual cues sighted users take for granted. Also useful as ambient feedback for anyone who doesn't want to watch the screen to know what's happening.

Named after the bird. Finches are songbirds known for their varied, distinctive calls. This extension works the same way: each browser event gets its own short, recognizable sound.

## Install

- Chrome, Chromium, Edge, Brave: Finch on the Chrome Web Store (link pending first submission)
- Firefox: Finch on Firefox Add-ons (link pending first submission)

Both store versions auto-update. For pre-release builds, [GitHub Releases](https://github.com/akash07k/finch/releases) attaches Chrome and Firefox zips. Chrome: load unpacked via `chrome://extensions` developer mode. Firefox: temporary load via `about:debugging`. Sideloaded builds do not auto-update.

Store-listing copy lives in [`extension/store-listing/`](./extension/store-listing/).

## What it does

65 browser events across three tiers (64 on Chrome, 59 on Firefox — some events are platform-specific): 26 essential (Tier 1, enabled by default), 37 useful (Tier 2, opt-in), and 2 advanced (Tier 3). Every event has its own enable toggle, volume slider (0–100%), pitch slider (0.5x–2.0x), and preview button.

The Pulse sound theme ships built in — short, clean cues designed to sit under a screen reader's voice. The theme format is documented in [`docs/sound-themes.md`](./docs/sound-themes.md); in-extension theme import is planned for a future release.

A global cooldown (~150 ms) prevents cascading sounds from a single user action. Per-event debounce handles rapid-fire duplicates. Higher-priority events (errors, page-loaded) can preempt lower-priority cues in the cooldown window.

Keyboard shortcuts: Alt+M toggles mute, Alt+Shift+M toggles mute-when-unfocused, Alt+I opens options (all global).

## Privacy

No telemetry. No analytics. No crash reports. No accounts. No third-party services or CDN fetches. All settings stored in `browser.storage.local`, never leaving your machine. Sound files ship inside the extension package.

An optional log server for development runs on `localhost:8089` and is off by default.

## Project links

- [`CHANGELOG.md`](./CHANGELOG.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`LICENSE.md`](./LICENSE.md) — AGPL-3.0
- [`docs/`](./docs/) — architecture and design docs; see [`docs/README.md`](./docs/README.md) for the index
- [GitHub Issues](https://github.com/akash07k/finch/issues)
- [GitHub Releases](https://github.com/akash07k/finch/releases)

## Developer setup

Requires Node.js 20 or later and pnpm 10 or later.

```sh
git clone https://github.com/akash07k/finch.git
cd finch
pnpm setup
```

`pnpm setup` runs install with `--ignore-scripts`, builds the logger workspace, then runs `wxt prepare`. After that, plain `pnpm install` is enough on dependency bumps.

### Daily commands

```sh
cd extension
pnpm dev           # both browsers concurrently (labelled output)
pnpm dev:chrome    # Chrome only
pnpm dev:firefox   # Firefox only
```

```sh
# from anywhere in the repo:
pnpm typecheck
pnpm lint
pnpm lint:md
pnpm test
```

The pre-push hook runs typecheck, lint, lint:md, and test in parallel.

### Releases

```sh
pnpm release:dry           # preview the next bump and CHANGELOG entry
pnpm release               # bump, write CHANGELOG, signed commit + tag
pnpm release:push          # push main + tag (or `git push --follow-tags origin main`)
# OR all-in-one:
pnpm do-release            # release + push in a single command
```

The tag push fires `.github/workflows/release.yml`, which runs the gates again and submits to both stores. The workflow also creates a GitHub Release with the Chrome zip, Firefox zip, and sources zip attached.

#### Re-running the release after a partial failure

If one store rejects an upload (most commonly Chrome's `ITEM_NOT_UPDATABLE` while a previous review is still in flight), re-dispatch the workflow against the failing store once the rejection clears. The GitHub Release is created on the original tag push regardless of submit outcome, so re-dispatch never produces a duplicate.

[![Re-dispatch release workflow](https://img.shields.io/badge/Actions-Re--run%20release-blue?logo=github)](https://github.com/akash07k/finch/actions/workflows/release.yml)

Open the workflow page above, click **Run workflow**, then pick:

- **target** — `both` (default), `chrome` (Chrome Web Store only), or `firefox` (Firefox AMO only).
- **create_release** — leave off for re-submissions. Toggle on if the original tag-triggered run never created a GitHub Release page entry and you want this dispatch to create one.

The dispatch UI's "Use workflow from" dropdown also lets you choose a ref (branch or tag, default `main`). Picking a version tag (e.g., `v0.1.0`) makes the workflow create the Release automatically — no need to toggle `create_release`.

### Log server

```sh
pnpm log-server:dev
```

Then enable log streaming in the extension's options page (Logging tab). The viewer is at <http://localhost:8089>.

## Architecture

pnpm monorepo with three packages:

- `extension/` — the WXT browser extension (the product)
- `packages/logger/` — `@finch/logger`, structured logger used by the extension
- `packages/log-server/` — `@finch/log-server`, dev-only WebSocket sink and React viewer

The extension uses a module system with lifecycle stages (initialize, activate, deactivate, dispose). Modules communicate via a message bus and never import each other directly. The sound engine is the only module so far.

Audio playback is browser-specific: Chrome uses an offscreen document (service workers have no DOM); Firefox plays directly in the background page via Howler.js. Both share the same `AudioBackend` interface.

See [`docs/architecture.md`](./docs/architecture.md) for the full layout.

## Browser support

Chrome 140 or later. Firefox 142 or later.

## License

[AGPL-3.0-only](./LICENSE.md)
