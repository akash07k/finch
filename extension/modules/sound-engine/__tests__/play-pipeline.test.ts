import { describe, it, expect, vi } from "vitest";
import { decidePlay, type PlayGates, type SkipReason } from "../play-pipeline.js";
import type { BrowserEventMessage } from "../event-engine.js";
import type { ThemeManager } from "../theme-manager.js";
import type { CooldownGate } from "../cooldown-gate.js";
import type { EventConfig } from "../../../core/settings/schema.js";

/** A real event id that exists in the registry; safer than making one up. */
const KNOWN_EVENT_ID = "tabs.onCreated";

function makeGates(overrides: Partial<PlayGates> = {}): PlayGates {
  const themeManager = {
    resolveSound: vi.fn().mockReturnValue("/sounds/tab-created.ogg"),
    getActiveThemeId: vi.fn().mockReturnValue("pulse"),
  } as unknown as ThemeManager;
  const cooldownGate = {
    tryEnter: vi.fn().mockReturnValue(true),
  } as unknown as CooldownGate;
  return {
    muted: false,
    muteWhenBlurred: false,
    browserFocused: true,
    eventConfigs: new Map<string, EventConfig>(),
    cooldownGate,
    themeManager,
    resolveOverrideUrl: vi.fn().mockReturnValue("/sounds/override.ogg"),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<BrowserEventMessage> = {}): BrowserEventMessage {
  return {
    eventId: KNOWN_EVENT_ID,
    extractedData: {},
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function assertSkip(
  decision: ReturnType<typeof decidePlay>,
  kind: SkipReason["kind"],
): void {
  expect(decision.play).toBe(false);
  if (decision.play === false) {
    expect(decision.reason.kind).toBe(kind);
  }
}

describe("decidePlay — gates in order", () => {
  it("skips when master mute is on", () => {
    const gates = makeGates({ muted: true });
    assertSkip(decidePlay(makeMessage(), gates), "muted");
    expect(gates.cooldownGate.tryEnter).not.toHaveBeenCalled();
  });

  it("skips when blurred + muteWhenBlurred", () => {
    const gates = makeGates({ muteWhenBlurred: true, browserFocused: false });
    assertSkip(decidePlay(makeMessage(), gates), "blurred");
    expect(gates.cooldownGate.tryEnter).not.toHaveBeenCalled();
  });

  it("plays when muteWhenBlurred is on but browser IS focused", () => {
    const gates = makeGates({ muteWhenBlurred: true, browserFocused: true });
    const decision = decidePlay(makeMessage(), gates);
    expect(decision.play).toBe(true);
  });

  it("skips an unknown event id", () => {
    const gates = makeGates();
    assertSkip(decidePlay(makeMessage({ eventId: "no.such.event" }), gates), "unknown-event");
    expect(gates.cooldownGate.tryEnter).not.toHaveBeenCalled();
  });

  it("skips when per-event override sets enabled=false", () => {
    const gates = makeGates({
      eventConfigs: new Map([
        [KNOWN_EVENT_ID, { enabled: false } as EventConfig],
      ]),
    });
    assertSkip(decidePlay(makeMessage(), gates), "disabled");
    expect(gates.cooldownGate.tryEnter).not.toHaveBeenCalled();
  });

  it("disabled events do NOT consume the cooldown gate", () => {
    const gates = makeGates({
      eventConfigs: new Map([[KNOWN_EVENT_ID, { enabled: false } as EventConfig]]),
    });
    decidePlay(makeMessage(), gates);
    expect(gates.cooldownGate.tryEnter).not.toHaveBeenCalled();
  });

  it("skips when cooldown gate refuses admission", () => {
    const gates = makeGates();
    (gates.cooldownGate.tryEnter as ReturnType<typeof vi.fn>).mockReturnValue(false);
    assertSkip(decidePlay(makeMessage(), gates), "cooldown");
  });

  it("commits the cooldown timestamp on admission (atomic gate)", () => {
    const gates = makeGates();
    decidePlay(makeMessage(), gates);
    expect(gates.cooldownGate.tryEnter).toHaveBeenCalledOnce();
  });

  it("skips when the theme has no sound mapped", () => {
    const gates = makeGates();
    (gates.themeManager.resolveSound as ReturnType<typeof vi.fn>).mockReturnValue(null);
    assertSkip(decidePlay(makeMessage(), gates), "no-sound");
  });
});

describe("decidePlay — resolved play command", () => {
  it("uses the theme-resolved URL when no override is given", () => {
    const gates = makeGates();
    const decision = decidePlay(makeMessage(), gates);
    expect(decision.play).toBe(true);
    if (decision.play) {
      expect(decision.command.soundUrl).toBe("/sounds/tab-created.ogg");
    }
  });

  it("uses the override resolver when message.soundOverride is set", () => {
    const gates = makeGates();
    const decision = decidePlay(
      makeMessage({ soundOverride: "custom.ogg" }),
      gates,
    );
    expect(gates.resolveOverrideUrl).toHaveBeenCalledWith("custom.ogg");
    expect(gates.themeManager.resolveSound).not.toHaveBeenCalled();
    if (decision.play) {
      expect(decision.command.soundUrl).toBe("/sounds/override.ogg");
    }
  });

  it("converts volume from percent (0-100) to fraction (0.0-1.0)", () => {
    const gates = makeGates({
      eventConfigs: new Map([
        [KNOWN_EVENT_ID, { enabled: true, volume: 50, pitch: 1.0 } as EventConfig],
      ]),
    });
    const decision = decidePlay(makeMessage(), gates);
    if (decision.play) {
      expect(decision.command.volume).toBe(0.5);
      expect(decision.command.rate).toBe(1.0);
    }
  });

  it("passes undefined volume/rate when the event has no override", () => {
    const gates = makeGates();
    const decision = decidePlay(makeMessage(), gates);
    if (decision.play) {
      expect(decision.command.volume).toBeUndefined();
      expect(decision.command.rate).toBeUndefined();
    }
  });

  it("returns the event definition in the play command", () => {
    const gates = makeGates();
    const decision = decidePlay(makeMessage(), gates);
    if (decision.play) {
      expect(decision.command.eventDef.id).toBe(KNOWN_EVENT_ID);
    }
  });
});

describe("decidePlay — registry defaults for enabled", () => {
  it("falls back to the registry default when no user override exists", () => {
    // tabs.onCreated defaults to enabled=true; with no map entry it
    // should still pass the enabled gate.
    const gates = makeGates({ eventConfigs: new Map() });
    const decision = decidePlay(makeMessage(), gates);
    expect(decision.play).toBe(true);
  });

  it("uses a disabled-by-default event's registry default when no override exists", () => {
    // tabs.onHighlighted defaults to enabled=false in events.ts.
    const gates = makeGates({ eventConfigs: new Map() });
    const decision = decidePlay(makeMessage({ eventId: "tabs.onHighlighted" }), gates);
    assertSkip(decision, "disabled");
  });
});
