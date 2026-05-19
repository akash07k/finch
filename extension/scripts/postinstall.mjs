// Guarded postinstall for the extension.
//
// `wxt prepare` loads wxt.config.ts, which transitively imports
// `@oriole/logger`. That package's `exports` field resolves to
// `packages/logger/dist/index.js`, and that dist is produced by
// `pnpm build:logger` — NOT by `pnpm install`. On a fresh clone the
// dist doesn't exist yet, so an unguarded `wxt prepare` fails with
// "No exports main defined".
//
// The guard: skip silently if the logger hasn't been built. The user
// should run `pnpm setup` at the repo root to complete the initial
// setup (install → build:logger → wxt prepare). After that, plain
// `pnpm install` will find dist/ present and run this hook normally.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const loggerDist = "../packages/logger/dist/index.js";

if (!existsSync(loggerDist)) {
  // Silent skip — the fresh-clone path. `pnpm setup` will build the
  // logger and run `wxt prepare` explicitly.
  process.exit(0);
}

// Shell:true is needed so the `wxt` bin resolves from node_modules/.bin
// the same way an npm/pnpm script would. No user input is ever passed
// — the command and its args are hardcoded above.
const result = spawnSync("wxt", ["prepare"], { stdio: "inherit", shell: true });
process.exit(result.status ?? 0);
