# Audio backends

Chrome and Firefox handle audio playback in fundamentally different ways. Finch papers over the difference with a shared `AudioBackend` interface and two implementations.

## The AudioBackend interface

[`extension/modules/sound-engine/audio-backends/types.ts`](../extension/modules/sound-engine/audio-backends/types.ts):

```ts
interface AudioBackend {
  initialize(context: ModuleContext): Promise<void>;
  play(url: string, opts?: PlayOptions): Promise<PlayResult>;
  stopAll(): Promise<void>;
  setGlobalVolume(volume: number): Promise<void>;
  isReady(): boolean;
  dispose(): Promise<void>;
}
```

`PlayOptions` carries per-sound overrides (volume, rate, interrupt). `PlayResult` returns success status and latency, used by the sound engine for diagnostics logs.

`SoundEngineModule.handleBrowserEvent()` calls `play()` after the cooldown gate succeeds and theme manager resolves the URL. The engine doesn't care which backend is loaded.

The factory in [`extension/modules/sound-engine/index.ts`](../extension/modules/sound-engine/index.ts) picks the right backend at module-load time by reading `import.meta.env.BROWSER`. Vite tree-shakes the unused branch at build time so Howler.js never enters the Chrome service-worker bundle.

## Why two backends

Chrome MV3 service workers do not have access to the DOM, `Audio`, or `AudioContext`. There is no way to play audio directly from the service worker. The official solution is the offscreen document API.

Firefox MV2 background pages do have a DOM. They can use `<audio>` elements or the Web Audio API directly, no offscreen document needed.

The two backends keep this complexity contained.

## Chrome backend flow

[`ChromeAudioBackend`](../extension/modules/sound-engine/audio-backends/chrome-backend.ts) owns the offscreen document. The runtime interaction:

1. `SoundEngineModule` calls `ChromeAudioBackend.play(url, opts)`.
2. `ChromeAudioBackend.play` calls `ensureOffscreenDocument()` (creates the document if missing), then sends `{ type: PLAY_SOUND, url, opts }` via `chrome.runtime.sendMessage`.
3. The message crosses the runtime boundary into the offscreen DOM context.
4. `offscreen/main.ts` receives the message and calls `HowlerPlayer.play(url, opts)`.
5. Howler.js handles caching, volume, and playback rate.
6. The promise resolves with `{ success, latency }`, which routes back across the boundary to the backend.

<details>
<summary>Visual flow</summary>

```text
SoundEngineModule
     │ play(url, opts)
     ▼
ChromeAudioBackend.play()
     │ ensureOffscreenDocument()   (creates if missing)
     │ chrome.runtime.sendMessage({ type: PLAY_SOUND, url, opts })
     ▼
[ message boundary ]
     ▼
offscreen/main.ts (DOM context)
     │ HowlerPlayer.play(url, opts)
     │ Howler.js handles caching, volume, rate
     │ resolves with { success, latency }
     ▼
[ response back to backend ]
```

</details>

Three classes of bug have happened in this path; the fixes shipped, but the relevant decisions are recorded in [`decisions.md`](./decisions.md).

### Offscreen document creation race

`ensureOffscreenDocument` previously had an open await between `await hasDocument()` and the `creatingPromise` assignment. Two concurrent `play()` callers landing during a long-idle period (Chrome had terminated the offscreen document) could both observe `hasDocument()` returning false, both proceed past the entry guard, and both invoke `chrome.offscreen.createDocument()` - the second errors with "Only a single offscreen document may be created."

Fix: the `creatingPromise` field is set synchronously, before any await yields control. Concurrent callers see the same in-flight promise.

### Cross-context message routing

`chrome.runtime.sendMessage` broadcasts to every listener across the extension. The offscreen document listener originally typed its parameter as `AudioMessage` (the union of audio-only message types) and switched on `type` with no default arm. Non-audio messages (`LOG`, `EXPORT_LOGS`, `PREVIEW_SOUND`) fell through. This was harmless in practice (returning undefined from `onMessage` means "no response coming") but the type annotation was lying.

Fix: type the parameter as `unknown`, narrow via an `isAudioMessage` type guard, and add a `never` exhaustiveness check on the default arm. Future audio message variants now fail compilation if not added to the switch.

### Per-event interrupt semantics

`PlayOptions.interrupt` tells the backend to stop currently-playing sounds before starting the new one. Used for events like "page loaded" that should be heard even if a less-important cue is still playing. The Chrome backend forwards the flag to `HowlerPlayer.play`, which calls `Howler.stop()` on overlapping handles before starting the new playback.

## Firefox backend flow

[`FirefoxAudioBackend`](../extension/modules/sound-engine/audio-backends/firefox-backend.ts) is much simpler because the background page has DOM:

1. `SoundEngineModule` calls `FirefoxAudioBackend.play(url, opts)`.
2. The backend calls `this.player.play(url, opts)` directly. `this.player` is a `HowlerPlayer` instance running in the same DOM context. No message boundary, no offscreen document.
3. The promise resolves with `{ success, latency }`.

<details>
<summary>Visual flow</summary>

```text
SoundEngineModule
     │ play(url, opts)
     ▼
FirefoxAudioBackend.play()
     │ this.player.play(url, opts)   (HowlerPlayer)
     │ (no message boundary, no offscreen)
     ▼
resolves with { success, latency }
```

</details>

No message protocol, no race window, no exhaustiveness checks. The trade-off is that Firefox MV2 is being deprecated (Mozilla has signalled MV3 transition); when it lands here, the Firefox backend will collapse into the Chrome shape.

## HowlerPlayer

Both backends delegate to a shared [`HowlerPlayer`](../extension/modules/sound-engine/audio-backends/howler-player.ts) class. It wraps Howler.js with:

- A sound cache keyed by URL, so repeated plays reuse the same `Howl` instance.
- A play method that returns `{ success, latency }` (timed via `performance.now()`).
- A `stopAll` that calls `Howler.stop()` and unloads cached sounds.
- A `dispose` that clears the cache.

Centralising the Howler.js usage means a future swap to a different audio library (Web Audio directly, for example) only touches this file.

## Test coverage

- `chrome-backend.test.ts` covers the offscreen document race fix (concurrent `play()` callers do not double-create) and the message-narrowing type guard.
- `firefox-backend.test.ts` covers the simpler direct-play flow.
- `howler-player.test.ts` covers cache hits, stop semantics, and dispose cleanup.

Browser globals are mocked per-test. Howler.js is mocked at the module level so tests don't actually decode audio.
