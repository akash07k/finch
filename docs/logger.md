# Logger

`@oriole/logger` is the structured logger used by the extension. It is a small, dependency-free package built around three primitives: a `Logger` interface, a `Transport` interface, and a default `LogEntry` shape.

Source layout under `packages/logger/src/`:

- `core/` - the `Logger`, `Transport`, `LogEntry`, `LogLevel` types in `types.ts` and the `LoggerImpl` in `logger.ts`.
- `transports/` - the three transport implementations: `console.ts` (`ConsoleTransport`), `indexed-db.ts` (`IndexedDBTransport` with rotation), `websocket.ts` (`WebSocketTransport` with backoff).
- `exporter/` - `exporter.ts` (`LogExporter` for JSON, CSV, HTML output).
- `index.ts` - the public API barrel.

<details>
<summary>Visual tree</summary>

```text
packages/logger/src/
├── core/
│   ├── types.ts         # Logger, Transport, LogEntry, LogLevel
│   └── logger.ts        # LoggerImpl
├── transports/
│   ├── console.ts       # ConsoleTransport
│   ├── indexed-db.ts    # IndexedDBTransport (rotation)
│   └── websocket.ts     # WebSocketTransport (backoff)
├── exporter/
│   └── exporter.ts      # LogExporter (JSON, CSV, HTML)
└── index.ts             # public API
```

</details>

## Logger and dispatch

`createLogger(config)` returns a `Logger`. The implementation:

- Filters by configured `level`. `LogLevel.DEBUG` < `INFO` < `WARN` < `ERROR` < `FATAL`. Entries below the configured level are dropped before any transport sees them.
- Dispatches to every transport in parallel. A transport's `log()` is async and may throw or return; errors are caught and logged via `console.error` so a faulty transport can't break the others.
- Provides `child(context)` that returns a new logger with merged `context`. Child contexts override parent keys on collision. The transport list is shallow-copied so `addTransport()` on a child does not leak to the parent.
- Provides `addTransport(transport)` to register a transport at runtime (the WebSocket transport is added this way, after the user opts in via the options page).
- Provides `flush()` and `dispose()`. `dispose()` is idempotent and short-circuits subsequent `log()` / `addTransport()` / `flush()` calls. Disposed transports never receive new entries.

`LogEntry` carries `id` (UUID), `timestamp` (ISO 8601 string), `level`, `tag`, `message`, optional `context`, and optional `error`. The id uses `crypto.randomUUID()` rather than `Date.now() + counter` to survive service-worker restarts without collisions.

## ConsoleTransport

A thin wrapper that maps `LogLevel` to `console.debug`, `info`, `warn`, `error`. Used in development for immediate visibility. The format is `[tag] message` with the entry serialised inline as a second argument so DevTools formats it as a structured object.

## IndexedDBTransport

Persists entries to `oriole-logs` (database name from `CONFIG.logger.idbName`). Rotation: when the entry count exceeds `CONFIG.logger.idbMaxEntries` (default 10,000), the oldest 10% are deleted. A `rotating` flag prevents concurrent rotate calls from racing each other during burst logging.

API:

- `log(entry)` - append.
- `query(opts)` - read entries with filters (level, time range, search). Used by the export feature.
- `clear()` - wipe the store. Used by the "Clear logs" button.
- `count()` - current entry count.

The transport opens its own IDB connection on `initialize()` and closes it on `dispose()`. Methods after dispose return early without touching the closed connection.

## WebSocketTransport

Forwards entries to a log server (`@oriole/log-server`) over WebSocket. The transport is opt-in: the extension only adds it after the user enables log streaming in the options page.

Behaviour:

- On connect, sends a small handshake identifying the extension (browser, version) so the server can group entries by client.
- While connected, every entry is sent immediately as JSON.
- While disconnected, entries buffer in a bounded ring buffer (`CONFIG.logger.wsBufferMax`, default 1,000). Older entries drop on overflow.
- On reconnect, the buffered entries flush in order before resuming live forwarding.
- Reconnect uses exponential backoff (1s, 2s, 4s, ..., capped at 30s) with jitter. The transport never gives up; it keeps trying until `dispose()`.

`flush()` warns when the buffer is discarded due to a permanently disconnected socket, instead of silently dropping entries.

## Public API

[`packages/logger/src/index.ts`](../packages/logger/src/index.ts) exports the surface:

- `Logger` (interface)
- `LogLevel` (enum)
- `LogEntry` (interface)
- `Transport` (interface)
- `createLogger` (factory)
- `ConsoleTransport`
- `IndexedDBTransport`
- `WebSocketTransport`
- `LogExporter`

The package is published as ESM with `.d.ts` types from `tsc` directly (the build uses `vite build` for the JS bundle plus a `tsc -p tsconfig.build.json` pass for type emission). The `package.json` `exports` field has `"types"` first so TypeScript under `moduleResolution: "bundler"` picks types over JS.

## LogExporter

Converts a `LogEntry[]` into JSON, CSV, or HTML. CSV escapes commas, quotes, and newlines per RFC 4180. HTML escapes `<`, `>`, `&`, `"` to prevent XSS in exported files. The HTML output uses semantic elements (`<table>`, `<thead>`, `<tbody>`) and a `<caption>` so it is readable in any browser including with a screen reader.

JSON exports include the full entry shape; CSV and HTML drop nested `context` and `error.stack` since those don't render usefully in tabular form (the JSON export carries them).

## Disposal semantics

`Logger.dispose()` awaits each transport's `dispose()` once. Subsequent `log()`, `addTransport()`, `flush()` calls are no-ops. Each transport's `dispose()` is responsible for releasing its own resources: closing the IDB connection, closing the WebSocket, etc.

The extension calls `logger.dispose()` from `runtime.onSuspend` (when the service worker is about to be unloaded). This guarantees pending entries flush before the worker dies.

## Test coverage

55 tests under `packages/logger/__tests__/`. Highlights:

- `core/logger.test.ts` - level filtering, child loggers, transport isolation, dispose idempotence.
- `transports/console.test.ts` - level-to-method mapping.
- `transports/indexed-db.test.ts` - rotation under burst load, query filters, concurrent-rotate guard.
- `transports/websocket.test.ts` - buffer overflow, reconnect backoff, flush semantics.
- `exporter/exporter.test.ts` - CSV escaping, HTML escaping (XSS test cases included), JSON round-trip.

`fake-indexeddb` provides the IDB implementation under Node. The WebSocket tests use a small mock server.
