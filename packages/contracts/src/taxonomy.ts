import { z } from "zod";
import taxonomyJson from "./taxonomy.json" with { type: "json" };

/** The effect a clause has on the user. */
export const Effect = z.enum(["good", "bad", "neutral"]);
export type Effect = z.infer<typeof Effect>;

export const ClauseSchema = z.object({
  /** Stable string identifier used across the generator, artifacts, and client. */
  key: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string(),
  effect: Effect,
  /** Importance / impact weight, 0–100. Informational; scoring is category-based. */
  weight: z.number().int().min(0).max(100),
  /**
   * The concern this clause belongs to (e.g. "tracking", "legal_rights").
   * Scoring counts DISTINCT bad categories, so several related bad clauses in
   * the same category are penalized once, not additively.
   */
  category: z.string().regex(/^[a-z0-9_]+$/),
  /** Description shown to the LLM to decide whether the clause applies. */
  guidance: z.string(),
});
export type Clause = z.infer<typeof ClauseSchema>;

/** A concern grouping clauses; carries the penalty applied when a bad clause in it is present. */
export const CategorySchema = z.object({
  label: z.string(),
  /** Points deducted (once) when any bad clause in this category is present. 0 = never penalizing. */
  penalty: z.number().min(0).max(100),
});
export type Category = z.infer<typeof CategorySchema>;

export const TaxonomySchema = z.object({
  version: z.number().int(),
  categories: z.record(z.string(), CategorySchema),
  clauses: z.array(ClauseSchema),
});
export type Taxonomy = z.infer<typeof TaxonomySchema>;

/** The parsed, validated clause taxonomy. */
export const TAXONOMY: Taxonomy = TaxonomySchema.parse(taxonomyJson);

/** Every valid clause key. */
export const CLAUSE_KEYS = TAXONOMY.clauses.map((c) => c.key);

/** Look up a category's penalty by key; 0 if unknown. */
export function categoryPenalty(category: string): number {
  return TAXONOMY.categories[category]?.penalty ?? 0;
}

const CLAUSE_BY_KEY: ReadonlyMap<string, Clause> = new Map(
  TAXONOMY.clauses.map((c) => [c.key, c]),
);

/** Look up a clause definition by key, or undefined if unknown. */
export function getClause(key: string): Clause | undefined {
  return CLAUSE_BY_KEY.get(key);
}

/** A zod enum restricted to the known clause keys, for validating findings. */
export const ClauseKey = z.enum(
  CLAUSE_KEYS as [string, ...string[]],
);
