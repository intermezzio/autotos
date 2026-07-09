// The orchestrator: run stages 1–6 for one domain and return a validated
// artifact. All I/O (fetch, LLM, clock) is injected, so the whole pipeline is
// unit-testable without the network or the Anthropic SDK.

import type { DomainAnalysis, Source } from "@autotos/contracts";
import type { FetchLike, FetchedDoc } from "./types.js";
import { discover } from "./discover.js";
import { fetchHtml } from "./fetch.js";
import { extractText, hashContent, isUsable } from "./extract.js";
import { classify } from "./classify.js";
import { verifyFindings } from "./verify.js";
import { emitAnalyzed, emitUnavailable } from "./emit.js";
import type { LLMClient } from "./llm.js";

export interface GenerateDeps {
  fetchImpl: FetchLike;
  llm: LLMClient;
  /** Injected clock -> generatedAt. */
  now: () => string;
  hintUrls?: string[];
  /** Existing artifact (if any) for skip-if-unchanged. */
  existing?: DomainAnalysis | null;
  /** Max candidate documents to fetch/analyze. */
  maxCandidates?: number;
  /** Optional progress log. */
  log?: (msg: string) => void;
}

export interface GenerateResult {
  artifact: DomainAnalysis;
  /** True when we skipped classification because contentHash was unchanged. */
  skipped: boolean;
  rejectedCount: number;
}

/** Combine multiple fetched docs into one text blob + a stable hash. */
function combine(docs: FetchedDoc[]): { text: string; hash: string } {
  // Sort by kind then url so the hash is order-independent across runs.
  const ordered = [...docs].sort((a, b) =>
    (a.kind + a.url).localeCompare(b.kind + b.url),
  );
  const text = ordered
    .map((d) => `### ${d.kind.toUpperCase()} (${d.url})\n${d.text}`)
    .join("\n\n");
  return { text, hash: hashContent(text) };
}

export async function generate(
  domain: string,
  deps: GenerateDeps,
): Promise<GenerateResult> {
  const log = deps.log ?? (() => {});
  const now = deps.now();

  // 1. Discover.
  const candidates = await discover(domain, {
    fetchImpl: deps.fetchImpl,
    hintUrls: deps.hintUrls,
    max: deps.maxCandidates ?? 4,
  });
  if (candidates.length === 0) {
    log(`${domain}: no candidates`);
    return unavailable(domain, now, "no-candidates");
  }

  // 2–3. Fetch + extract each candidate; keep the ones with usable text.
  // Dedupe on finalUrl (post-redirect) to avoid duplicate docs from different candidates.
  const docs: FetchedDoc[] = [];
  const sources: Source[] = [];
  const seenFinalUrls = new Set<string>();
  for (const c of candidates) {
    const page = await fetchHtml(c.url, { fetchImpl: deps.fetchImpl });
    if (!page) continue;
    const text = extractText(page.html);
    if (!isUsable(text)) continue;

    // Normalize finalUrl: strip fragment and trailing slash
    const normalizedUrl = page.finalUrl.replace(/#.*$/, "").replace(/\/$/, "");
    if (seenFinalUrls.has(normalizedUrl)) continue;
    seenFinalUrls.add(normalizedUrl);

    docs.push({ url: page.finalUrl, kind: c.kind, text });
    sources.push({ url: page.finalUrl, kind: c.kind });
  }

  if (docs.length === 0) {
    // Fetched nothing usable — most likely JS-rendered or blocked.
    log(`${domain}: no usable content`);
    return unavailable(domain, now, "empty-content");
  }

  const { text, hash } = combine(docs);

  // Skip-if-unchanged: same content hash => reuse prior findings, bump timestamp.
  if (deps.existing?.contentHash === hash && deps.existing.status === "analyzed") {
    log(`${domain}: unchanged (hash match) — skipping LLM`);
    const artifact = emitAnalyzed({
      domain,
      findings: deps.existing.findings ?? [],
      sources,
      contentHash: hash,
      generatedAt: now,
    });
    return { artifact, skipped: true, rejectedCount: 0 };
  }

  // 4. Classify (grouped per-clause, cached document).
  const raw = await classify(text, { llm: deps.llm });

  // 5. Verify evidence against the source.
  const { findings, rejected } = verifyFindings(raw, text);
  log(
    `${domain}: ${findings.length} findings kept, ${rejected.length} rejected (unverified evidence)`,
  );

  // 6. Score + emit (score is deterministic in @autotos/core).
  const artifact = emitAnalyzed({
    domain,
    findings,
    sources,
    contentHash: hash,
    generatedAt: now,
  });
  return { artifact, skipped: false, rejectedCount: rejected.length };
}

function unavailable(
  domain: string,
  now: string,
  reason: string,
): GenerateResult {
  return {
    artifact: emitUnavailable(domain, now, reason),
    skipped: false,
    rejectedCount: 0,
  };
}
