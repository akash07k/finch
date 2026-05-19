import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

/**
 * Vitest configuration for the Oriole extension.
 *
 * WxtVitest() provides browser API polyfilling via fakeBrowser,
 * applies Vite config from wxt.config.ts, configures path aliases,
 * and sets up import.meta.env.BROWSER / MANIFEST_VERSION globals.
 */
export default defineConfig({
  plugins: [WxtVitest()],
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
