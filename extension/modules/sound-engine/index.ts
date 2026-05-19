/**
 * @module sound-engine
 *
 * The sound engine module — maps browser events to audio playback.
 *
 * This is the first feature module of Oriole. It implements
 * the OrioleModule interface and orchestrates:
 *
 * 1. **Audio backend** — platform-specific playback (Chrome offscreen / Firefox direct)
 * 2. **Event engine** — wires browser API listeners from the event registry
 * 3. **Theme manager** — resolves which sound to play for each event
 *
 * The flow: browser event fires → event engine publishes to message bus →
 * this module receives the message → resolves sound via theme manager →
 * plays via audio backend.
 */

import type { OrioleModule, ModuleContext } from "../../core/module-system/types.js";
import type { AudioBackend } from "./audio-backends/types.js";
import { EventEngine, BROWSER_EVENT_CHANNEL, type BrowserEventMessage } from "./event-engine.js";
import { ThemeManager } from "./theme-manager.js";
import { loadBuiltInThemes } from "./theme-loader.js";
import { EVENT_REGISTRY, EVENT_REGISTRY_BY_ID } from "./event-registry.js";
import { createWindowFocusEvents } from "./windows-focus-router.js";
import { CooldownGate } from "./cooldown-gate.js";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "../../config/themes.js";
import { getEventDefaults } from "../../config/events.js";
import { CONFIG } from "../../config/index.js";
import { DEFAULT_SETTINGS } from "../../core/settings/defaults.js";
import { getAssetURL } from "../../shared/platform/url.js";

/** Module ID used for registration and dependency references. */
const SOUND_ENGINE_MODULE_ID = "sound-engine";

/**
 * Shape of the per-event user override stored under `sounds.events.<id>`.
 * Fields are optional (absent = "use registry default") except `enabled`,
 * which is the authoritative on/off for the event.
 */
interface EventConfig {
  enabled: boolean;
  volume?: number;
  pitch?: number;
}

/**
 * Sound engine module — implements OrioleModule.
 *
 * Lifecycle:
 * - **initialize**: Load theme, wire event listeners
 * - **activate**: Subscribe to browser-event messages and start playing sounds
 * - **deactivate**: Unsubscribe from messages, stop all sounds
 * - **dispose**: Release audio backend and all resources
 *
 * The audio backend must be injected via setAudioBackend() before
 * initialize() is called. This is done by the background script
 * to avoid bundling Howler.js into Chrome's service worker.
 */
export class SoundEngineModule implements OrioleModule {
  readonly id = SOUND_ENGINE_MODULE_ID;
  readonly name = "Sound Engine";
  readonly version = "1.0.0";

  /** Module context provided during initialization. */
  private context: ModuleContext | null = null;

  /** Platform-specific audio playback backend. */
  private backend: AudioBackend | null = null;

  /** Wires browser API listeners from the event registry. */
  private eventEngine: EventEngine | null = null;

  /** Resolves event IDs to sound file URLs. */
  private themeManager: ThemeManager | null = null;

  /**
   * Two-stage suppression gate (global cooldown + per-event debounce).
   * Updated only after a sound actually plays — disabled events and
   * failed plays do not poison the cooldown window.
   */
  private cooldownGate: CooldownGate | null = null;

  /** Unsubscribe function for the message bus subscription. */
  private unsubscribe: (() => void) | null = null;

  /**
   * Cancel any in-flight unfocus debounce armed by the window-focus
   * router. Set during initialize() from createWindowFocusEvents() and
   * called during dispose() so a stray setTimeout cannot fire after
   * the message bus and audio backend are gone.
   */
  private windowFocusDispose: (() => void) | null = null;

  /** Unwatch functions for settings watchers. */
  private unwatchers: (() => void)[] = [];

  /**
   * Cached mute state. handleBrowserEvent reads this synchronously
   * instead of awaiting `settings.get` on every event. Kept fresh by
   * the watcher registered in activate().
   */
  private muted = false;

  /**
   * Cached "mute when no browser window has focus" toggle. Composes
   * with `muted` — either flag suppresses sounds. Kept fresh by the
   * `general.muteWhenBlurred` watcher registered in activate().
   */
  private muteWhenBlurred = false;

  /**
   * Tracked focus state, fed by the windows-focus-router's
   * `onFocusStateChange` callback (subscribed during initialize()).
   * Initial value `true` matches the router's own initial assumption
   * — the service worker boots while the browser is open. Used in
   * combination with `muteWhenBlurred` on the hot path.
   */
  private browserFocused = true;

  /**
   * Unsubscribe handle for the focus-state subscription set up in
   * initialize(). Called and nulled in dispose() so the closure does
   * not retain a reference to this module after teardown.
   */
  private unsubscribeFocusState: (() => void) | null = null;

