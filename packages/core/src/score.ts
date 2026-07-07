import type { Finding } from "@autotos/contracts";

/**
 * Compute the overall fairness score from a set of findings.
 *
 * Deterministic, weight-based (never produced by the LLM). Each finding
 * contributes its weight signed by effect: `good` adds, `bad` subtracts,
 * `neutral` contributes to the denominator only. The signed sum is normalized
 * to [-1, 1] and mapped onto a 0–10 scale:
 *
 *   10 = fully user-friendly, 5 = neutral, 0 = hostile.
 *
 * With no findings (or only zero-weight ones), returns the neutral midpoint 5.
 */
export function computeScore(findings: readonly Finding[]): number {
  let signed = 0;
  let totalWeight = 0;

  for (const f of findings) {
    totalWeight += f.weight;
    if (f.effect === "good") signed += f.weight;
    else if (f.effect === "bad") signed -= f.weight;
    // neutral: contributes to totalWeight only, pulling the score toward center
  }

  if (totalWeight === 0) return 5;

  const normalized = signed / totalWeight; // [-1, 1]
  const score = normalized * 5 + 5; // [0, 10]
  return Math.round(score * 10) / 10; // one decimal place
}

export type Verdict = "good" | "neutral" | "bad";

/** Bucket a 0–10 score into a coarse verdict for UI display. */
export function scoreVerdict(score: number): Verdict {
  if (score < 4) return "bad";
  if (score > 6) return "good";
  return "neutral";
}
