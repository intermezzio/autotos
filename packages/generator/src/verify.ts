// Stage 5: the hallucination firewall.
//
// A finding survives only if its evidence appears (near-)verbatim in the source
// text. The schema already REQUIRES evidence; this ENFORCES that it is real.
// We compare on whitespace-normalized text so trivial spacing differences don't
// cause false rejections, but we do not accept paraphrases.

import { getClause, type Finding } from "@autotos/contracts";
import type { RawFinding } from "./classify.js";

/**
 * Flatten ALL whitespace (incl. newlines) to single spaces and lowercase, so a
 * quoted span matches regardless of the line breaks in the source. Lenient on
 * spacing, but not fuzzy — the characters themselves must still match verbatim.
 *
 * Typographic punctuation (curly quotes, dashes, exotic spaces) is already
 * folded to ASCII upstream in extract.ts, so both the source text and the
 * classifier's quoted evidence are in the same form by the time they reach here.
 */
function canonical(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Turn raw model detections into contract Findings, dropping any whose evidence
 * isn't present in the source. Weight/effect/title come from the taxonomy — the
 * model's opinion on those is never trusted.
 */
export function verifyFindings(
  raw: RawFinding[],
  sourceText: string,
): { findings: Finding[]; rejected: RawFinding[] } {
  const haystack = canonical(sourceText);
  const findings: Finding[] = [];
  const rejected: RawFinding[] = [];
  const seen = new Set<string>();

  for (const r of raw) {
    const clause = getClause(r.clauseKey);
    const evidence = r.evidence?.trim() ?? "";
    const ok = clause && evidence.length > 0 && haystack.includes(canonical(evidence));

    if (!ok) {
      rejected.push(r);
      continue;
    }
    if (seen.has(r.clauseKey)) continue; // one finding per clause
    seen.add(r.clauseKey);

    findings.push({
      clauseKey: clause.key,
      title: clause.title,
      effect: clause.effect,
      weight: clause.weight,
      category: clause.category,
      confidence: clamp01(r.confidence),
      evidence,
    });
  }
  return { findings, rejected };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
