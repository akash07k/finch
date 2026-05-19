import { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { VisuallyHidden } from "react-aria";
import type { LogEntry } from "../types.js";
import { StatusBar } from "./components/status-bar.js";
import { SearchBar } from "./components/search-bar.js";
import { LevelFilter } from "./components/level-filter.js";
import { LogTable } from "./components/log-table.js";
import { enqueueAnnounce, announceAssertive } from "./lib/announce.js";

const ALL_LEVELS = [0, 1, 2, 3, 4];
const RECONNECT_DELAY = 2000;
/**
 * How often the viewer announces "N new log entries received" while the
 * live feed is streaming. At 3 seconds (the original default) a user
 * trying to read any entry would be interrupted roughly every few lines
 * — too chatty for a quiet reading pass. 10 seconds is calm enough for
 * extended reading and still frequent enough that a user knows they're
 * seeing the live feed.
 *
 * Kept as a module constant rather than a user setting: exposing this
 * in the UI would require wiring a new control through StatusBar, and
 * the right value is not really user-specific. Revisit if users ask.
 */
const ENTRY_ANNOUNCE_INTERVAL = 10_000;
/**
 * Maximum number of live log entries the React state retains. Newer
 * entries push older ones out FIFO. Without this cap, a long-running
 * viewer accumulates the entire session — at ~1 entry/sec that's
 * 3,600 entries per hour, and the array spread on every push becomes
 * an O(n) cost per message.
 *
 * 10,000 entries ≈ ~10 MB of JS object memory for typical entry sizes
 * and several hours of typical session length. Users who need older
 * data can switch to a historical session via the Session selector.
 */
const MAX_LIVE_ENTRIES = 10_000;

interface SessionInfo {
  filename: string;
  startedAt: string;
  entryCount: number;
}

function App() {
  const [liveEntries, setLiveEntries] = useState<LogEntry[]>([]);
  const [historicalEntries, setHistoricalEntries] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState("");
  const [enabledLevels, setEnabledLevels] = useState<number[]>(ALL_LEVELS);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([
    "id",
    "date",
    "time",
    "level",
    "tag",
    "message",
    "details",
  ]);
  // Default OFF so the DOM does not mutate under a screen reader's
  // virtual cursor while the user is reading. Sighted users who want
  // tail-style scrolling can toggle the checkbox in the StatusBar.
  // See docs/decisions.md for the rationale.
  const [autoScroll, setAutoScroll] = useState(false);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSessionFile, setCurrentSessionFile] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string>("live");
  const wsRef = useRef<WebSocket | null>(null);
  const newEntryCountRef = useRef(0);

  const isLiveSession = selectedSession === "live";

  // Fetch and refresh session list
  useEffect(() => {
    let cancelled = false;

    async function loadSessions() {
      try {
        const res = await fetch("/api/sessions");
        const data = await res.json();
        if (!cancelled) {
          setSessions(data.sessions);
          setCurrentSessionFile(data.currentSession);
        }
      } catch {
        // Server might not be ready yet
      }
    }

    loadSessions();
    const timer = setInterval(loadSessions, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // WebSocket connection with reconnect
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}`;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        // No imperative announce — the visible role="status" region in
        // StatusBar mirrors the `connected` state and announces itself
        // when the text changes. Firing both produced duplicate
        // out-of-order announcements.
      };

      ws.onmessage = (event) => {
        try {
          const entry = JSON.parse(event.data as string) as LogEntry;
          setLiveEntries((prev) => {
            const next = [...prev, entry];
            // FIFO trim: keep only the most recent MAX_LIVE_ENTRIES.
            // slice() returns a new array so React detects the change.
            return next.length > MAX_LIVE_ENTRIES
              ? next.slice(next.length - MAX_LIVE_ENTRIES)
              : next;
          });
          newEntryCountRef.current++;
        } catch {
          // Ignore invalid messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!disposed) {
          // Same as onopen — the StatusBar's role="status" region
          // announces "Disconnected" when the text flips. No imperative
          // announce needed.
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
        }
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [reconnectTrigger]);

  // Batch announce new entries (only for live session)
  useEffect(() => {
    if (!isLiveSession) return;

    const timer = setInterval(() => {
      const count = newEntryCountRef.current;
      if (count > 0) {
        enqueueAnnounce(`${count} new log ${count === 1 ? "entry" : "entries"} received`);
        newEntryCountRef.current = 0;
      }
    }, ENTRY_ANNOUNCE_INTERVAL);

    return () => clearInterval(timer);
  }, [isLiveSession]);

  const handleReconnect = () => {
    wsRef.current?.close();
    setReconnectTrigger((n) => n + 1);
  };

  const handleSessionChange = async (key: string) => {
    setSelectedSession(key);

    if (key === "live") {
      setHistoricalEntries([]);
      enqueueAnnounce("Switched to live session");
      return;
    }

    enqueueAnnounce("Loading historical session");
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(key)}`);
      const data = await res.json();
      setHistoricalEntries(data.entries);
      const session = sessions.find((s) => s.filename === key);
      const summary = session
        ? `Loaded session from ${session.startedAt} with ${data.entries.length} entries`
        : `Loaded session with ${data.entries.length} entries`;
      enqueueAnnounce(summary);
    } catch {
      // Genuine error — assertive is appropriate so the user hears it
      // even mid-screen-reader-speech.
      announceAssertive("Failed to load session");
      setSelectedSession("live");
    }
  };

  // Use live or historical entries based on session selection
  const activeEntries = isLiveSession ? liveEntries : historicalEntries;

  // Filter entries
  const filteredEntries = activeEntries.filter((entry) => {
    if (!enabledLevels.includes(entry.level)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        entry.message.toLowerCase().includes(q) ||
        entry.tag.toLowerCase().includes(q) ||
        (entry.error?.message.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  return (
    <>
      {/* Skip links — only visible when keyboard-focused. With hundreds */}
      {/* of potential tab stops inside the table (sort buttons + one    */}
      {/* Details button per row) a user who just wants to read entries  */}
      {/* or get past them to the export controls would otherwise spend  */}
      {/* dozens of Tab presses getting there. Both targets are anchors  */}
      {/* that already exist below.                                       */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <a href="#after-log-table" className="skip-link">
        Skip past log table
      </a>

      <header role="banner">
        <h1>Finch Log Viewer</h1>
        <StatusBar
          connected={connected}
          autoScroll={autoScroll}
          onAutoScrollChange={setAutoScroll}
          entries={filteredEntries}
          onReconnect={handleReconnect}
          sessions={sessions}
          currentSessionFile={currentSessionFile}
          selectedSession={selectedSession}
          onSessionChange={handleSessionChange}
          isLiveSession={isLiveSession}
        />
      </header>

      {/* `<section>`, not `<nav>`: this region contains filter controls, */}
      {/* not page navigation links. Using <nav> misleads assistive tech  */}
      {/* users into expecting a site-navigation landmark.                */}
      <section aria-label="Log controls" id="log-controls">
        <VisuallyHidden elementType="h2">Search and Filters</VisuallyHidden>
        <SearchBar
          value={search}
          onChange={setSearch}
          resultCount={filteredEntries.length}
          totalCount={activeEntries.length}
        />
        <LevelFilter enabledLevels={enabledLevels} onChange={setEnabledLevels} />
      </section>

      <main id="main-content">
        <VisuallyHidden elementType="h2" id="log-heading">
          Log Entries
        </VisuallyHidden>
        <LogTable
          entries={filteredEntries}
          totalCount={activeEntries.length}
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={setVisibleColumns}
          autoScroll={autoScroll && isLiveSession}
          isLiveSession={isLiveSession}
        />
        {/* Skip-past-table target. tabIndex={-1} makes it programmatically */}
        {/* focusable via hash nav but not in the Tab sequence.              */}
        <div id="after-log-table" tabIndex={-1} />
      </main>
    </>
  );
}

const root = document.getElementById("app");
if (root) {
  createRoot(root).render(<App />);
}
