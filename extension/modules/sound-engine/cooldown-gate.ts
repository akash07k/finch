/**
 * @module sound-engine/cooldown-gate
 *
 * Two-stage suppression gate that decides whether an event should be
 * allowed to play a sound right now: a global cooldown (debounce across
 * all events) and a per-event debounce (suppress same-event spam).
 *
 * `tryEnter()` is **atomic** — it checks both gates and, if the event is
 * allowed through, commits the cooldown timestamp synchronously in the
 * same call, before any `await`. This is essential under JS concurrency:
 * `SoundEngineModule.handleBrowserEvent()` is async, and several
 * invocations can race through the gate in microsecond-scale windows
 * (e.g., when Ctrl+T fires onCreated + onActivated + onBeforeNavigate
 * all within ~5 ms). A split "check then commit later" API would let
 * every concurrent invocation pass; an atomic check-and-set lets only
 * the first one through.
 *
 * **Priority preemption:** when an event arrives within the global
 * cooldown window AND its priority is strictly greater than the
 * in-flight event's priority, it preempts — its sound plays (possibly
 * overlapping the prior sound) and the cooldown timestamp resets to
 * the preempting event. This solves cases where two semantically
 * different events fire in the same millisecond and the second one is
 * more informative (e.g., bfcache back/forward fires onBeforeNavigate
 * + onCompleted at msSince=0; onCompleted should win). Equal priority
 * does NOT preempt — keeps the gate's anti-cascade purpose intact for
 * normal navigations.
 *
 * The gate is INSULATED from the "disabled events poison the cooldown"
 * problem by ordering inside the caller: `handleBrowserEvent` checks
 * the per-event enabled setting BEFORE calling `tryEnter`. Disabled
 * events therefore never reach the gate at all.
 *
 * Trade-off: a failed audio play (rare — backend error) still consumes
 * the cooldown window for its 150 ms duration, since the timestamp is
 * committed before play() resolves. Acceptable, because the next event
 * would have been suppressed by the cooldown regardless.
 */

import type { Logger } from "@finch/logger";

/** Tunable thresholds for the gate. */
interface CooldownGateConfig {
  /**
   * Global suppression window in milliseconds. After any sound plays,
   * all subsequent events are suppressed for this duration. Set to 0
   * to disable the global gate.
   */
  globalCooldownMs: number;
}

/**
 * Tracks the last-played event globally and per-event so the gate can
 * suppress cascading or repeating sounds. State is mutated only inside
 * `tryEnter()` on the success branch — never as a separate side-effect.
 */
export class CooldownGate {
  /** Wall-clock time of the most recently committed fire. */
  private lastGlobalFireTime = 0;

  /**
   * Event id that owned the most recent committed fire. Recorded so
   * suppression logs can identify which event "won" the current window.
   */
  private lastGlobalFiredEventId: string | null = null;

  /**
   * Priority of the most recently committed fire. Used to decide
   * whether an arriving event can preempt within the cooldown window.
   */
  private lastGlobalFiredPriority = 0;

  /** Per-event id → timestamp of last committed fire, for debounce. */
  private readonly lastFireTime = new Map<string, number>();

  /**
   * @param config - Tunable cooldown thresholds.
   * @param logger - Logger for emitting suppression-reason debug entries.
   */
  constructor(
    private readonly config: CooldownGateConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Atomic check-and-commit. If the event is allowed through, the
   * cooldown timestamp is updated synchronously before this method
   * returns. If the event is suppressed, a structured debug-level
   * suppression entry is logged and no state changes.
   *
   * Concurrent callers race only at the JS-engine level; because this
   * method has no `await`, the JS event loop guarantees the check-
   * and-set pair is observed atomically by every other caller.
   *
   * @param eventId - Event identifier.
   * @param debounceMs - Optional per-event debounce window. Omit for none.
   * @param priority - Event priority. Higher preempts lower within the
   *                   global cooldown window. Default 0.
   * @returns true if the event was admitted (and the gate updated),
   *          false if it was suppressed.
   */
  tryEnter(eventId: string, debounceMs?: number, priority: number = 0): boolean {
    const now = Date.now();

    if (this.config.globalCooldownMs > 0) {
      const msSinceLastFire = now - this.lastGlobalFireTime;
      if (msSinceLastFire < this.config.globalCooldownMs) {
        // Within the cooldown window. Allow only if the arriving event has
        // strictly higher priority than the in-flight one (preemption).
        if (priority > this.lastGlobalFiredPriority) {
          this.logger.debug(`Preempted in cooldown: ${eventId}`, {
            suppression: "preempted",
            eventId,
            priority,
            preemptedEventId: this.lastGlobalFiredEventId,
            preemptedPriority: this.lastGlobalFiredPriority,
            msSinceLastFire,
          });
          this.commit(eventId, now, priority);
          return true;
        }
        this.logger.debug(`Suppressed by global cooldown: ${eventId}`, {
          suppression: "globalCooldown",
          eventId,
          priority,
          msSinceLastFire,
          cooldownMs: this.config.globalCooldownMs,
          msRemaining: this.config.globalCooldownMs - msSinceLastFire,
          previousEventId: this.lastGlobalFiredEventId,
          previousPriority: this.lastGlobalFiredPriority,
        });
        return false;
      }
    }

    if (debounceMs && debounceMs > 0) {
      const lastFire = this.lastFireTime.get(eventId) ?? 0;
      const msSinceLastFire = now - lastFire;
      if (msSinceLastFire < debounceMs) {
        // Debounce is intentionally NOT preemptable by priority — its
        // purpose is to prevent same-event spam regardless of importance.
        this.logger.debug(`Suppressed by debounce: ${eventId}`, {
          suppression: "debounce",
          eventId,
          msSinceLastFire,
          debounceMs,
        });
        return false;
      }
    }

    this.commit(eventId, now, priority);
    return true;
  }

  /** Commit the gate state for an admitted event. */
  private commit(eventId: string, now: number, priority: number): void {
    if (this.config.globalCooldownMs > 0) {
      this.lastGlobalFireTime = now;
      this.lastGlobalFiredEventId = eventId;
      this.lastGlobalFiredPriority = priority;
    }
    this.lastFireTime.set(eventId, now);
  }

  /** Clear all recorded fire times. Used on dispose. */
  reset(): void {
    this.lastGlobalFireTime = 0;
    this.lastGlobalFiredEventId = null;
    this.lastGlobalFiredPriority = 0;
    this.lastFireTime.clear();
  }
}
