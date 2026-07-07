import type { AnalysisRequestResponse } from "@autotos/contracts";
import {
  lookupAnalysis,
  requestAnalysis as coreRequestAnalysis,
  type LookupResult,
} from "@autotos/core";
import { getAliasMap } from "./alias-cache.js";
import { analysisUrl, REQUEST_ENDPOINT } from "./config.js";

export type { LookupResult };

/**
 * The extension's read path: pull the cached alias map, then delegate to the
 * platform-agnostic lookup in @autotos/core using the browser's fetch.
 */
export async function lookupForUrl(pageUrl: string): Promise<LookupResult> {
  const aliasMap = await getAliasMap();
  return lookupAnalysis(pageUrl, {
    aliasMap,
    fetchImpl: (input, init) => fetch(input, init as RequestInit),
    analysisUrl,
  });
}

/** The "request analysis" button. User-initiated; sends only the canonical domain. */
export async function requestAnalysis(
  domain: string,
  hintUrls?: string[],
): Promise<AnalysisRequestResponse> {
  return coreRequestAnalysis(domain, hintUrls, {
    fetchImpl: (input, init) => fetch(input, init as RequestInit),
    endpoint: REQUEST_ENDPOINT,
  });
}
