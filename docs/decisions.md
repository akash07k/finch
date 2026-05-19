# Decisions log

Each entry records why a non-obvious choice was made. Read this when something looks weird and you want to know whether to "fix" it.

Reverse chronological (newest first).

---

## Architecture deepening: hooks, Zod schema, theme loader, messaging

Six targeted refactors to reduce duplication and increase module depth:

**useConfirmAction hook** (`shared/hooks/use-confirm-action.ts`): The two-step destructive-action confirmation pattern was copy-pasted across all four options tabs (6 instances). Extracted into a hook that manages the pending state, auto-cancel timeout, focus management, and ARIA announcement. The caller still owns the button ref because React 19's `react-hooks/refs` lint rule flags refs returned inside custom hook objects as render-time ref accesses.

**useCycleTheme hook** (`shared/hooks/use-cycle-theme.ts`): The popup and options page both had identical `cycleTheme` logic — read current theme from storage, compute next in list, write back. Extracted into a shared hook that accepts an optional state-sync callback.

**Zod settings schema** (`core/settings/schema.ts`): Types and defaults for settings were split across `types.ts` (manual interfaces) and `defaults.ts` (manual object matching those interfaces). Now a single Zod schema defines both: types are inferred via `z.infer`, defaults are derived by parsing an empty skeleton. Default values reference `CONFIG` so `config/index.ts` remains the one file for tuning ship-time values. `types.ts` and `defaults.ts` survive as re-export shims so existing imports work without changes.

**Complete messaging send helpers** (`core/messaging/send.ts`): `sendExportLogs` and `sendClearLogs` join the existing `sendLog` and `sendPreviewSound`. The Logging tab no longer constructs raw `browser.runtime.sendMessage` objects — all UI-to-background messaging now goes through typed helpers.

**Theme loading extraction** (`modules/sound-engine/theme-loader.ts`): The built-in theme fetch-and-register loop was inlined in `SoundEngineModule.initialize()`. Extracted to `loadBuiltInThemes()` so the module's initialize method reads as a sequence of named steps and theme loading is independently testable.

**SoundEngineModule activate split**: The 100-line `activate()` method now delegates to `warmSettingsCaches()` (parallel storage reads to populate in-memory caches) and `registerSettingsWatchers()` (subscribe to live changes). The three methods compose a clear pipeline: warm caches, start watching, subscribe to events.

## Typed WXT storage items for UI, BrowserSettingsStore for modules

UI entry points (popup, options, background command handlers) now read and write settings through typed storage items defined in `extension/core/settings/items.ts` via WXT's `storage.defineItem()`. Each item wraps one `browser.storage.local` key with a compile-time type and a fallback default sourced from `CONFIG`. The module system continues to use `BrowserSettingsStore`, which provides the generic `SettingsStore` interface that `ModuleContext` exposes and that `InMemorySettingsStore` doubles in tests.

The two layers coexist because they serve different constraints. Modules need a swappable interface for testing (`InMemorySettingsStore`). UI code needs per-key type safety and centralised defaults so a key string typo or a missing fallback is caught at compile time rather than surfacing as a silent `undefined` at runtime. Both layers operate on the same flat dot-notation keys in the same `browser.storage.local` area, so changes from either side propagate through `storage.onChanged` as before.

`eventConfigItem(eventId)` is a factory rather than a pre-instantiated map because the event registry is large and most events are never customised. Constructing 60+ `WxtStorageItem` instances at module load would be wasted allocation.

## WxtVitest plugin and fakeBrowser for extension tests

The extension's Vitest config now uses `WxtVitest()` from `wxt/testing/vitest-plugin`, which auto-polyfills browser APIs via `fakeBrowser`. This replaces the manual `chrome`/`browser` stub setup that each test file previously maintained. `fakeBrowser` provides in-memory stubs for storage, runtime, and event objects — tests that need to fire events like `windows.onFocusChanged` call `fakeBrowser.windows.onFocusChanged.trigger(windowId)` instead of constructing mock listener arrays.

Not every event surface in `fakeBrowser` is fully implemented; some throw "not implemented" when `addListener` is called. `EventEngine.registerAll()` wraps `addListener` in a try-catch and logs a warning on failure, so unsupported events degrade gracefully in both tests and any future browser API gaps in production. This is a genuine robustness improvement, not just a test-support hack.

---

## Mute sounds when browser is unfocused

A new `general.muteWhenBlurred` toggle (default off, exposed in the Sound Controls section of the General tab) tells the sound engine to suppress every cue while no browser window has focus. It composes with `general.muted` — either flag short-circuits the hot path. When the user comes back to the browser, mute-by-blur clears and normal cues resume; the `windows.onFocused` cue plays as the welcome-back signal if the user has that event enabled.

The unfocus cue itself is part of "every cue", on purpose. The naive design lets `windows.onUnfocused` play once as a "you've left" signal and then goes silent. That sounds tidy on paper but the cue would be playing when the user has already moved focus out of the browser, which is exactly the situation they asked to be silent for. Full silence — including the unfocus cue — is the predictable behaviour. The state propagation that makes this work: `extension/modules/sound-engine/windows-focus-router.ts` exposes `onFocusStateChange(cb)` that fires inside the unfocused handler BEFORE the handler returns and the engine publishes the sound event. By the time `SoundEngineModule.handleBrowserEvent` sees the unfocus message, `this.browserFocused` is already `false` and the gate suppresses the cue.

