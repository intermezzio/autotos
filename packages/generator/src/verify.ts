// Stage 5: the hallucination firewall.
//
// A finding survives only if its evidence appears (near-)verbatim in the source
// text. The schema already REQUIRES evidence; this ENFORCES that it is real.
// We compare on whitespace-normalized text so trivial spacing differences don't
// cause false rejections, but we do not accept paraphrases.

import { getClause, type Finding } from "@autotos/contracts";
import type { RawFinding } from "./classify.js";

/**
 * Fold typographic punctuation to its ASCII equivalent so a quoted span isn't
 * rejected over a curly apostrophe vs a straight one, an en/em dash vs a hyphen,
 * etc. Extraction and copy-paste routinely swap these, and they carry no meaning
 * for evidence matching — but this is still exact-character folding, not fuzzing.
 */
function foldPunct(s: string): string {
  return s
    .replace(/[‘’‚‛′‵]/g, "'") // ' ' ‚ ‛ ′ ‵ -> '
    .replace(/[“”„‟″‶]/g, '"') // " " „ ‟ ″ ‶ -> "
    .replace(/[‐‑‒–—―−]/g, "-") // ‐‑‒–—―− -> -
    .replace(/[   ]/g, " "); // non-breaking / figure / narrow spaces
}

/**
 * Flatten ALL whitespace (incl. newlines) to single spaces, fold typographic
 * punctuation, and lowercase, so a quoted span matches regardless of the line
 * breaks or quote styling in the source. Lenient on spacing and punctuation
 * styling, but not fuzzy — the characters themselves must still match verbatim.
 */
function canonical(s: string): string {
  return foldPunct(s).replace(/\s+/g, " ").trim().toLowerCase();
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
