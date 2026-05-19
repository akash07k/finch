# oriole-extension

The WXT browser extension. The repository root has the project README, contributing guide, and license - see [`../README.md`](../README.md).

## Layout

| Directory        | Purpose                                               |
| ---------------- | ----------------------------------------------------- |
| `config/`        | Tunables (defaults, theme registry, event defaults)   |
| `core/`          | Module system, message bus, settings store, messaging |
| `modules/`       | Feature modules (only sound-engine so far)            |
| `entrypoints/`   | Background, popup, options, offscreen                 |
| `shared/`        | A11y utilities, platform detection                    |
| `components/`    | shadcn/ui components                                  |
| `public/`        | Icons, sound files (theme assets)                     |
| `store-listing/` | Copy uploaded to Chrome Web Store and Firefox AMO     |
| `scripts/`       | Local helpers (postinstall, submit)                   |

## Local development

```sh
pnpm dev            # both browsers concurrently (labelled output)
pnpm dev:chrome     # Chrome only
pnpm dev:firefox    # Firefox only

pnpm build          # build both browsers
pnpm build:chrome   # Chrome only
pnpm build:firefox  # Firefox only

pnpm zip            # zip both browsers (chrome + firefox + sources)
pnpm zip:chrome     # Chrome zip into .output/
pnpm zip:firefox    # Firefox zip + sources zip
```

## Browser support

Chrome 140 or later (MV3, service worker). Firefox 142 or later (MV2, background page).

## Submission

Day-to-day, you don't run the submission scripts directly - `pnpm release` plus `git push --follow-tags` triggers the CI workflow that submits to the stores. These scripts are here for local debugging:

```sh
pnpm submit:init      # one-time: write .env.submit with store credentials
pnpm submit:dry-run   # verify credentials, no real submission
pnpm submit           # submit to both stores
pnpm submit:chrome    # submit Chrome Web Store only
pnpm submit:firefox   # submit Firefox AMO only
```

See the contributing guide and the WXT publishing docs for credential setup.