  /**
   * Cached per-event config. handleBrowserEvent reads from this map
   * instead of awaiting `settings.get` for each event. Only entries
   * with user overrides are stored; missing entries fall through to
   * `getEventDefaults` at read time. Kept fresh by per-event
   * watchers registered in activate().
   */
  private readonly eventConfigs = new Map<string, EventConfig>();

  /**
   * Inject the platform-specific audio backend.
   * Must be called BEFORE initialize().
   *
   * The background script creates the right backend (Chrome offscreen
   * or Firefox direct) and injects it here. This avoids importing
   * Howler.js in Chrome's service worker (which has no DOM).
   *
   * @param backend - The platform-specific audio backend (Chrome or Firefox).
   */
  setAudioBackend(backend: AudioBackend): void {
    this.backend = backend;
  }

  /** Get the theme manager (for preview sound). Null if not initialized. */
  getThemeManager(): ThemeManager | null {
    return this.themeManager;
  }

  /** Get the audio backend (for preview sound). Null if not injected. */
  getBackend(): AudioBackend | null {
    return this.backend;
  }

  /**
   * Initialize the sound engine: set up audio backend, load the default
   * theme, and register browser event listeners from the event registry.
   * @param context - Module context providing logger, messageBus, settings, and platform.
   * @throws Error if setAudioBackend() was not called before this method.
   */
  async initialize(context: ModuleContext): Promise<void> {
    this.context = context;
    const { logger } = context;

    // 1. Audio backend must be injected before initialization.
    if (!this.backend) {
      throw new Error("Audio backend not set. Call setAudioBackend() before initialize().");
    }

    await this.backend.initialize();
    logger.info("Audio backend initialized", { browser: context.platform.browser });

    // 2. Set up the theme manager and load the default theme
    this.themeManager = new ThemeManager();
    await loadBuiltInThemes(this.themeManager, logger);

    // Set active theme from user settings (falls back to config default)
    const activeTheme =
      (await context.settings.get<string>("general.activeTheme")) ?? DEFAULT_THEME_ID;
    this.themeManager.setActiveTheme(activeTheme);

    // 3. Wire the event engine to the browser APIs
    const browserGlobal =
      typeof browser !== "undefined"
        ? (browser as unknown as Record<string, unknown>)
        : ((globalThis as Record<string, unknown>).chrome as Record<string, unknown>);

    this.eventEngine = new EventEngine(browserGlobal, context.messageBus, logger);

    // Build the live window-focus pair here (not at registry module
    // load) so the registry stays pure data. The factory's closure
    // owns the WINDOW_ID_NONE debounce; we hold its dispose so a
    // pending setTimeout cannot outlive this module.
    const windowFocus = createWindowFocusEvents();
    this.windowFocusDispose = windowFocus.dispose;
    // Subscribe BEFORE the engine starts dispatching so that by the
    // time the unfocus handler publishes its sound event, this module
    // already sees `browserFocused === false` and the hot-path gate
    // can suppress the cue (when the user has opted into
    // mute-when-blurred). The router fires the callback synchronously
    // from inside its own handler, ahead of message-bus publish.
    this.unsubscribeFocusState = windowFocus.onFocusStateChange((focused) => {
      this.browserFocused = focused;
    });
    const liveWindowFocusById = new Map(windowFocus.events.map((e) => [e.id, e]));

    // Replace the static window-focus metadata in the registry copy
    // passed to the engine with the live, handler-attached versions.
    // Other consumers (UI, preview) keep importing EVENT_REGISTRY as
    // pure metadata.
    const eventsForEngine = EVENT_REGISTRY.map((e) => liveWindowFocusById.get(e.id) ?? e);

    // Register listeners for ALL events on this platform. The runtime
    // handler (handleBrowserEvent) checks per-event enabled state from
    // user settings, so listeners must exist for Tier 2/3 events that
    // the user may enable at runtime without requiring a restart.
    this.eventEngine.registerAll(eventsForEngine, context.platform.browser);
    logger.info("Event engine ready", { registeredEvents: eventsForEngine.length });

    // 4. Build the cooldown / debounce gate. Initialised here (not in
    //    activate) so its state survives deactivate/reactivate cycles
    //    and the same physical instance is disposed in dispose().
    this.cooldownGate = new CooldownGate(
      { globalCooldownMs: CONFIG.soundEngine.globalCooldownMs },
      logger,
    );

    this.unsubscribe = null;
  }

