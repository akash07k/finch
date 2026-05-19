/**
 * @module options/tabs/LoggingTab
 *
 * Logging settings tab — configure log level, WebSocket server URL
 * for streaming logs to the accessible log viewer, and export logs.
 *
 * The WebSocket transport is only connected when the user enables
 * log streaming via the toggle. The URL defaults to ws://localhost:8089.
 */

import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  sendLog,
  sendConnectLogServer,
  sendExportLogs,
  sendClearLogs,
} from "@/core/messaging/send";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { announce } from "@/shared/a11y/announcer";
import { useConfirmAction } from "@/shared/hooks/use-confirm-action";
import { logLevelItem, logStreamEnabledItem, logServerUrlItem } from "@/core/settings/items";

/** Log level options matching LogLevel enum values. */
const LOG_LEVELS = [
  { value: "0", label: "DEBUG — All messages" },
  { value: "1", label: "INFO — Informational and above" },
  { value: "2", label: "WARN — Warnings and errors only" },
  { value: "3", label: "ERROR — Errors only" },
  { value: "4", label: "FATAL — Fatal errors only" },
];

/** Validates a WebSocket URL — must start with ws:// or wss:// and have a host. */
function isValidWebSocketUrl(url: string): boolean {
  return /^wss?:\/\/[^\s/]+/.test(url.trim());
}

