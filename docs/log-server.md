# Log server

`@oriole/log-server` is a development-only Node CLI that receives log entries from the extension over WebSocket, persists them per session, and serves a small accessible React UI over HTTP.

It exists because Chrome's service-worker DevTools console is awkward to use with a screen reader; the log-server gives screen-reader-friendly real-time visibility.

## CLI

```sh
pnpm log-server:dev                         # tsx, no build required
pnpm log-server                             # build then run dist/bin.js

oriole-log-server [options]
  --port <n>                  default 8089
  --host <ip>                 default 127.0.0.1 (localhost only)
  --buffer-size <n>           in-memory ring buffer for replay (default 1000)
  --log-dir <path>            session storage directory (default ./logs)
  --max-sessions <n>          rotation cap (default 50)
```

Built on `commander`. The CLI parses options, opens the WebSocket + HTTP servers, and prints a startup line listing the URL and the log directory.

## Runtime shape

Four pieces cooperate at runtime:

1. The Oriole extension's `WebSocketTransport` sends JSON log entries to the log server.
2. `LogServer` in `ws-server.ts` receives them, tracks each client per-connection, and emits an `"entry"` event for the rest of the system.
3. `SessionStore` in `session-store.ts` listens for that event and appends the entry to a JSONL file on disk.
4. The HTTP API and the React web viewer (Express + `react-aria-components`) read from the session store. The viewer connects via HTTP for historical sessions and via WebSocket for live entries.

<details>
<summary>Visual flow</summary>

```text
oriole extension
      │ WebSocketTransport - JSON entry
      ▼
LogServer (ws-server.ts)              ┌───────────────────────┐
      │ emit("entry", e)              │ Per-connection client │
      ▼                               │ tracking              │
SessionStore (session-store.ts)       └───────────────────────┘
      │ append-only JSONL on disk
      ▼
HTTP API / web viewer (express + react-aria-components)
      <-- web viewer connects (HTTP for sessions, WS for live)
```

</details>

## WebSocket server

[`ws-server.ts`](../packages/log-server/src/ws-server.ts) opens a `ws.WebSocketServer` on the configured host and port. Three security surfaces:

