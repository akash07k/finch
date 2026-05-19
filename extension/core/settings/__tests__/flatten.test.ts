import { describe, it, expect } from "vitest";
import { flattenSettings } from "../flatten.js";

describe("flattenSettings", () => {
  it("returns {} for an empty object", () => {
    expect(flattenSettings({})).toEqual({});
  });

  it("returns {} for non-object roots without a prefix", () => {
    expect(flattenSettings(42)).toEqual({});
    expect(flattenSettings("hello")).toEqual({});
    expect(flattenSettings(null)).toEqual({});
    expect(flattenSettings(undefined)).toEqual({});
  });

  it("flattens a single-level object", () => {
    expect(flattenSettings({ a: 1, b: "x", c: true })).toEqual({
      a: 1,
      b: "x",
      c: true,
    });
  });

  it("flattens nested objects with dot-notation paths", () => {
    expect(flattenSettings({ a: { b: { c: 42 } } })).toEqual({
      "a.b.c": 42,
    });
  });

  it("keeps arrays as leaves", () => {
    expect(flattenSettings({ list: [1, 2, 3] })).toEqual({
      list: [1, 2, 3],
    });
  });

  it("keeps null as a leaf value", () => {
    expect(flattenSettings({ a: null })).toEqual({ a: null });
  });

  it("handles a mix of nested objects, arrays, and primitives", () => {
    expect(
      flattenSettings({
        general: { volume: 80, muted: false },
        themes: { customThemes: ["a", "b"] },
        sounds: { events: {} },
      }),
    ).toEqual({
      "general.volume": 80,
      "general.muted": false,
      "themes.customThemes": ["a", "b"],
    });
  });

  it("includes keys that contain dots and colons (hotkey bindings)", () => {
    expect(
      flattenSettings({
        hotkeys: {
          bindings: {
            "global:toggle-mute": "Alt+M",
            "global:open-options": "Alt+Shift+C",
          },
        },
      }),
    ).toEqual({
      "hotkeys.bindings.global:toggle-mute": "Alt+M",
      "hotkeys.bindings.global:open-options": "Alt+Shift+C",
    });
  });

  it("respects the prefix argument", () => {
    expect(flattenSettings({ a: 1, b: 2 }, "root")).toEqual({
      "root.a": 1,
      "root.b": 2,
    });
  });

  it("does NOT descend into class instances (only plain objects)", () => {
    class NotPlain {
      x = 1;
    }
    const instance = new NotPlain();
    expect(flattenSettings({ wrapped: instance })).toEqual({
      wrapped: instance,
    });
  });
});
