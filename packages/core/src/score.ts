import { categoryPenalty, getClause, type Finding } from "@autotos/contracts";

/**
 * Compute the overall fairness score from a set of findings.
 *
 * Deterministic (never produced by the LLM). This is a category-based PENALTY
 * model. A Terms-of-Service score should measure how many distinct user-hostile
 * *concerns* a document raises and how severe they are — not how many clauses it
 * happens to spell out. Only `bad` clauses count; `good` clauses are the
 * baseline expectation (not selling your data is not a merit) and `neutral`
 * clauses are informational. Neither lifts the score.
 *
 * Crucially, we penalize per distinct CATEGORY, not per clause: a document with
 * three separate tracking clauses raises one "tracking" concern, not three, so
 * it's deducted once. This bounds the penalty (there are only ~10 penalizing
 * categories) and stops verbose legalese from flooring every real-world ToS.
 *
 *   penalty = Σ over distinct bad categories present ( category.penalty )
 *   score   = clamp(100 − penalty, 0, 100) / 10
 *
 * A clean document (no bad concerns) is 10; each distinct bad concern deducts
 * its category penalty. Scale is 0–10 where 10 = nothing hostile, 0 = hostile.
 */
export function computeScore(findings: readonly Finding[]): number {
  const badCategories = new Set<string>();

  for (const f of findings) {
    if (f.effect !== "bad") continue; // good & neutral: informational only
    const category = f.category ?? getClause(f.clauseKey)?.category;
    if (category) badCategories.add(category);
  }

  let penalty = 0;
  for (const category of badCategories) penalty += categoryPenalty(category);

  const score = clamp(100 - penalty, 0, 100) / 10; // [0, 10]
  return Math.round(score * 10) / 10; // one decimal place
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
