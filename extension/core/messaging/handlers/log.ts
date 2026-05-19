/**
 * @module messaging/handlers/log
 *
 * Forward a `LOG` message from popup/options into the background's
 * logger pipeline. The UI cannot reach the IndexedDB or WebSocket
 * transports directly because both live in the background context,
 * so all UI logs hop through this handler.
 */

import type { Logger } from "@finch/logger";
import type { LogMessage, ExtensionResponse } from "../types.js";
import type { MessageHandler } from "../router.js";

/**
 * Build the LOG handler with a pre-bound child logger tagged for UI
 * traffic. The caller is expected to have already created the child
 * via `logger.child({ tag: "ui" })` so the per-message allocation
 * cost stays out of the dispatch path.
 */
export function createLogHandler(uiLogger: Logger): MessageHandler<LogMessage> {
  return (message): ExtensionResponse => {
    switch (message.level) {
      case "debug":
        uiLogger.debug(message.message, message.data);
        break;
      case "info":
        uiLogger.info(message.message, message.data);
        break;
      case "warn":
        uiLogger.warn(message.message, message.data);
        break;
      case "error":
        uiLogger.error(message.message, message.data);
        break;
      case "fatal":
        uiLogger.fatal(message.message, message.data);
        break;
    }
    return { success: true };
  };
}
