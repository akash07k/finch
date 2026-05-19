/**
 * @module a11y/announcer
 *
 * Screen reader live region announcer for the Oriole extension.
 *
 * Wraps @react-aria/live-announcer — Adobe's battle-tested, pure DOM
 * announcer that handles timing quirks, duplicate message detection,
 * and proper live region management. No React dependency.
 *
 * This thin wrapper provides:
 * 1. A single import path across all extension surfaces (popup, options, content scripts)
 * 2. A convenience `clearAnnouncements()` that clears both polite and assertive channels
 * 3. A future hook point for content script cleanup (removing orphaned live regions)
 *
 * Note: In content scripts, live regions are appended to the host page's
 * document.body (not shadow DOM). This is correct — NVDA doesn't reliably
 * read live regions inside shadow DOM.
 *
 * @example
 * ```ts
 * import { announce, clearAnnouncements } from "@/shared/a11y/announcer";
 *
 * announce("5 new entries received", "polite");
 * announce("Disconnected from server", "assertive");
 * clearAnnouncements(); // removes all live regions
 * ```
 */

import { announce as reactAriaAnnounce, clearAnnouncer } from "@react-aria/live-announcer";

/**
 * Announce a message to screen readers via a live region.
 *
 * Uses @react-aria/live-announcer under the hood. Live regions are
 * created lazily in the current document.body on first call.
 *
 * @param message - The text to announce.
 * @param priority - "polite" (default) waits for the screen reader to finish.
 *                   "assertive" interrupts immediately (use for urgent status changes).
 */
export function announce(message: string, priority: "polite" | "assertive" = "polite"): void {
  reactAriaAnnounce(message, priority);
}

/**
 * Remove all announcer live regions from the DOM.
 *
 * Clears both polite and assertive channels. Use for cleanup
 * when tearing down UI surfaces (e.g., content script detach).
 */
export function clearAnnouncements(): void {
  clearAnnouncer("polite");
  clearAnnouncer("assertive");
}
