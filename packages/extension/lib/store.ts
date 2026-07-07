import {
  lookupAnalysis,
  requestAnalysis as coreRequestAnalysis,
  type LookupResult,
  type RequestOutcome,
} from "@autotos/core";
import { getAliasMap } from "./alias-cache.js";
import { enqueuePending, flushOutbox } from "./request-outbox.js";
import { analysisUrl, REQUEST_ENDPOINT } from "./config.js";

export type { LookupResult, RequestOutcome };

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

/**
 * The "request analysis" button. User-initiated; sends only the canonical domain.
 *
 * Before sending, we opportunistically flush any requests queued during a prior
 * outage. If this request itself can't reach the Worker, we persist it to the
 * local outbox so it isn't lost — the extension stays useful even when the tally
 * Worker is down. A queued-but-undelivered request is still reported as `queued`
 * to the user, since it will be delivered on a later flush.
 */
export async function requestAnalysis(
  domain: string,
  hintUrls?: string[],
): Promise<RequestOutcome> {
  await flushOutbox();

  const res = await coreRequestAnalysis(domain, hintUrls, {
    fetchImpl: (input, init) => fetch(input, init as RequestInit),
    endpoint: REQUEST_ENDPOINT,
  });

  if (res.status === "unreachable") {
    await enqueuePending(domain, hintUrls);
    return {
      ok: true,
      status: "queued",
      message: "Saved — we'll send this as soon as we're back online.",
    };
  }
  return res;
}

/** Best-effort delivery of any requests queued during an earlier outage. */
export { flushOutbox };
