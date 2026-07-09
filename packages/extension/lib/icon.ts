import browser from "webextension-polyfill";
import { scoreGrade } from "@autotos/core";
import type { LookupResult } from "./store.js";

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

/**
 * Set the toolbar icon for a single tab to reflect its grade (or the grayed "?").
 * Scoped to the tab so other tabs keep their own state. Best-effort — never throws.
 */
export async function setTabIcon(tabId: number | undefined, state: IconState): Promise<void> {
  if (tabId == null || !action?.setIcon) return;
  try {
    await action.setIcon({ tabId, path: iconPaths(state) });
  } catch {
    // Icon is cosmetic; a failure here must never break the popup.
  }
}
