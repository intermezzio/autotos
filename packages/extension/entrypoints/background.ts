import { defineBackground } from "wxt/sandbox";
import browser from "webextension-polyfill";
import { getAliasMap } from "../lib/alias-cache.js";
import { flushOutbox } from "../lib/request-outbox.js";
import { refreshIconForTab } from "../lib/icon.js";

// The AutoTOS background keeps the toolbar icon in sync with the site you're on.
// On every navigation (and tab switch) it resolves the tab's domain and paints
// the A–E grade badge — or the grayed "?" when we have no grade. The lookup is
// cache-first (see analysis-cache.ts), so a domain hits the network at most once
// per TTL; repeat visits are served locally. The popup, when opened, reuses the
// same cache, so opening it never triggers a fresh request for a known site.
export default defineBackground(() => {
  // Prime the alias-map cache in the background (best-effort).
  void getAliasMap().catch(() => {});
  // Deliver any requests queued while the tally Worker was unreachable.
  void flushOutbox().catch(() => {});

  // Paint the icon when a tab navigates. `changeInfo.url` fires the moment the
  // address changes — including same-tab navigation to a *different* site and
  // SPA URL changes — so re-navigating one tab re-checks the new domain. We also
  // catch `status: "complete"`, when `tab.url` is authoritative, as a backstop.
  //
  // The callbacks are `async` and awaited: an MV3 service worker can be torn
  // down once an event listener returns, so a floating `.then()` may be killed
  // before the fetch+paint finishes (this is why switches updated only
  // sometimes). Awaiting keeps the worker alive until the paint completes.
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const url = changeInfo.url ?? (changeInfo.status === "complete" ? tab.url : undefined);
    if (url) await refreshIconForTab(tabId, url);
  });

  // Switching to an existing tab should show that tab's grade immediately.
  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await browser.tabs.get(tabId);
      await refreshIconForTab(tabId, tab.url);
    } catch {
      // Tab may have closed between the event and the lookup; ignore.
    }
  });

  // The listeners above only fire on *future* navigations and tab switches, so
  // tabs that were already open when this worker started (a fresh install, a
  // browser restart, or an MV3 service-worker wake) would sit on the "?" icon
  // until interacted with. Sweep every open tab once at startup so each already-
  // open site gets its grade without needing a click.
  void paintAllOpenTabs();
  browser.runtime.onInstalled.addListener(() => void paintAllOpenTabs());
  browser.runtime.onStartup.addListener(() => void paintAllOpenTabs());
});

/** Resolve and paint the icon for every currently-open tab. Best-effort. */
async function paintAllOpenTabs(): Promise<void> {
  try {
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map((tab) => refreshIconForTab(tab.id, tab.url)));
  } catch {
    // Non-fatal: the per-navigation listeners still cover everything going forward.
  }
}
