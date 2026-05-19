/**
 * @module core/boot/commands
 *
 * Global keyboard shortcut handler. `browser.commands` fires on the
 * keystrokes registered in `wxt.config.ts` (Alt+M, Alt+Shift+M,
 * Alt+Shift+I) regardless of which tab has focus, so the dispatch
 * lives in the background script.
 *
 * The handler reads and writes typed WXT storage items directly
 * rather than going through `BrowserSettingsStore`. The two layers
 * share the same `browser.storage.local` keys, so an update from
 * either side fires `storage.onChanged` and the sound engine's
 * watchers see it.
 */

import type { Logger } from "@finch/logger";
import { mutedItem, muteWhenBlurredItem } from "../settings/items.js";

/**
 * Wire `browser.commands.onCommand` to the in-process toggles.
 * Returns the unsubscribe function so tests (or a future graceful
 * shutdown path) can detach the listener.
 */
export function setupCommandListener(logger: Logger): () => void {
  const listener = async (command: string): Promise<void> => {
    logger.debug(`Command received: ${command}`);

    switch (command) {
      case "toggle-mute":
        await handleToggleMute(logger);
        return;
      case "toggle-mute-when-blurred":
        await handleToggleMuteWhenBlurred(logger);
        return;
      case "open-options":
        browser.runtime.openOptionsPage();
        logger.info("Opened options page via shortcut");
        return;
    }
  };

  browser.commands.onCommand.addListener(listener);
  return () => browser.commands.onCommand.removeListener(listener);
}

async function handleToggleMute(logger: Logger): Promise<void> {
  const wasMuted = await mutedItem.getValue();
  await mutedItem.setValue(!wasMuted);
  const message = wasMuted ? "Finch unmuted" : "Finch muted";

  // Badge API differs between MV3 (browser.action) and MV2 (browser.browserAction).
  // Runtime check tolerates either; a missing badge surface is non-fatal.
  const badgeApi = browser.action ?? browser.browserAction;
  if (badgeApi) {
    badgeApi.setBadgeText({ text: wasMuted ? "" : "M" });
    badgeApi.setBadgeBackgroundColor({ color: "#8b0000" });
  }

  try {
    await browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("/icon/128.png"),
      title: "Finch",
      message,
    });
  } catch (error) {
    logger.error("Failed to show notification", error instanceof Error ? error : undefined);
  }
  logger.info(message);
}

async function handleToggleMuteWhenBlurred(logger: Logger): Promise<void> {
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
  } catch (error) {
    logger.error(
      "Failed to show mute-when-unfocused notification",
      error instanceof Error ? error : undefined,
    );
  }
}
