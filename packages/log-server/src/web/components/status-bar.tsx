import {
  Button,
  Checkbox,
  Select,
  SelectValue,
  Label,
  Popover,
  ListBox,
  ListBoxItem,
  type Key,
} from "react-aria-components";
import { VisuallyHidden } from "react-aria";
import { enqueueAnnounce } from "../lib/announce.js";
import type { LogEntry } from "../../types.js";

interface SessionInfo {
  filename: string;
  startedAt: string;
  entryCount: number;
}

interface StatusBarProps {
  connected: boolean;
  autoScroll: boolean;
  onAutoScrollChange: (value: boolean) => void;
  entries: LogEntry[];
  onReconnect: () => void;
  sessions: SessionInfo[];
  currentSessionFile: string | null;
  selectedSession: string;
  onSessionChange: (key: string) => void;
  isLiveSession: boolean;
}

function formatSessionDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const day = d.getDate();
    const suffix =
      day % 10 === 1 && day !== 11
        ? "st"
        : day % 10 === 2 && day !== 12
          ? "nd"
          : day % 10 === 3 && day !== 13
            ? "rd"
            : "th";
    const month = d.toLocaleString("en-US", { month: "long" });
    const hours = d.getHours() % 12 || 12;
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const ampm = d.getHours() >= 12 ? "PM" : "AM";
    return `${day}${suffix} ${month}, ${d.getFullYear()} at ${hours}:${minutes} ${ampm}`;
  } catch {
    return isoString;
  }
}

/** Connection status bar with reconnect, session selection, auto-scroll toggle, and log export. */
export function StatusBar({
  connected,
  autoScroll,
  onAutoScrollChange,
  entries,
  onReconnect,
  sessions,
  currentSessionFile,
  selectedSession,
  onSessionChange,
  isLiveSession,
}: StatusBarProps) {
  const handleAutoScrollChange = (isSelected: boolean) => {
    onAutoScrollChange(isSelected);
    enqueueAnnounce(isSelected ? "Auto-scroll enabled" : "Auto-scroll paused");
  };

  const handleSessionSelect = (key: Key | null) => {
    if (key !== null) onSessionChange(String(key));
  };

  const handleExport = (format: "json" | "csv" | "html") => {
    /** Escape HTML special characters to prevent XSS in exported files. */
    const esc = (s: string): string =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    let content: string;
    let mimeType: string;
    let extension: string;

    if (format === "json") {
      content = JSON.stringify(entries, null, 2);
      mimeType = "application/json";
      extension = "json";
    } else if (format === "csv") {
      const header = "id,timestamp,level,tag,message";
      const rows = entries.map((e) =>
        [e.id, e.timestamp, e.level, e.tag, `"${e.message.replace(/"/g, '""')}"`].join(","),
      );
      content = [header, ...rows].join("\n");
      mimeType = "text/csv";
      extension = "csv";
    } else {
      content = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Log Export</title></head><body><table><thead><tr><th>Timestamp</th><th>Level</th><th>Tag</th><th>Message</th></tr></thead><tbody>${entries.map((e) => `<tr><td>${esc(e.timestamp)}</td><td>${esc(String(e.level))}</td><td>${esc(e.tag)}</td><td>${esc(e.message)}</td></tr>`).join("")}</tbody></table></body></html>`;
      mimeType = "text/html";
      extension = "html";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finch-logs.${extension}`;
    a.click();
    URL.revokeObjectURL(url);

    enqueueAnnounce(`Exported ${entries.length} entries as ${format.toUpperCase()}`);
  };

  // Build session list: filter out current session (it's shown as "live")
  const previousSessions = sessions.filter((s) => s.filename !== currentSessionFile);

  return (
    <div className="status-bar">
      {/* Hidden heading so NVDA H-key navigation reaches this region    */}
      {/* without visual duplication. The visible connection-state span  */}
      {/* below provides the live status text.                            */}
      <VisuallyHidden elementType="h3">Connection status and session</VisuallyHidden>
      <span
        role="status"
        aria-live="polite"
        className={connected ? "status-connected" : "status-disconnected"}
      >
        {connected ? "Connected" : "Disconnected"}
      </span>

      {/* Always render so focus doesn't jump to body if the user is on */}
      {/* this button at the moment the socket reconnects. Disabled      */}
      {/* state keeps it in the Tab order but non-activatable.           */}
      <Button isDisabled={connected} onPress={onReconnect}>
        Reconnect
      </Button>

      <Select selectedKey={selectedSession} onSelectionChange={handleSessionSelect}>
        <Label>Session</Label>
        <Button>
          <SelectValue />
        </Button>
        <Popover>
          <ListBox>
            <ListBoxItem id="live" textValue="Current session, live">
              Current Session (Live)
            </ListBoxItem>
            {previousSessions.map((s) => (
              <ListBoxItem
                key={s.filename}
                id={s.filename}
                textValue={`Session from ${formatSessionDate(s.startedAt)}, ${s.entryCount} entries`}
              >
                {formatSessionDate(s.startedAt)} — {s.entryCount} entries
              </ListBoxItem>
            ))}
          </ListBox>
        </Popover>
      </Select>

      {isLiveSession && (
        <Checkbox isSelected={autoScroll} onChange={handleAutoScrollChange}>
          Auto-scroll to new entries
        </Checkbox>
      )}

      {/* role="group" with a group label so SRs announce "Export logs  */}
      {/* group, Export JSON button" instead of three disconnected       */}
      {/* Export buttons with no relationship cue.                        */}
      <div role="group" aria-label="Export logs">
        <Button onPress={() => handleExport("json")}>Export JSON</Button>
        <Button onPress={() => handleExport("csv")}>Export CSV</Button>
        <Button onPress={() => handleExport("html")}>Export HTML</Button>
      </div>
    </div>
  );
}
