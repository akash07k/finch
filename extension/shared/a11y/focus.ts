/**
 * @module a11y/focus
 *
 * Focus management utilities for the Finch extension.
 *
 * Currently fills one gap that component libraries (Radix, shadcn/ui)
 * don't cover: moving focus into a freshly-rendered section after a
 * route or tab change, so screen reader users land on the new content
 * instead of staying on the trigger that brought them there.
 *
 * Focus trapping and restoration for modals/dialogs is handled by
 * Radix Dialog — don't duplicate that here.
 */

/**
 * Selector for elements that can receive keyboard focus.
 * Matches buttons, inputs, selects, textareas, links with href,
 * and elements with explicit tabindex.
 */
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  'a[href]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Focus the first focusable element within a container.
 *
 * Use this when navigating to a new section/tab in the options page —
 * screen reader users need focus to move to the new content, otherwise
 * they're left on the previous tab button with no indication that
 * content changed.
 *
 * @param container - The DOM element to search within.
 * @returns true if an element was focused, false if none found.
 *
 * @example
 * ```ts
 * // After switching to the "Sound Events" tab:
 * const panel = document.getElementById("sound-events-panel");
 * focusFirst(panel);
 * ```
 */
export function focusFirst(container: HTMLElement): boolean {
  const target = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  if (target) {
    target.focus();
    return true;
  }
  return false;
}
