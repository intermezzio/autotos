import { defineConfig } from "wxt";

// AutoTOS extension config. One source tree, per-browser manifests emitted by WXT.
// `webextension-polyfill` (aliased below) lets us write `browser.*` promises on
// all three targets (Chrome shims it over chrome.*; Firefox/Safari use it natively).
export default defineConfig({
  manifest: ({ browser }) => ({
    name: "AutoTOS",
    description:
      "See how fair a website's Terms of Service are — flagged clauses and a 0–10 fairness score, right in your browser.",
    // Project homepage; the store listings also link the privacy policy hosted
    // as a raw file in this repo (see PRIVACY.md).
    homepage_url: "https://github.com/intermezzio/autotos",
    // Permissions we actually need:
    //  - activeTab: read the current tab's URL when the popup is opened.
    //  - tabs: observe navigations/tab switches in the background so the toolbar
    //    icon can reflect each site's grade automatically (activeTab only grants
    //    URL access on click, which isn't enough for the on-navigation icon).
    //  - storage: persist the alias map, per-domain analysis cache, and outbox.
    // Still no broad host permissions and no page-content access — we only ever
    // read a tab's URL and reduce it to its registrable domain.
    permissions: ["activeTab", "tabs", "storage"],
    // The store host (CDN) and the request endpoint (Worker) we talk to.
    // No custom domain yet — the *.workers.dev URLs are the live endpoints.
    host_permissions: [
      "https://autotos-data.amascillaro.workers.dev/*",
      "https://autotos-request.amascillaro.workers.dev/*",
    ],
    // Default (per-tab) toolbar icon: grayed "?" until we know the site's grade.
    // The popup swaps in the A–E badge for a tab once it's looked up (activeTab).
    action: {
      default_title: "AutoTOS",
      default_popup: "popup.html",
      default_icon: {
        16: "icon/unknown-16.png",
        32: "icon/unknown-32.png",
      },
    },
    icons: {
      16: "icon/unknown-16.png",
      32: "icon/unknown-32.png",
      48: "icon/unknown-48.png",
      128: "icon/unknown-128.png",
    },
    // Firefox requires an explicit add-on id.
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "autotos@amascillaro.workers.dev",
              strict_min_version: "115.0",
            },
          },
        }
      : {}),
  }),
  // Alias the webextension namespace to the polyfill so `browser` is uniform.
  alias: {},
});
