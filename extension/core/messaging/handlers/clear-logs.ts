/**
 * @module messaging/handlers/clear-logs
 *
 * Empty the IndexedDB log store on user request. The handler logs an
 * info entry through the same logger that owns the IDB transport, so
 * the audit trail starts again with a single "Logs cleared" line
 * instead of vanishing entirely.
 */

import type { IndexedDBTransport, Logger } from "@finch/logger";
import type { ClearLogsMessage, ExtensionResponse } from "../types.js";
import type { MessageHandler } from "../router.js";

export function createClearLogsHandler(
  transport: IndexedDBTransport,
  logger: Logger,
): MessageHandler<ClearLogsMessage> {
  return async (): Promise<ExtensionResponse> => {
    try {
      await transport.clear();
      logger.info("Logs cleared from IndexedDB");
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
