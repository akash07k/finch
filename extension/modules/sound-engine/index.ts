/**
 * @module sound-engine
 *
 * The sound engine module — maps browser events to audio playback.
 *
 * This is the first feature module of Finch. It implements
 * the FinchModule interface and orchestrates:
 *
 * 1. **Audio backend** — platform-specific playback (Chrome offscreen / Firefox direct)
 * 2. **Event engine** — wires browser API listeners from the event registry
 * 3. **Theme manager** — resolves which sound to play for each event
 *
 * The flow: browser event fires → event engine publishes to message bus →
 * this module receives the message → resolves sound via theme manager →
 * plays via audio backend.
 */

import type { FinchModule, ModuleContext } from "../../core/module-system/types.js";
import type { AudioBackend } from "./audio-backends/types.js";
import { EventEngine, BROWSER_EVENT_CHANNEL, type BrowserEventMessage } from "./event-engine.js";
import { ThemeManager } from "./theme-manager.js";
import { loadBuiltInThemes } from "./theme-loader.js";
import { EVENT_REGISTRY } from "./event-registry.js";
import { createWindowFocusEvents } from "./windows-focus-router.js";
import { CooldownGate } from "./cooldown-gate.js";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "../../config/themes.js";
import { CONFIG } from "../../config/index.js";
import { DEFAULT_SETTINGS } from "../../core/settings/defaults.js";
import { getAssetURL } from "../../shared/platform/url.js";
import { decidePlay, type SkipReason } from "./play-pipeline.js";
import type { EventConfig } from "../../core/settings/schema.js";

/** Module ID used for registration and dependency references. */
const SOUND_ENGINE_MODULE_ID = "sound-engine";

/**
 * Sound engine module — implements FinchModule.
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
export class SoundEngineModule implements FinchModule {
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
   * Resolve a handler-supplied filename to a full URL against the
   * active theme. Pulled out so the play pipeline doesn't have to
   * know about `BUILT_IN_THEMES` or `getAssetURL`.
   */
  private resolveOverrideUrl = (filename: string): string | null => {
    const activeTheme = this.themeManager?.getActiveThemeId();
    const themeInfo = activeTheme ? BUILT_IN_THEMES.find((t) => t.id === activeTheme) : null;
    return themeInfo ? `${getAssetURL(themeInfo.path)}/${filename}` : null;
  };

  /**
   * Handle a browser event: ask the pipeline whether to play, then
   * play and log. The pipeline owns the gate ordering and the
   * cooldown commit semantics — this method is left with just the
   * I/O (backend.play) and the log routing.
   *
   * The early bail keeps the hot path sync until backend.play; the
   * pipeline returns a decision without any await, so a busy session
   * still settles its cooldown timestamps before the next event
   * arrives.
   */
  private async handleBrowserEvent(message: BrowserEventMessage): Promise<void> {
    if (!this.context || !this.backend || !this.themeManager || !this.cooldownGate) return;
    const { logger } = this.context;

    const decision = decidePlay(message, {
      muted: this.muted,
      muteWhenBlurred: this.muteWhenBlurred,
      browserFocused: this.browserFocused,
      eventConfigs: this.eventConfigs,
      cooldownGate: this.cooldownGate,
      themeManager: this.themeManager,
      resolveOverrideUrl: this.resolveOverrideUrl,
    });

    if (!decision.play) {
      logSkip(decision.reason, logger);
      return;
    }

    const { command } = decision;
    const result = await this.backend.play(command.soundUrl, {
      volume: command.volume,
      rate: command.rate,
    });

    // Log the result with the event label, extracted event data
    // (URLs, tab IDs, etc — populated by the registry's extractData
    // function), and any extra data attached by a custom handler.
    const logData: Record<string, unknown> = {
      eventId: message.eventId,
      sound: command.soundUrl,
      ...message.extractedData,
      ...message.handlerData,
    };

    // For error events, surface the error reason in the message text
    // (not just in data) so HTML and CSV exports that only render
    // the message column still carry it.
    const errorReason =
      command.eventDef.isError && typeof message.extractedData?.error === "string"
        ? `: ${message.extractedData.error}`
        : "";

    if (result.success) {
      logger.info(
        `${command.eventDef.label} sound played (${result.latencyMs}ms)${errorReason}`,
        logData,
      );
    } else {
      logger.warn(`${command.eventDef.label} sound failed: ${result.error}`, logData);
    }
  }
}

/**
 * Route skip reasons to the right log level. Most skips (muted,
 * blurred, disabled, cooldown) are expected during normal use and
 * stay silent — only the two diagnostic ones produce log output.
 */
function logSkip(reason: SkipReason, logger: ModuleContext["logger"]): void {
  switch (reason.kind) {
    case "unknown-event":
      logger.warn("Unknown event ID in message", { eventId: reason.eventId });
      return;
    case "no-sound":
      logger.debug("No sound mapped for event", { eventId: reason.eventId });
      return;
    case "muted":
    case "blurred":
    case "disabled":
    case "cooldown":
      // Expected suppression — silent on purpose.
      return;
  }
}

/** Singleton instance of the sound engine module. */
export const soundEngineModule = new SoundEngineModule();
