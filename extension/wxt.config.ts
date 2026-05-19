import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

/**
 * WXT configuration for the Finch browser extension.
 *
 * WXT uses file-based entrypoints — each file in entrypoints/ becomes
 * a background script, popup, options page, content script, etc.
 * based on its name and export.
 *
 * Tailwind CSS is added via the Vite plugin since WXT manages Vite
 * internally (there's no separate vite.config.ts).
 *
 * @see https://wxt.dev/api/config.html
 */
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  zip: {
    // Firefox AMO requires source code for review. Since this is a monorepo
    // and the extension depends on @finch/logger (workspace package),
    // the sources zip must include the entire repo root — not just extension/.
    sourcesRoot: "..",
    excludeSources: [
      // Build outputs
      "dist/**",
      ".output/**",
      ".wxt/**",
      "coverage/**",
      // IDE / editor
      ".vscode/**",
      ".idea/**",
      // Scratch / temp
      "tmp/**",
      "docs/**",
    ],
  },
  manifest: {
    name: "Finch",
    description:
      "Hear your browser — audio cues for tabs, bookmarks, downloads, and navigation. A richer browsing experience for everyone.",
    homepage_url: "https://github.com/akash07k/finch",
    minimum_chrome_version: "140",
    // Persistent development key — keeps the Chrome extension ID stable
    // across unpacked loads. Remove before Chrome Web Store submission.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1NqktAGg2g7LgLqQiG1C6kX7DSm0vzBnIP6a2auEafDeirVw0viyCkYVyEwN9HvtN//mWb6cSMWWNjvvtGs0Uv/pJd1kEhRzv9akGlp6d4FyNtmeHjuwPgE+KmrjJh185kYIkv5IrvZfgCGTEaTsVzoYj33VlnCa4jTXPd5ljuclDn6exXyHk/ocflWYUh8a+J00D4y7JlYa31pJE1kx/RlZ2sGFysgILUjfbSUHa56gH8hUunKWocT3nkQqS19htKiO03jD+O7GpZJKXCYh8/Tjog2bERrp/+ycE9u8njKmC4iRoKIlVITWze3TghVlwfRrUEEiFw/r5ZIlkNjcSQIDAQAB",
    permissions: [
      "tabs",
      "bookmarks",
      "downloads",
      "webNavigation",
      "storage",
      "notifications",
      "idle",
      "offscreen", // Chrome-only; Firefox ignores unknown permissions
    ],
    // Permissions only needed by Tier 2 events that are off by default.
    // Listed here instead of `permissions` so a fresh install does not
    // ask for management / cookies / history up front. SoundEventsTab
    // requests the relevant one when the user enables an event that
    // needs it; see extension/shared/permissions/request.ts.
    optional_permissions: ["management", "cookies", "history"],
    commands: {
      "toggle-mute": {
        suggested_key: { default: "Alt+M" },
        description: "Toggle sound mute on/off",
      },
      "toggle-mute-when-blurred": {
        suggested_key: { default: "Alt+Shift+M" },
        description: "Toggle muting sounds when browser is unfocused",
      },
      "open-options": {
        suggested_key: { default: "Alt+Shift+I" },
        description: "Open Finch options page",
      },
    },
    browser_specific_settings: {
      gecko: {
        id: "{a6e584fb-ab9a-4299-8be4-9beb56d39a03}",
        strict_min_version: "142.0",
        // Required by Firefox AMO for new extensions (WXT types don't include it yet)
        ...({
          data_collection_permissions: {
            required: ["none"],
            techdata_collected: false,
            interactiondata_collected: false,
          },
        } as Record<string, unknown>),
      },
    },
  },
  hooks: {
    "build:manifestGenerated": (wxt, manifest) => {
      // Remove Chrome-only "offscreen" permission from Firefox builds
      if (wxt.config.browser === "firefox" && manifest.permissions) {
        manifest.permissions = manifest.permissions.filter((p) => p !== "offscreen");
      }

      // Strip the development key from production builds — the Chrome Web Store
      // assigns its own key, and rejects uploads that include one.
      if (wxt.config.mode === "production") {
        delete (manifest as Record<string, unknown>).key;
      }
    },
  },
});
