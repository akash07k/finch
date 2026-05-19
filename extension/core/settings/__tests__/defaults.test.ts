import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../defaults.js";

describe("DEFAULT_SETTINGS", () => {
  describe("general", () => {
    it("has master volume between 0 and 100", () => {
      expect(DEFAULT_SETTINGS.general.masterVolume).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_SETTINGS.general.masterVolume).toBeLessThanOrEqual(100);
    });

    it("has a default theme", () => {
      expect(DEFAULT_SETTINGS.general.activeTheme).toBe("pulse");
    });

    it("is not muted by default", () => {
      expect(DEFAULT_SETTINGS.general.muted).toBe(false);
    });

    it("defaults to INFO log level", () => {
      expect(DEFAULT_SETTINGS.general.logLevel).toBe(1);
    });

    it("has a default log server URL", () => {
      expect(DEFAULT_SETTINGS.general.logServerUrl).toMatch(/^ws:\/\//);
    });

    it("has sound-engine enabled by default", () => {
      expect(DEFAULT_SETTINGS.general.enabledModules).toContain("sound-engine");
    });
  });

  describe("sounds", () => {
    it("starts with empty event config", () => {
      expect(DEFAULT_SETTINGS.sounds.events).toEqual({});
    });
  });

  describe("themes", () => {
    it("starts with no custom themes", () => {
      expect(DEFAULT_SETTINGS.themes.customThemes).toEqual([]);
    });
  });

  describe("hotkeys", () => {
    it("has default bindings for global commands", () => {
      const bindings = DEFAULT_SETTINGS.hotkeys.bindings;

      expect(bindings["global:toggle-mute"]).toBeDefined();
      expect(bindings["global:toggle-mute-when-blurred"]).toBeDefined();
      expect(bindings["global:open-options"]).toBeDefined();
    });

    it("uses Alt modifier for global shortcuts", () => {
      const bindings = DEFAULT_SETTINGS.hotkeys.bindings;

      expect(bindings["global:toggle-mute"]).toMatch(/^Alt\+/);
      expect(bindings["global:open-options"]).toMatch(/^Alt\+/);
    });
  });
});
