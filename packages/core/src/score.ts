import { categoryTier, getClause, type Finding, type Tier } from "@autotos/contracts";

/**
 * Compute the overall fairness score from a set of findings.
 *
 * Deterministic (never produced by the LLM). This is a category-based, TIERED
 * penalty model. A Terms-of-Service score should measure how *severe* a
 * document's worst user-hostile concern is — not merely how many concerns it
 * raises. Only `bad` clauses count; `good` clauses are the baseline expectation
 * (not selling your data is not a merit) and `neutral` clauses are
 * informational. Neither lifts the score.
 *
 * We still count per distinct CATEGORY, not per clause (three tracking clauses
 * are one "tracking" concern). But instead of summing flat penalties — which
 * floored any site with ~5 mid-tier concerns at 0, making a data-seller
 * indistinguishable from a merely verbose ToS — each category carries a
 * severity TIER, and the model works by *tier dominance*:
 *
 *   worst_tier = the most severe tier among the bad categories present
 *   score      = ceiling[worst_tier] − Σ_i deduct[tier_i] · decay^i
 *                (i = 0,1,2,… over categories ordered worst-tier first)
 *   score      = clamp(score, 0, 10)
 *
 * The worst tier sets a grade CEILING (Critical ⇒ ≤D, Severe ⇒ ≤C,
 * Moderate ⇒ ≤B, Minor ⇒ ≤A). Additional concerns deduct with diminishing
 * returns, so a long tail of minor issues can't drag a data-seller and an
 * ordinary site to the same floor. Scale is 0–10 where 10 = nothing hostile.
 *
 * Ceilings align exactly with the grade thresholds in `scoreGrade` so that
 * "worst tier ⇒ max grade" holds by construction.
 */
const TIER_CEILING: Record<Tier, number> = {
  critical: 3.9, // caps at D
  severe: 5.9, //   caps at C
  moderate: 7.9, // caps at B
  minor: 9.9, //    caps at A
};

const TIER_DEDUCT: Record<Tier, number> = {
  critical: 1.5,
  severe: 1.0,
  moderate: 0.6,
  minor: 0.3,
};

const TIER_RANK: Record<Tier, number> = {
  critical: 0,
  severe: 1,
  moderate: 2,
  minor: 3,
};

const DECAY = 0.6; // each successive concern deducts 60% of the previous one

export function computeScore(findings: readonly Finding[]): number {
  const badCategories = new Set<string>();
  for (const f of findings) {
    if (f.effect !== "bad") continue; // good & neutral: informational only
    const category = f.category ?? getClause(f.clauseKey)?.category;
    if (category) badCategories.add(category);
  }

  // Tiers of the distinct bad concerns present, worst-first. Categories without
  // a tier (the never-penalizing ones) contribute nothing.
  const tiers: Tier[] = [];
  for (const category of badCategories) {
    const tier = categoryTier(category);
    if (tier) tiers.push(tier);
  }
  if (tiers.length === 0) return 10; // no bad concerns => clean

  tiers.sort((a, b) => TIER_RANK[a] - TIER_RANK[b]);

  const worst = tiers[0] as Tier; // non-empty: guarded above
  let score = TIER_CEILING[worst]; // worst tier sets the ceiling
  tiers.forEach((tier, i) => {
    score -= TIER_DEDUCT[tier] * Math.pow(DECAY, i);
  });

  return Math.round(clamp(score, 0, 10) * 10) / 10; // one decimal place
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export type Grade = "A" | "B" | "C" | "D" | "E";

/**
 * Map a 0–10 score to a letter grade (A-E).
 *
 * Higher score = better terms. Thresholds:
 * - A: score >= 8
 * - B: score >= 6
 * - C: score >= 4
 * - D: score >= 2
 * - E: score < 2
 */
export function scoreGrade(score: number): Grade {
  if (score >= 8) return "A";
  if (score >= 6) return "B";
  if (score >= 4) return "C";
  if (score >= 2) return "D";
  return "E";
}

/**
 * Return a short human-readable label for a grade.
 */
export function gradeLabel(grade: Grade): string {
  switch (grade) {
    case "A":
      return "Very user-friendly";
    case "B":
      return "User-friendly";
    case "C":
      return "Mixed";
    case "D":
      return "Unfriendly";
    case "E":
      return "Very unfriendly";
  }
}

export type Verdict = "good" | "neutral" | "bad";

/**
 * Bucket a 0–10 score into a coarse verdict for UI display.
 * Derived from the grade for consistency: A/B = good, C = neutral, D/E = bad.
 */
export function scoreVerdict(score: number): Verdict {
  const grade = scoreGrade(score);
  if (grade === "A" || grade === "B") return "good";
  if (grade === "C") return "neutral";
  return "bad";
}