- **Localhost bind by default.** The server listens on `127.0.0.1`. It's unreachable from other machines on the LAN. Operators can opt back into LAN exposure via `--host 0.0.0.0` if they want it.
- **Origin allowlist.** WebSockets are not subject to CORS, so a malicious page on `evil.com` could otherwise attempt to connect. `verifyClient` rejects upgrades from disallowed origins. Allowed: no origin (Node ws / curl), same-origin loopback, `chrome-extension://` and `moz-extension://` (the extension's own transport). Anything else gets HTTP 403.
- **Payload cap.** `maxPayload: 1 MiB` (default ws is 100 MiB). Log entries should be small; an oversized message is either misuse or a deliberate DoS attempt.

Per-connection: tracks a client object with id, browser, version, connect time. Listens for `message` events, parses each frame as JSON, validates against the entry schema, and emits an `entry` event for the rest of the system. Malformed JSON is logged at WARN and the frame is dropped - the connection stays open.

The server holds an in-memory ring buffer of the last `bufferSize` entries (default 1000). New clients receive a replay of the buffer on connect so they see recent activity rather than a blank screen.

## Session store

[`session-store.ts`](../packages/log-server/src/session-store.ts) writes every entry to an append-only JSONL file. Sessions are keyed by ISO timestamp; one session corresponds to one run of the log-server (or one wake of the extension's WebSocket transport).

Operations:

- `append(entry)` - line-write to the current session file.
- `listSessions()` - returns metadata for all stored sessions, sorted newest-first.
- `loadSession(id, opts?)` - streams entries back, optionally with `level`, `since`, and `until` filters.
- `clear(id)` - delete a session file. Used by the "Clear" UI.

Path-traversal guard: `loadSession` resolves the requested path and asserts it starts with the configured `log-dir`. Without this guard, a crafted session id like `../../../etc/passwd` would read arbitrary files.

Per-line try/catch around JSON parsing, so a single corrupt line doesn't break the load - the bad line gets logged at WARN and skipped.

Rotation: when session count exceeds `maxSessions`, the oldest session files get deleted. The newest `maxSessions` are kept.

## HTTP API

Three routes:

- `GET /` - serves the built web viewer (HTML + JS + CSS).
- `GET /api/sessions` - JSON list of session metadata.
- `GET /api/sessions/:id` - JSONL stream of session entries with optional `level`, `since`, `until` query params.

Express. Routes are added in `bin.ts` after the WS server is up.

## Web viewer

The viewer at `http://localhost:8089` is a small React app using `react-aria-components`. It connects to the log-server's WebSocket for live entries and calls the HTTP API to list and load historical sessions.

Components:

- **LogTable** - plain HTML `<table>` with native NVDA navigation (Ctrl+Alt+Arrow). Sortable headers via `<button>` inside `<th>` with `aria-sort`. `<caption>` for an accessible name. Per-row Show/Hide button toggles a sibling `<section>` carrying the expanded entry details - keeping the table strictly rectangular for assistive tech.
- **StatusBar** - connection indicator (`role="status"`), auto-scroll toggle (off by default), export button.
- **SearchBar** - debounced search input with result-count announcement (250 ms).
- **LevelFilter** - checkbox group filtering by `LogLevel`.
- **SessionPicker** - dropdown listing live + historical sessions. Switching announces with assertive priority.

Skip links: "Skip to main content" and "Skip past log table" so a user with hundreds of rows doesn't have to Tab through every Show/Hide button to reach the section after the table.

Live announcements are routed through a 200 ms throttle queue (`web/lib/announce.ts`) so a burst of sort + filter + count announcements collapses into one polite announcement instead of NVDA cancelling each in turn.

Live entries cap at 10,000 to prevent unbounded React state growth. Older entries fall out FIFO-style; users who need older data switch to a historical session.

## Build

Source layout under `packages/log-server/`:

- `src/`:
  - `bin.ts` - CLI entry point.
  - `cli.ts` - commander setup.
  - `ws-server.ts` - `WebSocketServer` plus the `verifyClient` origin allowlist.
  - `session-store.ts` - JSONL persistence.
  - `format.ts` - terminal output formatter (screen-reader friendly).
  - `file-writer.ts` - disk writes.
  - `types.ts`.
  - `web/` - the React viewer (`app.tsx` plus `components/`).
- `vite.config.ts` - CLI bundle config.
- `vite.web.config.ts` - web viewer bundle config.

<details>
<summary>Visual tree</summary>

```text
packages/log-server/
├── src/
│   ├── bin.ts              # CLI entry point
│   ├── cli.ts              # commander setup
│   ├── ws-server.ts        # WebSocketServer + verifyClient
│   ├── session-store.ts    # JSONL persistence
│   ├── format.ts           # terminal output formatter (screen-reader friendly)
│   ├── file-writer.ts      # disk writes
│   ├── types.ts
│   └── web/                # React viewer
│       ├── app.tsx
│       └── components/...
├── vite.config.ts          # CLI bundle
└── vite.web.config.ts      # web viewer bundle
```

</details>

`pnpm build` produces both bundles. `pnpm log-server` runs the CLI bundle; the CLI bundle serves the web bundle as static files.

## Test coverage

64 tests under `packages/log-server/__tests__/`. Highlights:

- `ws-server.test.ts` - connection accept/reject (origin allowlist), payload cap, buffer replay, malformed JSON handling.
- `session-store.test.ts` - append + load round-trip, path-traversal rejection, malformed JSONL recovery, rotation.
- `format.test.ts` - terminal formatter cases (severity colours, ordinal date, on/at separators).
- `web/lib/announce.test.ts` - burst collapsing, separate-window behaviour, assertive bypass.

The tests run under Node with mocked WebSockets where end-to-end coverage isn't needed; a few use a real `ws` server on an ephemeral port for the upgrade-rejection cases.
