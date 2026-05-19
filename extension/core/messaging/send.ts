/**
 * @module messaging/send
 *
 * Helper functions for UI contexts (popup, options) to communicate
 * with the background script.
 *
 * These wrap browser.runtime.sendMessage() with typed messages
 * so callers don't need to construct raw message objects.
 */

import type {
  LogMessage,
  ConnectLogServerMessage,
  PreviewSoundMessage,
  ExportLogsMessage,
  ClearLogsMessage,
  ExtensionResponse,
} from "./types.js";

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
    console.log(`[Finch ${level.toUpperCase()}] ${message}`, data ?? "");
  }
}

/**
 * Ask the background script to attach the WebSocket log transport.
 *
 * Sent from the Logging tab when the user enables log streaming. The
 * background reads the configured URL from settings and attaches a
 * `WebSocketTransport` to the existing logger.
 */
export async function sendConnectLogServer(): Promise<ExtensionResponse> {
  try {
    const response = await browser.runtime.sendMessage({
      type: "CONNECT_LOG_SERVER",
    } satisfies ConnectLogServerMessage);
    return response as ExtensionResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
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

/**
 * Request the background script to export stored logs in the given format.
 *
 * The background queries IndexedDB and returns the formatted data as a string.
 * The caller is responsible for turning the string into a downloadable file.
 *
 * @param format - Output format: "json", "csv", or "html".
 * @returns Response with `data` containing the formatted log output on success.
 */
export async function sendExportLogs(
  format: ExportLogsMessage["format"],
): Promise<ExtensionResponse> {
  try {
    const response = await browser.runtime.sendMessage({
      type: "EXPORT_LOGS",
      format,
    } satisfies ExportLogsMessage);
    return response as ExtensionResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Request the background script to clear all stored logs from IndexedDB.
 */
export async function sendClearLogs(): Promise<ExtensionResponse> {
  try {
    const response = await browser.runtime.sendMessage({
      type: "CLEAR_LOGS",
    } satisfies ClearLogsMessage);
    return response as ExtensionResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
