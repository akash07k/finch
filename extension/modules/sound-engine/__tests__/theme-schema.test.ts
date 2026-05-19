import { describe, it, expect } from "vitest";
import { validateThemeManifest } from "../theme-schema.js";
import type { ThemeManifest } from "../theme-schema.js";

/** A valid theme manifest for testing. */
function validManifest(): ThemeManifest {
  return {
    name: "Subtle",
    description: "Soft clicks and gentle chimes.",
    author: "Finch",
    version: "1.0.0",
    mappings: {
      "tabs.onCreated": "tab-created.ogg",
      "tabs.onRemoved": "tab-closed.ogg",
    },
    fallbacks: {
      tier1: "generic-info.ogg",
      error: "generic-error.ogg",
    },
  };
}

describe("validateThemeManifest", () => {
  it("returns no errors for a valid manifest", () => {
    const errors = validateThemeManifest(validManifest());
    expect(errors).toHaveLength(0);
  });

  it("rejects non-object input", () => {
    const errors = validateThemeManifest("not an object");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("root");
  });

  it("rejects null input", () => {
    const errors = validateThemeManifest(null);
    expect(errors).toHaveLength(1);
  });

  it("requires name field", () => {
    const manifest = { ...validManifest(), name: "" };
    const errors = validateThemeManifest(manifest);
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  it("requires description field", () => {
    const manifest = { ...validManifest(), description: undefined };
    const errors = validateThemeManifest(manifest as unknown);
    expect(errors.some((e) => e.field === "description")).toBe(true);
  });

  it("requires author field", () => {
    const manifest = { ...validManifest(), author: 123 };
    const errors = validateThemeManifest(manifest as unknown);
    expect(errors.some((e) => e.field === "author")).toBe(true);
  });

  it("requires version field", () => {
    const manifest = { ...validManifest(), version: "" };
    const errors = validateThemeManifest(manifest);
    expect(errors.some((e) => e.field === "version")).toBe(true);
  });

  it("requires mappings to be an object", () => {
    const manifest = { ...validManifest(), mappings: "not an object" };
    const errors = validateThemeManifest(manifest as unknown);
    expect(errors.some((e) => e.field === "mappings")).toBe(true);
  });

  it("rejects empty mapping values", () => {
    const manifest = validManifest();
    manifest.mappings["tabs.onCreated"] = "";
    const errors = validateThemeManifest(manifest);
    expect(errors.some((e) => e.field === "mappings.tabs.onCreated")).toBe(true);
  });

  it("allows missing fallbacks (optional)", () => {
    const manifest = validManifest();
    delete (manifest as unknown as Record<string, unknown>).fallbacks;
    const errors = validateThemeManifest(manifest);
    expect(errors).toHaveLength(0);
  });

  it("rejects unknown fallback keys", () => {
    const manifest = {
      ...validManifest(),
      fallbacks: { tier1: "ok.ogg", unknown: "bad.ogg" },
    };
    const errors = validateThemeManifest(manifest);
    expect(errors.some((e) => e.field === "fallbacks.unknown")).toBe(true);
  });

  it("rejects empty fallback values", () => {
    const manifest = { ...validManifest(), fallbacks: { tier1: "" } };
    const errors = validateThemeManifest(manifest);
    expect(errors.some((e) => e.field === "fallbacks.tier1")).toBe(true);
  });
});
