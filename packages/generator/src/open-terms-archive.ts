// Open Terms Archive (OTA) lookup: given a domain, find the curated ToS/privacy
// document URLs a community has already mapped for that service.
//
// OTA (opentermsarchive.org) publishes ~hundreds of "service declarations" in the
// OpenTermsArchive/contrib-declarations repo. Each is a JSON file named by SERVICE
// (e.g. "GitHub.json"), not by domain, of the shape:
//
//   { "name": "GitHub",
//     "terms": {
//       "Terms of Service": { "fetch": "https://docs.github.com/.../github-terms-of-service", ... },
//       "Privacy Policy":   { "fetch": "https://docs.github.com/.../github-privacy-statement", ... } } }
//
// There's no domain->service index, so we resolve a domain by:
//   1. Guessing the likely filename(s) from the domain and probing raw.githubusercontent
//      (cheap, no rate limit — it's a CDN), then, if that misses,
//   2. Listing the declarations/ directory via the GitHub API (60 req/hr unauth) and
//      matching a file whose declaration document URLs live on the target eTLD+1.
//
// This module only LOCATES candidate URLs; fetching/extraction stay in the pipeline.

import { toRegistrableDomain } from "@autotos/core";
import type { Candidate, FetchLike } from "./types.js";

const RAW_BASE =
  "https://raw.githubusercontent.com/OpenTermsArchive/contrib-declarations/main/declarations";
const CONTENTS_API =
  "https://api.github.com/repos/OpenTermsArchive/contrib-declarations/contents/declarations";

/** Map OTA document-type names to our candidate kinds. Unknown types are skipped. */
const TYPE_TO_KIND: Record<string, Candidate["kind"]> = {
  "Terms of Service": "terms",
  "Terms and Conditions": "terms",
  "Terms of Use": "terms",
  "Privacy Policy": "privacy",
  "Privacy Notice": "privacy",
  "Cookies Policy": "privacy",
  "Trackers Policy": "privacy",
};

/** One OTA declaration document entry (only the fields we use). */
interface OtaTermEntry {
  fetch?: string;
}
interface OtaDeclaration {
  name?: string;
  terms?: Record<string, OtaTermEntry>;
}

export interface OtaLookupOptions {
  fetchImpl: FetchLike;
  /** Cap on directory-listing probes; also bounds work when the guess misses. */
  timeoutMs?: number;
  log?: (msg: string) => void;
}

/**
 * Look up curated ToS/privacy candidate URLs for a domain from Open Terms Archive.
 * Returns [] when the service isn't in OTA or the lookup fails — callers treat OTA
 * as an additive source, never a hard dependency.
 */
export async function lookupOpenTermsArchive(
  domain: string,
  opts: OtaLookupOptions,
): Promise<Candidate[]> {
  const log = opts.log ?? (() => {});
  const registrable = toRegistrableDomain(domain) ?? domain;

  // 1. Try likely filenames directly against the raw CDN (no rate limit).
  for (const name of guessServiceFilenames(registrable)) {
    const decl = await fetchDeclaration(`${RAW_BASE}/${encodeURIComponent(name)}`, opts);
    if (decl && declarationMatchesDomain(decl, registrable)) {
      log(`OTA: matched "${decl.name ?? name}" by filename guess`);
      return candidatesFrom(decl, registrable);
    }
  }

  // 2. Fall back to the directory listing and match by document hostname.
  const name = await findServiceViaListing(registrable, opts);
  if (!name) {
    log(`OTA: no declaration found for ${registrable}`);
    return [];
  }
  const decl = await fetchDeclaration(`${RAW_BASE}/${encodeURIComponent(name)}`, opts);
  if (!decl) return [];
  log(`OTA: matched "${decl.name ?? name}" via directory listing`);
  return candidatesFrom(decl, registrable);
}

/**
 * Candidate service filenames for a domain, most-likely first. OTA names files by
 * a human service name ("GitHub.json"), so we derive plausible spellings from the
 * domain's second-level label: "github.com" -> ["Github", "GitHub"], plus the raw
 * label. Cheap to probe; a miss just falls through to the listing.
 */
