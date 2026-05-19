# Oriole

Audio cues for browser events. Oriole plays short sounds when things happen in your browser: a tab opens, a download finishes, a page loads. The primary audience is screen-reader users, where visual cues for these events are easy to miss. Sighted users can use it for ambient feedback without watching the screen.

## Install

- Chrome, Chromium, Edge, Brave: [Oriole on the Chrome Web Store](https://chromewebstore.google.com/detail/oriole/mklgnoddcbikoenjlfmdghigeapfeijk)
- Firefox: [Oriole on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/oriole/)

Both store versions auto-update. For testing pre-release builds, [GitHub Releases](https://github.com/akash07k/oriole/releases) attaches Chrome and Firefox zips per release. Chrome: load unpacked via `chrome://extensions` developer mode. Firefox: temporary load via `about:debugging`. Sideloads do not auto-update.

Store-listing copy lives in [`extension/store-listing/`](./extension/store-listing/).

## What it does

65 browser events across three tiers: 26 essential (on by default), 37 useful (opt-in), and 2 advanced (power users). Every event has its own enable toggle, volume slider, pitch slider, and preview button.

The Pulse sound theme ships built in. The theme format is documented in [`docs/sound-themes.md`](./docs/sound-themes.md) for future authoring; in-extension theme import is planned for a future release.

A global cooldown (~150 ms) prevents cascading sounds from a single user action. Per-event debounce handles rapid-fire duplicates. Higher-priority events can preempt lower-priority cues already in the cooldown window.

Keyboard shortcuts: Alt+M to toggle mute, Alt+Shift+M to mute when the browser is unfocused, Alt+Shift+R to open options (all global). Inside the options page: Alt+T cycles themes, Shift+? reads a help announcement.

## Privacy

No telemetry. No analytics. No crash reports. No accounts. No third-party services or CDN fetches. All settings stored in `browser.storage.local`, never leaving your machine.

The optional log viewer for development runs only on `localhost:8089` and is off by default.

## Project links

- [`CHANGELOG.md`](./CHANGELOG.md)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`LICENSE.md`](./LICENSE.md) - AGPL-3.0
- [`docs/`](./docs/) - architecture and design docs; see [`docs/README.md`](./docs/README.md) for the index
- [GitHub Issues](https://github.com/akash07k/oriole/issues)
- [GitHub Releases](https://github.com/akash07k/oriole/releases)

## Developer setup

Requires Node.js 20 or later and pnpm 10 or later.

```sh
git clone https://github.com/akash07k/oriole.git
cd oriole
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

If one store rejects an upload (most commonly Chrome's `ITEM_NOT_UPDATABLE` while a previous review is still in flight), you can re-dispatch the workflow against just the failing store once the rejection clears. The GitHub Release is created on the original tag push regardless of submit outcome, so re-dispatch never produces a duplicate Release.

[![Re-dispatch release workflow](https://img.shields.io/badge/Actions-Re--run%20release-blue?logo=github)](https://github.com/akash07k/oriole/actions/workflows/release.yml)

Open the workflow page above, click **Run workflow**, then pick:

- **target** — `both` (default; matches the tag-triggered behaviour), `chrome` (only Chrome Web Store, use after a Chrome rejection clears), or `firefox` (only Firefox AMO, use after an AMO rejection clears).
- **create_release** — leave off for ordinary re-submissions. Toggle on if the original tag-triggered run never produced a GitHub Release page entry (e.g., every store rejected, or the tag pre-dated this workflow setup) and you want this dispatch to create one. The tag name comes from `extension/package.json` when you dispatch against a branch, or from the ref itself when you pick a tag in "Use workflow from".

The dispatch UI's "Use workflow from" dropdown also lets you choose a ref (branch or tag, default `main`). Picking the version's tag (e.g., `v1.1.0`) also makes the workflow create the Release automatically — no need to toggle `create_release` in that case.

### Log server

```sh
pnpm log-server:dev
```

Then enable log streaming in the extension's options page (Logging tab). The viewer is at <http://localhost:8089>.

## Architecture

pnpm monorepo with three packages:

- `extension/` - the WXT browser extension (the product)
- `packages/logger/` - `@oriole/logger`, structured logger used by the extension
- `packages/log-server/` - `@oriole/log-server`, dev-only WebSocket sink and React viewer

The extension uses a module-system with lifecycle stages (initialize, activate, deactivate, dispose). Modules talk via a message bus and never import each other directly. The sound engine module is the only module so far.

Audio is browser-specific: Chrome uses an offscreen document (service workers have no DOM); Firefox plays directly in the background page. Both delegate to a shared `HowlerPlayer`.

See [`docs/architecture.md`](./docs/architecture.md) for the full layout.

## Browser support

Chrome 140 or later. Firefox 142 or later.

## License

[AGPL-3.0-only](./LICENSE.md)
