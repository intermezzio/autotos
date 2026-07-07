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
  /** Importance / impact weight, 0–100. Drives the fairness score. */
  weight: z.number().int().min(0).max(100),
  /** Description shown to the LLM to decide whether the clause applies. */
  guidance: z.string(),
});
export type Clause = z.infer<typeof ClauseSchema>;

export const TaxonomySchema = z.object({
  version: z.number().int(),
  clauses: z.array(ClauseSchema),
});
export type Taxonomy = z.infer<typeof TaxonomySchema>;

/** The parsed, validated clause taxonomy. */
export const TAXONOMY: Taxonomy = TaxonomySchema.parse(taxonomyJson);

/** Every valid clause key. */
export const CLAUSE_KEYS = TAXONOMY.clauses.map((c) => c.key);

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
