# Contributing

This is a small codebase with a single primary maintainer. Most "contributions" are issue reports, theme submissions, or follow-up work after a published release. The notes below cover the workflow if you do want to send a PR.

## Setup

```sh
git clone https://github.com/akash07k/oriole.git
cd oriole
pnpm setup
```

Requires Node 20+ and pnpm 10+. `pnpm setup` does install + build the logger + wxt prepare. After that, `pnpm install` works for dep bumps.

To run the extension while developing:

```sh
cd extension
pnpm dev           # both browsers concurrently (labelled output, Ctrl+C kills both)
pnpm dev:chrome    # Chrome only
pnpm dev:firefox   # Firefox only
```

## Hard gates

Every commit must pass these four checks. They run locally on `pre-push` via lefthook and on every PR + push to main via the CI workflow:

| Gate          | Command             |
| ------------- | ------------------- |
| Typecheck     | `pnpm -r typecheck` |
| Test          | `pnpm -r test`      |
| Lint          | `pnpm lint`         |
| Markdown lint | `pnpm lint:md`      |

A `pre-commit` hook also runs `lint-staged` on changed files (eslint --fix, markdownlint-cli2 --fix, prettier --write) so most formatting fixes are automatic.

Don't bypass hooks with `--no-verify` unless you have a specific reason. CI runs the same gates so a bypass only delays the failure.

## Commit conventions

Conventional Commits, enforced by `@commitlint/config-conventional`:

```text
<type>(<scope>): <summary>

<body>
```

Types: `feat`, `fix`, `perf`, `refactor`, `chore`, `docs`, `style`, `test`, `build`, `ci`. The `feat`, `fix`, `perf`, and `revert` commits show up in the auto-generated CHANGELOG; the rest are filtered out.

The summary should be a sentence fragment in imperative mood, lowercase, no trailing period. Keep it under ~70 characters.

## Adding a new sound event

The event registry is at `extension/modules/sound-engine/event-registry.ts`. To add an event:

1. Pick the right tier (1 = essential / on by default; 2 = useful / opt-in; 3 = advanced / hidden).
2. Add a new `EventDefinition` entry with the WebExtension API path, an id, label, description, and any per-event filter or extractData function.
3. If it's tier 1, also add the event id to `EVENT_DEFAULTS` with `enabled: true` (a contract test enforces "tier 1 == default-enabled").
4. Add a sound mapping for the event id in every built-in `theme.json` under `extension/public/sounds/<theme>/`. A contract test enforces this for default-enabled events.

See [`docs/sound-engine.md`](./docs/sound-engine.md) for the full event model, including priority, filter, handler, and extractData.

## Adding a new sound theme

See [`docs/sound-themes.md`](./docs/sound-themes.md). The contract is: every default-enabled event must have a direct mapping in your `theme.json`, and the theme must be registered in `extension/config/themes.ts`.

## Decisions log

If a change introduces a new pattern, deviates from an existing one, or closes a non-obvious bug with a tradeoff worth recording, add a short entry to [`docs/decisions.md`](./docs/decisions.md) in the same PR. Two or three plain-prose sentences is enough; no template required.

Entries are reverse-chronological (newest first).

## Cutting a release

The release flow is automated by [release-it](https://github.com/release-it/release-it) with the conventional-changelog plugin. Configuration is in [`extension/.release-it.json`](./extension/.release-it.json).

```sh
pnpm release:dry                 # preview bump and CHANGELOG entry
pnpm release                     # bump, write CHANGELOG, signed commit + signed tag
git push --follow-tags origin main
# OR equivalent shortcut:
pnpm release:push                # same `git push --follow-tags origin main`
# OR one-shot (release + push together):
pnpm do-release
```

`pnpm release` runs the four gates first (typecheck, test, lint, lint:md), so a failing gate prevents the bump. The tag push fires `.github/workflows/release.yml`, which verifies the tag matches `extension/package.json`'s version, runs the gates again, builds and zips both browsers, and submits to the Chrome Web Store and Firefox AMO. It also creates a GitHub Release with the Chrome zip, Firefox zip, and sources zip attached.

`pnpm release` does not push automatically (`git.push: false` in the config) — that's deliberate so you review the local commit and tag before they go to origin. Two shortcuts coexist with the manual `git push --follow-tags`:

- `pnpm release:push` runs only the push (use after a `pnpm release` if you've reviewed and want to ship).
- `pnpm do-release` chains `pnpm release && pnpm release:push` for the case where you trust the conventional-commits bump and want to skip the review pause. The pre-push lefthook still runs gates a second time before the push goes out.

If conventional-commits picks the wrong bump, override:

```sh
pnpm release -- --release-as minor
```

If you need to abort mid-flow, release-it prompts before each destructive step. If the local commit and tag are already created and you decide not to ship, `git tag -d v<x.y.z>` and `git reset --hard HEAD~1` undo them.

CHANGELOG entries below v1.1.1 are hand-written. Everything from v1.1.1 onward is generated. Don't hand-edit auto-generated entries; if the wording is wrong, fix the conventional-commit message instead.

### Re-submitting after a store rejection

The GitHub Release page is created on the original tag push and is independent of store-submission outcome, so a partial failure (one store accepted, the other rejected) still produces a Release with the sideloadable zips. To resubmit just the failing store after a rejection clears, dispatch [`.github/workflows/release.yml`](https://github.com/akash07k/oriole/actions/workflows/release.yml) manually with **target** set to `chrome` or `firefox`. The default `both` matches the tag-triggered behaviour.

## Testing conventions

- Vitest everywhere. Logger and log-server run in Node; extension runs in jsdom.
- Tests live in `__tests__/` next to source.
- Browser globals (`browser.*`, `chrome.*`, `fetch`) are mocked per-test, not globally.
- Contract tests guard cross-cutting invariants. Add one when a new invariant emerges.
- Regression tests cite the commit that fixed the bug.

## One more thing

This project's user base is dominated by NVDA and VoiceOver users. Accessibility isn't decorative; if you're touching UI, the popup or options page should be navigable end to end with a screen reader, and the new flow should work without sight. Live-region announcements should be polite by default and assertive only for errors.
