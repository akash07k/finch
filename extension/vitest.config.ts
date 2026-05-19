import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the Oriole extension.
 *
 * Uses jsdom environment for tests that need DOM APIs (a11y utilities).
 * Browser extension APIs (like chrome.*) are mocked in individual tests.
 */
export default defineConfig({
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
