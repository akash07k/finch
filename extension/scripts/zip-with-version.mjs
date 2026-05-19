#!/usr/bin/env node
// Thin wrapper that runs `wxt zip` with an optional version override.
//
// Usage (from extension/):
//     pnpm zip:chrome              # uses version from package.json
//     pnpm zip:chrome 1.0.1        # overrides version to 1.0.1
//     pnpm zip:firefox 0.2.11      # overrides version to 0.2.11
//     pnpm zip 0.1.1               # both browsers with override
//
// The version is passed to WXT via the FINCH_VERSION environment
// variable, picked up by the build:manifestGenerated hook in
// wxt.config.ts.

import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const browsers = [];
let version;

for (const arg of args) {
  if (arg === "chrome" || arg === "firefox") {
    browsers.push(arg);
  } else if (/^\d+\.\d+\.\d+/.test(arg)) {
    version = arg;
  }
}

if (browsers.length === 0) {
  console.error("Usage: node scripts/zip-with-version.mjs <chrome|firefox|chrome firefox> [version]");
  process.exit(1);
}

const env = { ...process.env };
if (version) {
  env.FINCH_VERSION = version;
}

for (const browser of browsers) {
  const cmd =
    browser === "chrome"
      ? "node scripts/build-whats-new.mjs && wxt zip"
      : "node scripts/build-whats-new.mjs && wxt zip -b firefox";

  execSync(cmd, { stdio: "inherit", env });
}
