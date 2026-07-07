// Central config for where the extension reads data and posts requests.
// These are data/infra endpoints, deliberately not baked into logic elsewhere.

// Dev builds hit the Cloudflare *.workers.dev preview URLs directly; production
// builds use the custom domains (wired once autotos.me is on Cloudflare). Toggle
// is import.meta.env.DEV, set by WXT/Vite (`wxt dev` => true, `wxt build` => false).
const DEV = import.meta.env.DEV;

/** CDN base for static analysis artifacts (autotos-data Worker / Pages). */
export const STORE_BASE = DEV
  ? "https://autotos-data.amascillaro.workers.dev"
  : "https://data.autotos.me";

/** Worker endpoint that logs a "please analyze this site" request. */
export const REQUEST_ENDPOINT = DEV
  ? "https://autotos-request.amascillaro.workers.dev/request"
  : "https://api.autotos.me/request";

/** Path template for a domain's analysis file. */
export const analysisUrl = (domain: string): string =>
  `${STORE_BASE}/v1/analysis/${encodeURIComponent(domain)}.json`;

/** The derived alias map published alongside the analysis files. */
export const ALIASES_URL = `${STORE_BASE}/v1/aliases.json`;

/** How long a cached alias map is considered fresh (24h). */
export const ALIAS_TTL_MS = 24 * 60 * 60 * 1000;

/** chrome.storage.local keys. */
export const STORAGE_KEYS = {
  aliasCache: "aliasCache",
  requestOutbox: "requestOutbox",
} as const;
