import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CooldownGate } from "../cooldown-gate.js";
import type { Logger } from "@oriole/logger";

/**
 * Returns a logger whose every level method is a vi.fn() spy. The cooldown
 * gate emits debug() entries with structured suppression-reason data; tests
 * assert against `logger.debug.mock.calls` to confirm the right reason and
 * payload were logged.
 */
function createMockLogger(): Logger & { debug: ReturnType<typeof vi.fn> } {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => createMockLogger(),
    addTransport: vi.fn(),
    flush: async () => {},
    dispose: async () => {},
  } as Logger & { debug: ReturnType<typeof vi.fn> };
}

describe("CooldownGate", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("global cooldown", () => {
    it("admits the first event through", () => {
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      expect(gate.tryEnter("first.event")).toBe(true);
    });

    it("blocks subsequent events within the cooldown window", () => {
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      expect(gate.tryEnter("a")).toBe(true);

      vi.advanceTimersByTime(50);
      expect(gate.tryEnter("b")).toBe(false);
    });

    it("admits events after the cooldown expires", () => {
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      gate.tryEnter("a");

      vi.advanceTimersByTime(150);
      expect(gate.tryEnter("b")).toBe(true);
    });

    it("commits the cooldown atomically — concurrent admit calls do not all pass", () => {
      // Regression coverage for the race condition where a split
      // tryEnter / markPlayed API let several concurrent enabled events
      // through before any commit landed. With atomic tryEnter, the
      // second back-to-back call must observe the first's commit.
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      expect(gate.tryEnter("a")).toBe(true);
      // No await in between — the second call should still observe the commit.
      expect(gate.tryEnter("b")).toBe(false);
    });

    it("logs structured suppression metadata when blocking", () => {
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      gate.tryEnter("first");

      vi.advanceTimersByTime(40);
      gate.tryEnter("second");

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Suppressed by global cooldown: second"),
        expect.objectContaining({
          suppression: "globalCooldown",
          eventId: "second",
          msSinceLastFire: 40,
          cooldownMs: 150,
          msRemaining: 110,
          previousEventId: "first",
        }),
      );
    });

    it("does not log a suppression entry when the event is admitted", () => {
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      gate.tryEnter("a");
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it("disabled with globalCooldownMs: 0 — never blocks on the global gate", () => {
      const gate = new CooldownGate({ globalCooldownMs: 0 }, logger);
      gate.tryEnter("a");
      expect(gate.tryEnter("b")).toBe(true);
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  describe("per-event debounce", () => {
    it("blocks the same event id within the debounce window", () => {
      const gate = new CooldownGate({ globalCooldownMs: 0 }, logger);
      gate.tryEnter("noisy.event", 300);

      vi.advanceTimersByTime(100);
      expect(gate.tryEnter("noisy.event", 300)).toBe(false);
    });

    it("does not block a different event id within the debounce window", () => {
      const gate = new CooldownGate({ globalCooldownMs: 0 }, logger);
      gate.tryEnter("noisy.event", 300);

      vi.advanceTimersByTime(100);
      expect(gate.tryEnter("other.event", 300)).toBe(true);
    });

    it("admits the same event id after the debounce expires", () => {
      const gate = new CooldownGate({ globalCooldownMs: 0 }, logger);
      gate.tryEnter("noisy.event", 300);

      vi.advanceTimersByTime(300);
      expect(gate.tryEnter("noisy.event", 300)).toBe(true);
    });

    it("logs structured debounce metadata", () => {
      const gate = new CooldownGate({ globalCooldownMs: 0 }, logger);
      gate.tryEnter("e", 200);

      vi.advanceTimersByTime(50);
      gate.tryEnter("e", 200);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Suppressed by debounce: e"),
        expect.objectContaining({
          suppression: "debounce",
          eventId: "e",
          msSinceLastFire: 50,
          debounceMs: 200,
        }),
      );
    });

    it("no debounce check when debounceMs is undefined or 0", () => {
      const gate = new CooldownGate({ globalCooldownMs: 0 }, logger);
      gate.tryEnter("e");
      expect(gate.tryEnter("e")).toBe(true);
      expect(gate.tryEnter("e", 0)).toBe(true);
    });
  });

  describe("interaction", () => {
    it("global cooldown takes precedence over debounce", () => {
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      gate.tryEnter("a");

      vi.advanceTimersByTime(50);
      // Both gates would block 'a', but the global cooldown is checked first.
      gate.tryEnter("a", 300);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Suppressed by global cooldown"),
        expect.objectContaining({ suppression: "globalCooldown" }),
      );
      expect(logger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining("Suppressed by debounce"),
        expect.anything(),
      );
    });
  });

  describe("priority preemption", () => {
    it("higher-priority event preempts within the cooldown window", () => {
      // Simulates the bfcache back/forward case: onBeforeNavigate (priority 0)
      // commits the gate, then onCompleted (priority 10) arrives at msSince=0
      // and must preempt so the user hears "page loaded" instead of just
      // "navigation starting."
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      expect(gate.tryEnter("nav.start", undefined, 0)).toBe(true);
      expect(gate.tryEnter("nav.complete", undefined, 10)).toBe(true);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Preempted in cooldown: nav.complete"),
        expect.objectContaining({
          suppression: "preempted",
          eventId: "nav.complete",
          priority: 10,
          preemptedEventId: "nav.start",
          preemptedPriority: 0,
        }),
      );
    });

    it("equal priority does not preempt — preserves anti-cascade behavior", () => {
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      expect(gate.tryEnter("a", undefined, 5)).toBe(true);
      // Same priority — must be suppressed, otherwise normal navigation
      // cascades would all play.
      expect(gate.tryEnter("b", undefined, 5)).toBe(false);
    });

    it("lower priority does not preempt", () => {
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      expect(gate.tryEnter("important", undefined, 20)).toBe(true);
      expect(gate.tryEnter("trivial", undefined, 0)).toBe(false);
    });

    it("priority preemption updates the gate state — next event sees new priority", () => {
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      gate.tryEnter("a", undefined, 0);
      gate.tryEnter("b", undefined, 10); // preempts a

      // 'c' with priority 5 should be suppressed because b's commit (10) is now in the gate.
      expect(gate.tryEnter("c", undefined, 5)).toBe(false);
      // 'd' with priority 20 should still preempt b.
      expect(gate.tryEnter("d", undefined, 20)).toBe(true);
    });

    it("default priority 0 — omitting the argument behaves the same as passing 0", () => {
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      gate.tryEnter("a"); // implicit priority 0
      // Same explicit-0 event must be suppressed
      expect(gate.tryEnter("b", undefined, 0)).toBe(false);
    });

    it("priority does NOT preempt per-event debounce", () => {
      // Debounce is for spam prevention; importance shouldn't override it.
      const gate = new CooldownGate({ globalCooldownMs: 0 }, logger);
      gate.tryEnter("repeated", 300, 0);

      vi.advanceTimersByTime(50);
      expect(gate.tryEnter("repeated", 300, 100)).toBe(false);
    });
  });

  describe("reset", () => {
    it("clears the global cooldown timestamp", () => {
      const gate = new CooldownGate({ globalCooldownMs: 150 }, logger);
      gate.tryEnter("a");

      vi.advanceTimersByTime(10);
      expect(gate.tryEnter("b")).toBe(false);

      gate.reset();
      // After reset, the next event can pass — proving the global timestamp
      // was cleared (otherwise it would still be inside the 150 ms window).
      expect(gate.tryEnter("b")).toBe(true);
    });

    it("clears the per-event debounce map", () => {
      const gate = new CooldownGate({ globalCooldownMs: 0 }, logger);
      gate.tryEnter("repeated", 300);

      vi.advanceTimersByTime(10);
      expect(gate.tryEnter("repeated", 300)).toBe(false);

      gate.reset();
      // After reset, the same event can fire again immediately — proving
      // the per-event debounce map was cleared.
      expect(gate.tryEnter("repeated", 300)).toBe(true);
    });
  });
});
