/**
 * @module whats-new/App
 *
 * What's New page — opened automatically by the background script
 * after the user updates the extension to a new version. Renders
 * the release notes for the current version. The HTML is inlined
 * into the page bundle at build time via a static import of
 * `whats-new.generated.ts`, written by
 * `extension/scripts/build-whats-new.mjs` from CHANGELOG.md.
 *
 * Accessibility notes:
 *   - The page H1 receives focus on mount (via ref + rAF) so screen
 *     readers announce the heading text immediately. The skip link
 *     in index.html bypasses the header and lands on the release
 *     notes region for keyboard users.
 *   - There is intentionally no aria-live announcement on load —
 *     focusing the H1 already triggers a virtual-cursor read of the
 *     heading. A live region would double-announce.
 *   - The action buttons sit inside <nav aria-label="Page actions">
 *     so screen reader users can jump straight to them via the
 *     landmark.
 *   - The full-changelog link in the footer carries the absolute
 *     GitHub URL because there is no in-extension full changelog
 *     view; this matches the pattern used by the version footer
 *     on the options page (entrypoints/options/App.tsx).
 *
 * The HTML constant comes from our own build script running over a
 * maintainer-committed CHANGELOG file, so dangerouslySetInnerHTML is
 * safe in this context. The build script escapes user content before
 * adding trusted tags.
 */

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { WHATS_NEW } from "./whats-new.generated.js";

const MANIFEST = browser.runtime.getManifest();
const EXTENSION_NAME = MANIFEST.name;
const FULL_CHANGELOG_URL = "https://github.com/akash07k/oriole/blob/main/CHANGELOG.md";

/** Read the `from` query parameter (the version the user updated from). */
function readPreviousVersion(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("from");
  } catch {
    return null;
  }
}

/**
 * Page root. Focuses the H1 on mount (so the SR reads the heading
 * rather than landing silently in the body) and renders the inlined
 * release notes plus a small action bar.
 */
export default function App() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousVersion = readPreviousVersion();

  useEffect(() => {
    requestAnimationFrame(() => {
      headingRef.current?.focus();
    });
  }, []);

  // Override the static fallback title from index.html with the
  // current version so the browser tab label distinguishes this
  // page from any other extension tabs the user has open.
  useEffect(() => {
    document.title = `What's new in ${EXTENSION_NAME} v${WHATS_NEW.version}`;
  }, []);

  const handleClose = () => {
    window.close();
  };

  const handleOpenSettings = () => {
    browser.runtime.openOptionsPage();
    window.close();
  };

  const headingText = `What's new in ${EXTENSION_NAME} v${WHATS_NEW.version}`;

  return (
    <>
      <header className="max-w-3xl mx-auto p-6 pb-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold">
          {headingText}
        </h1>
        {previousVersion && (
          <p className="text-sm text-muted-foreground mt-2">
            Updated from v{previousVersion} to v{WHATS_NEW.version}.
          </p>
        )}
      </header>

      <main id="release-notes" tabIndex={-1} className="max-w-3xl mx-auto px-6 pb-4">
        <div
          className="whats-new-prose space-y-3"
          dangerouslySetInnerHTML={{ __html: WHATS_NEW.html }}
        />
      </main>

      <nav aria-label="Page actions" className="max-w-3xl mx-auto px-6 pb-4 flex gap-2 flex-wrap">
        <Button onClick={handleOpenSettings}>Open Settings</Button>
        <Button variant="outline" onClick={handleClose}>
          Close
        </Button>
      </nav>

      <footer
        role="contentinfo"
        aria-label="About this page"
        className="max-w-3xl mx-auto px-6 pb-6 pt-2 mt-4 border-t border-border text-sm text-muted-foreground"
      >
        <p>
          Looking for older releases?{" "}
          <a
            href={FULL_CHANGELOG_URL}
            rel="noopener noreferrer"
            className="underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Read the full changelog on GitHub
          </a>
          .
        </p>
        <p className="mt-1">
          You can turn off the What&apos;s New page on update from the General tab in Settings.
        </p>
      </footer>
    </>
  );
}
