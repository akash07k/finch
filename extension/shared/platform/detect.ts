/**
 * @module platform/detect
 *
 * Detects the browser, OS, and extension capabilities at runtime.
 *
 * This information is injected into every module's ModuleContext so
 * modules can branch behavior without importing detection logic
 * directly. The main use case is audio playback — Chrome uses
 * offscreen documents while Firefox uses background pages.
 *
 * WXT normalizes most browser APIs via its polyfill, but some
 * features (like chrome.offscreen) are Chrome-only and need
 * explicit platform checks.
 */

import type { PlatformInfo } from "../../core/module-system/types.js";

/**
 * Detects the current platform by inspecting browser APIs and user agent.
 *
 * Detection strategy:
 * - **Browser:** Firefox exposes `runtime.getBrowserInfo()`, Chrome does not.
 * - **Manifest version:** Read from `runtime.getManifest()`.
 * - **OS:** Parsed from `navigator.platform`.
 * - **Browser version:** Extracted from the user agent string.
 *
 * @returns Platform information for the current environment.
 */
export async function detectPlatform(): Promise<PlatformInfo> {
  const chromeGlobal = (globalThis as Record<string, unknown>).chrome as ChromeRuntime | undefined;

  const browser = await detectBrowser(chromeGlobal);
  const manifestVersion = getManifestVersion(chromeGlobal);
  const browserVersion = extractBrowserVersion(navigator.userAgent);
  const os = detectOS(navigator.platform);

  return {
    browser,
    manifestVersion,
    browserVersion,
    os,
  };
}

/**
 * Detects whether we're running in Chrome or Firefox.
 *
 * Firefox's WebExtension API includes `runtime.getBrowserInfo()`.
 * Chrome does not have this method. This is the most reliable
 * detection method because user agent strings can be spoofed.
 */
async function detectBrowser(chrome: ChromeRuntime | undefined): Promise<"chrome" | "firefox"> {
  if (chrome?.runtime?.getBrowserInfo) {
    return "firefox";
  }
  return "chrome";
}

/**
 * Reads the manifest version from the extension's manifest.json.
 * Falls back to 3 if the API is unavailable (always MV3 for Oriole).
 */
function getManifestVersion(chrome: ChromeRuntime | undefined): number {
  try {
    const manifest = chrome?.runtime?.getManifest?.();
    return manifest?.manifest_version ?? 3;
  } catch {
    return 3;
  }
}

/**
 * Extracts the browser version from the user agent string.
 *
 * Looks for "Chrome/X.Y.Z" or "Firefox/X.Y" patterns.
 * Returns "unknown" if no version is found.
 */
function extractBrowserVersion(userAgent: string): string {
  // Match Chrome/X.X.X.X or Firefox/X.X
  const chromeMatch = userAgent.match(/Chrome\/([\d.]+)/);
  if (chromeMatch) return chromeMatch[1]!;

  const firefoxMatch = userAgent.match(/Firefox\/([\d.]+)/);
  if (firefoxMatch) return firefoxMatch[1]!;

  return "unknown";
}

/**
 * Detects the operating system from navigator.platform.
 *
 * navigator.platform values:
 * - Windows: "Win32", "Win64"
 * - macOS: "MacIntel", "MacPPC", "Mac68K"
 * - Linux: "Linux x86_64", "Linux armv7l", etc.
 * - ChromeOS: "CrOS" (in user agent, not platform)
 */
function detectOS(platform: string): PlatformInfo["os"] {
  const p = platform.toLowerCase();

  if (p.startsWith("win")) return "win";
  if (p.startsWith("mac")) return "mac";
  if (p.includes("linux")) return "linux";
  if (p.includes("cros")) return "chromeos";

  // Fallback — check user agent for ChromeOS
  if (navigator.userAgent.includes("CrOS")) return "chromeos";

  return "linux"; // Default fallback
}

/**
 * Minimal type for the chrome global object.
 * Only the properties we need for detection.
 */
interface ChromeRuntime {
  runtime?: {
    getManifest?: () => { manifest_version?: number };
    getBrowserInfo?: () => Promise<{ name: string; version: string }>;
  };
}
