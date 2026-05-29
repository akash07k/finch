# Changelog

All notable changes to Finch are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Finch adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are generated from [Conventional Commits](https://conventionalcommits.org) by `release-it`.

## 0.1.2 (2026-05-28)

The first public release of Finch.

Finch plays a short, distinct sound when something happens in your browser: a tab opens, a download finishes, a page loads, a bookmark is saved. It is built first for blind and low-vision users, and it is useful to anyone who wants to keep track of their browser without watching the screen.

Highlights:

- 65 browser events across three tiers, each with its own toggle, volume, pitch, and preview.
- The Pulse sound theme, tuned to sit quietly under a screen reader.
- Smart suppression so one click does not fire five sounds: a global cooldown, priority preemption for errors and finished page loads, and per-event debounce.
- Global shortcuts for mute (Alt+M), mute-when-unfocused (Alt+Shift+M), and opening options (Alt+I).
- No telemetry, no analytics, no network calls. Everything stays on your machine.
