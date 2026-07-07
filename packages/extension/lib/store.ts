import {
  safeParseDomainAnalysis,
  type DomainAnalysis,
  type AnalysisRequest,
  AnalysisRequestResponseSchema,
  type AnalysisRequestResponse,
} from "@autotos/contracts";
import { toRegistrableDomain, resolveCanonical } from "@autotos/core";
import { getAliasMap } from "./alias-cache.js";
import { analysisUrl, REQUEST_ENDPOINT } from "./config.js";

export type LookupResult =
  | { kind: "hit"; domain: string; analysis: DomainAnalysis }
  | { kind: "miss"; domain: string }
  | { kind: "not-analyzable" }
  | { kind: "error"; domain: string; message: string };

/**
 * The whole read path for a given page URL:
 *   1. normalize to eTLD+1
 *   2. resolve aliases to the canonical domain
 *   3. GET the static analysis file from the CDN
 *   4. validate against the contract
 *
 * Returns a discriminated result; the caller (popup) decides how to render.
 */
export async function lookupForUrl(pageUrl: string): Promise<LookupResult> {
  const registrable = toRegistrableDomain(pageUrl);
  if (!registrable) return { kind: "not-analyzable" };

  const aliasMap = await getAliasMap();
  const domain = resolveCanonical(registrable, aliasMap);

  try {
    const res = await fetch(analysisUrl(domain), { cache: "default" });

    if (res.status === 404) return { kind: "miss", domain };
    if (!res.ok) {
      return { kind: "error", domain, message: `HTTP ${res.status}` };
    }

    const parsed = safeParseDomainAnalysis(await res.json());
    if (!parsed.success) {
      return { kind: "error", domain, message: "Invalid analysis format" };
    }

    const analysis = parsed.data;

    // An artifact may itself declare it is an alias of another domain (belt &
    // suspenders alongside the client-side alias map) — follow it once.
    if (analysis.status !== "analyzed" && analysis.aliasOf) {
      return lookupForDomain(analysis.aliasOf);
    }
    if (analysis.status !== "analyzed") {
      return { kind: "miss", domain };
    }

    return { kind: "hit", domain, analysis };
  } catch (err) {
    return {
      kind: "error",
      domain,
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}

/** Fetch analysis for an already-canonical domain (used for aliasOf follow). */
async function lookupForDomain(domain: string): Promise<LookupResult> {
  try {
    const res = await fetch(analysisUrl(domain), { cache: "default" });
    if (res.status === 404) return { kind: "miss", domain };
    if (!res.ok) return { kind: "error", domain, message: `HTTP ${res.status}` };
    const parsed = safeParseDomainAnalysis(await res.json());
    if (!parsed.success || parsed.data.status !== "analyzed") {
      return { kind: "miss", domain };
    }
    return { kind: "hit", domain, analysis: parsed.data };
  } catch (err) {
    return {
      kind: "error",
      domain,
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}

/**
 * The "request analysis" button. Explicit, user-initiated — we only ever send a
 * domain to the server when the user asks us to, never automatically (privacy).
 */
export async function requestAnalysis(
  domain: string,
  hintUrls?: string[],
): Promise<AnalysisRequestResponse> {
  const body: AnalysisRequest = {
    domain,
    ...(hintUrls && hintUrls.length ? { hintUrls: hintUrls.slice(0, 8) } : {}),
  };

  try {
    const res = await fetch(REQUEST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = AnalysisRequestResponseSchema.safeParse(await res.json());
    if (parsed.success) return parsed.data;
    return { ok: res.ok, status: res.ok ? "queued" : "rejected" };
  } catch (err) {
    return {
      ok: false,
      status: "rejected",
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}