  /**
   * Subscribe to browser-event messages and start playing sounds.
   * Reads masterVolume from settings and applies it to the audio backend.
   * @throws Error if the module has not been initialized.
   */
  async activate(): Promise<void> {
    if (!this.context || !this.backend) {
      throw new Error("Module not initialized.");
    }
    const { logger, messageBus } = this.context;

    await this.warmSettingsCaches();
    this.registerSettingsWatchers();

    // Subscribe LAST so the cache is already warm when events start
    // arriving. Events that fire before activate() returns would
    // otherwise see empty caches and use defaults instead of user
    // overrides.
    this.unsubscribe = messageBus.subscribe(BROWSER_EVENT_CHANNEL, (data: unknown) => {
      const message = data as BrowserEventMessage;
      this.handleBrowserEvent(message).catch((error: unknown) => {
        logger.error("Failed to handle browser event", error instanceof Error ? error : undefined);
      });
    });

    logger.info("Sound engine activated");
  }

  /**
   * Populate in-memory caches from storage so the first event arriving
   * via the message bus sees the user's actual settings. Reads run in
   * parallel to keep cold-start latency low.
   */
  private async warmSettingsCaches(): Promise<void> {
    const { settings } = this.context!;

    const [mutedValue, muteWhenBlurredValue, masterVolume] = await Promise.all([
      settings.get<boolean>("general.muted"),
      settings.get<boolean>("general.muteWhenBlurred"),
      settings.get<number>("general.masterVolume"),
    ]);
    this.muted = mutedValue ?? false;
    this.muteWhenBlurred = muteWhenBlurredValue ?? DEFAULT_SETTINGS.general.muteWhenBlurred;

    await Promise.all(
      EVENT_REGISTRY.map(async (event) => {
        const config = await settings.get<EventConfig>(`sounds.events.${event.id}`);
        if (config) this.eventConfigs.set(event.id, config);
      }),
    );

    await this.backend!.setGlobalVolume((masterVolume ?? 80) / 100);
  }

  /**
   * Register settings.watch callbacks that keep in-memory caches and
   * the audio backend in sync with live storage changes. Unsubscribe
   * handles are pushed to `this.unwatchers` for teardown.
   */
  private registerSettingsWatchers(): void {
    const { logger, settings } = this.context!;

    this.unwatchers.push(
      settings.watch("general.masterVolume", (newValue) => {
        const vol = (newValue as number) ?? 80;
        this.backend?.setGlobalVolume(vol / 100).catch((e: unknown) => {
          logger.error("Failed to update volume", e instanceof Error ? e : undefined);
        });
        logger.debug(`Volume changed to ${vol}%`);
      }),
      settings.watch("general.muted", (newValue) => {
        const muted = (newValue as boolean) ?? false;
        this.muted = muted;
        if (muted) {
          this.backend?.stopAll().catch((e: unknown) => {
            logger.error("Failed to stop sounds", e instanceof Error ? e : undefined);
          });
        }
        logger.debug(muted ? "Muted" : "Unmuted");
      }),
      settings.watch("general.muteWhenBlurred", (newValue) => {
        const next = (newValue as boolean | undefined) ?? DEFAULT_SETTINGS.general.muteWhenBlurred;
        this.muteWhenBlurred = next;
        logger.debug(`muteWhenBlurred = ${next}`);
      }),
      settings.watch("general.activeTheme", (newValue) => {
        const themeId = (newValue as string) ?? DEFAULT_THEME_ID;
        if (this.themeManager) {
          try {
            this.themeManager.setActiveTheme(themeId);
            logger.info(`Theme switched to ${themeId}`);
          } catch {
            logger.warn(`Unknown theme "${themeId}", falling back to default`);
            try {
              this.themeManager.setActiveTheme(DEFAULT_THEME_ID);
            } catch {
              /* no-op — default theme should always be loaded */
            }
          }
        }
      }),
    );

    for (const event of EVENT_REGISTRY) {
      this.unwatchers.push(
        settings.watch(`sounds.events.${event.id}`, (newValue) => {
          if (newValue === undefined) {
            this.eventConfigs.delete(event.id);
          } else {
            this.eventConfigs.set(event.id, newValue as EventConfig);
          }
        }),
      );
    }
  }

  /** Unsubscribe from browser-event messages and stop all playing sounds. */
  async deactivate(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    for (const unwatch of this.unwatchers) unwatch();
    this.unwatchers = [];

    await this.backend?.stopAll();
    this.context?.logger.info("Sound engine deactivated");
  }

  /** Dispose event engine and audio backend, releasing all resources. */
  async dispose(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    for (const unwatch of this.unwatchers) unwatch();
    this.unwatchers = [];

    this.eventEngine?.dispose();
    this.cooldownGate?.reset();
    // Drop the focus-state subscription before clearing the router's
    // internal subscriber set in windowFocusDispose() — no harm in
    // either order, but explicitly nulling here keeps the closure
    // from retaining a reference to this module.
    if (this.unsubscribeFocusState) {
      this.unsubscribeFocusState();
      this.unsubscribeFocusState = null;
    }
    // Cancel any in-flight unfocus debounce armed by the windows-focus
    // router. Without this, a setTimeout could fire after the message
    // bus and audio backend are gone.
    if (this.windowFocusDispose) {
      this.windowFocusDispose();
      this.windowFocusDispose = null;
    }
    await this.backend?.dispose();
    this.context?.logger.info("Sound engine disposed");
  }

