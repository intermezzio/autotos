import {
  safeParseDomainAnalysis,
  AnalysisRequestResponseSchema,
  type DomainAnalysis,
  type AnalysisRequest,
  type AnalysisRequestResponse,
  type AliasMap,
} from "@autotos/contracts";
import { toRegistrableDomain } from "./domain.js";
import { resolveCanonical } from "./alias.js";

/** Result of a lookup, as a discriminated union the caller renders from. */
export type LookupResult =
  | { kind: "hit"; domain: string; analysis: DomainAnalysis }
  | { kind: "miss"; domain: string }
  | { kind: "not-analyzable" }
  | { kind: "error"; domain: string; message: string };

/** Minimal fetch signature so callers can inject the platform fetch (or a mock). */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; cache?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface LookupDeps {
  /** Resolved alias map ({ alias -> canonical }); null/undefined if unavailable. */
  aliasMap?: AliasMap | null;
  /** Platform fetch implementation. */
  fetchImpl: FetchLike;
  /** Builds the analysis URL for a canonical domain. */
  analysisUrl: (domain: string) => string;
}

/**
 * The whole read path for a page URL:
 *   1. normalize to eTLD+1
 *   2. resolve aliases to the canonical domain
 *   3. GET the static analysis file
 *   4. validate against the contract
 *   5. follow a server-side aliasOf pointer at most once
 *
 * Pure w.r.t. the browser: all I/O is injected via `deps`.
 */
export async function lookupAnalysis(
  pageUrl: string,
  deps: LookupDeps,
): Promise<LookupResult> {
  const registrable = toRegistrableDomain(pageUrl);
  if (!registrable) return { kind: "not-analyzable" };

  const domain = resolveCanonical(registrable, deps.aliasMap);
  const result = await fetchDomain(domain, deps);

  // If the artifact declares itself an alias of another domain and isn't itself
  // analyzed, follow the pointer exactly once (belt & suspenders alongside the
  // client-side alias map).
  if (result.kind === "alias" && result.aliasOf !== domain) {
    const followed = await fetchDomain(result.aliasOf, deps);
    return followed.kind === "hit"
      ? followed
      : { kind: "miss", domain: result.aliasOf };
  }
  if (result.kind === "alias") return { kind: "miss", domain };
  return result;
}

type FetchDomainResult = LookupResult | { kind: "alias"; aliasOf: string };

async function fetchDomain(
  domain: string,
  deps: LookupDeps,
): Promise<FetchDomainResult> {
  try {
    const res = await deps.fetchImpl(deps.analysisUrl(domain), { cache: "default" });
    if (res.status === 404) return { kind: "miss", domain };
    if (!res.ok) return { kind: "error", domain, message: `HTTP ${res.status}` };

    const parsed = safeParseDomainAnalysis(await res.json());
    if (!parsed.success) {
      return { kind: "error", domain, message: "Invalid analysis format" };
    }

    const analysis = parsed.data;
    if (analysis.status !== "analyzed") {
      return analysis.aliasOf
        ? { kind: "alias", aliasOf: analysis.aliasOf }
        : { kind: "miss", domain };
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

export interface RequestDeps {
  fetchImpl: FetchLike;
  endpoint: string;
}

/**
 * Outcome of a request attempt, as seen by the client. Extends the wire status
 * with a client-only `"unreachable"`: the Worker (or network) couldn't be
 * reached, so nothing was recorded and the caller may safely retry later.
 * `rejected` means the Worker *did* answer and declined — do NOT retry.
 */
export type RequestStatus = AnalysisRequestResponse["status"] | "unreachable";

export interface RequestOutcome {
  ok: boolean;
  status: RequestStatus;
  count?: number;
  message?: string;
}

/** Build the request body, clamping hintUrls to the contract's max of 8. */
export function buildAnalysisRequest(
  domain: string,
  hintUrls?: string[],
): AnalysisRequest {
  return {
    domain,
    ...(hintUrls && hintUrls.length ? { hintUrls: hintUrls.slice(0, 8) } : {}),
  };
}

/**
 * The "request analysis" button. Explicit, user-initiated — the caller passes
 * only a canonical domain (and optional page-URL hints); we never auto-send data.
 */
export async function requestAnalysis(
  domain: string,
  hintUrls: string[] | undefined,
  deps: RequestDeps,
): Promise<RequestOutcome> {
  const body = buildAnalysisRequest(domain, hintUrls);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await deps.fetchImpl(deps.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Transport failure: the Worker was never reached. Nothing recorded, so the
    // caller can queue this and retry — distinct from a Worker-side rejection.
    return {
      ok: false,
      status: "unreachable",
      message: err instanceof Error ? err.message : "Network error",
    };
  }

  // A 5xx is the Worker (or its edge) failing, not a considered rejection —
  // treat it as retryable too. Only a well-formed answer or a 4xx is terminal.
  if (res.status >= 500) {
    return { ok: false, status: "unreachable", message: `HTTP ${res.status}` };
  }

  try {
    const parsed = AnalysisRequestResponseSchema.safeParse(await res.json());
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to the HTTP-code-based outcome below
  }
  return { ok: res.ok, status: res.ok ? "queued" : "rejected" };
}
