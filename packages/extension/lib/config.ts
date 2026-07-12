// Central config for where the extension reads data and posts requests.
// These are data/infra endpoints, deliberately not baked into logic elsewhere.

// No custom domain yet, so both dev and production builds talk directly to the
// Cloudflare *.workers.dev URLs. When a custom domain is added later, branch these
// on import.meta.env.DEV (set by WXT/Vite: `wxt dev` => true, `wxt build` => false).

/** CDN base for static analysis artifacts (autotos-data Worker). */
export const STORE_BASE = "https://autotos-data.amascillaro.workers.dev";

/** Worker endpoint that logs a "please analyze this site" request. */
export const REQUEST_ENDPOINT =
  "https://autotos-request.amascillaro.workers.dev/request";

/** Path template for a domain's analysis file. */
export const analysisUrl = (domain: string): string =>
  `${STORE_BASE}/v1/analysis/${encodeURIComponent(domain)}.json`;

/** The derived alias map published alongside the analysis files. */
export const ALIASES_URL = `${STORE_BASE}/v1/aliases.json`;

/** How long a cached alias map is considered fresh (24h). */
export const ALIAS_TTL_MS = 24 * 60 * 60 * 1000;

/** How long a cached per-domain analysis lookup is considered fresh (24h). */
export const ANALYSIS_TTL_MS = 24 * 60 * 60 * 1000;

/** chrome.storage.local keys. */
export const STORAGE_KEYS = {
  aliasCache: "aliasCache",
  requestOutbox: "requestOutbox",
  analysisCache: "analysisCache",
} as const;