  /**
   * Handle a browser event by resolving and playing the appropriate sound.
   *
   * **Hot path — stays synchronous** until the `backend.play()` await at
   * the end. Mute + per-event config are read from in-memory caches
   * (populated at activate(), kept fresh via settings.watch) instead
   * of awaiting `settings.get`, which avoids two async storage reads
   * per event. For a busy session that's hundreds of saved hops per
   * second and tighter race windows for the cooldown gate.
   */
  private async handleBrowserEvent(message: BrowserEventMessage): Promise<void> {
    if (!this.context || !this.backend || !this.themeManager) return;
    const { logger } = this.context;

    // Mute — from the in-memory cache populated by activate() and the
    // "general.muted" watcher.
    if (this.muted) return;

    // Mute-when-blurred composes with `muted`: when the user has
    // opted in and no browser window currently has focus, suppress
    // every cue including the `windows.onUnfocused` cue itself. The
    // windows-focus-router fires its focus-state callback BEFORE
    // publishing its sound events, so `browserFocused` is up to date
    // by the time the unfocus message arrives here.
    if (this.muteWhenBlurred && !this.browserFocused) return;

    // Find the event definition to get its tier. O(1) Map lookup —
    // the handleBrowserEvent hot path sees every fire.
    const eventDef = EVENT_REGISTRY_BY_ID.get(message.eventId);
    if (!eventDef) {
      logger.warn("Unknown event ID in message", { eventId: message.eventId });
      return;
    }

    // Per-event config — user override from cache → registry default.
    const eventConfig = this.eventConfigs.get(message.eventId);
    const isEnabled = eventConfig?.enabled ?? getEventDefaults(message.eventId).enabled;
    if (!isEnabled) return;

    // Cooldown / debounce gate. Runs AFTER the enabled check so that
    // disabled events cannot consume the cooldown window. Higher-priority
    // events can preempt lower-priority ones already in the window —
    // important for cascades like bfcache back/forward where
    // onBeforeNavigate (priority 0) and onCompleted (priority 10) fire
    // in the same millisecond.
    const debounceMs = getEventDefaults(message.eventId).debounceMs;
    const priority = eventDef.priority ?? 0;
    if (this.cooldownGate && !this.cooldownGate.tryEnter(message.eventId, debounceMs, priority)) {
      return;
    }

    // Resolve which sound to play — handler soundOverride takes priority
    let soundUrl: string | null;
    if (message.soundOverride) {
      // Handler specified a sound file — resolve relative to the active theme
      const activeTheme = this.themeManager.getActiveThemeId();
      const themeInfo = activeTheme ? BUILT_IN_THEMES.find((t) => t.id === activeTheme) : null;
      if (themeInfo) {
        soundUrl = `${getAssetURL(themeInfo.path)}/${message.soundOverride}`;
      } else {
        soundUrl = null;
      }
    } else {
      soundUrl = this.themeManager.resolveSound(
        message.eventId,
        eventDef.tier,
        eventDef.isError ?? false,
      );
    }

    if (!soundUrl) {
      logger.debug("No sound mapped for event", { eventId: message.eventId });
      return;
    }

    // Play the sound with per-event overrides
    const result = await this.backend.play(soundUrl, {
      volume: eventConfig?.volume !== undefined ? eventConfig.volume / 100 : undefined,
      rate: eventConfig?.pitch,
    });

    // Log the result with the event label, extracted event data
    // (URLs, tab IDs, etc — populated by the registry's extractData
    // function), and any extra data attached by a custom handler.
    const logData: Record<string, unknown> = {
      eventId: message.eventId,
      sound: soundUrl,
      ...message.extractedData,
      ...message.handlerData,
    };

    // Cooldown was already committed inside tryEnter(); nothing to do here
    // beyond logging the outcome. A failed play still consumes the cooldown
    // window for ~150ms but that's a rare backend failure and acceptable.
    //
    // For error events, surface the error reason in the message text itself
    // (not just in the data field) so it shows up in HTML and CSV log
    // exports that only render the message column.
    const errorReason =
      eventDef.isError && typeof message.extractedData?.error === "string"
        ? `: ${message.extractedData.error}`
        : "";

    if (result.success) {
      logger.info(`${eventDef.label} sound played (${result.latencyMs}ms)${errorReason}`, logData);
    } else {
      logger.warn(`${eventDef.label} sound failed: ${result.error}`, logData);
    }
  }
}

/** Singleton instance of the sound engine module. */
export const soundEngineModule = new SoundEngineModule();
