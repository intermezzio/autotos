// Central config for where the extension reads data and posts requests.
// These are data/infra endpoints, deliberately not baked into logic elsewhere.

/** CDN base for static analysis artifacts (Cloudflare Pages -> autotos-data). */
export const STORE_BASE = "https://data.autotos.me";

/** Path template for a domain's analysis file. */
export const analysisUrl = (domain: string): string =>
  `${STORE_BASE}/v1/analysis/${encodeURIComponent(domain)}.json`;

/** The derived alias map published alongside the analysis files. */
export const ALIASES_URL = `${STORE_BASE}/v1/aliases.json`;

/** Worker endpoint that logs a "please analyze this site" request. */
export const REQUEST_ENDPOINT = "https://api.autotos.me/request";

/** How long a cached alias map is considered fresh (24h). */
export const ALIAS_TTL_MS = 24 * 60 * 60 * 1000;

/** chrome.storage.local keys. */
export const STORAGE_KEYS = {
  aliasCache: "aliasCache",
} as const;
