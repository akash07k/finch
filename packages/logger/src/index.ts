/**
 * @packageDocumentation
 *
 * `@oriole/logger` — structured, multi-transport logger for browser
 * extensions and web applications.
 *
 * - {@link createLogger} — factory function for logger instances
 * - {@link ConsoleTransport} — writes to the browser/Node.js console
 * - {@link IndexedDBTransport} — persists to IndexedDB with querying
 * - {@link WebSocketTransport} — streams over WebSocket with reconnect
 * - {@link LogExporter} — exports entries to JSON, CSV, or HTML
 */

// Core
export { createLogger } from "./core/logger.js";
export { LogLevel } from "./core/types.js";
export type {
  Logger,
  LoggerConfig,
  LogEntry,
  Transport,
  IndexedDBTransportConfig,
  WebSocketTransportConfig,
  LogQuery,
  ExportFormat,
} from "./core/types.js";

// Transports
export { ConsoleTransport } from "./transports/console.js";
export { IndexedDBTransport } from "./transports/indexed-db.js";
export { WebSocketTransport } from "./transports/websocket.js";

// Export
export { LogExporter } from "./export/exporter.js";
