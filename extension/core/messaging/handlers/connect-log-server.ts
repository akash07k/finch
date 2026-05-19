/**
 * @module messaging/handlers/connect-log-server
 *
 * Attach the WebSocket log transport when the user enables log
 * streaming from the Logging tab. The transport's URL comes from
 * settings so the same handler works for the default `localhost:8089`
 * and any user-configured server.
 *
 * Attachment is idempotent at the transport layer (the logger
 * accepts duplicate transports but they'd double-write). The boot
 * script is responsible for not calling this handler when the
 * transport is already attached.
 */

import { WebSocketTransport, type Logger } from "@finch/logger";
import type { SettingsStore } from "../../module-system/types.js";
import { DEFAULT_SETTINGS } from "../../settings/defaults.js";
import type { ConnectLogServerMessage, ExtensionResponse } from "../types.js";
import type { MessageHandler } from "../router.js";

/**
 * Build the CONNECT_LOG_SERVER handler. The logger and settings store
 * are bound at construction time so the dispatch path is just a
 * settings read followed by a transport add.
 */
export function createConnectLogServerHandler(
  logger: Logger,
  settings: SettingsStore,
): MessageHandler<ConnectLogServerMessage> {
  return async (): Promise<ExtensionResponse> => {
    try {
      const wsUrl =
        (await settings.get<string>("general.logServerUrl")) ??
        DEFAULT_SETTINGS.general.logServerUrl;
      logger.addTransport(new WebSocketTransport({ url: wsUrl }));
      logger.info("WebSocket log transport connected", { url: wsUrl });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
