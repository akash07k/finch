#!/usr/bin/env node

// Workaround for @release-it/conventional-changelog on Windows.
//
// The plugin converts the header to CRLF via os.EOL, then tries to
// strip it from the existing CHANGELOG (which uses LF, enforced by
// prettier). The mismatch causes the header to be duplicated.
//
// This script runs after the plugin writes the CHANGELOG and:
//   1. Normalizes all line endings to LF
//   2. Removes any duplicate "# Changelog" header block

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const changelogPath = resolve(__dirname, "../../CHANGELOG.md");

let content = readFileSync(changelogPath, "utf-8");

content = content.replace(/\r\n/g, "\n");

const headerPattern = /^# Changelog\n\n[^\n]+\n/;
const match = content.match(headerPattern);
if (match) {
  const header = match[0];
  const afterFirstHeader = content.slice(header.length);
  content = header + afterFirstHeader.replace(header, "");
}

content = content.replace(/\n{3,}/g, "\n\n");

writeFileSync(changelogPath, content);
