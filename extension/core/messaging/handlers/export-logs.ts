/**
 * @module messaging/handlers/export-logs
 *
 * Render the IndexedDB log buffer as JSON, CSV, or HTML and hand the
 * string back to the requesting page. The UI is responsible for
 * turning the string into a downloadable file — the handler stays
 * stateless and synchronous-feeling apart from the IDB query.
 */

import { LogExporter, type IndexedDBTransport } from "@finch/logger";
import type { ExportLogsMessage, ExtensionResponse } from "../types.js";
import type { MessageHandler } from "../router.js";

const FORMATTERS = {
  json: LogExporter.toJSON,
  csv: LogExporter.toCSV,
  html: LogExporter.toHTML,
} as const;

export function createExportLogsHandler(
  transport: IndexedDBTransport,
): MessageHandler<ExportLogsMessage> {
  return async (message): Promise<ExtensionResponse> => {
    try {
      const entries = await transport.query({});
      const data = FORMATTERS[message.format](entries);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
