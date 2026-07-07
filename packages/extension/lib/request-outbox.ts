import browser from "webextension-polyfill";
import { requestAnalysis as coreRequestAnalysis } from "@autotos/core";
import { REQUEST_ENDPOINT, STORAGE_KEYS } from "./config.js";

/** Cheap sanity check mirroring the contract's DomainName shape. */
function isValidDomain(d: unknown): d is string {
  return typeof d === "string" && d.length <= 253 && d.includes(".") && /^[a-z0-9.-]+$/.test(d);
}

/**
 * Soft fallback for the "request analysis" button when the tally Worker is down.
 *
 * The whole read path (analysis lookups) is served from the static CDN and never
 * touches the Worker, so the extension keeps working when the Worker is offline.
 * The one Worker-dependent action is the request button. Rather than lose a click
 * to a transient outage, we persist un-delivered requests to a local outbox and
 * flush them later (on the next popup open / background startup). The Worker's
 * tally is idempotent-per-domain for queueing (it counts every hit but enqueues
 * once), so a replayed request is safe.
 */

interface PendingRequest {
  domain: string;
  hintUrls?: string[];
  queuedAt: number; // epoch ms
}

const MAX_PENDING = 50;
const browserFetch = (input: string, init?: unknown) => fetch(input, init as RequestInit);

async function readOutbox(): Promise<PendingRequest[]> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEYS.requestOutbox);
    const raw = stored[STORAGE_KEYS.requestOutbox];
    if (!Array.isArray(raw)) return [];
    // Keep only well-formed, valid-domain entries; drop anything corrupt.
    return raw.filter(
      (r): r is PendingRequest =>
        !!r && typeof r === "object" && isValidDomain((r as PendingRequest).domain),
    );
  } catch {
    return [];
  }
}

async function writeOutbox(pending: PendingRequest[]): Promise<void> {
  try {
    await browser.storage.local.set({
      [STORAGE_KEYS.requestOutbox]: pending.slice(-MAX_PENDING),
    });
  } catch {
    // Best-effort: if storage is unavailable the request is simply not retried.
  }
}

/** Persist a request that couldn't be delivered, de-duped by domain. */
export async function enqueuePending(
  domain: string,
  hintUrls: string[] | undefined,
  now: number = Date.now(),
): Promise<void> {
  const pending = await readOutbox();
  const existing = pending.find((p) => p.domain === domain);
  if (existing) {
    existing.queuedAt = now; // refresh; a repeat click is still one pending item
  } else {
    pending.push({ domain, ...(hintUrls?.length ? { hintUrls } : {}), queuedAt: now });
  }
  await writeOutbox(pending);
}

/** Whether a domain is already sitting in the outbox awaiting delivery. */
export async function hasPending(domain: string): Promise<boolean> {
  return (await readOutbox()).some((p) => p.domain === domain);
}

/**
 * Attempt to deliver every queued request. Delivered and Worker-rejected items
 * are dropped; only genuinely-unreachable items stay for the next flush. Safe to
 * call opportunistically (popup open, background startup) — it no-ops on an empty
 * outbox and never throws.
 */
export async function flushOutbox(): Promise<void> {
  const pending = await readOutbox();
  if (pending.length === 0) return;

  const stillPending: PendingRequest[] = [];
  for (const item of pending) {
    const res = await coreRequestAnalysis(item.domain, item.hintUrls, {
      fetchImpl: browserFetch,
      endpoint: REQUEST_ENDPOINT,
    });
    // Keep only if the Worker was unreachable; a real answer (queued /
    // already_present / rejected) is terminal, so we stop retrying it.
    if (res.status === "unreachable") stillPending.push(item);
  }

  if (stillPending.length !== pending.length) await writeOutbox(stillPending);
}
