#!/usr/bin/env node
/**
 * CLI entry point for oriole-log-server.
 * Parses process.argv and delegates to {@link startServer}. Failures
 * during startup print to stderr and exit with a non-zero code so
 * shell wrappers and CI runners can detect them — without the catch
 * block, an unhandled promise rejection would only print a Node
 * warning and the process would still exit 0.
 */
import { parseCliArgs, startServer } from "./cli.js";

const options = parseCliArgs(process.argv.slice(2));
startServer(options).catch((error: unknown) => {
  console.error(
    "oriole-log-server failed to start:",
    error instanceof Error ? error.message : String(error),
  );
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
