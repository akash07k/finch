/**
 * @module background
 *
 * Finch service worker — WXT entrypoint. The work lives in
 * {@link bootExtension}; this file only owns the surface that has to
 * stay in the entrypoint:
 *
 * - `defineBackground()` wrapper (WXT contract)
 * - `runtime.onInstalled` listener (must register synchronously,
 *    before the first await, so MV3's install/update event isn't
 *    missed during service-worker startup)
 * - The browser-specific audio-backend import (dynamic so Vite
 *    tree-shakes the unused half at build time)
 * - The global command listener
 * - `runtime.onSuspend` cleanup
 *
 * `defineBackground` must be sync, so the async boot is fired in a
 * fire-and-forget IIFE and any rejection is logged to console.
 */

import { soundEngineModule } from "../modules/sound-engine/index.js";
import { showWhatsNewOnUpdateItem } from "../core/settings/items.js";
import { bootExtension } from "../core/boot/boot.js";
import { setupCommandListener } from "../core/boot/commands.js";
import type { AudioBackend } from "../modules/sound-engine/audio-backends/types.js";

export default defineBackground(() => {
  // Register the onInstalled listener synchronously at the very top
  // of this callback. Chrome MV3 fires onInstalled while the service
  // worker is starting up, and listeners registered after any await
  // (e.g., inside the async boot below) miss the event. Reads
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

  // Fire-and-forget boot. Service workers can't use top-level await.
  void runBoot();
});

async function runBoot(): Promise<void> {
  try {
    const audioBackend = await createAudioBackend();
    soundEngineModule.setAudioBackend(audioBackend);

    const result = await bootExtension({
      modules: [soundEngineModule],
      previewSoundSource: {
        getThemeManager: () => soundEngineModule.getThemeManager(),
        getBackend: () => soundEngineModule.getBackend(),
      },
    });

    setupCommandListener(result.logger);

    // Dispose modules BEFORE the settings store. Modules may still
    // read settings during their own dispose(); firing settings.dispose()
    // first would rip the storage.onChanged listener out from under any
    // module still settling.
    browser.runtime.onSuspend.addListener(() => {
      result.logger.info("Service worker suspending — disposing modules");
      result.loader
        .disposeAll()
        .catch((e: unknown) => {
          console.error("[Finch] Module disposal error:", e);
        })
        .finally(() => {
          result.settings.dispose();
        });
    });
  } catch (error) {
    console.error("[Finch] Fatal bootstrap error:", error);
  }
}

/**
 * Build the platform-specific audio backend. Dynamic imports so Vite
 * tree-shakes the unused branch at build time:
 *
 * - Chrome: only ChromeAudioBackend is bundled (no Howler.js in SW)
 * - Firefox: only FirefoxAudioBackend is bundled (Howler.js in background page)
 */
async function createAudioBackend(): Promise<AudioBackend> {
  if (import.meta.env.BROWSER === "firefox") {
    const { FirefoxAudioBackend } = await import(
      "../modules/sound-engine/audio-backends/firefox-backend.js"
    );
    return new FirefoxAudioBackend();
  }

  const { ChromeAudioBackend } = await import(
    "../modules/sound-engine/audio-backends/chrome-backend.js"
  );
  return new ChromeAudioBackend();
}
