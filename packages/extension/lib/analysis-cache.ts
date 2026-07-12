import browser from "webextension-polyfill";
import { toRegistrableDomain, resolveCanonical } from "@autotos/core";
import type { LookupResult } from "./store.js";
import { lookupForUrl } from "./store.js";
import { getAliasMap } from "./alias-cache.js";
import { ANALYSIS_TTL_MS, STORAGE_KEYS } from "./config.js";

// Local, TTL'd cache of analysis lookups, keyed by canonical domain.
//
// The icon now updates on every navigation (see background.ts), which would
// otherwise mean one CDN request per page view. This cache collapses that to at
// most one network lookup per domain per TTL: repeat visits — and the popup —
// read the cached verdict instead of hitting the network again. A `hit` or
// `miss` is cached (both are stable answers); a transient `error` is not, so we
// retry it next time. Aliases are resolved before the cache key is computed, so
// twitter.com / x.com share one entry.

/** Only stable outcomes are worth caching; errors are transient and re-tried. */
type CacheableResult = Extract<LookupResult, { kind: "hit" | "miss" }>;

interface CacheEntry {
  result: CacheableResult;
  fetchedAt: number; // epoch ms
}

type CacheMap = Record<string, CacheEntry>;

// Keep the cache bounded so it can't grow without limit across a long session.
const MAX_ENTRIES = 500;

async function readCache(): Promise<CacheMap> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEYS.analysisCache);
    const raw = stored[STORAGE_KEYS.analysisCache];
    return raw && typeof raw === "object" ? (raw as CacheMap) : {};
  } catch {
    return {};
  }
}

async function writeCache(map: CacheMap): Promise<void> {
  try {
    // Evict oldest entries if we're over the cap (roughly LRU by fetch time).
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      const sorted = keys.sort(
        (a, b) => (map[a]?.fetchedAt ?? 0) - (map[b]?.fetchedAt ?? 0),
      );
      for (const k of sorted.slice(0, keys.length - MAX_ENTRIES)) delete map[k];
    }
    await browser.storage.local.set({ [STORAGE_KEYS.analysisCache]: map });
  } catch {
    // Best-effort: caching is an optimization, never a hard dependency.
  }
}

/** Resolve a page URL to the canonical domain we'd look up, or null. */
async function canonicalDomainForUrl(pageUrl: string): Promise<string | null> {
  const registrable = toRegistrableDomain(pageUrl);
  if (!registrable) return null;
  const aliasMap = await getAliasMap();
  return resolveCanonical(registrable, aliasMap);
}

/**
 * Cache-first read path. Returns the same LookupResult as `lookupForUrl`, but
 * serves a fresh cached answer without a network call when one exists, and
 * populates the cache on a miss. Non-analyzable pages short-circuit with no I/O.
 */
export async function lookupForUrlCached(
  pageUrl: string,
  now: number = Date.now(),
): Promise<LookupResult> {
  const domain = await canonicalDomainForUrl(pageUrl);
  if (!domain) return { kind: "not-analyzable" };

  const cache = await readCache();
  const entry = cache[domain];
  if (entry && now - entry.fetchedAt < ANALYSIS_TTL_MS) {
    return entry.result; // fresh — no network
  }

  const result = await lookupForUrl(pageUrl);
  if (result.kind === "hit" || result.kind === "miss") {
    cache[domain] = { result, fetchedAt: now };
    await writeCache(cache);
  }
  return result;
}

/**
 * Drop a domain's cached entry so the next lookup re-fetches it — e.g. right
 * after the user requests analysis for a currently-missing site, so a freshly
 * published grade shows up without waiting out the TTL.
 */
export async function invalidateDomain(domain: string): Promise<void> {
  const cache = await readCache();
  if (cache[domain]) {
    delete cache[domain];
    await writeCache(cache);
  }
}
