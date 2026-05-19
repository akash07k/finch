# Architecture

Finch is an audio-feedback browser extension. Browser events are mapped to short audio cues, primarily to give blind and low-vision users a richer sense of what the browser is doing.

The codebase is a small pnpm monorepo with three packages: the extension itself plus two supporting libraries used during development.

- `extension/` - the WXT browser extension (the product).
- `packages/logger/` - `@finch/logger`, consumed by the extension.
- `packages/log-server/` - `@finch/log-server`, the dev-only WebSocket sink and React viewer.
- `docs/` - this directory.
- `README.md` and `LICENSE.md` at the root.

<details>
<summary>Visual tree</summary>

```text
finch/
├── extension/                       # the product (WXT browser extension)
├── packages/
│   ├── logger/                      # @finch/logger (consumed by the extension)
│   └── log-server/                  # @finch/log-server (dev-only WebSocket sink + viewer)
├── docs/                            # this directory
└── README.md, LICENSE.md
```

</details>

The deeper exploration of any subsystem is in its own document; this one is the map.

## Why pnpm workspaces

The extension consumes `@finch/logger` as `workspace:*`. pnpm symlinks the package from `packages/logger/dist/` so changes flow without publishing. This is why `pnpm build:logger` must run before the extension's dev server: the extension imports the built output, not the TS sources. The `pnpm setup` one-shot at the repo root chains this for you (install + build logger + `wxt prepare`).

`packages/log-server` is never bundled into the extension. It runs as a standalone Node CLI plus a small accessible React viewer. The extension only knows about it through the optional `WebSocketTransport` in `@finch/logger`. Without that opt-in, the log-server is invisible.

## Runtime contexts

Three browser-provided execution contexts cooperate:

