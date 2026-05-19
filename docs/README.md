# Oriole documentation

In-depth design documentation for the codebase. Source-code TSDoc explains how individual classes work; these documents explain why each subsystem exists and how the parts fit together.

## Index

| Document                              | Audience                       | Covers                                                                                              |
| ------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| [Architecture](./architecture.md)     | New contributor                | Monorepo layout, module system, runtime contexts, boot sequence, build and release pipeline         |
| [Sound engine](./sound-engine.md)     | Anyone touching audio playback | Event registry, cooldown gate, priority preemption, theme manager, suppression model                |
| [Audio backends](./audio-backends.md) | Anyone touching audio playback | Chrome offscreen vs Firefox direct, the `AudioBackend` interface, `HowlerPlayer`, race fixes        |
| [Logger](./logger.md)                 | Anyone using the logger        | `@oriole/logger` core: dispatch, child loggers, transports (Console / IndexedDB / WebSocket)        |
| [Log server](./log-server.md)         | Tool operators                 | `@oriole/log-server` CLI, WebSocket and HTTP server, session storage, accessible React viewer       |
| [Decisions log](./decisions.md)       | Maintainers                    | One short entry per significant design choice, in reverse-chronological order                       |
| [Sound themes](./sound-themes.md)     | Theme authors                  | How to author a sound theme: manifest schema, fallback rules, sound design notes                    |

## Conventions

- Each document is self-contained. Use H2 headings to navigate with a screen reader's heading shortcut.
- Internal links are relative markdown so they work in any markdown renderer including the GitHub web UI.
- Where a doc cites a source line, the path is relative to the repository root with a line number, e.g. `extension/modules/sound-engine/cooldown-gate.ts:83`.

## Adding a new subsystem doc

1. Add a markdown file in `docs/` named after the subsystem.
2. Link it from this index table.
3. If the change affects an existing decision, add a short entry to [`decisions.md`](./decisions.md).
4. Keep TSDoc in source for what the code does; keep markdown here for why and how.
