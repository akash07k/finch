# Changelog

All notable changes to Oriole are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Oriole adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries below v1.1.1 are released by hand; everything from v1.1.1 onward is generated from [Conventional Commits](https://conventionalcommits.org) by `release-it`.

## [1.3.0](https://github.com/akash07k/oriole/compare/v1.2.1...v1.3.0) (2026-04-28)

### Features

- **commands:** add Alt+Shift+M shortcut to toggle mute-when-unfocused ([278d6d4](https://github.com/akash07k/oriole/commit/278d6d43e24269ddd70c27094dd5f47a6244f005))
- **general-tab:** add mute-when-unfocused toggle ([63dd2ec](https://github.com/akash07k/oriole/commit/63dd2ecf4ce1862c734e74a4e64b509530e6ef5c))
- **settings:** add muteWhenBlurred toggle to general settings ([ff99b0b](https://github.com/akash07k/oriole/commit/ff99b0b3405046705460805828fcc1f4d3be1612))
- **sound-engine:** expose focus state callback from window-focus router ([178763f](https://github.com/akash07k/oriole/commit/178763f651deacdd9eb7eb4760a0e51a41aeea84))
- **sound-engine:** mute hot path when browser is unfocused ([db9726e](https://github.com/akash07k/oriole/commit/db9726e56e3c4e8e667ac3d2f2169838fe5e333d))

# Changelog

All notable changes to Oriole are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Oriole adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries below v1.1.1 are released by hand; everything from v1.1.1 onward is generated from [Conventional Commits](https://conventionalcommits.org) by `release-it`.

## [1.2.1](https://github.com/akash07k/oriole/compare/v1.2.0...v1.2.1) (2026-04-28)

### Bug Fixes

- **background:** register onInstalled synchronously to dodge MV3 race ([cba30e4](https://github.com/akash07k/oriole/commit/cba30e46d67fb87fabe06b8c63e48e23b18e550f))
- **messaging:** trust by sender.id, not sender.tab ([89bdfee](https://github.com/akash07k/oriole/commit/89bdfee5d1d343f2b9bcab55ef734a1779718f40))
- **release-it:** bump root package.json and stage CHANGELOG before commit ([8cebc2c](https://github.com/akash07k/oriole/commit/8cebc2ce416de151daabc40f75edfe0f1a3672a1))
- **release:** read submission flags from secrets with sane defaults ([4976913](https://github.com/akash07k/oriole/commit/4976913396a1f2ff2e33dbe9bacc7a8a3c274f6d))
- **whats-new:** include version in document title ([b720256](https://github.com/akash07k/oriole/commit/b720256b44f8e1bac5f32bffacd53d493ec03765))

# Changelog

All notable changes to Oriole are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Oriole adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries below v1.1.1 are released by hand; everything from v1.1.1 onward is generated from [Conventional Commits](https://conventionalcommits.org) by `release-it`.

## [1.2.0](https://github.com/akash07k/oriole/compare/v1.1.0...v1.2.0) (2026-04-28)

### Features

- **release:** add release:push and do-release script shortcuts ([e29d9f2](https://github.com/akash07k/oriole/commit/e29d9f22564ff1cb50d74a77006824860e935f4a))
- **sound-engine:** split window focus event into focused and unfocused ([6f847aa](https://github.com/akash07k/oriole/commit/6f847aa99d61c229dca0d8d59391cd569298c79f))
- **whats-new:** handle markdown images and fenced code blocks ([dcda0bf](https://github.com/akash07k/oriole/commit/dcda0bf7aa6f6848ee5c3f6aec409c45783a1a16))

### Bug Fixes

- **error-boundary:** make stack trace keyboard-scrollable ([6b29cab](https://github.com/akash07k/oriole/commit/6b29cabe5fbb4bf3a3b398b7e2e41173465c0484))
- **log-server:** range-check level in isValidLogEntry ([5815a28](https://github.com/akash07k/oriole/commit/5815a281e07e993446ba65eaabd58f8e19adb877))
- **log-server:** remove duplicate static skip links from index.html ([d1baa24](https://github.com/akash07k/oriole/commit/d1baa24675eb9271bedfe53bd0f5c52715407225))
- **log-server:** use path.relative to detect traversal outside log dir ([31df7b5](https://github.com/akash07k/oriole/commit/31df7b51cfa6d804f83ad14f2099242c2bae3317))
- **log-server:** validate incoming WebSocket messages before broadcast ([f954802](https://github.com/akash07k/oriole/commit/f9548027f085d2fa5e6cc377e8a20f7d3ef90306))
- **logger:** await store-size probe before incrementing writeCount ([ce6b5ea](https://github.com/akash07k/oriole/commit/ce6b5eab3da78eb6eac2c5e5d4cc9ac00262a94b))
- **logger:** isolate child dispose from parent transports ([d6e468c](https://github.com/akash07k/oriole/commit/d6e468c0e7e4d1fdb9ac7f992d9814e13ff18773))
- **logger:** probe IndexedDB store size on transport init ([0b7caf9](https://github.com/akash07k/oriole/commit/0b7caf98256689ab5fd2d0abd0e4d450fc979a7a))
- **logger:** track parent so child loggers detect post-dispose state ([15be75c](https://github.com/akash07k/oriole/commit/15be75c7e4c8e8477016c6677f3dcf204d11fd41))
- **logging-tab:** apply two-step confirm to reset button ([1ed6491](https://github.com/akash07k/oriole/commit/1ed649193b33c58c4fe049628bf642f62131ac4e))
- **logging-tab:** handle sendMessage rejection when starting log stream ([83f65fe](https://github.com/akash07k/oriole/commit/83f65fe6c8d9504b15db3b3dc6161973b86d13f6))
- **logging-tab:** use stable polite live region for URL validation ([94852ca](https://github.com/akash07k/oriole/commit/94852ca316adb3232c1262b33b2c2b3ea4e446d5))
- **messaging:** reject runtime.onMessage from content scripts ([d988939](https://github.com/akash07k/oriole/commit/d9889398cb5636d168ea61a07f8563aa6c948634))
- **options-tabs:** wrap reset clusters in section landmarks ([afcd5c5](https://github.com/akash07k/oriole/commit/afcd5c5f6626260617fb3f0f122f33a65e2bd8c1))
- **options:** label version footer link for SR links list ([5521fa4](https://github.com/akash07k/oriole/commit/5521fa4bdf4242d5043dedd122d47bd826598cc7))
- **options:** make tab content region focusable for skip link ([f166669](https://github.com/akash07k/oriole/commit/f1666690e214e93f4754c23a46ff7e83af7ea463))
- **popup:** focus H1 on mount and clean up button aria-labels ([b165a42](https://github.com/akash07k/oriole/commit/b165a42bf597c717e4d66125131fac925440720d))
- **popup:** scope hotkeys filter to registered shortcuts only ([269eec9](https://github.com/akash07k/oriole/commit/269eec9dcc3f8b18f884c75ac9f4229cdd7c02e1))
- **release-it:** run lint at workspace root to dodge wxt's eslint v10 ([65b682c](https://github.com/akash07k/oriole/commit/65b682c119e7cc86a43801e7ebd434da5406bc85))
- **shortcut-recorder:** keep focus on input after cancel and capture ([6d94afa](https://github.com/akash07k/oriole/commit/6d94afaf707d44877d940c61a0c0cb01f3063f8d))
- **sound-engine:** cancel pending unfocus timer on dispose ([521649c](https://github.com/akash07k/oriole/commit/521649c071e02cf289e600f3a1223d0ed7da2719))
- **sound-events:** build updated config inside functional setter ([66812db](https://github.com/akash07k/oriole/commit/66812db0cd9f94b1decc86a3ba6d19a35d03d6eb))
- **sound-events:** fall back to defaults when reverting denied permission ([4afcc3d](https://github.com/akash07k/oriole/commit/4afcc3db8b28ae2d019a79335554388e46df571d))
- **sound-events:** fall back to defaults when storage entry is missing ([143d498](https://github.com/akash07k/oriole/commit/143d498c53805ac6c363d56c8fdb2ce38451bd21))
- **sound-events:** reset count announcement before tier change ([0d749aa](https://github.com/akash07k/oriole/commit/0d749aac22d0761a270b4cc571380a31f38dfb81))
- **sound-events:** tighten tier filter legend and add focus ring ([2648fc7](https://github.com/akash07k/oriole/commit/2648fc7e0441c1dfd194a7d15f260f3529cfd123))
- **sound-events:** use TableHead component for row header consistency ([0b35a21](https://github.com/akash07k/oriole/commit/0b35a21f91dcb32d91d659db92e1f961e9bdd6c7))
- **themes:** describe disabled import button via aria-describedby ([87a4196](https://github.com/akash07k/oriole/commit/87a4196641f6d9d445147c8a524c98ed0e360f90))
- **whats-new:** allowlist URL schemes to block javascript: ([d903839](https://github.com/akash07k/oriole/commit/d903839615425438c45a165bb50bf1045cafbf75))
- **whats-new:** block protocol-relative URLs in markdown converter ([6178af7](https://github.com/akash07k/oriole/commit/6178af7034d4a5d90222bb8c8663d6f2e287e630))
- **whats-new:** style generated prose with focus indicators ([8680483](https://github.com/akash07k/oriole/commit/8680483f2f8c652865b2bec000847a9ed998ad94))

### Performance

- **background:** hoist UI child logger out of message handler ([4b98dab](https://github.com/akash07k/oriole/commit/4b98dab4990a925765ccaa7e835bd90474a1bb7b))
- **background:** look up preview events via EVENT_REGISTRY_BY_ID ([23f4ab3](https://github.com/akash07k/oriole/commit/23f4ab3c333513439bfe9daaf032bc56191959e7))
- **sound-events:** query specific keys instead of full storage scan ([22eceab](https://github.com/akash07k/oriole/commit/22eceab582c698117595c48808fb35e34ac11c2d))

# Changelog

Notable user-facing changes. Versions before v1.1.1 are hand-written; v1.1.1 onward is generated by release-it from conventional commits.

## [1.1.0] - 2026-04-27

Initial public release.

Oriole plays short audio cues when things happen in your browser: a tab opens, a download finishes, a page loads, a bookmark gets added. The intended audience is screen-reader users, where visual cues are easy to miss. Sighted users can also use it to hear what the browser is doing without watching the screen.

64 browser events across three tiers, with 25 essential events enabled by default. Per-event volume, pitch, enable, and preview. One built-in sound theme (Pulse). Chrome (MV3) and Firefox (MV2) supported, requiring Chrome 140+ or Firefox 142+. No telemetry, no accounts, no third-party services; all settings stored in browser.storage.local.

Each GitHub release attaches Chrome and Firefox zips for sideloading.

[1.1.0]: https://github.com/akash07k/oriole/releases/tag/v1.1.0
