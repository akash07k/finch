/**
 * @module messaging/send
 *
 * Helper functions for UI contexts (popup, options) to communicate
 * with the background script.
 *
 * These wrap browser.runtime.sendMessage() with typed messages
 * so callers don't need to construct raw message objects.
 */

import type { LogMessage, PreviewSoundMessage, ExtensionResponse } from "./types.js";

/**
 * Send a log message to the background script's logger.
 *
 * Use this from popup/options instead of console.log — the message
 * goes through the proper logger pipeline (console + WebSocket + log server).
 *
 * @example
 * ```ts
 * await sendLog("info", "General settings reset to defaults");
 * await sendLog("warn", "Factory reset triggered", { source: "options" });
 * ```
 */
export async function sendLog(
  level: LogMessage["level"],
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: "LOG",
      level,
      message,
      data,
    } satisfies LogMessage);
  } catch {
    // Background script might not be running — fall back to console
    console.log(`[Oriole ${level.toUpperCase()}] ${message}`, data ?? "");
  }
}

/**
 * Request the background script to preview a sound for an event.
 *
 * @param eventId - The event registry ID (e.g., "tabs.onCreated").
 * @returns Response with success status.
 */
export async function sendPreviewSound(eventId: string): Promise<ExtensionResponse> {
  try {
    const response = await browser.runtime.sendMessage({
      type: "PREVIEW_SOUND",
      eventId,
    } satisfies PreviewSoundMessage);
    return response as ExtensionResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
