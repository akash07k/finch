# Sound engine

The sound engine maps browser events to short audio cues. This document explains the moving parts and the vocabulary used to talk about cascading event behaviour. Most of the words here got coined while debugging actual incidents observed in real browsing data.

## Vocabulary

- **Cascade** - a burst of events that all describe the same user action. Clicking a link can produce navigation-starting, page-loading, navigation-committed, DOM-ready, page-loaded in under a second. Five events for one user intent. Without suppression, you'd hear five sounds.
- **Cooldown** - a global silence window after any sound plays. Subsequent events arriving inside the window are suppressed (with one exception, see preempt). The window is tunable via `CONFIG.soundEngine.globalCooldownMs` (default 150 ms).
- **Debounce** - a per-event silence window that ignores rapid duplicates of the same event id. Different from cooldown: cooldown is global across all events; debounce is per event. `tabs.onUpdated.title` has a 500 ms debounce so a page rewriting its title several times during load produces one sound, not five.
- **Poison** - when a disabled or failed event consumes the cooldown window for subsequent enabled events. Closed by the cooldown-commit-only-on-success rule: the cooldown is committed only after a successful play, not on entry.
- **Preempt** - a higher-priority event bypassing the cooldown to play over a lower-priority event already in the window. Errors and page-loaded preempt navigation-starting and tab-created.
- **Race** - two concurrent calls landing in the same microtask window producing inconsistent state. The cooldown gate's `tryEnter` is atomic specifically to close this race.

## The journey of a single event

A browser event flows through five stages from fire to log entry:

1. The browser fires the event (for example, the user creates a new tab).
2. `event-engine.ts` `handleEvent` runs three checks in order: the filter (which skips sub-events like `tabs.onUpdated.loading`), the optional custom handler (which can suppress, override the sound, or attach extra data), and `extractData` (which pulls the URL, tab id, frame id, and so on).
3. The event publishes on the message bus as `MessageBus.publish("browser-event", BrowserEventMessage)`.
4. `SoundEngineModule.handleBrowserEvent` runs four gates in order: mute check (cached, no storage round-trip), per-event enabled check (cached), cooldown gate atomic `tryEnter` (which commits the cooldown timestamp on admission), and theme manager sound URL resolution.
5. `AudioBackend.play(url, opts)` calls into `HowlerPlayer` (in Chrome's offscreen document, or Firefox's background page). The cooldown was already committed in step 4; when the play result returns, the logger records the outcome.

<details>
<summary>Visual flow</summary>

```text
browser fires event (e.g., user creates a new tab)
  │
  ▼
event-engine.ts handleEvent
  │  - filter check (sub-events like tabs.onUpdated.loading)
  │  - optional custom handler (suppression, sound override, extra data)
  │  - extractData (URL, tab id, frame id, etc.)
  ▼
MessageBus.publish("browser-event", BrowserEventMessage)
  │
  ▼
SoundEngineModule.handleBrowserEvent
  │  - mute check (cached, no storage round-trip)
  │  - per-event enabled check (cached)
  │  - cooldown gate atomic tryEnter (commits cooldown on admission)
  │  - theme manager resolves event id to sound URL
  ▼
AudioBackend.play(url, opts)
  │
  ▼
HowlerPlayer (Chrome offscreen / Firefox background) plays the sound
  │
  ▼
result returns; logger records it (cooldown was committed in tryEnter)
```

</details>

## Event registry

[`extension/modules/sound-engine/event-registry.ts`](../extension/modules/sound-engine/event-registry.ts) is a flat array of `EventDefinition` entries. Adding a new event is adding one object to the array.

```ts
interface EventDefinition {
  id: string; // "tabs.onCreated"
  label: string; // "Tab Created" (UI display)
  description: string; // long-form for accessibility
  tier: 1 | 2 | 3; // 1 = essential, 2 = useful, 3 = advanced
  category: EventCategory; // "tabs" | "navigation" | "downloads" | ...
  api: string; // "tabs.onCreated"
  platforms?: ("chrome" | "firefox")[]; // both if absent
  isError?: boolean; // priority preemption
  filter?: (...args: unknown[]) => boolean;
  handler?: (...args: unknown[]) => Promise<HandlerResult | void>;
  extractData?: (...args: unknown[]) => Record<string, unknown>;
}
```

`EVENTS_BY_ID` is a `Map` keyed by `id` for O(1) lookup on the hot path. Built once at module load.

The registry has 65 events (64 on Chrome, 59 on Firefox): 26 tier 1, 37 tier 2, 2 tier 3. Two contract tests in `__tests__/event-registry.test.ts` enforce:

- `EVENTS_BY_ID.size === EVENT_REGISTRY.length` and `EVENTS_BY_ID.get(e.id) === e` for every entry.
- Every default-enabled event has a direct mapping in every built-in `theme.json`.

## Event engine

[`event-engine.ts`](../extension/modules/sound-engine/event-engine.ts) is a pure router. On `registerAll()` it iterates the registry, picks the right `browser.*` API, attaches one listener per definition, and stores the listener reference for `dispose()` to remove. The listener:

1. Runs the optional `filter` (skip sub-events).
2. Runs the optional `handler` (extract context, optionally suppress or override).
3. Calls `extractData` for log enrichment.
4. Publishes `BrowserEventMessage` on the bus.

Errors inside the handler are caught and logged at WARN - the engine does not let one bad event break the listener.

