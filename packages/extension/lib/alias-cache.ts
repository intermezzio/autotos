import browser from "webextension-polyfill";
import { AliasMapSchema, type AliasMap } from "@autotos/contracts";
import { ALIASES_URL, ALIAS_TTL_MS, STORAGE_KEYS } from "./config.js";

interface CachedAliasMap {
  map: AliasMap;
  fetchedAt: number; // epoch ms
}

/**
 * Fetch-once, cache-aggressively alias map.
 *
 * Persisted in chrome.storage.local (survives MV3 service-worker restarts).
 * On lookup we serve the cached copy immediately and refresh in the background
 * when stale, so a user's lookup never blocks on the alias fetch. If the network
 * fails we keep using the last-known map (stale-if-error) — aliases are an
 * optimization, not a hard dependency.
 *
 * Because the map lives on the CDN, adding a new alias needs no extension
 * release: publish the updated aliases.json and clients pick it up within the TTL.
 */
export async function getAliasMap(now: number = Date.now()): Promise<AliasMap | null> {
  const cached = await readCache();

  if (cached && now - cached.fetchedAt < ALIAS_TTL_MS) {
    return cached.map; // fresh
  }

  // Stale or missing: try to refresh.
  const fresh = await fetchAliasMap();
  if (fresh) {
    await writeCache({ map: fresh, fetchedAt: now });
    return fresh;
  }

  // Refresh failed — fall back to whatever we have (may be stale, may be null).
  return cached?.map ?? null;
}

async function fetchAliasMap(): Promise<AliasMap | null> {
  try {
    const res = await fetch(ALIASES_URL, { cache: "no-cache" });
    if (!res.ok) return null;
    const parsed = AliasMapSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readCache(): Promise<CachedAliasMap | null> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEYS.aliasCache);
    const raw = stored[STORAGE_KEYS.aliasCache] as CachedAliasMap | undefined;
    if (!raw) return null;
    const parsed = AliasMapSchema.safeParse(raw.map);
    if (!parsed.success) return null;
    return { map: parsed.data, fetchedAt: raw.fetchedAt };
  } catch {
    return null;
  }
}

async function writeCache(value: CachedAliasMap): Promise<void> {
  try {
    await browser.storage.local.set({ [STORAGE_KEYS.aliasCache]: value });
  } catch {
    // Non-fatal: caching is best-effort.
  }
}
