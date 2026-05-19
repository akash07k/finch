/**
 * @module sound-engine/play-pipeline
 *
 * Pure-ish decision function for the sound engine hot path. Given a
 * browser event message and the current gate state, it returns
 * whether a cue should play and (if so) the resolved sound URL plus
 * per-event volume/pitch overrides.
 *
 * "Pure-ish" because admitting an event through the cooldown gate
 * commits its timestamp synchronously — the gate is intentionally
 * atomic (see `cooldown-gate.ts` for why). Every other gate is a
 * read against the supplied state, so a test can construct gates,
 * call `decidePlay`, and assert on the outcome without booting the
 * module, the message bus, or the audio backend.
 *
 * The pipeline does NOT log. Skip outcomes carry a structured reason
 * so the caller decides which reasons deserve a warn (truly unknown
 * event id) versus a debug (no sound mapped) versus silence (muted,
 * blurred, disabled, cooldown — all expected during normal use).
 */

import { EVENT_REGISTRY_BY_ID } from "./event-registry.js";
import { getEventDefaults } from "../../config/events.js";
import type { EventDefinition } from "./types.js";
import type { ThemeManager } from "./theme-manager.js";
import type { CooldownGate } from "./cooldown-gate.js";
import type { BrowserEventMessage } from "./event-engine.js";
import type { EventConfig } from "../../core/settings/schema.js";

/** Per-event in-memory cache keyed by registry id. */
export type EventConfigCache = ReadonlyMap<string, EventConfig>;

/** Resolve a handler-supplied filename to a full asset URL. */
export type OverrideUrlResolver = (filename: string) => string | null;

/**
 * Snapshot of the state the pipeline reads on each call. The
 * SoundEngineModule keeps these as instance fields and rebuilds the
 * object per event; tests construct them directly.
 */
export interface PlayGates {
  readonly muted: boolean;
  readonly muteWhenBlurred: boolean;
  readonly browserFocused: boolean;
  readonly eventConfigs: EventConfigCache;
  readonly cooldownGate: CooldownGate;
  readonly themeManager: ThemeManager;
  readonly resolveOverrideUrl: OverrideUrlResolver;
}

/** Reason a cue was skipped. The caller maps each kind to a log level. */
export type SkipReason =
  | { kind: "muted" }
  | { kind: "blurred" }
  | { kind: "unknown-event"; eventId: string }
  | { kind: "disabled"; eventId: string }
  | { kind: "cooldown"; eventId: string }
  | { kind: "no-sound"; eventId: string };

/** Everything the audio backend needs to actually play the cue. */
export interface PlayCommand {
  readonly soundUrl: string;
  readonly volume: number | undefined;
  readonly rate: number | undefined;
  readonly eventDef: EventDefinition;
}

export type PlayDecision =
  | { readonly play: true; readonly command: PlayCommand }
  | { readonly play: false; readonly reason: SkipReason };

/**
 * Decide whether the cue for `message` should play, given the
 * current gates. Gate order matches the historical hot path:
 *
 * 1. Master mute
 * 2. Mute-when-unfocused (composes with master mute)
 * 3. Event must exist in the registry
 * 4. Event must be enabled (user override > registry default)
 * 5. Cooldown gate (atomic — commits on admission)
 * 6. Resolve the sound URL (handler override > theme mapping)
 *
 * Order matters: the enabled check has to run before the cooldown
 * gate so disabled events can't consume the cooldown window. That
 * invariant lives in this function rather than at every caller.
 */
export function decidePlay(message: BrowserEventMessage, gates: PlayGates): PlayDecision {
  if (gates.muted) {
    return { play: false, reason: { kind: "muted" } };
  }

  // mute-when-blurred composes with master mute: either flag is enough
  // to suppress, including the windows.onUnfocused cue itself.
  if (gates.muteWhenBlurred && !gates.browserFocused) {
    return { play: false, reason: { kind: "blurred" } };
  }

  const eventDef = EVENT_REGISTRY_BY_ID.get(message.eventId);
  if (!eventDef) {
    return { play: false, reason: { kind: "unknown-event", eventId: message.eventId } };
  }

  const eventConfig = gates.eventConfigs.get(message.eventId);
  const defaults = getEventDefaults(message.eventId);
  const isEnabled = eventConfig?.enabled ?? defaults.enabled;
  if (!isEnabled) {
    return { play: false, reason: { kind: "disabled", eventId: message.eventId } };
  }

  const priority = eventDef.priority ?? 0;
  if (!gates.cooldownGate.tryEnter(message.eventId, defaults.debounceMs, priority)) {
    return { play: false, reason: { kind: "cooldown", eventId: message.eventId } };
  }

  const soundUrl = message.soundOverride
    ? gates.resolveOverrideUrl(message.soundOverride)
    : gates.themeManager.resolveSound(
        message.eventId,
        eventDef.tier,
        eventDef.isError ?? false,
      );

  if (!soundUrl) {
    return { play: false, reason: { kind: "no-sound", eventId: message.eventId } };
  }

  return {
    play: true,
    command: {
      soundUrl,
      volume: eventConfig?.volume !== undefined ? eventConfig.volume / 100 : undefined,
      rate: eventConfig?.pitch,
      eventDef,
    },
  };
}