The engine owns no decisions about whether a sound should play. That's the sound-engine module's job. Cooldown, debounce, mute, and per-event enabled checks all live in `SoundEngineModule.handleBrowserEvent`.

## Cooldown gate

[`cooldown-gate.ts`](../extension/modules/sound-engine/cooldown-gate.ts) is a small unit-testable helper that owns:

- The global cooldown timestamp (last successful play across all events).
- The per-event debounce timestamps (last play per event id).
- The current cooldown's priority (so preempt logic can decide).

The atomic check-and-commit is essential. `SoundEngineModule.handleBrowserEvent` is async and can have multiple invocations land in microsecond-scale windows. A split "check now, commit later" API would let every concurrent invocation pass through the check before any of them commits - exactly the race that played three "navigation start" sounds within a 6 ms cluster, which is why `tryEnter` does both in one synchronous step.

The fix is `tryEnter(eventId, priority): boolean`. It checks both gates and commits the cooldown timestamp in the same synchronous call before any await yields control. Concurrent callers atomically observe each other's commits.

The commit happens on admission, not after `backend.play()` confirms playback. A failed play therefore consumes the global cooldown window (~150 ms) for whatever arrives next. That is intentional: backend failures are rare, and committing optimistically prevents a slow-failing backend from defeating the gate by leaving every concurrent caller free to race through the check.

### Three suppression paths

1. Global cooldown - within 150 ms of any prior fire (unless preempted).
2. Debounce - within `debounceMs` of the same event id.
3. Priority preemption - global cooldown bypassed because the arriving event's priority is higher than the in-flight priority.

The preemption case still updates the cooldown timestamp; this prevents the new high-priority event from being immediately preempted by something even higher arriving milliseconds later.

## Theme manager

[`theme-manager.ts`](../extension/modules/sound-engine/theme-manager.ts) loads validated theme manifests and resolves event id → sound file URL.

### Resolution order

1. Direct mapping in the active theme's `manifest.mappings[eventId]`.
2. Error fallback (`manifest.fallbacks.error`) if `event.isError`.
3. Tier-based fallback (`manifest.fallbacks.tier1`, `tier2`, or `tier3`).
4. Generic info fallback (`manifest.fallbacks.info`).
5. `null` - no sound available.

Returning `null` is explicit: the sound engine logs "Preview unavailable for X" and the UI announces it via polite live region. The no-sound path is signalled, not silent.

Theme manifests live as JSON at `extension/public/sounds/<theme-id>/theme.json`. The validator (`theme-schema.ts`) checks required fields and rejects manifests that reference nonexistent sound files.

## Sound engine module

[`extension/modules/sound-engine/index.ts`](../extension/modules/sound-engine/index.ts) is the `FinchModule` implementation. It wires the event engine, theme manager, audio backend, and cooldown gate together.

`handleBrowserEvent` is the hot path. It:

1. Checks `this.muted` (cached scalar, refreshed on settings change).
2. Checks `this.eventConfigs.get(eventId)?.enabled` (cached map, refreshed on settings change).
3. Calls `cooldownGate.tryEnter(eventId, priority)` — this both checks the gates and commits the cooldown timestamp on admission. Nothing further is needed after `play()` returns.
4. Calls `themeManager.resolveSound(eventId)`.
5. Calls `audioBackend.play(url, { volume, rate })`.
6. On success, logs at INFO.
7. On failure, logs at WARN. The cooldown stays committed — a failed play eats the window (see the cooldown-gate section above for why).

All settings reads happen against in-memory caches, populated at `activate()` and refreshed by per-key `settings.watch` subscriptions. The hot path is synchronous from message arrival down to the single `await backend.play(...)`.

## Adding a new event

1. Pick the right tier (1 essential / on by default, 2 useful / opt-in, 3 advanced / hidden).
2. Add an `EventDefinition` entry to `event-registry.ts`. Specify `id`, `label`, `description`, `tier`, `category`, `api`, plus any `filter`, `handler`, `extractData`, or `isError` flag.
3. If tier 1, add `{ id: "...", enabled: true }` to `EVENT_DEFAULTS` in `extension/config/events.ts`.
4. Add a sound mapping to every built-in `theme.json` (`extension/public/sounds/<theme>/theme.json`). The contract test rejects any default-enabled event without a direct mapping.
5. Run `pnpm test`. The contract tests will catch the common omissions.

## Adding a custom handler

Some events need more than fire-and-publish. The `handler` field on `EventDefinition` gets the raw browser event arguments. It can:

- Perform side effects (webhook, notification, storage write).
- Suppress the sound entirely by returning `{ suppress: true }`.
- Override the resolved sound by returning `{ soundOverride: "file.ogg" }`.
- Attach extra data to the log entry by returning `{ data: {...} }`.

Handlers are async. Errors in handlers are caught and logged without stopping the rest of the event flow. Handler output flows through the message bus to the sound engine.

## Test coverage

151 extension tests cover the sound engine end to end. Highlights:

- `cooldown-gate.test.ts` - atomic tryEnter under back-to-back calls (the race regression test); priority preemption; debounce isolation per event.
- `event-engine.test.ts` - registry-driven listener wiring; sub-event filters; handler suppression; handler errors don't break the listener.
- `event-registry.test.ts` - the two contract tests (id uniqueness, default-enabled has mapping).
- `theme-manager.test.ts` - fallback chain order; error events use error fallback; missing themes return null.
- `sound-engine-module.test.ts` - integration: mute → enabled → cooldown → resolve → play → log, all with mocked browser globals.