Extending the existing windows-focus-router rather than registering a separate `chrome.windows.onFocusChanged` listener keeps the WINDOW_ID_NONE debounce as the single source of truth for "did the user really leave the browser, or was that a Windows window-switch transient?". A second listener would either reimplement the same 150 ms debounce or fire `false` on every cross-window switch — both wrong. Subscribers are notified only on actual transitions; the initial state is `true` so a fresh subscribe does not fire.

`Alt+Shift+M` is the global shortcut for toggling the new flag; the listener in `extension/entrypoints/background.ts` reads the current value, flips it, persists, and shows a basic browser notification with the new state. While we were touching the commands block, the long-standing `Alt+Shift+O` for opening the options page moved — first to `Alt+Shift+B`, then to `Alt+Shift+R` after `Alt+Shift+B` turned out to be silently captured before reaching the extension on both Chrome and Firefox (likely a Windows layout-switcher or WM-level intercept on common configs). `Alt+Shift+R` doesn't collide with any documented browser, OS, or third-party shortcut on the platforms we test against.

## management, cookies, and history declared as optional, requested at toggle time

`management`, `cookies`, and `history` are declared under `optional_permissions` instead of the static `permissions` list. A fresh install therefore prompts only for the seven everyday permissions (`tabs`, `bookmarks`, `downloads`, `webNavigation`, `storage`, `notifications`, `idle`, plus `offscreen` on Chrome). Each of the three optional permissions is needed by exactly one cluster of Tier 2 events that ship disabled, and getting prompted up front for permissions the user may never enable is the kind of overreach store reviewers flag on audio extensions.

`extension/shared/permissions/request.ts` exports `requestPermissions` (a `permissions.contains` short-circuit wrapping `permissions.request`) and `OPTIONAL_PERMISSIONS`, the consumer-side mirror of the manifest list. The Sound Events tab's `handleToggle` calls `pickOptionalPermissions(event.permissions)` when enabling a row; if the result is non-empty it requests the grant before writing storage. Denial reverts the optimistic Switch state and announces the requirement assertively. Disabling never prompts, and the existing static permissions (`tabs`, `webNavigation`, etc.) skip the helper entirely because they are already granted at install. Releasing optional permissions when the last event that needs them is disabled is left as a follow-up — `permissions.remove` works but the UX of a notification "Oriole released the cookies permission" needs a separate think.

## Split windows.onFocusChanged into windows.onFocused and windows.onUnfocused

The single `windows.onFocusChanged` event was replaced by two registry entries — `windows.onFocused` (a window received focus) and `windows.onUnfocused` (all browser windows lost focus). The split lets each direction carry a distinct sound and makes the Sound Events tab show two clearly-named rows instead of one ambiguous "focus changed" entry. Both default to enabled because focus state is one of the most useful audio cues for a screen-reader user; the Sound Events tab still lets either be muted independently.

The implementation handles a documented quirk of `chrome.windows.onFocusChanged`: on Windows and some Linux window managers, `WINDOW_ID_NONE` (`-1`) is dispatched immediately before a window-to-window switch even though the user never gave focus to a non-browser application. `extension/modules/sound-engine/windows-focus-router.ts` wraps both events in a 150 ms debounce: when WINDOW_ID_NONE arrives, the unfocused emission is held; if a real `windowId` arrives within the window, the unfocused side is suppressed and only `windows.onFocused` fires. Closure-scoped state in the factory keeps the cross-handler coordination out of module scope so tests can build independent pairs.

A one-shot migration in `entrypoints/background.ts` copies any existing `sounds.events.windows.onFocusChanged` config to `sounds.events.windows.onFocused` (the original sound was tuned to be a focus-gain cue), removes the legacy key, and writes a marker so the migration runs at most once per profile.

## release:push and do-release shortcuts on top of the review-first release flow

`pnpm release` keeps `git.push: false` from `extension/.release-it.json` so the maintainer can review the bumped commit, the CHANGELOG diff, and the signed tag locally before they leave the workstation. Two new wrappers sit alongside it:

- `pnpm release:push` is just `git push --follow-tags origin main` — a 16-character shortcut for the manual command. It changes nothing about the policy; it just shortens what you type after reviewing.
- `pnpm do-release` chains `pnpm release && pnpm release:push` for the case where you trust the conventional-commits bump and want to skip the review pause. The pre-push lefthook still re-runs typecheck + test + lint + lint:md before the push hits origin, so a regression introduced between the release-it gate run and the push window is still caught.

Both wrappers exist in `extension/package.json` (with mirrored entries in the root `package.json` so they run from anywhere in the repo). The default flow is unchanged — `pnpm release` then `git push --follow-tags origin main` still works exactly as before.

## GitHub Release creation is independent of store-submission outcome

The release workflow's `Upload artifacts`, `Extract changelog section`, and `Create GitHub Release` steps gate on `!cancelled() && steps.zip.outcome == 'success'` rather than the implicit "succeed only if every prior step succeeded" default. A partial submit failure (e.g., Chrome rejecting with `ITEM_NOT_UPDATABLE` because a previous review is still in flight) used to skip Release creation entirely, leaving users without a sideloadable bundle even though the zips already existed and the other store had accepted. The new gate runs the post-submit steps whenever zip succeeded, regardless of submit outcome — sideloading does not depend on store status.

