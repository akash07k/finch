/**
 * @module settings/defaults
 *
 * Default values for all Oriole settings.
 *
 * These defaults are used when a setting has never been set by the user.
 * They represent the out-of-the-box experience — a sensible starting
 * point that works immediately without configuration.
 *
 * General settings are imported from the centralized config so
 * developers can tune ship-time defaults from a single file.
 */

import type { OrioleSettings } from "./types.js";
import { CONFIG } from "../../config/index.js";

/** Default values for all extension settings. */
export const DEFAULT_SETTINGS: OrioleSettings = {
  general: {
    masterVolume: CONFIG.settings.masterVolume,
    activeTheme: CONFIG.settings.activeTheme,
    muted: CONFIG.settings.muted,
    muteWhenBlurred: CONFIG.settings.muteWhenBlurred,
    logLevel: CONFIG.settings.logLevel,
    logStreamEnabled: CONFIG.settings.logStreamEnabled,
    logServerUrl: CONFIG.settings.logServerUrl,
    enabledModules: [...CONFIG.settings.enabledModules],
    showWhatsNewOnUpdate: CONFIG.settings.showWhatsNewOnUpdate,
  },

  sounds: {
    events: {},
  },

  themes: {
    customThemes: [],
  },

  hotkeys: {
    bindings: {
      // Global shortcuts — handled by browser.commands API, work from any tab
      "global:toggle-mute": "Alt+M",
      "global:toggle-mute-when-blurred": "Alt+Shift+M",
      "global:open-options": "Alt+Shift+R",
      // Local shortcuts — handled by hotkeys-js, work in popup/options UI
      "local:cycle-theme": "alt+t",
      "local:tab-general": "alt+1",
      "local:tab-sound-events": "alt+2",
      "local:tab-themes": "alt+3",
      "local:tab-logging": "alt+4",
      "local:show-help": "shift+/",
    },
  },
};
