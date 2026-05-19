/**
 * @module background
 *
 * Finch service worker — the extension's entry point.
 *
 * This is where the module system boots up. On extension load:
 * 1. Creates the logger with a Console transport
 * 2. Detects the platform (Chrome/Firefox, OS)
 * 3. Creates the module registry, message bus, and settings store
 * 4. Injects the platform-specific audio backend
 * 5. Registers and initializes all modules in dependency order
 * 6. Activates enabled modules
 * 7. Connects WebSocket log transport if user has enabled log streaming
 * 8. Registers message listener for popup/options page communication
 * 9. Registers global keyboard shortcut listener (browser.commands)
 * 10. Opens options page on first install (onboarding)
 * 11. Registers service worker suspension cleanup
 *
 * WXT's defineBackground() is the entry point. The main function
 * CANNOT be async (MV3 constraint), so we call the async bootstrap
 * function inside it and handle errors.
 */

import {
  createLogger,
  LogLevel,
  ConsoleTransport,
  WebSocketTransport,
  IndexedDBTransport,
  LogExporter,
} from "@finch/logger";
import type { Logger } from "@finch/logger";
import { ModuleRegistry } from "../core/module-system/registry.js";
import { ModuleLoader } from "../core/module-system/loader.js";
import { MessageBusImpl } from "../core/message-bus/bus.js";
import { BrowserSettingsStore } from "../core/settings/browser-store.js";
import { DEFAULT_SETTINGS } from "../core/settings/defaults.js";
import { runMigrations } from "../core/settings/migrations.js";
import { detectPlatform } from "../shared/platform/detect.js";
import { soundEngineModule } from "../modules/sound-engine/index.js";
import { EVENT_REGISTRY_BY_ID } from "../modules/sound-engine/event-registry.js";
import { CONFIG } from "../config/index.js";
import {
  mutedItem,
  muteWhenBlurredItem,
  showWhatsNewOnUpdateItem,
} from "../core/settings/items.js";
import type { AudioBackend } from "../modules/sound-engine/audio-backends/types.js";
import type { ModuleContext } from "../core/module-system/types.js";