The workflow_dispatch trigger also accepts two inputs: `target` (`both` / `chrome` / `firefox`) so a single store can be re-submitted after a rejection clears without re-running the other one, and `create_release` (boolean) so a manual dispatch against a branch ref can also create a missing GitHub Release. The tag name comes from `github.ref_name` when running on a tag ref, or from `extension/package.json`'s version when running on a branch with `create_release` enabled. Tag-triggered runs leave both inputs unset and behave as before — `target` falls through to the `both` default, and `create_release` is not consulted because `github.ref_type == 'tag'` already short-circuits the Release-creation gate.

## Per-browser scripts: dev / build / zip / submit run both browsers; :chrome and :firefox run one

The bare `dev`, `build`, and `zip` scripts target both Chrome and Firefox; `:chrome` and `:firefox` variants exist for each so a contributor can iterate on one browser when the other is not relevant. `dev` uses `concurrently -k -n chrome,firefox` so both watch processes share a labelled terminal and exit together (`-k` kills the second when the first stops). `build` and `zip` chain the per-browser scripts sequentially. `submit` keeps submitting to both stores by default; `submit:chrome` and `submit:firefox` were added for the case where one store rejects the upload and only that one needs re-submission. The `zip:chrome` and `zip:firefox` scripts now run `build-whats-new.mjs` first, closing a gap where production zips shipped without `whats-new.json` because nothing in the release pipeline had populated it.

## Inline What's New release notes via static import

The build script writes the release notes as a TypeScript module (`extension/entrypoints/whats-new/whats-new.generated.ts`) instead of a JSON file in `public/`. The What's New page imports it statically, so the HTML is bundled into the page at build time. This removes the runtime fetch path along with its loading and error states, and removes the dependency on the WXT-generated `PublicPath` union that made `prepare:clean-types` necessary.

## OBSOLETE: Mirror CI's clean public/ state in the pre-push typecheck

Superseded by the inline-TS refactor above; the pre-push step has been removed.

The pre-push lefthook runs `prepare:clean-types` before `pnpm -r typecheck`. That script removes any gitignored generated artifact under `extension/public/` (right now just `whats-new.json`) and re-runs `wxt prepare`, so the WXT-generated `PublicPath` union reflects only what is committed under `public/`. Without it, a literal like `browser.runtime.getURL("/whats-new.json")` typechecks locally once `pnpm dev` or `pnpm build` has populated the file but fails in CI on a fresh checkout. The relative-URL fetch in `entrypoints/whats-new/App.tsx` removes the dependency for that one call site; the pre-push step exists so a literal of the same shape gets caught at push time instead of by CI.

## What's New page on extension update

The background script now opens an in-extension `whats-new.html` tab when `browser.runtime.onInstalled` fires with `reason === "update"` and the previous version differs from the current version. The page reads its content from `/whats-new.json`, written at build time by `extension/scripts/build-whats-new.mjs` from the matching `## [<version>]` section of `CHANGELOG.md`. Build-time markdown-to-HTML conversion keeps the runtime bundle free of a markdown parser, and the JSON is gitignored so each branch builds against its own CHANGELOG. The opt-out lives in the General tab (`general.showWhatsNewOnUpdate`, default true) rather than Logging because it controls a user-facing notification, not telemetry. Headings are demoted by one level during conversion (`### Bug Fixes` becomes `<h2>`) so the page H1 sits at the top of an unbroken outline. Focus moves to the H1 on mount and there is no live-region announcement, which would double-announce the heading.

## Display extension version in options page footer

The options page now ends with a `<footer role="contentinfo">` showing `{ExtensionName} v{version}`, where the version is a link to the GitHub release tag for that version. Both fields come from `browser.runtime.getManifest()` so a release bump in `extension/package.json` flows through without UI changes. Placed at the bottom of the page outside the `<main>` so screen readers reach it via the contentinfo landmark and it does not interrupt the tab content.

## markdownlint-cli2 as a fourth hard gate

Prettier already formats markdown but doesn't enforce semantic rules: duplicate H1s, fenced blocks without a language, bare URLs, missing top-level headings. Adding markdownlint-cli2 as a fourth gate (alongside typecheck, lint, test) catches those at commit time. Same author as the underlying markdownlint library, JSONC config so disables can carry their reason inline. Disables: MD013 (line length, prettier handles wrapping), MD024 with siblings_only, MD033 with a small allowlist of inline HTML elements. LICENSE.md and CHANGELOG.md ignored (legal text, auto-generated).

## GitHub Release auto-creation with sideloadable extension zips

