/**
 * @module core/boot
 *
 * Testable extension boot sequence. The WXT entrypoint
 * (`extensions/entrypoints/background.ts`) is a side-effect island —
 * `defineBackground(() => { … })` registers listeners at import time
 * and can't be invoked under test. Pulling the work into
 * `bootExtension(deps)` gives tests a function with explicit
 * dependencies they can stub.
 *
 * What stays in the entrypoint:
 * - `defineBackground` wrapper (WXT contract)
 * - `runtime.onInstalled` listener (MV3 requires it registered
 *    synchronously, before the first await)
 * - `runtime.onSuspend` listener (uses the `BootResult` to dispose)
 * - The dynamic import of the audio backend (browser-specific)
 * - The global command listener (reads typed WXT storage items
 *    directly, doesn't need the boot's services)
 *
 * Everything else — logger construction, platform detection,
 * settings store, migrations, module lifecycle, WebSocket transport
 * attachment, message router wiring — lives here and accepts
 * injectable overrides for hard-to-mock pieces (audio backend,
 * logger factory, platform detector).
 */

import {
  createLogger as createDefaultLogger,
  LogLevel,
  ConsoleTransport,
  WebSocketTransport,
  IndexedDBTransport,
} from "@finch/logger";
import type { Logger } from "@finch/logger";
import { ModuleRegistry } from "../module-system/registry.js";
import { ModuleLoader } from "../module-system/loader.js";
import { MessageBusImpl } from "../message-bus/bus.js";
import { BrowserSettingsStore } from "../settings/browser-store.js";
import { DEFAULT_SETTINGS, FLAT_DEFAULTS } from "../settings/defaults.js";
import { runMigrations as runDefaultMigrations } from "../settings/migrations.js";
import { detectPlatform as detectDefaultPlatform } from "../../shared/platform/detect.js";
import { CONFIG } from "../../config/index.js";
import { MessageRouter } from "../messaging/router.js";
import { createLogHandler } from "../messaging/handlers/log.js";
import { createConnectLogServerHandler } from "../messaging/handlers/connect-log-server.js";
import { createPreviewSoundHandler } from "../messaging/handlers/preview-sound.js";
import { createExportLogsHandler } from "../messaging/handlers/export-logs.js";
import { createClearLogsHandler } from "../messaging/handlers/clear-logs.js";
import type { AudioBackend } from "../../modules/sound-engine/audio-backends/types.js";
import type { FinchModule, ModuleContext, PlatformInfo } from "../module-system/types.js";
import type { ThemeManager } from "../../modules/sound-engine/theme-manager.js";

/** Logger + IDB transport bundle returned by the logger factory. */
export interface LoggerBundle {
  logger: Logger;
  idbTransport: IndexedDBTransport;
}

/** The sound-engine module surface the preview-sound handler needs. */
export interface PreviewSoundSource {
  getThemeManager(): ThemeManager | null;
  getBackend(): AudioBackend | null;
}

/**
 * Dependencies passed into `bootExtension`. Most have sensible
 * production defaults; tests override the ones that touch the
 * environment (audio, platform, IDB) or the ones the test needs to
 * observe (logger).
 */
export interface BootDeps {
  /**
   * Modules to register, initialize, and activate. The boot function
   * does not own module configuration — the caller wires anything
   * module-specific (e.g., `soundEngineModule.setAudioBackend(...)`)
   * before passing the module in.
   */
  modules: FinchModule[];

  /**
   * The sound engine, exposed to the preview-sound handler. Separate
   * from `modules` because the preview path reads the live theme
   * manager / backend handles, not the module's lifecycle hooks. If
   * `null` is returned from the getters, the preview handler reports
   * "Sound engine not initialized" instead of crashing.
   */
  previewSoundSource: PreviewSoundSource;

  /** Build the logger and its IDB transport. Defaults to the production factory. */
  createLogger?: () => LoggerBundle;

  /** Detect the runtime platform. Defaults to `detectPlatform` from `shared/platform`. */
  detectPlatform?: () => Promise<PlatformInfo>;

  /** Run one-shot settings migrations. Defaults to `runMigrations` from `core/settings`. */
  runMigrations?: (logger: Logger) => Promise<void>;
}

/**
 * Handles built during boot. Returned so the entrypoint can wire
 * suspend/dispose hooks against the live state without re-importing.
 */
export interface BootResult {
  readonly logger: Logger;
  readonly settings: BrowserSettingsStore;
  readonly loader: ModuleLoader;
  readonly router: MessageRouter;
  readonly idbTransport: IndexedDBTransport;
}

