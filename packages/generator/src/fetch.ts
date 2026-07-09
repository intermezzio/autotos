// Stage 2: fetch a URL over plain HTTP (no browser). Wraps a FetchLike with a
// timeout, a realistic UA + Accept-Language, redirect following, a response-size
// cap, and one retry on transient failure. Returns raw HTML or null.

import type { FetchLike } from "./types.js";

export interface FetchOptions {
  fetchImpl: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  maxMetaRefreshHops?: number;
}

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; AutoTOSBot/1.0; +https://github.com/intermezzio/autotos)";
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MAX_BYTES = 3_000_000; // 3 MB of HTML is plenty for a legal page
const DEFAULT_MAX_META_REFRESH_HOPS = 3;

export interface FetchedHtml {
  finalUrl: string;
  html: string;
  contentType: string;
}

/**
 * Extract a meta-refresh URL from HTML if present.
 * Matches: <meta http-equiv="refresh" content="0; URL=https://...">
 */
function parseMetaRefresh(html: string): string | null {
  const match = html.match(
    /<meta\s+http-equiv=["']?refresh["']?\s+content=["']?\d+;\s*url=([^"'\s>]+)/i,
  );
  return match?.[1] ?? null;
}

/**
 * Fetch a single URL. Returns null on any failure (non-2xx, non-HTML, too big,
 * timeout, network error) — the caller treats a null as "this candidate didn't
 * work" and moves on.
 */
export async function fetchHtml(
  url: string,
  opts: FetchOptions,
): Promise<FetchedHtml | null> {
  const {
    fetchImpl,
    timeoutMs = DEFAULT_TIMEOUT,
    maxBytes = DEFAULT_MAX_BYTES,
    userAgent = DEFAULT_UA,
    maxMetaRefreshHops = DEFAULT_MAX_META_REFRESH_HOPS,
  } = opts;

  const attempt = async (targetUrl: string): Promise<FetchedHtml | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(targetUrl, {
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        // signal is passed via the underlying fetch when the real impl supports it;
        // FetchLike keeps the surface minimal so mocks stay simple.
        ...(controller.signal ? { signal: controller.signal } : {}),
      } as never);

      if (!res.ok) return null;
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType && !/html|xml|text\/plain/i.test(contentType)) return null;

      const html = await res.text();
      if (html.length > maxBytes) return null;
      return { finalUrl: res.url || targetUrl, html, contentType };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const followMetaRefresh = async (
    result: FetchedHtml,
    depth: number,
  ): Promise<FetchedHtml | null> => {
    if (depth >= maxMetaRefreshHops) return result;

    const refreshUrl = parseMetaRefresh(result.html);
    if (!refreshUrl) return result;

    // Resolve relative URLs
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(refreshUrl, result.finalUrl).toString();
    } catch {
      return result; // Invalid URL; return what we have
    }

    // Avoid self-refresh loops
    if (absoluteUrl === result.finalUrl) return result;

    const nextPage = await attempt(absoluteUrl);
    if (!nextPage) return result; // Can't follow; return what we have

    // Recursively follow further meta-refreshes
    return followMetaRefresh(nextPage, depth + 1);
  };

  let first = await attempt(url);
  if (!first) {
    // One retry — transient network / rate-limit blips are common.
    first = await attempt(url);
  }
  if (!first) return null;

  // Follow meta-refresh redirects
  return followMetaRefresh(first, 0);
}