| Context                                             | Code                                                             | DOM                    | Role                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| Service worker (Chrome) / Background page (Firefox) | `extension/entrypoints/background.ts`                            | Chrome no, Firefox yes | Receives every browser event, decides what to play, manages module lifecycle |
| Offscreen document (Chrome only)                    | `extension/entrypoints/offscreen/main.ts`                        | yes                    | Plays audio (Chrome's service worker has no Audio/AudioContext)              |
| UI pages (popup + options)                          | `extension/entrypoints/popup/`, `extension/entrypoints/options/` | yes                    | React 19 + Radix + Tailwind 4                                                |

Communication between contexts: `chrome.runtime.sendMessage` for one-shot requests (popup-to-background, background-to-offscreen) and `browser.storage.local` change events for ambient settings sync.

## Boot sequence

`extension/entrypoints/background.ts` is the entry point. WXT's `defineBackground()` wraps an asynchronous `bootstrap()` function that:

1. Creates a `Logger` with two transports: `ConsoleTransport` (developer visibility) and `IndexedDBTransport` (persistent, queryable, exportable).
2. Detects platform via `detectPlatform()` from `extension/shared/platform/detect.ts`.
3. Constructs shared services: `MessageBusImpl` (in-process pub/sub) and `BrowserSettingsStore` (backed by `browser.storage.local`, flat dot-notation keys).
4. Dynamically imports the platform-specific audio backend (`ChromeAudioBackend` or `FirefoxAudioBackend`). Vite tree-shakes the unused branch via `import.meta.env.BROWSER`.
5. Registers and initialises modules through `ModuleRegistry` and `ModuleLoader`. There is currently one module: the sound engine.
6. Activates each enabled module from settings.
7. Optionally adds `WebSocketTransport` to the logger if the user has opted in.
8. Wires the runtime message listener (popup/options ↔ background) and the global keyboard shortcut listener (`browser.commands.onCommand`).
9. Opens the options page on first install.
10. Disposes modules cleanly on `runtime.onSuspend`.

The async chain inside `defineBackground(() => bootstrap().catch(...))` is required by MV3: the top-level callback must be synchronous. Errors propagate to `console.error` so they surface in DevTools even before the logger is ready.

## Module system

Every "feature" implements `FinchModule` (see [`extension/core/module-system/types.ts`](../extension/core/module-system/types.ts)):

```ts
interface FinchModule {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly dependencies?: string[];
  initialize(context: ModuleContext): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  dispose(): Promise<void>;
}
```

`ModuleRegistry` stores modules; `ModuleLoader` runs the lifecycle in dependency order via topological sort. State transitions: `registered → initialized → active ↔ inactive → disposed`.

Modules never import each other directly. They communicate through a shared `MessageBus` exposed via `ModuleContext`. The boundary is enforceable, modules are independently testable, and a future second module can be added without modifying the first.

## Sound engine in two paragraphs

The deep dive is in [`sound-engine.md`](./sound-engine.md).

`extension/modules/sound-engine/event-engine.ts` is a generic router. It reads the declarative event registry (`event-registry.ts`), attaches one browser-API listener per event definition, applies the optional per-event filter, runs the optional custom handler, and publishes a `BrowserEventMessage` on the message bus. It owns no decisions about whether a sound should play; that lives in `SoundEngineModule.handleBrowserEvent()`.

`SoundEngineModule.handleBrowserEvent()` is where gating happens: mute → per-event enabled → cooldown gate → resolve sound URL via `ThemeManager` → play via `AudioBackend`. The cooldown gate is an atomic check-and-commit primitive with optional priority preemption. Themes live as JSON manifests under `extension/public/sounds/<theme-id>/theme.json` mapping event ids to sound files in the same directory.

## Cross-browser split

| Concern                  | Chrome (MV3)                                       | Firefox (MV2)                                                                 |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Background context       | Service worker - no DOM                            | Background page - has DOM                                                     |
| Audio playback           | Offscreen document; backend sends play via runtime | Background page calls Howler.js inline                                        |
| `offscreen` permission   | Required in manifest                               | Stripped at build time by `wxt.config.ts`                                     |
| Notification / badge API | `browser.action`                                   | `browser.browserAction`                                                       |
| AMO compliance           | n/a                                                | `browser_specific_settings.gecko.data_collection_permissions` injected by WXT |

The dynamic import of the audio backend in `background.ts` keeps Howler.js out of Chrome's service-worker bundle. Even an unused import would trip Chrome's manifest validator since the service worker has no DOM.

## UI

React 19, Radix UI primitives, Tailwind 4. shadcn/ui "new-york" components live under `extension/components/ui/`. Three a11y conventions matter:

- Tab navigation uses the WAI-ARIA Tabs keyboard model (Tab into the list, then Left/Right/Home/End). `hotkeys-js` covers two local shortcuts (`Alt+T` cycle theme, `Shift+?` help) plus the global `Alt+M` (mute) and `Alt+Shift+C` (open options) registered with `browser.commands`.
- `@react-aria/live-announcer` provides `announce(message, "polite" | "assertive")` for status changes, export notifications, and the welcome banner.
- `extension/shared/a11y/focus.ts` provides focus helpers; the options page uses `requestAnimationFrame` to focus a heading after dismissing modal-like UI.

The user base is dominated by NVDA and VoiceOver users. Accessibility is a hard gate, not a courtesy.

## Settings storage

Two layers talk to `browser.storage.local`, each serving a different consumer:

**Module system (background):** `BrowserSettingsStore` ([`extension/core/settings/browser-store.ts`](../extension/core/settings/browser-store.ts)) exposes a generic `get/set/watch` interface to modules via `ModuleContext`. Keys are flat dot-notation strings (`general.masterVolume`, `sounds.events.tabs.onCreated`), built by flattening the nested `DEFAULT_SETTINGS` tree at startup. Flat storage gives cheap single-key reads and per-key watchers, which matters because the service worker frequently sleeps and wakes.

**UI layer (popup, options, background commands):** Typed storage items defined in [`extension/core/settings/items.ts`](../extension/core/settings/items.ts) via WXT's `storage.defineItem()`. Each item wraps one storage key with a compile-time type, a fallback default from `CONFIG`, and a typed API (`getValue`, `setValue`, `removeValue`, `watch`). UI components import individual items instead of passing raw key strings to `browser.storage.local`.

Both layers read and write the same underlying keys in the same storage area. The split exists because the module system needs a generic `SettingsStore` interface (swappable with `InMemorySettingsStore` in tests), while UI code benefits from per-key type safety and centralised defaults.

**Schema layer:** [`extension/core/settings/schema.ts`](../extension/core/settings/schema.ts) is the single source of truth for the shape and defaults of every setting. Zod schemas define types (via `z.infer`) and defaults (via `.default()` sourced from `CONFIG`). `types.ts` re-exports the inferred types; `defaults.ts` derives `DEFAULT_SETTINGS` by parsing an empty skeleton through the root schema.

## Logger and log server

`packages/logger` is a structured logger with three transports:

- `ConsoleTransport` - formatted output via `console.debug` / `info` / `warn` / `error`.
- `IndexedDBTransport` - persists every entry to `finch-logs`, rotates at 10,000 entries (`CONFIG.logger.idbMaxEntries`). Supports `query()` for export.
- `WebSocketTransport` - opt-in, buffers up to 1,000 entries while disconnected, exponential-backoff reconnect.

`packages/log-server` is a Node `commander` CLI that opens a WebSocket server, holds a ring buffer of recent entries for replay to new clients, and serves a small accessible React UI over HTTP. It exists because Chrome's service-worker DevTools console is awkward to use with a screen reader; the log-server gives screen-reader-friendly real-time visibility.

## Testing

Vitest. Three test scopes:

| Package             | Environment | Pattern                                                                                          |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `@finch/logger`     | Node        | `__tests__/*.test.ts` colocated with source                                                      |
| `@finch/log-server` | Node        | `__tests__/*.test.ts` colocated with source                                                      |
| `finch-extension`   | jsdom       | `core/**/__tests__/*.test.ts`, `shared/**/__tests__/*.test.ts`, `modules/**/__tests__/*.test.ts` |

The extension uses jsdom because some non-UI code touches DOM-shaped APIs. The `WxtVitest()` plugin from `wxt/testing/vitest-plugin` auto-polyfills browser APIs via `fakeBrowser` from `wxt/testing`, which provides in-memory stubs for `browser.storage`, `browser.runtime`, and event objects like `browser.windows.onFocusChanged`. Tests that need to fire browser events use `fakeBrowser.<api>.trigger()` rather than manual stubs.

Two contract tests in [`event-registry.test.ts`](../extension/modules/sound-engine/__tests__/event-registry.test.ts) protect cross-cutting invariants:

- Tier 1 events are enabled by default in `EVENT_DEFAULTS`.
- Every default-enabled event has a direct mapping in every built-in `theme.json`.

## Build and release

Local build: `pnpm build` runs in workspace dependency order (logger → log-server → extension).

Release: `.github/workflows/release.yml` fires on a manual `workflow_dispatch` or a tag push matching `v*`. On tag-triggered runs it first verifies the tag suffix matches `extension/package.json`'s version and fails fast on mismatch. Then it:

1. Installs dependencies (with `--ignore-scripts` to avoid the chicken-and-egg postinstall).
2. Builds the logger, then runs `wxt prepare`.
3. Runs the four hard gates: typecheck, lint, lint:md, test.
4. Zips both browsers via `wxt zip` / `wxt zip:firefox`. The Firefox zip includes the entire monorepo source per AMO requirements.
5. Submits to the Chrome Web Store and Firefox AMO via `wxt submit`.
6. Creates a GitHub Release with the Chrome zip, Firefox zip, and sources zip attached.

Required secrets: `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`, `FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET`.

## Tooling

- Prettier - 100-column, double quotes, trailing commas, LF.
- ESLint - `typescript-eslint` recommended + `eslint-plugin-react` + `eslint-plugin-react-hooks` + `eslint-plugin-jsx-a11y`. Pinned to ESLint 9 because the React and jsx-a11y plugins haven't released ESLint 10 compatible versions yet.
- markdownlint-cli2 - semantic markdown rules; runs as the fourth pre-push and CI gate.
- Lefthook - `pre-commit` runs lint-staged; `commit-msg` runs commitlint; `pre-push` runs the four gates in parallel.
- TypeScript 6.0+ - strict mode. The extension has a one-line `globals.d.ts` with `/// <reference types="chrome" />` because TS 6 tightened auto-loading of ambient types.

## File map

The `extension/` directory contains:

- `wxt.config.ts` - manifest, browser-specific manifest hooks, Vite config.
- `globals.d.ts` - `/// <reference types="chrome" />`, required since TS 6.0.
- `entrypoints/` - WXT file-based entrypoints:
  - `background.ts` - service worker (Chrome) or background page (Firefox).
  - `offscreen/main.ts` - Chrome-only audio playback document.
  - `popup/{main,App}.tsx` - the toolbar popup.
  - `options/{main,App}.tsx` plus `options/tabs/{General,SoundEvents,Themes,Logging}Tab.tsx` - the tabbed settings shell using the WAI-ARIA Tabs model.
- `config/` - ship-time defaults:
  - `index.ts` - the `CONFIG` object covering cooldown, logger limits, log-server tuning.
  - `events.ts` - `EVENT_DEFAULTS`, per-event enabled flag and debounce window.
  - `themes.ts` - `BUILT_IN_THEMES` and `DEFAULT_THEME_ID`.
- `core/` - cross-cutting infrastructure:
  - `module-system/` - `FinchModule`, `ModuleRegistry`, `ModuleLoader`.
  - `message-bus/` - in-process pub/sub.
  - `settings/` - `schema.ts` (Zod source of truth), `BrowserSettingsStore` (module system), `items.ts` (typed WXT storage items for UI).
  - `messaging/` - typed `chrome.runtime.sendMessage` wrapper.
- `modules/sound-engine/` - the audio feature module:
  - `index.ts` - `SoundEngineModule`.
  - `event-registry.ts` - all supported browser events.
  - `event-engine.ts` - generic router.
  - `cooldown-gate.ts` - atomic gate with priority preemption.
  - `theme-loader.ts` - loads built-in theme manifests via fetch.
  - `theme-manager.ts` - resolves event id to sound file URL.
  - `theme-schema.ts` - `theme.json` validator.
  - `types.ts` - `EventDefinition`, `BrowserEventMessage`.
  - `audio-backends/` - Chrome offscreen vs Firefox direct.
- `shared/` - `a11y/` for announcer and focus utilities, `hooks/` for `useConfirmAction` and `useCycleTheme`, `platform/` for browser and OS detection.
- `components/ui/` - shadcn/ui components (button, slider, tabs, and so on).
- `lib/utils.ts` - the `cn()` Tailwind class merger.
- `public/` - `icon/` for extension icons, `sounds/<theme>/` for `theme.json` and `.ogg` files.

<details>
<summary>Visual tree</summary>

```text
extension/
├── wxt.config.ts                       # Manifest, browser-specific manifest hooks, Vite config
├── globals.d.ts                        # /// <reference types="chrome" /> - required since TS 6.0
├── entrypoints/
│   ├── background.ts                   # Service worker / background page entry
│   ├── offscreen/main.ts               # Chrome-only audio playback document
│   ├── popup/{main,App}.tsx            # Toolbar popup
│   └── options/
│       ├── {main,App}.tsx              # Tabbed settings shell (WAI-ARIA Tabs)
│       └── tabs/{General,SoundEvents,Themes,Logging}Tab.tsx
├── config/                             # Ship-time defaults
│   ├── index.ts                        # CONFIG: cooldown, logger limits, log-server tuning
│   ├── events.ts                       # EVENT_DEFAULTS - per-event enabled/debounce
│   └── themes.ts                       # BUILT_IN_THEMES, DEFAULT_THEME_ID
├── core/                               # Cross-cutting infrastructure
│   ├── module-system/                  # FinchModule, ModuleRegistry, ModuleLoader
│   ├── message-bus/                    # In-process pub/sub
│   ├── settings/                       # BrowserSettingsStore + typed WXT storage items
│   └── messaging/                      # Typed chrome.runtime.sendMessage wrapper
├── modules/sound-engine/               # The audio feature module
│   ├── index.ts                        # SoundEngineModule
│   ├── event-registry.ts               # All supported browser events
│   ├── event-engine.ts                 # Generic router
│   ├── cooldown-gate.ts                # Atomic gate with priority preemption
│   ├── theme-manager.ts                # Resolves event id to sound file URL
│   ├── theme-schema.ts                 # theme.json validator
│   ├── types.ts                        # EventDefinition, BrowserEventMessage
│   └── audio-backends/                 # Chrome offscreen vs Firefox direct
├── shared/
│   ├── a11y/                           # announcer, focus utilities
│   ├── hooks/                          # useConfirmAction, useCycleTheme
│   └── platform/                       # browser + OS detection
├── components/ui/                      # shadcn/ui (button, slider, tabs, ...)
├── lib/utils.ts                        # cn() Tailwind class merger
└── public/
    ├── icon/                           # Extension icons
    └── sounds/<theme>/{theme.json, *.ogg}
```

</details>