/**
 * Boot the extension: build services, run migrations, register and
 * start modules, attach the WebSocket transport if the user opted
 * in, and start the message router.
 *
 * Throws if any required step fails. Optional steps (WebSocket
 * attach, individual module activation) log and continue so a
 * single misconfigured piece doesn't take down the whole extension.
 *
 * The caller is responsible for wiring `runtime.onSuspend` against
 * `result.loader.disposeAll()` and `result.settings.dispose()`.
 */
export async function bootExtension(deps: BootDeps): Promise<BootResult> {
  const { logger, idbTransport } = (deps.createLogger ?? defaultLoggerFactory)();
  logger.info("Finch starting up...");

  const detectPlatform = deps.detectPlatform ?? detectDefaultPlatform;
  const runMigrations = deps.runMigrations ?? runDefaultMigrations;

  const platform = await detectPlatform();
  logger.info("Platform detected", {
    browser: platform.browser,
    os: platform.os,
    version: platform.browserVersion,
  });

  const messageBus = new MessageBusImpl();
  const settings = new BrowserSettingsStore(FLAT_DEFAULTS);

  await runMigrations(logger);

  const context: ModuleContext = { logger, messageBus, settings, platform };

  const registry = new ModuleRegistry();
  for (const module of deps.modules) registry.register(module);
  logger.info("Modules registered", { count: registry.getIds().length });

  const loader = new ModuleLoader(registry, context);
  await loader.initializeAll();
  logger.info("Modules initialized");

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

  const logStreamEnabled = await settings.get<boolean>("general.logStreamEnabled");
  if (logStreamEnabled) {
    await attachWebSocketTransport(logger, settings);
  }

  const router = buildMessageRouter({
    logger,
    settings,
    idbTransport,
    previewSoundSource: deps.previewSoundSource,
  });
  router.start();

  return { logger, settings, loader, router, idbTransport };
}

/**
 * Production logger factory. Console + IndexedDB transports;
 * WebSocket added later only if the user opted into log streaming.
 */
function defaultLoggerFactory(): LoggerBundle {
  const idbTransport = new IndexedDBTransport({
    dbName: "finch-logs",
    maxEntries: CONFIG.logger.idbMaxEntries,
    storeName: CONFIG.logger.idbStoreName,
  });
  const logger = createDefaultLogger({
    level: LogLevel.DEBUG,
    tag: "finch",
    transports: [new ConsoleTransport(), idbTransport],
  });
  return { logger, idbTransport };
}

/**
 * Attach the WebSocket log transport at boot when the user already
 * had log streaming enabled in a prior session. Runtime toggles go
 * through the CONNECT_LOG_SERVER message handler instead. Errors
 * are swallowed because the transport auto-reconnects with
 * exponential backoff and a missing log server is a development
 * convenience, not a fatal condition.
 */
async function attachWebSocketTransport(
  logger: Logger,
  settings: BrowserSettingsStore,
): Promise<void> {
  try {
    const wsUrl =
      (await settings.get<string>("general.logServerUrl")) ??
      DEFAULT_SETTINGS.general.logServerUrl;
    logger.addTransport(new WebSocketTransport({ url: wsUrl }));
    logger.info("WebSocket log transport connected", { url: wsUrl });
  } catch {
    // Silently skip — auto-reconnect will retry.
  }
}

interface RouterDeps {
  logger: Logger;
  settings: BrowserSettingsStore;
  idbTransport: IndexedDBTransport;
  previewSoundSource: PreviewSoundSource;
}

function buildMessageRouter(deps: RouterDeps): MessageRouter {
  const uiLogger = deps.logger.child({ tag: "ui" });
  const router = new MessageRouter();
  router.register("LOG", createLogHandler(uiLogger));
  router.register(
    "CONNECT_LOG_SERVER",
    createConnectLogServerHandler(deps.logger, deps.settings),
  );
  router.register(
    "PREVIEW_SOUND",
    createPreviewSoundHandler({
      getThemeManager: () => deps.previewSoundSource.getThemeManager(),
      getBackend: () => deps.previewSoundSource.getBackend(),
      logger: deps.logger,
    }),
  );
  router.register("EXPORT_LOGS", createExportLogsHandler(deps.idbTransport));
  router.register("CLEAR_LOGS", createClearLogsHandler(deps.idbTransport, deps.logger));
  return router;
}
