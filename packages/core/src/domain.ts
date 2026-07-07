import { getDomain, parse as parseTld } from "tldts";

// Treat private suffixes (github.io, vercel.app, etc.) as public, so that each
// such subdomain is its own registrable site — matching how we key analyses.
const TLD_OPTS = { allowPrivateDomains: true } as const;

/**
 * Normalize any URL or hostname to its registrable domain (eTLD+1).
 *
 * Uses the Public Suffix List (via tldts) so multi-part suffixes are handled
 * correctly: `www.github.com` -> `github.com`, `bbc.co.uk` -> `bbc.co.uk`,
 * `foo.github.io` -> `foo.github.io`.
 *
 * Returns null for inputs that have no registrable domain (IP addresses,
 * `localhost`, browser-internal pages, etc.) — the client should not attempt a
 * lookup in those cases.
 */
export function toRegistrableDomain(input: string): string | null {
  if (!input) return null;

  // tldts accepts both full URLs and bare hostnames.
  const domain = getDomain(input, TLD_OPTS);
  if (!domain) return null;

  return domain.toLowerCase();
}

/**
 * Whether a URL is one the extension should analyze at all. Filters out
 * browser-internal schemes, IPs, and localhost before we ever hit the network.
 */
export function isAnalyzableUrl(input: string): boolean {
  if (!input) return false;

  // Reject non-http(s) schemes (chrome://, about:, file:, moz-extension://, ...).
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  } catch {
    // Not a full URL; fall through and let tldts decide on the hostname.
  }

  const parsed = parseTld(input, TLD_OPTS);
  if (parsed.isIp) return false;
  if (!parsed.domain) return false; // no registrable domain (e.g. localhost)
  return true;
}