export default defineBackground(() => {
  // Register the onInstalled listener synchronously at the very top
  // of this callback. Chrome MV3 fires onInstalled while the service
  // worker is starting up, and listeners registered after any await
  // (e.g., inside the async bootstrap below) miss the event. Reads
  // browser.storage.local directly because the settings store does
  // not exist yet at this point in the lifecycle.
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
      browser.runtime.openOptionsPage();
      console.log("[Finch] First install — opened options page for onboarding");
      return;
    }
    if (details.reason !== "update") return;

    const previousVersion = details.previousVersion;
    const currentVersion = browser.runtime.getManifest().version;
    if (!previousVersion || previousVersion === currentVersion) return;

    const optedIn = await showWhatsNewOnUpdateItem.getValue();
    if (!optedIn) {
      console.log(
        `[Finch] Update ${previousVersion} -> ${currentVersion}; What's New disabled by user`,
      );
      return;
    }

    const url = browser.runtime.getURL(
      `/whats-new.html?from=${encodeURIComponent(previousVersion)}`,
    );
    try {
      await browser.tabs.create({ url });
      console.log(
        `[Finch] Update ${previousVersion} -> ${currentVersion}; opened What's New page`,
      );
    } catch (error) {
      console.error("[Finch] Failed to open What's New tab:", error);
    }
  });

  /**
   * Bootstrap the extension — create all services and start modules.
   * Called from the synchronous defineBackground main function.
   */
  async function bootstrap(): Promise<void> {
    // 1. Create the logger with Console + IndexedDB transports.
    //    Console for developer visibility, IndexedDB for persistent storage
    //    and log export. WebSocket transport is added later if the user
    //    enables log streaming (to avoid Chrome errors from failed connections).
    const idbTransport = new IndexedDBTransport({
      dbName: "finch-logs",
      maxEntries: CONFIG.logger.idbMaxEntries,
      storeName: CONFIG.logger.idbStoreName,
    });
    const logger = createLogger({
      level: LogLevel.DEBUG,
      tag: "finch",
      transports: [new ConsoleTransport(), idbTransport],
    });

    logger.info("Finch starting up...");

    try {
      // 2. Detect the platform
      const platform = await detectPlatform();
      logger.info("Platform detected", {
        browser: platform.browser,
        os: platform.os,
        version: platform.browserVersion,
      });

      // 3. Create shared services
      const messageBus = new MessageBusImpl();
      const settings = createSettingsStore();

      // 3a. Run one-shot settings migrations before modules read
      //     config. Each migration is guarded by a marker key so it
      //     does not re-run on subsequent boots.
      await runMigrations(logger);

      // 4. Build the module context — shared by all modules
      const context: ModuleContext = {
        logger,
        messageBus,
        settings,
        platform,
      };

      // 5. Inject the platform-specific audio backend before registering.
      //    Chrome: offscreen document (service workers have no DOM).
      //    Firefox: Howler.js directly in background page (has DOM access).
      //    Dynamic import keeps Howler.js out of Chrome's service worker bundle —
      //    Vite tree-shakes the unused branch at build time via import.meta.env.BROWSER.
      const audioBackend = await createAudioBackend();
      soundEngineModule.setAudioBackend(audioBackend);

      const registry = new ModuleRegistry();
      registry.register(soundEngineModule);
      logger.info("Modules registered", { count: registry.getIds().length });

      // 6. Initialize all modules in dependency order
      const loader = new ModuleLoader(registry, context);
      await loader.initializeAll();
      logger.info("Modules initialized");

      // 7. Activate enabled modules
      const enabledModules =
        (await settings.get<string[]>("general.enabledModules")) ??
        DEFAULT_SETTINGS.general.enabledModules;
      for (const moduleId of enabledModules) {
        const entry = registry.get(moduleId);
        if (entry && entry.state === "initialized") {
          try {
            await loader.activate(moduleId);
            logger.info(`Module activated: ${moduleId}`);
          } catch (error) {
            logger.error(
              `Failed to activate module: ${moduleId}`,
              error instanceof Error ? error : undefined,
            );
          }
        }
      }

      logger.info("Finch ready", {
        activeModules: enabledModules.length,
        platform: platform.browser,
      });

      // 8. Connect WebSocket log transport ONLY if user has enabled it.
      //    Reads through the settings store so the default (false) is
      //    applied consistently — no raw storage access needed.
      const logStreamEnabled = await settings.get<boolean>("general.logStreamEnabled");
      if (logStreamEnabled) {
        connectLogServer(logger, settings);
      }

      // 9. Listen for messages from popup/options page
      setupMessageListener(logger, settings, idbTransport);

      // 10. Global keyboard shortcuts via browser.commands API
      setupCommandListener(logger);

      // 11. onInstalled handler is registered synchronously at the top
      //     of this defineBackground callback (above the bootstrap
      //     definition) so the listener is in place before MV3 fires
      //     the event during service-worker startup. Registering it
      //     here, after several awaits, would race the event and miss
      //     it on every install / update cycle.

      // 12. Clean up on service worker suspension.
      //     Dispose the settings store AFTER modules — modules may
      //     still read settings during their own dispose(). Firing
      //     settings.dispose() first would rip the storage.onChanged
      //     listener out from under any module still settling.
      browser.runtime.onSuspend.addListener(() => {
        logger.info("Service worker suspending — disposing modules");
        loader
          .disposeAll()
          .catch((e: unknown) => {
            console.error("[Finch] Module disposal error:", e);
          })
          .finally(() => {
            settings.dispose();
          });
      });
    } catch (error) {
      logger.fatal("Finch failed to start", error instanceof Error ? error : undefined);
    }
  }

  /**
   * Adds a WebSocket transport to the logger for streaming logs
   * to the accessible log viewer.
   *
   * Only called when the user has enabled log streaming in settings.
   * The WebSocket transport auto-reconnects with exponential backoff,
   * so if the server is not running yet, it will connect when it starts.
   *
   * NOTE: Creating a WebSocket that fails WILL show as a Chrome
   * extension error. This is acceptable because the user explicitly
   * opted in by enabling log streaming.
   */
  async function connectLogServer(
    logger: Logger,
    settingsStore: BrowserSettingsStore,
  ): Promise<void> {
    try {
      const wsUrl =
        (await settingsStore.get<string>("general.logServerUrl")) ??
        DEFAULT_SETTINGS.general.logServerUrl;

      const wsTransport = new WebSocketTransport({ url: wsUrl });
      logger.addTransport(wsTransport);
      logger.info("WebSocket log transport connected", { url: wsUrl });
    } catch {
      // Silently skip
    }
  }

  /**
   * Listens for messages from popup/options page contexts.
   * Routes LOG messages to the logger and handles other message types.
   */
  function setupMessageListener(
    logger: Logger,
    settings: BrowserSettingsStore,
    idbTransport: IndexedDBTransport,
  ): void {
    // Built once at setup time. The previous shape constructed a fresh
    // child on every LOG message — a busy options page can fire dozens
    // per second, each allocation copies the parent transports array
    // and a new closure for the dispatch chain.
    const uiLogger = logger.child({ tag: "ui" });

    browser.runtime.onMessage.addListener(
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ) => {
        // Reject anything from another extension. Finch ships no
        // content scripts and isn't externally_connectable, so messages
        // whose sender.id doesn't match our own runtime id come from a
        // foreign extension probing this background. Drop them; none of
        // the LOG / CONNECT_LOG_SERVER / PREVIEW_SOUND / EXPORT_LOGS /
        // CLEAR_LOGS handlers should serve a foreign caller.
        //
        // Do NOT guard on `sender.tab !== undefined` here: WXT defaults
        // options_ui.open_in_tab to true, so the options page (the
        // primary sender of these messages) renders inside a tab and
        // therefore carries a sender.tab. Tab presence is not a trust
        // signal; sender.id is.
        if (sender.id !== browser.runtime.id) {
          return false;
        }

        const msg = message as { type?: string };

        if (msg.type === "LOG") {
          const logMsg = message as {
            level: string;
            message: string;
            data?: Record<string, unknown>;
          };
          switch (logMsg.level) {
            case "debug":
              uiLogger.debug(logMsg.message, logMsg.data);
              break;
            case "info":
              uiLogger.info(logMsg.message, logMsg.data);
              break;
            case "warn":
              uiLogger.warn(logMsg.message, logMsg.data);
              break;
            case "error":
              uiLogger.error(logMsg.message, logMsg.data);
              break;
            case "fatal":
              uiLogger.fatal(logMsg.message, logMsg.data);
              break;
          }
          sendResponse({ success: true });
          return false;
        }

        if (msg.type === "CONNECT_LOG_SERVER") {
          connectLogServer(logger, settings).then(() => sendResponse({ success: true }));
          return true; // async response
        }

        if (msg.type === "PREVIEW_SOUND") {
          const previewMsg = message as { eventId: string };
          handlePreviewSound(previewMsg.eventId, logger)
            .then((result) => sendResponse(result))
            .catch(() => sendResponse({ success: false, error: "Preview failed" }));
          return true; // async response
        }

        if (msg.type === "EXPORT_LOGS") {
          const exportMsg = message as { format: "json" | "csv" | "html" };
          handleExportLogs(idbTransport, exportMsg.format)
            .then((result) => sendResponse(result))
            .catch(() => sendResponse({ success: false, error: "Export failed" }));
          return true; // async response
        }

        if (msg.type === "CLEAR_LOGS") {
          idbTransport
            .clear()
            .then(() => {
              logger.info("Logs cleared from IndexedDB");
              sendResponse({ success: true });
            })
            .catch(() => sendResponse({ success: false, error: "Clear failed" }));
          return true; // async response
        }

        // Unknown message type — don't respond (might be for offscreen document)
        return false;
      },
    );
  }

  /**
   * Listens for global keyboard shortcuts registered via browser.commands.
   * These work from any tab — the browser captures them and forwards to us.
   */
  function setupCommandListener(logger: Logger): void {
    browser.commands.onCommand.addListener(async (command: string) => {
      logger.debug(`Command received: ${command}`);

      switch (command) {
        case "toggle-mute": {
          const wasMuted = await mutedItem.getValue();
          await mutedItem.setValue(!wasMuted);
          const message = wasMuted ? "Finch unmuted" : "Finch muted";
          // Show badge text on extension icon (action for MV3, browserAction for MV2)
          const badgeApi = browser.action ?? browser.browserAction;
          if (badgeApi) {
            badgeApi.setBadgeText({ text: wasMuted ? "" : "M" });
            badgeApi.setBadgeBackgroundColor({ color: "#8b0000" });
          }

          try {
            await browser.notifications.create({
              type: "basic",
              iconUrl: chrome.runtime.getURL("icon/128.png"),
              title: "Finch",
              message,
            });
          } catch (e) {
            logger.error("Failed to show notification", e instanceof Error ? e : undefined);
          }
          logger.info(message);
          break;
        }

        case "toggle-mute-when-blurred": {
          const current = await muteWhenBlurredItem.getValue();
          const next = !current;
          await muteWhenBlurredItem.setValue(next);
          logger.info(`Mute when unfocused toggled: ${current} -> ${next}`);

          try {
            await browser.notifications.create({
              type: "basic",
              iconUrl: browser.runtime.getURL("/icon/128.png"),
              title: "Finch",
              message: `Mute when unfocused: ${next ? "enabled" : "disabled"}`,
            });
          } catch (e) {
            logger.error(
              "Failed to show mute-when-unfocused notification",
              e instanceof Error ? e : undefined,
            );
          }
          break;
        }

        case "open-options": {
          browser.runtime.openOptionsPage();
          logger.info("Opened options page via shortcut");
          break;
        }
      }
    });
  }

  /**
   * Handle a sound preview request from the options page.
   * Resolves the sound for the given event and plays it through the audio backend.
   */
  async function handlePreviewSound(
    eventId: string,
    logger: Logger,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const themeManager = soundEngineModule.getThemeManager();
      const backend = soundEngineModule.getBackend();

      if (!themeManager || !backend) {
        return { success: false, error: "Sound engine not initialized" };
      }

      const eventDef = EVENT_REGISTRY_BY_ID.get(eventId);
      if (!eventDef) {
        return { success: false, error: `Unknown event: ${eventId}` };
      }

      const soundUrl = themeManager.resolveSound(eventId, eventDef.tier, eventDef.isError ?? false);

      if (!soundUrl) {
        return { success: false, error: "No sound mapped for this event" };
      }

      const result = await backend.play(soundUrl);
      logger.info(`Preview: ${eventDef.label}`, { eventId, sound: soundUrl });
      return { success: result.success, error: result.error };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Handle a log export request from the options page.
   * Queries all entries from IndexedDB and formats them.
   */
  async function handleExportLogs(
    transport: IndexedDBTransport,
    format: "json" | "csv" | "html",
  ): Promise<{ success: boolean; data?: string; error?: string }> {
    try {
      const entries = await transport.query({});
      let data: string;
      switch (format) {
        case "json":
          data = LogExporter.toJSON(entries);
          break;
        case "csv":
          data = LogExporter.toCSV(entries);
          break;
        case "html":
          data = LogExporter.toHTML(entries);
          break;
      }
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Creates the settings store backed by browser.storage.local.
   *
   * Flattens the nested DEFAULT_SETTINGS into dot-notation keys used
   * as fallback values when a setting hasn't been explicitly set yet.
   * Reads/writes go to browser.storage.local for persistence.
   */
  function createSettingsStore(): BrowserSettingsStore {
    const flatDefaults: Record<string, unknown> = {};

    // Flatten general settings
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS.general)) {
      flatDefaults[`general.${key}`] = value;
    }

    // Flatten sound event settings
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS.sounds.events)) {
      flatDefaults[`sounds.events.${key}`] = value;
    }

    // Flatten theme settings
    flatDefaults["themes.customThemes"] = DEFAULT_SETTINGS.themes.customThemes;

    // Flatten hotkey settings
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS.hotkeys.bindings)) {
      flatDefaults[`hotkeys.bindings.${key}`] = value;
    }

    return new BrowserSettingsStore(flatDefaults);
  }

  /**
   * Creates the platform-specific audio backend.
   *
   * Uses dynamic imports so Vite tree-shakes the unused backend at build time:
   * - Chrome build: only ChromeAudioBackend is bundled (no Howler.js in SW)
   * - Firefox build: only FirefoxAudioBackend is bundled (Howler.js in background page)
   */
  async function createAudioBackend(): Promise<AudioBackend> {
    if (import.meta.env.BROWSER === "firefox") {
      const { FirefoxAudioBackend } =
        await import("../modules/sound-engine/audio-backends/firefox-backend.js");
      return new FirefoxAudioBackend();
    }

    const { ChromeAudioBackend } =
      await import("../modules/sound-engine/audio-backends/chrome-backend.js");
    return new ChromeAudioBackend();
  }

  // Start the bootstrap process.
  // Cannot use top-level await in a service worker, so we
  // call the async function and catch errors.
  bootstrap().catch((error) => {
    console.error("[Finch] Fatal bootstrap error:", error);
  });
});
