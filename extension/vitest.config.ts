import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vitest configuration for the Finch extension.
 *
 * WxtVitest() provides browser API polyfilling via fakeBrowser,
 * applies Vite config from wxt.config.ts, configures path aliases,
 * and sets up import.meta.env.BROWSER / MANIFEST_VERSION globals.
 *
 * Explicit `root` ensures WXT finds entrypoints/ when vitest runs
 * from the monorepo root via the workspace project aggregator.
 */
export default defineConfig({
  plugins: [WxtVitest({ root: __dirname })],
  test: {
    globals: true,
    environment: "jsdom",
    include: [
      "core/**/__tests__/**/*.test.ts",
      "shared/**/__tests__/**/*.test.ts",
      "modules/**/__tests__/**/*.test.ts",
    ],
  },
});
