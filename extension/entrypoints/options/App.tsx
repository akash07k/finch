/**
 * @module options/App
 *
 * Finch Options page — full settings interface.
 *
 * Organized into tabs: General, Sound Events, Themes, Logging.
 * Uses shadcn/ui Tabs (Radix) with default automatic activation —
 * tab switching uses the WAI-ARIA keyboard model: Tab into the tab
 * list, then Left/Right/Home/End to move between tabs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { announce } from "@/shared/a11y/announcer";
import { focusFirst } from "@/shared/a11y/focus";
import { onboardingSeenItem } from "@/core/settings/items";
import { GeneralTab } from "./tabs/GeneralTab.js";
import { SoundEventsTab } from "./tabs/SoundEventsTab.js";
import { ThemesTab } from "./tabs/ThemesTab.js";
import { LoggingTab } from "./tabs/LoggingTab.js";

/** Tab definitions — id and label. Keyboard switching uses Radix's
 *  built-in WAI-ARIA Tabs model (Left/Right/Home/End on focused tab list). */
const TAB_DEFINITIONS = [
  { id: "general", label: "General" },
  { id: "sound-events", label: "Sound Events" },
  { id: "themes", label: "Themes" },
  { id: "logging", label: "Logging" },
] as const;

const MANIFEST = browser.runtime.getManifest();
const VERSION = MANIFEST.version;
const EXTENSION_NAME = MANIFEST.name;
const RELEASE_URL = `https://github.com/akash07k/finch/releases/tag/v${VERSION}`;

/** Options page root — tabbed settings interface. */
export default function App() {
  const [activeTab, setActiveTab] = useState("general");
  const [showWelcome, setShowWelcome] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // One-shot guard for the welcome announcement. React.StrictMode (see
  // options/main.tsx) intentionally double-invokes effects in dev to
  // surface non-idempotent code. Storage reads and setShowWelcome are
  // idempotent (React dedupes equal state updates), but announce() is
  // fire-and-forget so NVDA would hear "Welcome ..." twice without
  // this ref gate. Scoped to the component so an unlikely future
  // multi-root mount doesn't cross-contaminate.
  const announcedWelcomeRef = useRef(false);

  // Check if this is the first visit (show welcome banner)
  useEffect(() => {
    async function init() {
      const seen = await onboardingSeenItem.getValue();
      if (!seen) {
        setShowWelcome(true);
        if (!announcedWelcomeRef.current) {
          announcedWelcomeRef.current = true;
          announce("Welcome to Finch. A welcome banner is available above the tabs.", "polite");
        }
      }
    }
    init();
  }, []);

  /** Dismiss the welcome banner and mark onboarding as seen. */
  const dismissWelcome = () => {
    setShowWelcome(false);
    onboardingSeenItem.setValue(true);
    announce("Welcome banner dismissed", "polite");
    requestAnimationFrame(() => {
      headingRef.current?.focus();
    });
  };

  /**
   * Handle tab change — announce the new tab name AND move focus into
   * the newly-rendered panel.
   *
   * Without the focus move, clicking a trigger or using the WAI-ARIA
   * arrow-key model to switch tabs would leave focus on the tab list
   * itself. Screen reader users would hear the announcement but then
   * have to manually navigate forward to find the new content.
   * focusFirst() drops them straight onto the first interactive control
   * of the panel.
   */
  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
    const tab = TAB_DEFINITIONS.find((t) => t.id === tabId);
    if (tab) {
      announce(`${tab.label} settings loaded`, "polite");
    }
    // Defer until Radix has rendered the new tabpanel into the DOM.
    requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]');
      if (panel) focusFirst(panel);
    });
  }, []);

  return (
    <>
      <main className="max-w-4xl mx-auto p-6">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold mb-6">
          Finch Options
        </h1>

        {showWelcome && (
          <div
            role="region"
            aria-labelledby="welcome-heading"
            className="mb-6 border rounded-lg p-4 space-y-2"
          >
            <h2 id="welcome-heading" className="text-lg font-semibold">
              Welcome to Finch
            </h2>
            <p className="text-muted-foreground">
              Finch plays audio cues for browser events — tabs, bookmarks, downloads, and
              navigation. Sounds play automatically as you browse. Use the General tab to adjust
              volume and mute. Use Sound Events to enable or disable individual events.
            </p>
            <button
              type="button"
              onClick={dismissWelcome}
              className="mt-2 px-4 py-2 rounded border border-input bg-transparent text-sm hover:bg-accent"
            >
              Got it
            </button>
          </div>
        )}

        <div id="tab-panels-region" tabIndex={-1} className="outline-none">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="w-full justify-start">
              {TAB_DEFINITIONS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="general">
              <GeneralTab />
            </TabsContent>

            <TabsContent value="sound-events">
              <SoundEventsTab />
            </TabsContent>

            <TabsContent value="themes">
              <ThemesTab />
            </TabsContent>

            <TabsContent value="logging">
              <LoggingTab />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <footer
        role="contentinfo"
        aria-label={`About ${EXTENSION_NAME}`}
        className="max-w-4xl mx-auto px-6 pb-6 pt-2 mt-4 border-t border-border text-sm text-muted-foreground"
      >
        <p>
          {EXTENSION_NAME}{" "}
          <a
            href={RELEASE_URL}
            aria-label={`Release notes for ${EXTENSION_NAME} v${VERSION} on GitHub`}
            className="underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            v{VERSION}
          </a>
        </p>
      </footer>
    </>
  );
}
