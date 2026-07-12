import browser from "webextension-polyfill";
import { scoreGrade } from "@autotos/core";
import type { LookupResult } from "./store.js";
import { lookupForUrlCached } from "./analysis-cache.js";

// Sizes we ship per state (must match scripts/gen-icons.mjs output).
const ICON_SIZES = [16, 32, 48, 128] as const;

type IconState = "a" | "b" | "c" | "d" | "e" | "unknown";

/** Map a lookup result to the icon state to show for that tab. */
export function iconStateFor(result: LookupResult): IconState {
  if (result.kind === "hit" && typeof result.analysis.score === "number") {
    return scoreGrade(result.analysis.score).toLowerCase() as IconState;
  }
  // miss / error / not-analyzable / analyzed-without-score => no known grade.
  return "unknown";
}

/** Build the { size: path } map the action API expects for a state. */
function iconPaths(state: IconState): Record<number, string> {
  const paths: Record<number, string> = {};
  for (const size of ICON_SIZES) paths[size] = `icon/${state}-${size}.png`;
  return paths;
}

// MV3 exposes browser.action; MV2 (Firefox) exposes browser.browserAction.
// The polyfill doesn't unify them, so pick whichever this build has.
const action =
  (browser as unknown as { action?: typeof browser.browserAction }).action ??
  browser.browserAction;

// An MV3 service worker has no DOM, so `setIcon({ path })` — which requires the
// browser to decode a PNG from a document context — silently fails there. The
// popup can use `path` fine, but the background (where the on-navigation paints
// happen) cannot. So when OffscreenCanvas is available we decode the PNGs to raw
// ImageData ourselves and pass `{ imageData }`, which works from the worker.
// Decoded bitmaps are cached per state so repeated paints don't re-fetch.
const canDecode =
  typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";

const imageDataCache = new Map<IconState, Record<number, ImageData>>();

async function imageDataFor(state: IconState): Promise<Record<number, ImageData> | null> {
  const cached = imageDataCache.get(state);
  if (cached) return cached;
  try {
    const out: Record<number, ImageData> = {};
    for (const size of ICON_SIZES) {
      const url = browser.runtime.getURL(`icon/${state}-${size}.png` as never);
      const blob = await (await fetch(url)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, size, size);
      out[size] = ctx.getImageData(0, 0, size, size);
    }
    imageDataCache.set(state, out);
    return out;
  } catch {
    return null;
  }
}

/**
 * Set the toolbar icon for a single tab to reflect its grade (or the grayed "?").
 * Scoped to the tab so other tabs keep their own state. Best-effort — never throws.
 *
 * Prefers decoded `imageData` (works from the MV3 background service worker) and
 * falls back to `path` (fine from the popup, and for MV2/Firefox backgrounds).
 */
export async function setTabIcon(tabId: number | undefined, state: IconState): Promise<void> {
  if (tabId == null || !action?.setIcon) return;
  try {
    if (canDecode) {
      const imageData = await imageDataFor(state);
      if (imageData) {
        // The polyfill types `imageData` with its own ImageDataType; the DOM
        // ImageData we produce is structurally identical at runtime.
        await action.setIcon({ tabId, imageData } as Parameters<typeof action.setIcon>[0]);
        return;
      }
    }
    await action.setIcon({ tabId, path: iconPaths(state) });
  } catch {
    // Icon is cosmetic; a failure here must never break the popup.
  }
}

/**
 * Resolve a tab's URL to its grade (cache-first) and paint the toolbar icon.
 * Called on navigation from the background so the icon reflects the site's grade
 * without the user having to open the popup. Best-effort and non-throwing; a URL
 * we can't analyze leaves the default grayed "?" in place.
 */
export async function refreshIconForTab(
  tabId: number | undefined,
  url: string | undefined,
): Promise<void> {
  if (tabId == null || !url) return;
  // Only bother for http(s) pages; chrome://, about:, file:, etc. aren't sites.
  if (!/^https?:\/\//i.test(url)) {
    await setTabIcon(tabId, "unknown");
    return;
  }
  try {
    const result = await lookupForUrlCached(url);
    await setTabIcon(tabId, iconStateFor(result));
  } catch {
    await setTabIcon(tabId, "unknown");
  }
}
