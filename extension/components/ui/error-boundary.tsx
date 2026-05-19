/**
 * @module components/ui/error-boundary
 *
 * React error boundary that catches rendering errors and displays
 * an accessible fallback instead of a blank white page.
 *
 * Used in popup and options page root to prevent a single component
 * crash from taking down the entire UI.
 */

import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  /** The component tree to wrap. */
  children: ReactNode;
  /** Context label for the error message (e.g., "Popup", "Options"). */
  context?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches rendering errors in child components and displays
 * an accessible error message instead of crashing to blank.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private buttonRef = React.createRef<HTMLButtonElement>();
  private retryCount = 0;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[Finch ${this.props.context ?? "UI"}] Rendering error:`, error, info);
  }

  componentDidUpdate(_: ErrorBoundaryProps, prevState: ErrorBoundaryState): void {
    if (this.state.hasError && !prevState.hasError && this.buttonRef.current) {
      this.buttonRef.current.focus();
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="p-6 max-w-lg mx-auto">
          <div role="alert">
            <h1 className="text-lg font-bold mb-2">Something went wrong</h1>
            <p className="text-muted-foreground mb-4">
              Finch encountered an error. Try reloading the extension.
            </p>
            {/* Visible heading, sr-only so it doesn't add visual noise but */}
            {/* still names the pre for screen readers via aria-labelledby. */}
            {/* The previous aria-label="Error details" overrode the visible */}
            {/* error text for SR users — they heard the label but not the   */}
            {/* error message body until they navigated into the pre.        */}
            <h2 id="error-details-heading" className="sr-only">
              Error details
            </h2>
            {/* tabIndex={0} on a non-interactive region is required by WCAG 2.1.1: */}
            {/* a scrollable container must be reachable via keyboard so users can */}
            {/* arrow-scroll its overflow content. Pairs with role=region + label.  */}
            <pre
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              tabIndex={0}
              role="region"
              aria-labelledby="error-details-heading"
              className="text-sm bg-muted p-3 rounded overflow-auto max-h-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {this.state.error?.message ?? "Unknown error"}
            </pre>
          </div>
          {this.retryCount > 0 && (
            <p className="text-sm text-muted-foreground mt-2" id="retry-hint">
              This error persists after retrying. Try reloading the extension page.
            </p>
          )}
          <button
            ref={this.buttonRef}
            type="button"
            onClick={() => {
              this.retryCount++;
              this.setState({ hasError: false, error: null });
            }}
            aria-describedby={this.retryCount > 0 ? "retry-hint" : undefined}
            className="mt-4 px-4 py-2 rounded border border-input bg-transparent text-sm hover:bg-accent"
          >
            Try Again
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
