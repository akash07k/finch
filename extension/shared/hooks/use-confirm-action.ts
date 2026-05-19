import { useEffect, useState, type RefObject } from "react";
import { announce } from "@/shared/a11y/announcer";

interface ConfirmAction {
  /** Whether the confirmation prompt is showing. */
  pending: boolean;
  /** Call from the initial button's onClick to enter the confirmation state. */
  requestConfirm: (ariaPrompt: string) => void;
  /** Call from the confirm button's onClick to run the action and exit confirmation. */
  confirm: () => void;
}

/**
 * Two-step confirmation pattern used by destructive actions across the options tabs.
 *
 * On the first click, the button enters a "pending" state and auto-cancels after
 * {@link timeoutMs} (default 5 s). A second click within the window runs the action.
 * The confirm button receives focus via `requestAnimationFrame` so keyboard and
 * screen-reader users land on the actionable control immediately.
 *
 * The caller owns the button ref and passes it in so that ESLint's
 * `react-hooks/refs` rule stays happy — refs in the component scope are
 * fine to pass to JSX `ref=` props; refs returned from a custom hook
 * inside an object are flagged.
 */
export function useConfirmAction(
  buttonRef: RefObject<HTMLButtonElement | null>,
  action: () => void | Promise<void>,
  timeoutMs = 5000,
): ConfirmAction {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pending) return;
    requestAnimationFrame(() => buttonRef.current?.focus());
    const timer = setTimeout(() => setPending(false), timeoutMs);
    return () => clearTimeout(timer);
  }, [pending, buttonRef, timeoutMs]);

  const requestConfirm = (ariaPrompt: string) => {
    setPending(true);
    announce(ariaPrompt, "assertive");
  };

  const confirm = () => {
    const result = action();
    if (result instanceof Promise) {
      result.finally(() => setPending(false));
    } else {
      setPending(false);
    }
  };

  return { pending, requestConfirm, confirm };
}
