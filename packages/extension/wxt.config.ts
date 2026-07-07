import { defineConfig } from "wxt";

// AutoTOS extension config. One source tree, per-browser manifests emitted by WXT.
// `webextension-polyfill` (aliased below) lets us write `browser.*` promises on
// all three targets (Chrome shims it over chrome.*; Firefox/Safari use it natively).
export default defineConfig({
  manifest: ({ browser }) => ({
    name: "AutoTOS",
    description:
      "See how fair a website's Terms of Service are — flagged clauses and a 0–10 fairness score, right in your browser.",
    // Only permissions we actually need: read the active tab's URL on click,
    // and persist the alias cache. No broad host permissions — the content
    // script derives the domain locally and the popup does the network calls.
    permissions: ["activeTab", "storage"],
    // The store host (CDN) and the request endpoint (Worker) we talk to.
    // Production custom domains + the *.workers.dev preview URLs used by dev builds.
    host_permissions: [
      "https://data.autotos.me/*",
      "https://api.autotos.me/*",
      "https://autotos-data.amascillaro.workers.dev/*",
      "https://autotos-request.amascillaro.workers.dev/*",
    ],
    action: {
      default_title: "AutoTOS",
      default_popup: "popup.html",
    },
    // Firefox requires an explicit add-on id.
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "autotos@autotos.me",
              strict_min_version: "115.0",
            },
          },
        }
      : {}),
  }),
  // Alias the webextension namespace to the polyfill so `browser` is uniform.
  alias: {},
});
