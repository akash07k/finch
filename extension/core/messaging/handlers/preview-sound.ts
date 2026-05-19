/**
 * @module messaging/handlers/preview-sound
 *
 * Play a one-off cue for the event the user is hovering in the Sound
 * Events tab. The handler resolves the sound through the active theme,
 * routes through the same audio backend the live engine uses, and
 * reports `{ success, error? }` back to the UI so the table row can
 * announce success or fallback.
 *
 * The handler depends on the sound engine being already activated.
 * If the user previews before activation completes (rare — boot is
 * fast), the missing-engine path returns a clear error instead of
 * silently no-oping.
 */

import type { Logger } from "@finch/logger";
import type { PreviewSoundMessage, ExtensionResponse } from "../types.js";
import type { MessageHandler } from "../router.js";
import type { AudioBackend } from "../../../modules/sound-engine/audio-backends/types.js";
import type { ThemeManager } from "../../../modules/sound-engine/theme-manager.js";
import { EVENT_REGISTRY_BY_ID } from "../../../modules/sound-engine/event-registry.js";

/**
 * Resolve the live theme manager + backend just-in-time. The boot
 * script doesn't have these at message-router construction time
 * (the sound engine activates later), so the handler is built with
 * getter functions that look them up on each call.
 */
export interface PreviewSoundDeps {
  getThemeManager(): ThemeManager | null;
  getBackend(): AudioBackend | null;
  logger: Logger;
}

export function createPreviewSoundHandler(
  deps: PreviewSoundDeps,
): MessageHandler<PreviewSoundMessage> {
  return async (message): Promise<ExtensionResponse> => {
    const themeManager = deps.getThemeManager();
    const backend = deps.getBackend();
    if (!themeManager || !backend) {
      return { success: false, error: "Sound engine not initialized" };
    }

    const eventDef = EVENT_REGISTRY_BY_ID.get(message.eventId);
    if (!eventDef) {
      return { success: false, error: `Unknown event: ${message.eventId}` };
    }

    const soundUrl = themeManager.resolveSound(
      message.eventId,
      eventDef.tier,
      eventDef.isError ?? false,
    );
    if (!soundUrl) {
      return { success: false, error: "No sound mapped for this event" };
    }

    const result = await backend.play(soundUrl);
    deps.logger.info(`Preview: ${eventDef.label}`, {
      eventId: message.eventId,
      sound: soundUrl,
    });
    return { success: result.success, error: result.error };
  };
}
