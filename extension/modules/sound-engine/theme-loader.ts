/**
 * @module sound-engine/theme-loader
 *
 * Loads theme manifests into a ThemeManager. Extracted from
 * SoundEngineModule.initialize() so the loading mechanism is
 * independently testable and swappable (e.g., for IndexedDB-backed
 * custom themes in the future).
 */

import type { Logger } from "@oriole/logger";
import type { ThemeManager } from "./theme-manager.js";
import { BUILT_IN_THEMES } from "../../config/themes.js";
import { getAssetURL } from "../../shared/platform/url.js";

/** Loads all built-in themes via fetch and registers them with the ThemeManager. */
export async function loadBuiltInThemes(themeManager: ThemeManager, logger: Logger): Promise<void> {
  for (const theme of BUILT_IN_THEMES) {
    try {
      const themeUrl = getAssetURL(`${theme.path}/theme.json`);
      const response = await fetch(themeUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading theme: ${themeUrl}`);
      }
      const manifest = await response.json();
      const basePath = getAssetURL(theme.path);
      const result = themeManager.loadTheme(theme.id, manifest, basePath);

      if (result.success) {
        logger.info(`Theme loaded: ${theme.id}`);
      } else {
        logger.error(`Failed to validate ${theme.id} theme`, { errors: result.errors });
      }
    } catch (error) {
      logger.error(
        `Failed to load ${theme.id} theme`,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
