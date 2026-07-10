// Stage 1: discover candidate TOS / privacy URLs for a domain — no crawler.
//
// Strategy, best sources first:
//   1. hintUrls forwarded by the request button.
//   2. Open Terms Archive: community-curated ToS/privacy URLs for the service.
//   3. Well-known paths (/terms, /privacy, /legal, ...) on https://{domain}.
//   4. Scan the homepage's <a> tags for links whose text/href look legal.
// The LLM tolerates imperfect page selection, so this stays deliberately simple.

import * as cheerio from "cheerio";
import { fetchHtml, type FetchOptions } from "./fetch.js";
import { lookupOpenTermsArchive } from "./open-terms-archive.js";
import type { Candidate } from "./types.js";

/** Common paths, grouped by the kind of document they usually hold. */
const WELL_KNOWN: Array<{ path: string; kind: Candidate["kind"] }> = [
  { path: "/terms", kind: "terms" },
  { path: "/terms-of-service", kind: "terms" },
  { path: "/terms-of-use", kind: "terms" },
  { path: "/tos", kind: "terms" },
  { path: "/legal/terms", kind: "terms" },
  { path: "/legal", kind: "terms" },
  { path: "/privacy", kind: "privacy" },
  { path: "/privacy-policy", kind: "privacy" },
  { path: "/legal/privacy", kind: "privacy" },
];

/** Classify a link by its visible text + href keywords. */
export function classifyLink(text: string, href: string): Candidate["kind"] | null {
  const hay = `${text} ${href}`.toLowerCase();
  const isPrivacy = /privacy|data protection|gdpr|cookie/.test(hay);
  const isTerms = /terms|conditions|\btos\b|user agreement|legal|eula/.test(hay);
  if (isPrivacy) return "privacy";
  if (isTerms) return "terms";
  return null;
}

/** De-dupe candidates by URL, preserving first-seen order. */
function dedupe(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    const key = c.url.replace(/#.*$/, "").replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export interface DiscoverOptions extends FetchOptions {
  /** URLs forwarded from the request button; treated as high-priority candidates. */
  hintUrls?: string[];
  /** Max candidates to return (keeps LLM cost bounded). */
  max?: number;
  /** Skip the Open Terms Archive lookup (e.g. in tests / offline runs). */
  skipOpenTermsArchive?: boolean;
  /** Optional progress log, forwarded to the OTA lookup. */
  log?: (msg: string) => void;
}

/**
 * Return an ordered, de-duped list of candidate documents for a domain.
 * Order matters: hints first, then Open Terms Archive's curated URLs, then
 * well-known paths, then homepage-scraped links.
 */
export async function discover(
  domain: string,
  opts: DiscoverOptions,
): Promise<Candidate[]> {
  const max = opts.max ?? 4;
  const origin = `https://${domain}`;

  const hinted: Candidate[] = (opts.hintUrls ?? []).map((url) => ({
    url,
    kind: "other" as const,
  }));

  // Open Terms Archive: curated, high-quality URLs when the service is known.
  // Additive and best-effort — a failure or miss just yields no candidates here.
  const fromOta = opts.skipOpenTermsArchive
    ? []
    : await lookupOpenTermsArchive(domain, {
        fetchImpl: opts.fetchImpl,
        log: opts.log,
      }).catch(() => []);

  const wellKnown: Candidate[] = WELL_KNOWN.map((w) => ({
    url: `${origin}${w.path}`,
    kind: w.kind,
  }));

  const fromHomepage = await scrapeHomepageLinks(origin, opts);

  return dedupe([...hinted, ...fromOta, ...fromHomepage, ...wellKnown]).slice(0, max);
}

/** Fetch the homepage and pull out links that look like legal documents. */
async function scrapeHomepageLinks(
  origin: string,
  opts: FetchOptions,
): Promise<Candidate[]> {
  const page = await fetchHtml(origin, opts);
  if (!page) return [];

  const $ = cheerio.load(page.html);
  const found: Candidate[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().trim();
    const kind = classifyLink(text, href);
    if (!kind) return;
    const abs = toAbsolute(href, page.finalUrl);
    if (abs) found.push({ url: abs, kind });
  });
  return found;
}

/** Resolve a possibly-relative href against the page URL; null if invalid. */
export function toAbsolute(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