The release workflow now creates a public GitHub Release on every tag-push, attaching the Chrome zip, Firefox zip, and sources zip. Release notes are extracted from the matching `## [<version>]` section of CHANGELOG.md via awk. The job permission was raised from `contents: read` to `contents: write` so `softprops/action-gh-release@v3` can call the Releases API with the default GITHUB_TOKEN. Sideloading is a real workflow for blind / low-vision testers who want to validate a build before AMO review clears, and the alternative (downloading the workflow's CI artifact bundle) requires login, expires after 90 days, and is buried two clicks deep.

## Automated changelog and signed-tag releases via release-it

release-it runs locally and uses `git commit -S` / `git tag -s` directly, so the YubiKey signs both the version-bump commit and the tag. semantic-release and release-please were rejected - both are CI-bot driven and would either publish unsigned commits or require a software GPG key on the runner, neither of which fits the YubiKey-only signing posture. Configuration in `extension/.release-it.json` keeps the maintainer in control: gates run before any state mutation, requireBranch/requireCleanWorkingDir/requireUpstream/requireCommits refuse to release from a feature branch or with uncommitted changes, and `git.push: false` means the maintainer reviews locally before pushing. CHANGELOG types filter to feat/fix/perf/revert; everything else is housekeeping.

## Release workflow auto-fires on tag push with version sanity check

`.github/workflows/release.yml` fires on a tag push matching `v*` (in addition to the existing manual `workflow_dispatch`). The first step compares the tag suffix against `extension/package.json`'s version via `jq` and fails fast on mismatch. Both stores reject re-uploads of an existing version, so without the fast check a tag/manifest mismatch would only surface at the final `wxt submit` step after a full ~5-minute pipeline. Three previously-implicit submission flags (`CHROME_PUBLISH_TARGET`, `CHROME_SKIP_SUBMIT_REVIEW`, `FIREFOX_CHANNEL`) are now in the workflow env so the submission posture is visible in code.

## Keep the Preview button interactive for disabled events

The Preview button on each row of the Sound Events table no longer carries `disabled={!config.enabled}`. The old behaviour forced users who wanted to hear a sound before deciding whether to enable it into a three-step detour: enable, wait for storage, click Preview, disable again. `handlePreview` already degrades gracefully when the active theme has no mapping for the event - it returns `{ success: false }` and the UI announces "Preview unavailable for X" via polite live region. Volume and Pitch sliders still carry the disabled prop; that's a separate UX question for a later pass.

## Guard welcome announcement against StrictMode double-invoke

The first-visit welcome announcement was firing twice because `options/main.tsx` wraps the app in `React.StrictMode`, which double-invokes effects in dev to surface non-idempotent code. The storage read and `setShowWelcome` are idempotent (React dedupes equal state updates) but `announce()` is fire-and-forget. A `useRef(false)` flag now ensures only the announcement fires once. Component-scoped ref preferred over a module-scoped `let` so future multi-mount scenarios don't see a stale latch.

## Sound Events filter: per-tier with an explicit "All tiers" escape hatch

The tier radio group now offers Tier 1 / Tier 2 / Tier 3 / All tiers. Each shows exactly its own tier; "All tiers" is the opt-in everything view. The old cumulative model (Essential only / Essential + Useful / All) made tier 2 and tier 3 impossible to view in isolation. The visible "Showing X of Y events" count and the debounced live-region announcement use the same per-tier denominator so sighted and screen-reader users read the same number.

## Drop Alt+1..4 tab hotkeys, rely on the WAI-ARIA Tabs keyboard model

Alt-digit combos were unreliable: other extensions and the browser itself bind them, and the primary blind user reported they fired inconsistently. With four tabs, the WAI-ARIA Tabs keyboard model (Tab into the list, Left/Right/Home/End to move) is faster to discover and always works. Removing the handler also required removing `aria-keyshortcuts`; per ARIA 1.2, that attribute documents shortcuts that actually exist, and leaving it would lie to assistive tech.

## Align pre-push hard gates with CI

The pre-push hook used to run only `pnpm test` (which resolved to root vitest), and root vitest's `projects` config excluded the extension workspace. 119 of 270 tests ran on pre-push; the other 151 were silently skipped. CI caught them on PR but the local feedback loop was broken. Fix: pre-push runs `pnpm -r typecheck`, `pnpm -r test`, `pnpm lint`, `pnpm lint:md` in parallel, mirroring CI exactly.

## Isolate watcher errors and snapshot the notifier list in settings stores

Both `InMemorySettingsStore.set` and `BrowserSettingsStore`'s storage-changed handler now iterate a `[...handlers]` snapshot, with each handler call wrapped in try/catch logging to `console.error`. Same pattern as `MessageBus.publish`. Two latent bugs in the old live-iteration: a throwing watcher would propagate out and stop subsequent watchers from firing, and a watcher that registered a new watcher during its own fire would have the new one notified for the current change. The structured logger isn't used here because settings has no dependency on it and adding one would invert the dependency graph.

## Surface module lifecycle failures through the logger

`ModuleLoader.initializeAll` and `disposeAll` now log through the structured logger when a module throws - `error` for init failures, `warn` for dispose failures. The catches previously had silent-swallow behaviour; the registry entry got the error message but nothing logged, so an operator watching the log stream saw no signal when a module failed to boot or leaked on shutdown.

## Replace linear event lookup with a Map on the hot path

`EVENTS_BY_ID` is built once at module load - a `Map<string, EventDefinition>` keyed by event id. `SoundEngineModule.handleBrowserEvent` calls `eventsById.get(message.eventId)` instead of `EVENT_REGISTRY.find(e => e.id === ...)`. A profile during a busy session showed the linear find dominating the hot path. Build cost is one O(n) loop at startup; lookup cost goes from O(n) to O(1).

## Cache mute and per-event config in the sound engine hot path

`SoundEngineModule.handleBrowserEvent` no longer awaits `settings.get` for mute or per-event config. Both are cached in memory at `activate()` and kept fresh by per-key `settings.watch` subscriptions. The hot path is now synchronous from message arrival down to the single `await backend.play(...)`. Each browser event previously cost two storage round-trips; on a busy session that's tens of trips per second of wasted work, plus each `await` widened the cooldown-gate race window.

## Make CooldownGate.tryEnter atomic

The gate previously exposed `tryEnter` and `markPlayed` as separate calls. `handleBrowserEvent` is async and called once per browser event, so several invocations could race through `tryEnter` before any reached `markPlayed`. Visible in real logs: three "navigation start" sounds within a 6 ms cluster with the cooldown supposedly active. Fix: collapse the check and the cooldown commit into a single synchronous method that runs before any await yields control. The commit happens on admission, not after `backend.play()` returns — a failed play therefore consumes the cooldown window for whatever arrives next. That is intentional: backend failures are rare, and waiting for a slow-failing play to settle would leave concurrent callers free to race through the check and reintroduce the same regression.

## Move suppression gating out of event-engine

The global cooldown and per-event debounce timestamps used to be updated in `event-engine` at message-bus publish time, before the sound engine had a chance to check whether the event was even enabled. Disabled events were poisoning the cooldown for subsequent enabled events - visible as `tabs.onUpdated.loading -> webNavigation.onCompleted` cascades silently eating the user-relevant "page loaded" sound. Fix: the cooldown gate is consulted from `SoundEngineModule.handleBrowserEvent` after the mute and per-event-enabled checks, and the cooldown is committed only after the audio backend confirms a successful play.

## Priority preemption in CooldownGate

Higher-priority events (errors, page-loaded) can play through the global cooldown even when a lower-priority event is currently in the window. Without preemption, an error sound got swallowed if a navigation-starting cue had just fired. The preemption case still updates the cooldown timestamp so the new high-priority event isn't immediately preempted by something even higher arriving milliseconds later.

## Snapshot subscribers in MessageBus.publish

`MessageBusImpl.publish()` now iterates `[...this.handlers]` instead of the live array. A handler that unsubscribed itself or another during dispatch caused `splice` to shift later entries down and the indexed walk to skip whichever entry took the removed slot. Snapshot semantics: a handler that subscribes during a publish does not receive that publish - it receives subsequent ones. Matches DOM event semantics (`addEventListener` mid-dispatch).

## Close race in ChromeAudioBackend offscreen creation

`ensureOffscreenDocument` previously had an open await between `await hasDocument()` and the `creatingPromise` assignment. Two concurrent `play()` callers landing during a long-idle period (Chrome had terminated the offscreen document) could both observe `hasDocument()` returning false, both proceed past the entry guard, and both invoke `chrome.offscreen.createDocument()` - which Chrome rejects with "Only a single offscreen document may be created." The `creatingPromise` is now set synchronously before any await yields. Concurrent callers see the same in-flight promise.

## Narrow incoming offscreen messages with an exhaustiveness check

`chrome.runtime.sendMessage` broadcasts to every listener across the extension. The offscreen listener originally typed its parameter as `AudioMessage` and processed every message through a switch with no default arm. Non-audio messages fell through. Harmless in practice (returning undefined from `onMessage` means "no response coming") but the type annotation was lying about what the listener actually receives. Fix: type the parameter as `unknown`, narrow via an `isAudioMessage` type guard, add a `never` exhaustiveness check on the default arm. Future audio message variants now fail compilation if not added to the switch.

## Logger no-ops after dispose

`Logger.dispose()` previously awaited each transport's dispose but didn't update any state on the logger. Subsequent `log()` / `addTransport()` / `flush()` calls would fan out to already-disposed transports - silent garbage at best, transport-specific errors at worst (e.g., IndexedDB rejecting writes to a closed db). A `disposed: boolean` flag short-circuits all four methods after `dispose()`. The transports' `dispose` is awaited only on the first call, so double-dispose is idempotent.

## Stop misusing fieldset for non-radio-group control clusters

Every settings card in popup and options used to wrap a mix of sliders / switches / selects / inputs in `<fieldset>` + `<legend>`. NVDA re-announces the legend on every nested control focus, producing severe verbosity for the primary blind user. `<fieldset>` is for a single semantic group of related form controls - radio buttons, checkbox groups. Replaced 9 misuses with `<section aria-labelledby>` + an `<h3>` heading, plus one `<div role="group" aria-label>` for a button cluster. Visual styling preserved.

## Move focus into tab panel after tab switch

`HandleTabChange` used to call `announce()` but never moved focus. Alt+1-4 (or clicking a trigger) left focus on whatever element had it before - the previous tab's last interaction, the body, or the trigger itself. Screen-reader users heard the announcement but then had to navigate forward to find the new content. Now uses `focusFirst()` on the active tabpanel after Radix renders it, deferred via `requestAnimationFrame`.

## Two-step confirm on destructive Reset buttons

Reset General Settings, Reset Sound Event Settings, and Reset Theme Settings each used to wipe state on a single click - no confirmation, no undo. Now each follows the existing Factory Reset pattern: first click flips a `confirmReset` state and announces "Are you sure? Press the button again to confirm." at assertive priority; second click executes; `setTimeout` cancels the pending confirm after 5 seconds. The confirm button uses the destructive variant for visual emphasis and gets focus via `requestAnimationFrame` so the second Enter lands on it deterministically.

## Prefer aria-labelledby with a real heading over aria-label

Two places used `aria-label` to name a region or element when a real heading would be both more informative for screen readers and visible-text-equivalent for sighted users. The error-boundary `<pre>` and the welcome banner now reference an `<h2>` via `aria-labelledby`. Screen-reader users hear the heading then the actual content, instead of the decorative label.

## Scope hotkeys.filter override to registered shortcuts

The options page used to replace `hotkeys.filter` wholesale with `() => true`, disabling the hotkeys-js default that blocks shortcuts when focus is in a text input. Today no shortcut would conflict (all are Alt+ combos), but a future single-letter shortcut would fire while the user is typing in the search box. The filter now allows specifically Alt+T and Shift+? and defers everything else to the original blocks-on-input default. Cleanup branch restores the original filter on unmount.

## Type and validate the log-server URL input

The log-server URL input used to be `type="text"` so NVDA didn't announce "edit, URL" and mobile keyboards couldn't offer the URL layout. Now `type="url"` + `inputMode="url"`, plus an `isValidWebSocketUrl` helper. `urlTouched` state prevents `aria-invalid` flickering on/off mid-typing. Invalid value still saves to storage; the connection attempt will fail with a clear WebSocket error.

## Defensive type=button on raw button elements

Two raw `<button>` elements lacked `type="button"`. The HTML default is `type="submit"`, which can cause surprise form submissions if either ever ends up nested in a future `<form>`. shadcn/ui's Button uses asChild patterns where the underlying element matters. Removing a latent footgun.

## Debounce search-results live region in Sound Events

The `#event-count` div had `role="status"` so NVDA queued a fresh announcement on every keystroke. Three characters of typing produced three queued announcements before the user could even read the result. Split: the visible count drops `role="status"` (sighted users still see instant feedback); a new `sr-only` div with `aria-live="polite"` carries a debounced announcement after 250 ms of idle.

## Surface log-server startup errors with non-zero exit code

`bin.ts` called `startServer(options)` without await or catch. If the server failed to bind (port in use, permission denied, log directory not writable), the unhandled promise rejection only printed a Node deprecation warning and the process exited 0 - indistinguishable from success for shell wrappers and CI. Now caught with a clear message to stderr and exit code 1.

## Harden log-server network surface

Three real exposures fixed in one pass: bind to `127.0.0.1` by default (not `0.0.0.0`); reject WebSocket upgrades from disallowed origins via `verifyClient` (CORS doesn't apply to WebSockets, so `evil.com` could otherwise connect); cap WebSocket `maxPayload` at 1 MiB (default is 100 MiB). Operators who want LAN exposure can opt in via `--host 0.0.0.0`. Allowed origins: empty (Node ws / curl), same-origin loopback, `chrome-extension://`, `moz-extension://`. Anything else gets HTTP 403.

## Cap live-entries to prevent unbounded React state growth

The web viewer's live-entries array used to spread-and-push every received entry with no cap. After hours of receiving entries the React state held the entire session, every push was O(n) due to spread, and the table re-rendered on every update. Now FIFO-trimmed at 10,000 entries; users who need older data switch to a historical session via the existing picker.

## Centralise log-viewer announcements through a throttled queue

The viewer fired `@react-aria/live-announcer.announce()` from many independent callers (sort, filter, expand, count tick, session change, column toggle, connection state). NVDA cancels the previous polite message every time a new one arrives - a user toggling a checkbox while sort + count tick fired within 200 ms heard only the last message. Several assertive calls (connection up/down, session loads) interrupted real content, and the imperative connection announces duplicated the visible `<span role="status">` region in StatusBar - the user heard "Connected" twice. Two helpers in `web/lib/announce.ts`: `enqueueAnnounce` collects polite messages within a 200 ms window and delivers them as one combined announcement; `announceAssertive` bypasses the queue and is reserved for genuine errors.

## Keep the log table rectangular, move expanded details out of body

Interleaved `<tr hidden>` with `colSpan` inside `<tbody>` silently broke NVDA's Ctrl+Alt+Arrow column navigation. After every expanded entry, the focused column index became ambiguous because the next data row had a different column count than the detail row before it. Also dropped `aria-rowcount` and `aria-rowindex`: they were inconsistent (rowcount was data rows only, rowindex didn't account for header or hidden detail rows). Detail content now lives in a sibling `<div role="region">` immediately after the table, with one `<section aria-labelledby>` per expanded entry.

## Skip links in the log viewer

Two skip links: "Skip to main content" → `#main-content`, "Skip past log table" → `#after-log-table` (a new `tabIndex={-1}` anchor div). With hundreds of rows per minute and per-row Show/Hide buttons, reaching the detail-sections region via Tab was punishing. Skip-link styling already existed in the global stylesheet and meets WCAG 2.4.13 AAA focus appearance.

## Hidden H3 headings for sibling regions

The log viewer's H1 in `<header>` and two visually-hidden H2s gave an incomplete outline - several sibling regions (StatusBar, SearchBar, LevelFilter, column-visibility CheckboxGroup) had no heading of their own. NVDA users navigating with the H key hit an H1 then two H2s and then nothing for those regions. Each region now carries an `sr-only` H3.

## Default autoScroll to false in the log viewer

Auto-scroll was on by default, which fights the screen-reader virtual cursor while the user is reading. Now off; sighted users who want tail-style scrolling toggle the StatusBar checkbox.

## Per-event debounce in the sound engine

Each `EventDefinition` carries an optional `debounceMs`. The cooldown gate's per-event debounce ignores duplicates of the same event within the window. `tabs.onUpdated.title` is the canonical example - pages rewrite their title several times during load (loading state, real title, notification badge updates). 500 ms debounce produces one sound, not five.

## Custom event handlers with async support

Events can have an optional `handler` that receives the raw browser event arguments. Handlers can perform side effects (webhook, storage write), suppress the sound entirely, override the resolved sound, or attach extra data to the log entry. async/await supported. Errors in handlers are caught and logged without affecting sound playback; handler results flow through the message bus to the sound engine.

## Configurable global cooldown

`CONFIG.soundEngine.globalCooldownMs` (default 150 ms) suppresses cascading sounds from a single user action. Empirical tuning rather than a guess: with the default off (or very small), a single click produced five overlapping sounds.

## Curate default-enabled navigation events

Suppression-log analysis (95s session, 51 plays vs 286 suppressions) showed 84.9% of events being eaten by the global cooldown, almost entirely cross-event navigation cascades. The cooldown was reliably biasing toward the first event in each cascade - `onBeforeNavigate` played 21 times while the more-informative `onCompleted` only played 3, because intermediate phases were stealing the cooldown window. Fix: move `onCommitted`, `onDOMContentLoaded`, `onHistoryStateUpdated` from tier 1 to tier 2 (opt-in only); move `tabs.onUpdated.loading` and `.complete` from tier 1 to tier 2 (the webNavigation versions cover the same intent at the tab level). Add a `frameId === 0` filter to `onBeforeNavigate` and `onCompleted` so they only fire for the main frame.

## Promote tab title changed to tier 1 by default

After living with the event on, the signal is genuinely useful - NVDA users in particular get a confirmation when a tab's title updates (page finished loading something dynamic, chat tab got a new message) without the cooldown gate letting it spam. The 500 ms debounce stays. Reclassifying to tier 1 matches how it's actually being used.

## Surface error reason in played-sound message text

For events flagged `isError`, the played-sound log message now appends `extractedData.error`. The error reason was already captured in the structured `data` field, but HTML and CSV log exports only render the message column. JSON exports were always fine; HTML/CSV exports lost the rich field. Visible in every export format now.

## Extract URLs and tab IDs into event logs

Each "sound played" log entry now carries the URL, tab id, frame id, and other context for the event that fired. Makes it possible to verify from logs alone whether a Tab Created sound was a real new-tab open (Ctrl+click, target="\_blank") or something else, and which page each Navigation Starting / Page Fully Loaded sound corresponded to. `extractData` functions on `EventDefinition` produce the per-event context.

## Strip Chrome dev key from production builds

The manifest `key` field keeps the extension ID stable during local development but is rejected by the Chrome Web Store on upload. The `build:manifestGenerated` hook strips it when `mode === "production"`. Without this, store submissions fail at upload time.

## Strip offscreen permission from Firefox builds

The `offscreen` permission is Chrome-only. Firefox ignores unknown permissions but listing them looks sloppy and could trip future stricter validators. The `build:manifestGenerated` hook removes the permission for the Firefox build.

## Firefox AMO data_collection_permissions

Required by Firefox AMO for new extensions. Cast in via the WXT manifest hook because WXT's TypeScript types don't yet model this field. Set to `required: ["none"]` with `techdata_collected: false` and `interactiondata_collected: false` - Oriole collects nothing.

## CI workflow runs the same gates as pre-push

`.github/workflows/ci.yml` runs typecheck, test, lint, and lint:md on every PR and push to main. Mirrors the pre-push hook so CI is the second line of defence and a `--no-verify` push can't sneak broken code through. Permission scope is `contents: read` only; concurrency cancellation prevents duplicate runs on the same ref.

## Two-step setup for fresh clones via `pnpm setup`

The extension's `postinstall: wxt prepare` hook used to run during `pnpm install`, which loaded `wxt.config.ts`, which transitively imports `@oriole/logger` - a workspace package that resolves to `packages/logger/dist/index.js`. On a fresh clone, dist doesn't exist yet, so the hook fails. Three-step fix: install with `--ignore-scripts` to skip lifecycle hooks; run `pnpm build:logger` to populate dist; run `wxt prepare` manually. The root `pnpm setup` script chains these for first-time contributors. The extension's `postinstall` is now guarded - it no-ops if `packages/logger/dist/index.js` doesn't exist.

## Emit logger .d.ts via tsc directly

`vite-plugin-dts` was producing inconsistent output across environments (worked locally, failed on clean CI). Replaced with `tsc -p tsconfig.build.json` for declaration emission; `vite build` still handles the JS bundle. The `package.json` `exports` field has `"types"` first so TypeScript under `moduleResolution: "bundler"` picks types over JS.

## Replace Subtle theme with Pulse, promote notifications.onShown to tier 1

The Subtle theme used Kenney CC0 sound packs; Pulse replaces it with curated cues designed for the screen-reader-first audience. Notifications.onShown moves from tier 2 to tier 1 because it's critical feedback for blind users who can't see notification popups.

## Centralized config with theme registry and event defaults

`extension/config/` holds three files: `index.ts` (CONFIG: cooldown, logger limits, log-server tuning), `themes.ts` (BUILT_IN_THEMES, DEFAULT_THEME_ID), `events.ts` (EVENT_DEFAULTS - per-event enabled/debounce). The single place to change ship-time defaults. Decoupled from the event registry so default-enabled state isn't part of the registry shape.

## Filter Sound Events UI by current platform

`SoundEventsTab` uses `import.meta.env.BROWSER` to show only events supported on the current browser. Firefox-only events like `notifications.onShown` are hidden on Chrome, so users can't enable events that can never fire on their browser.

## Adopt React 19, Radix UI, Tailwind 4

React 19 for the latest concurrent-rendering primitives. Radix UI primitives because they bake the WAI-ARIA keyboard models in (Tabs, Slider, Switch, Select). Tailwind 4 via Vite plugin - no separate config dance. shadcn/ui "new-york" components live under `extension/components/ui/` for the styled wrappers.

## Module system with lifecycle and topological-sort init

Every "feature" implements `OrioleModule` with `initialize` / `activate` / `deactivate` / `dispose`. `ModuleLoader` runs the lifecycle in dependency order via Kahn's-algorithm topological sort. Modules never import each other directly; they communicate through the shared `MessageBus`. The boundary is enforceable, modules are independently testable, and a future second module can be added without modifying the first.

## Flat dot-notation keys in BrowserSettingsStore

`browser.storage.local`'s `get/set` operate on top-level keys and `onChanged` events fire on top-level keys. Flat keys (`general.masterVolume`, `sounds.events.tabs.onCreated`) enable cheap single-key reads and per-key watchers. The trade-off - reading nested objects requires multiple `get` calls - is worthwhile because the service worker frequently sleeps and wakes, and a single-key warm cache is valuable.

## Logger transport architecture

Three transports: `ConsoleTransport` (developer visibility), `IndexedDBTransport` (persistent, queryable, exportable, rotation at 10,000 entries), `WebSocketTransport` (opt-in, buffer + exponential backoff). Each implements a small `Transport` interface. The logger dispatches in parallel; one transport's error doesn't break the others.

## Use crypto.randomUUID() for log entry ids

Switched from `Date.now() + counter` because the counter resets on service-worker restart, producing duplicate ids when the worker wakes within the same millisecond as a previous boot. `crypto.randomUUID()` is collision-free across restarts and is universally available in MV3 runtimes.

## XSS-escape HTML log exports

The HTML log exporter escapes `<`, `>`, `&`, `"` in tag, message, and context fields. Without escaping, a log entry containing `<script>` would execute when the export was opened in a browser. Same applies to CSV which RFC 4180-escapes commas, quotes, and newlines.

## Per-tab reset buttons

General, Sound Events, Themes, and Logging tabs each carry a Reset button scoped to that tab's settings. Plus Factory Reset on General which wipes everything. Asymmetric one-click vs two-step UX got fixed in a later pass - every Reset is now two-step with an assertive-then-polite announcement pair.

## Shortcut recorder with manual-text fallback

The hotkey capture supports both a record mode (native `<input>` with `aria-roledescription="shortcut recorder"` capturing keydown) and a manual-type mode (plain text input for users who prefer typing "alt+t" directly). Manual mode is required for WCAG AAA 3.3.5 (Help) and 2.5.6 (Concurrent Input Mechanisms) - not all assistive tech can reliably capture key events.

## Probe log server via HTTP before WebSocket

The `WebSocketTransport` connection attempt was producing visible Chrome extension errors when the log server wasn't running (`ERR_CONNECTION_REFUSED`). The transport now does an HTTP HEAD on the equivalent URL first; only adds the WebSocket transport if reachable. HTTP failures don't surface as Chrome extension errors.

## Persistent log streaming opt-in

Log streaming is off by default. The user toggles it in the Logging tab; the setting persists to `browser.storage.local` (survives restart). Background script checks on startup and only connects if enabled. No more automatic WebSocket connections; the user opts in explicitly.

## Mute notification + badge

`Alt+M` toggles mute across the extension. When muted, a system notification fires and a red "M" badge appears on the extension icon. Clears on unmute. Visible feedback matters: the user can mute via global shortcut from any tab and needs confirmation that the toggle worked. Firefox MV2 uses `browser.browserAction` for the badge; Chrome uses `browser.action`. Runtime check with fallback handles both.

## Howler.js cross-context sharing via HowlerPlayer

Both Chrome offscreen and Firefox background backends delegate to a shared `HowlerPlayer` class. Caches sound `Howl` instances by URL; repeated plays reuse the same handle. Extracting this avoided copy-pasted Howler.js code across two backends and centralised any future swap to a different audio library.

## TypeScript 6.0+ strict mode

TS 6 tightened auto-loading of ambient types from `@types/*` packages. `@types/chrome` no longer contributes its global `chrome` namespace to source files automatically. `extension/globals.d.ts` adds back the `/// <reference types="chrome" />` directive - the minimum required fix; no source files changed.

## Ramp log-level font-weight in the viewer

Log levels (DEBUG / INFO / WARN / ERROR / FATAL) now use a font-weight ramp (300 / 400 / 500 / 600 / 700) so severity survives grayscale rendering and grayscale-passing accessibility tests. Before, all levels were the same weight and the only visual cue was colour, which fails for users with colour-vision differences.

## Use AGPL-3.0-only

Switched from MIT during pre-1.0 development. AGPL ensures any network-accessible derivative work releases its source. The log-server is the relevant case: it serves a web viewer over HTTP, so a hosted derivative would otherwise be a closed-source service consuming MIT-licensed code without contributing back. AGPL forecloses that path.
