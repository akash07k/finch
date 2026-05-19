/**
 * @module messaging/router
 *
 * Typed `browser.runtime.onMessage` dispatcher. Each `ExtensionMessage`
 * variant is routed to a registered handler that owns its own
 * dependencies. The router handles the cross-cutting concerns once:
 *
 * - sender trust check (reject messages from foreign extensions)
 * - response delivery (returning a Promise from the listener so the
 *   webextension-polyfill resolves it for the caller)
 * - error containment so a throwing handler doesn't kill the listener
 *
 * Handlers return their response value directly (sync or via Promise);
 * the router awaits and forwards it. A handler that returns
 * `undefined` causes the router to skip responding — the message
 * falls through to other listeners (e.g., the offscreen document).
 */

import type { ExtensionMessage, ExtensionResponse } from "./types.js";

/** Per-call context handed to a handler. */
export interface MessageContext {
  /** Original sender, already trust-checked by the router. */
  readonly sender: chrome.runtime.MessageSender;
}

/**
 * A handler for a single message type. Returns the response value
 * (or a promise of it). May throw — the router converts thrown
 * errors into an `ExtensionResponse` with `success: false`.
 */
export type MessageHandler<Msg extends ExtensionMessage> = (
  message: Msg,
  context: MessageContext,
) => ExtensionResponse | Promise<ExtensionResponse>;

/** Lookup of message type -> handler. Untyped at the storage layer; */
/** the register() generic enforces the right shape at registration. */
type HandlerMap = Map<string, MessageHandler<ExtensionMessage>>;

type ListenerFn = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
) => Promise<ExtensionResponse> | undefined;

/**
 * Dispatcher for `browser.runtime.onMessage`. Construct once at
 * background-script boot, register handlers for each known message
 * type, then call `start()` to attach the listener.
 *
 * The router does NOT own the lifecycle of the handlers' dependencies
 * (logger, settings, audio backend, IDB transport). The boot script
 * builds those, then closes over them when constructing each handler.
 *
 * @example
 * ```ts
 * const router = new MessageRouter();
 * router.register("LOG", createLogHandler(uiLogger));
 * router.register("CLEAR_LOGS", createClearLogsHandler(idbTransport, logger));
 * router.start();
 * ```
 */
export class MessageRouter {
  private readonly handlers: HandlerMap = new Map();
  private listener: ListenerFn | null = null;

  /**
   * Bind a handler to a specific message type. Registering twice for
   * the same type replaces the prior handler — the boot script owns
   * the registration order and is expected not to do this accidentally.
   */
  register<Msg extends ExtensionMessage>(
    type: Msg["type"],
    handler: MessageHandler<Msg>,
  ): void {
    this.handlers.set(type, handler as MessageHandler<ExtensionMessage>);
  }

  /**
   * Attach the listener to `browser.runtime.onMessage`. Idempotent —
   * a second call is a no-op so the boot script can defensively
   * re-start without leaking duplicate listeners.
   */
  start(): void {
    if (this.listener) return;

    const listener: ListenerFn = (message, sender) => {
      // Reject messages from other extensions. Finch ships no content
      // scripts and is not externally_connectable, so a sender id that
      // doesn't match our own runtime id comes from a foreign probe.
      // Tab presence is NOT a trust signal: WXT opens the options page
      // in a tab by default, so sender.tab is populated for our own UI.
      if (sender.id !== browser.runtime.id) return undefined;

      const type = (message as { type?: unknown } | null)?.type;
      if (typeof type !== "string") return undefined;

      const handler = this.handlers.get(type);
      if (!handler) return undefined;

      return invoke(handler, message as ExtensionMessage, sender);
    };

    this.listener = listener;
    browser.runtime.onMessage.addListener(listener);
  }

  /**
   * Detach the listener. Used by tests and by suspension cleanup.
   * Safe to call without a prior `start()`.
   */
  stop(): void {
    if (!this.listener) return;
    browser.runtime.onMessage.removeListener(this.listener);
    this.listener = null;
  }
}

async function invoke(
  handler: MessageHandler<ExtensionMessage>,
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionResponse> {
  try {
    return await handler(message, { sender });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
