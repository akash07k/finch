// Store submission helper. Resolves the zip paths under .output/ and
// hands them to `wxt submit` with the correct flags.
//
// Usage (from extension/):
//     pnpm submit:init       # one-time: writes .env.submit with store credentials
//     pnpm zip               # produce both browsers' zips (and the Firefox sources zip)
//     pnpm submit:dry-run    # verify credentials without sending anything
//     pnpm submit            # submit to both stores
//     pnpm submit:chrome     # submit Chrome only
//     pnpm submit:firefox    # submit Firefox only
//
// The .output/ zip filenames embed the extension name and version
// (e.g. finch-extension-1.0.0-chrome.zip), so hardcoding
// paths in package.json would need a manual edit on every version
// bump. Node's readdir + filter avoids a shell-glob dependency that
// breaks on Windows cmd.
//
// Per-browser flags:
//     --chrome-only     skip the Firefox zip lookups, pass only --chrome-zip
//     --firefox-only    skip the Chrome zip lookup, pass only Firefox flags
// Any other args are forwarded to `wxt submit` unchanged, so
// `--dry-run` from `submit:dry-run` keeps working alongside either
// per-browser flag.

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const OUTPUT_DIR = ".output";

function fail(msg) {
  // process.stderr.write instead of console.error so the script needs
  // only the one `process` import (keeps the lint config simple).
  process.stderr.write(`[submit] ${msg}\n`);
  process.exit(1);
}

let files;
try {
  files = readdirSync(OUTPUT_DIR);
} catch {
  fail(`${OUTPUT_DIR}/ not found — run \`pnpm zip\` and \`pnpm zip:firefox\` first.`);
}

function findOne(suffix) {
  const match = files.filter((f) => f.endsWith(suffix));
  if (match.length === 0) {
    fail(`no ${suffix} under ${OUTPUT_DIR}/. Run the appropriate zip command first.`);
  }
  if (match.length > 1) {
    fail(
      `multiple ${suffix} under ${OUTPUT_DIR}/ (${match.join(", ")}). Remove stale builds or pass explicit paths to \`wxt submit\`.`,
    );
  }
  return resolve(OUTPUT_DIR, match[0]);
}

const args = process.argv.slice(2);
const chromeOnly = args.includes("--chrome-only");
const firefoxOnly = args.includes("--firefox-only");

if (chromeOnly && firefoxOnly) {
  fail("Cannot pass both --chrome-only and --firefox-only.");
}

// Forward everything except our own flags to `wxt submit`.
const passthrough = args.filter((a) => a !== "--chrome-only" && a !== "--firefox-only");

const wxtArgs = ["wxt", "submit", ...passthrough];

if (!firefoxOnly) {
  wxtArgs.push("--chrome-zip", findOne("-chrome.zip"));
}
if (!chromeOnly) {
  wxtArgs.push("--firefox-zip", findOne("-firefox.zip"));
  wxtArgs.push("--firefox-sources-zip", findOne("-sources.zip"));
}

const result = spawnSync("pnpm", wxtArgs, { stdio: "inherit", shell: true });
process.exit(result.status ?? 0);