export function LoggingTab() {
  const [logLevel, setLogLevel] = useState("1");
  const [logServerUrl, setLogServerUrl] = useState("ws://localhost:8089");
  const [logStreamEnabled, setLogStreamEnabled] = useState(false);
  // Validation only fires after the user has interacted with the URL field —
  // avoids flickering aria-invalid mid-typing while a partial "ws://localh"
  // looks malformed.
  const [urlTouched, setUrlTouched] = useState(false);

  const urlInvalid =
    urlTouched && logStreamEnabled && logServerUrl.length > 0 && !isValidWebSocketUrl(logServerUrl);

  const clearLogsRef = useRef<HTMLButtonElement>(null);
  const loggingResetRef = useRef<HTMLButtonElement>(null);

  const clearLogs = useConfirmAction(clearLogsRef, async () => {
    try {
      const response = await sendClearLogs();
      if (response.success) {
        announce("All stored logs cleared", "polite");
        sendLog("warn", "Logs cleared from IndexedDB", { source: "options" });
      } else {
        announce("Failed to clear logs", "assertive");
      }
    } catch {
      announce("Failed to clear logs. The extension may need to be reloaded.", "assertive");
    }
  });

  const loggingReset = useConfirmAction(loggingResetRef, async () => {
    setLogLevel("1");
    setLogServerUrl("ws://localhost:8089");
    setLogStreamEnabled(false);
    await Promise.all([
      logLevelItem.setValue(1),
      logServerUrlItem.setValue("ws://localhost:8089"),
      logStreamEnabledItem.setValue(false),
    ]);
    announce("Logging settings reset to defaults", "polite");
    sendLog("warn", "Logging settings reset to defaults", { source: "options" });
  });

  // Load settings on mount
  useEffect(() => {
    async function load() {
      try {
        setLogLevel(String(await logLevelItem.getValue()));
        setLogServerUrl(await logServerUrlItem.getValue());
        setLogStreamEnabled(await logStreamEnabledItem.getValue());
      } catch {
        // Use defaults
      }
    }
    load();
  }, []);

  /** Toggle log streaming to the log server. */
  const handleLogStreamToggle = async (checked: boolean) => {
    setLogStreamEnabled(checked);
    await logStreamEnabledItem.setValue(checked);

    if (checked) {
      // Tell the background script to connect now. The user's preference is
      // already persisted above; if the message fails (service worker asleep
      // or crashed), surface that to the user instead of silently flipping.
      const response = await sendConnectLogServer();
      if (response.success) {
        announce("Log streaming enabled. Connecting to log server...", "assertive");
        sendLog("info", "Log streaming enabled by user");
      } else {
        announce("Could not start log streaming. Try reloading the extension.", "assertive");
        sendLog("warn", "Failed to start log stream", {
          error: response.error ?? "unknown",
        });
      }
    } else {
      // Disconnecting requires extension reload (transport can't be removed at runtime)
      announce("Log streaming disabled. Reload the extension for full effect.", "assertive");
      sendLog("info", "Log streaming disabled by user");
    }
  };

  const handleLogLevelChange = (value: string) => {
    setLogLevel(value);
    logLevelItem.setValue(Number(value));
    const level = LOG_LEVELS.find((l) => l.value === value);
    announce(`Log level set to ${level?.label ?? value}`, "polite");
  };

  const handleUrlChange = (value: string) => {
    setLogServerUrl(value);
    logServerUrlItem.setValue(value);
  };

  const handleExport = async (format: "json" | "csv" | "html") => {
    announce(`Exporting logs as ${format.toUpperCase()}...`, "polite");
    try {
      const response = await sendExportLogs(format);

      if (!response.success || !response.data) {
        announce(`Export failed: ${response.error ?? "unknown error"}`, "assertive");
        return;
      }

      const mimeTypes = { json: "application/json", csv: "text/csv", html: "text/html" };
      const blob = new Blob([response.data], { type: mimeTypes[format] });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `finch-logs-${timestamp}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      announce(
        `Exported logs as ${format.toUpperCase()}. File saved to your Downloads folder.`,
        "polite",
      );
      sendLog("info", `Logs exported as ${format}`, { source: "options" });
    } catch {
      announce("Export failed. The extension may need to be reloaded.", "assertive");
    }
  };

  return (
    <div className="space-y-6 mt-4">
      <h2 className="text-xl font-semibold">Logging</h2>

      {/* Log Streaming */}
      <section aria-labelledby="logging-server-heading" className="space-y-4 border rounded-lg p-4">
        <h3 id="logging-server-heading" className="text-sm font-semibold">
          Log Server
        </h3>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="log-stream-toggle">Stream logs to server</Label>
            <p id="log-stream-desc" className="text-sm text-muted-foreground">
              When enabled, extension logs stream to the log server for accessible viewing. This
              setting persists across restarts.
            </p>
          </div>
          <Switch
            id="log-stream-toggle"
            aria-describedby="log-stream-desc"
            checked={logStreamEnabled}
            onCheckedChange={handleLogStreamToggle}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="log-server-url">Log Server URL</Label>
          <Input
            id="log-server-url"
            type="url"
            inputMode="url"
            value={logServerUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            onBlur={() => setUrlTouched(true)}
            placeholder="ws://localhost:8089"
            aria-describedby="log-server-error log-server-hint"
            aria-invalid={urlInvalid}
            disabled={!logStreamEnabled}
          />
          {/* Stable polite live region — always mounted so toggling validity */}
          {/* updates the same node instead of remounting role="alert" and    */}
          {/* re-firing assertive announcements on every keystroke.           */}
          <p
            id="log-server-error"
            aria-live="polite"
            className="text-sm text-destructive min-h-[1.25rem]"
          >
            {urlInvalid ? "URL must start with ws:// or wss://" : ""}
          </p>
          <p id="log-server-hint" className="text-sm text-muted-foreground">
            WebSocket URL (ws:// or wss://). Start the log server with: pnpm log-server
          </p>
        </div>
      </section>

      {/* Log Level */}
      <section aria-labelledby="logging-config-heading" className="space-y-4 border rounded-lg p-4">
        <h3 id="logging-config-heading" className="text-sm font-semibold">
          Log Configuration
        </h3>

        <div className="space-y-2">
          <Label htmlFor="log-level">Minimum Log Level</Label>
          <Select value={logLevel} onValueChange={handleLogLevelChange}>
            <SelectTrigger id="log-level" className="w-full">
              <SelectValue placeholder="Select log level" />
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVELS.map((level) => (
                <SelectItem key={level.value} value={level.value}>
                  {level.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* Export */}
      <section aria-labelledby="logging-stored-heading" className="space-y-4 border rounded-lg p-4">
        <h3 id="logging-stored-heading" className="text-sm font-semibold">
          Stored Logs
        </h3>
        <p className="text-sm text-muted-foreground">
          Logs are stored locally in the browser. Exported files are saved to your Downloads folder.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => handleExport("json")}>
            Export JSON
          </Button>
          <Button variant="outline" onClick={() => handleExport("csv")}>
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => handleExport("html")}>
            Export HTML
          </Button>
          {!clearLogs.pending ? (
            <Button
              variant="outline"
              onClick={() =>
                clearLogs.requestConfirm("Are you sure? Press Clear Logs again to confirm.")
              }
            >
              Clear Logs
            </Button>
          ) : (
            <Button
              ref={clearLogsRef}
              variant="outline"
              className="border-destructive text-destructive"
              onClick={clearLogs.confirm}
            >
              Confirm Clear Logs
            </Button>
          )}
        </div>
      </section>

      {/* Reset — two-step confirm to prevent accidentally wiping log level, */}
      {/* server URL, and stream toggle in one click. Wrapped in its own     */}
      {/* section landmark so region-hopping screen-reader users can jump    */}
      {/* to it instead of skipping past a stray button at the root level.   */}
      <section aria-labelledby="logging-reset-heading" className="space-y-4">
        <h3 id="logging-reset-heading" className="sr-only">
          Reset
        </h3>
        {!loggingReset.pending ? (
          <Button
            variant="outline"
            onClick={() =>
              loggingReset.requestConfirm(
                "Are you sure? Press Reset Logging Settings again to confirm.",
              )
            }
          >
            Reset Logging Settings
          </Button>
        ) : (
          <Button ref={loggingResetRef} variant="destructive" onClick={loggingReset.confirm}>
            Confirm Reset Logging Settings
          </Button>
        )}
      </section>
    </div>
  );
}
