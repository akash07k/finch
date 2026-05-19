/**
 * Shape of a log entry received over WebSocket.
 * Mirrors @oriole/logger's LogEntry — duplicated here
 * to avoid a runtime dependency on the logger package.
 */
export interface LogEntry {
  id: string;
  timestamp: string;
  level: number;
  tag: string;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}
