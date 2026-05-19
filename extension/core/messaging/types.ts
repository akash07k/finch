/**
 * @module messaging/types
 *
 * Message types for communication between extension contexts.
 *
 * The popup and options page run in separate contexts from the
 * background script. They communicate via browser.runtime.sendMessage().
 * This file defines the message protocol so all contexts use
 * consistent, typed messages.
 */

/**
 * Messages that UI contexts (popup, options) can send to the background script.
 */
export type ExtensionMessage =
  | LogMessage
  | ConnectLogServerMessage
  | PreviewSoundMessage
  | ExportLogsMessage
  | ClearLogsMessage;

/**
 * Request the background script to log a message.
 * Used by popup/options since they don't have direct logger access.
 */
export interface LogMessage {
  type: "LOG";
  level: "debug" | "info" | "warn" | "error" | "fatal";
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Request the background script to connect the WebSocket log transport.
 * Sent by the Logging tab when the user enables log streaming.
 */
export interface ConnectLogServerMessage {
  type: "CONNECT_LOG_SERVER";
}

/**
 * Request the background script to preview a sound for an event.
 * Used by the Sound Events tab's preview button.
 */
export interface PreviewSoundMessage {
  type: "PREVIEW_SOUND";
  eventId: string;
}

/**
 * Request the background script to export stored logs.
 * The background queries IndexedDB and returns formatted data.
 */
export interface ExportLogsMessage {
  type: "EXPORT_LOGS";
  format: "json" | "csv" | "html";
}

/**
 * Request the background script to clear all stored logs.
 */
export interface ClearLogsMessage {
  type: "CLEAR_LOGS";
}

/**
 * Response from the background script.
 */
export interface ExtensionResponse {
  success: boolean;
  error?: string;
  data?: string;
}
