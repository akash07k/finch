import { describe, it, expect } from "vitest";
import { validateEventConfig } from "../validate.js";

describe("validateEventConfig", () => {
  it("accepts a valid config", () => {
    const result = validateEventConfig({ enabled: true, volume: 80, pitch: 1.0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ enabled: true, volume: 80, pitch: 1.0 });
    }
  });

  it("accepts the boundary values", () => {
    expect(validateEventConfig({ enabled: false, volume: 0, pitch: 0.5 }).ok).toBe(true);
    expect(validateEventConfig({ enabled: true, volume: 100, pitch: 2.0 }).ok).toBe(true);
  });

  it("rejects out-of-range volume", () => {
    const result = validateEventConfig({ enabled: true, volume: 999, pitch: 1.0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("volume");
  });

  it("rejects negative volume", () => {
    const result = validateEventConfig({ enabled: true, volume: -1, pitch: 1.0 });
    expect(result.ok).toBe(false);
  });

  it("rejects pitch above the upper bound", () => {
    const result = validateEventConfig({ enabled: true, volume: 50, pitch: 3.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("pitch");
  });

  it("rejects pitch below the lower bound", () => {
    const result = validateEventConfig({ enabled: true, volume: 50, pitch: 0.1 });
    expect(result.ok).toBe(false);
  });

  it("rejects wrong types", () => {
    const result = validateEventConfig({
      enabled: "yes" as unknown as boolean,
      volume: 50,
      pitch: 1.0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("enabled");
  });
});