export function guessServiceFilenames(registrable: string): string[] {
  const label = registrable.split(".")[0] ?? registrable;
  if (!label) return [];
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  const names = new Set<string>([cap, label, label.toUpperCase()]);
  return [...names].map((n) => `${n}.json`);
}

/** Fetch + parse one declaration; null on any failure or non-JSON. */
async function fetchDeclaration(
  url: string,
  opts: OtaLookupOptions,
): Promise<OtaDeclaration | null> {
  try {
    const res = await opts.fetchImpl(url, {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const parsed = JSON.parse(await res.text()) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const decl = parsed as OtaDeclaration;
    if (!decl.terms || typeof decl.terms !== "object") return null;
    return decl;
  } catch {
    return null;
  }
}

/** True if any of the declaration's document URLs is on the target eTLD+1. */
function declarationMatchesDomain(decl: OtaDeclaration, registrable: string): boolean {
  for (const entry of Object.values(decl.terms ?? {})) {
    if (entry.fetch && hostRegistrable(entry.fetch) === registrable) return true;
  }
  return false;
}

/** Turn a matched declaration into ordered candidates (terms before privacy). */
function candidatesFrom(decl: OtaDeclaration, registrable: string): Candidate[] {
  const out: Candidate[] = [];
  for (const [type, entry] of Object.entries(decl.terms ?? {})) {
    const kind = TYPE_TO_KIND[type];
    if (!kind || !entry.fetch) continue;
    // Only keep documents that actually live on the requested domain, so a
    // declaration bundling third-party docs (e.g. an AdSense link) can't drag in
    // off-domain URLs.
    if (hostRegistrable(entry.fetch) !== registrable) continue;
    out.push({ url: entry.fetch, kind });
  }
  // terms first, then privacy — matches the rest of the pipeline's ordering.
  return out.sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
}

function kindRank(kind: Candidate["kind"]): number {
  return kind === "terms" ? 0 : kind === "privacy" ? 1 : 2;
}

/**
 * List the declarations/ directory and return the filename whose declaration maps
 * to the target domain. One GitHub API call (60/hr unauth) + up to a few raw
 * fetches for the name-prefix matches. null if nothing matches.
 */
async function findServiceViaListing(
  registrable: string,
  opts: OtaLookupOptions,
): Promise<string | null> {
  let entries: Array<{ name: string }>;
  try {
    const res = await opts.fetchImpl(CONTENTS_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "AutoTOSBot" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const parsed = JSON.parse(await res.text()) as unknown;
    if (!Array.isArray(parsed)) return null;
    entries = parsed as Array<{ name: string }>;
  } catch {
    return null;
  }

  // Consider only real declarations (skip *.history.json), and prioritize files
  // whose name shares the domain's label so we probe the fewest raw files.
  const label = (registrable.split(".")[0] ?? "").toLowerCase();
  const candidates = entries
    .map((e) => e.name)
    .filter((n) => n.endsWith(".json") && !n.endsWith(".history.json"))
    .sort((a, b) => nameAffinity(b, label) - nameAffinity(a, label));

  // Probe in affinity order, but bound the work: only fetch declarations whose
  // name plausibly relates to the label, then confirm by document hostname.
  for (const name of candidates) {
    if (nameAffinity(name, label) === 0) break; // no more plausible names
    const decl = await fetchDeclaration(`${RAW_BASE}/${encodeURIComponent(name)}`, opts);
    if (decl && declarationMatchesDomain(decl, registrable)) return name;
  }
  return null;
}

/** Higher = the filename more likely belongs to this domain label. */
function nameAffinity(fileName: string, label: string): number {
  if (!label) return 0;
  const base = fileName.replace(/\.json$/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const l = label.replace(/[^a-z0-9]/g, "");
  if (!l) return 0;
  if (base === l) return 3;
  if (base.startsWith(l) || l.startsWith(base)) return 2;
  if (base.includes(l) || l.includes(base)) return 1;
  return 0;
}

/** Registrable domain (eTLD+1) of a URL's host, or "" if unparseable. */
function hostRegistrable(url: string): string {
  return toRegistrableDomain(url) ?? "";
}
