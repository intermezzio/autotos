import { z } from "zod";
import { Effect } from "./taxonomy.js";

/** Current on-disk / on-CDN contract version for domain analysis artifacts. */
export const SCHEMA_VERSION = 1 as const;

/** A registrable domain (eTLD+1), lowercased. */
const DomainName = z.string().regex(/^[a-z0-9.-]+$/);

export const SourceSchema = z.object({
  url: z.string().url(),
  kind: z.enum(["terms", "privacy", "other"]).optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const FindingSchema = z.object({
  /** A key from the taxonomy. Not restricted to known keys here so old clients
   *  can still parse artifacts that reference newer clause keys. */
  clauseKey: z.string().regex(/^[a-z0-9_]+$/),
  /** Denormalized title so the client can render without loading the taxonomy. */
  title: z.string().optional(),
  effect: Effect,
  weight: z.number().int().min(0).max(100),
  /** Denormalized category key (see taxonomy) so scoring/UI can group without the taxonomy. */
  category: z.string().regex(/^[a-z0-9_]+$/).optional(),
  confidence: z.number().min(0).max(1).optional(),
  /** Verbatim span from the source text supporting the finding. */
  evidence: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const AnalysisStatus = z.enum(["analyzed", "pending", "unavailable"]);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

/**
 * The analysis artifact stored at /v1/analysis/{domain}.json.
 * `passthrough` keeps unknown fields so newer generator output does not break
 * older clients (the contract is additive-only).
 */
export const DomainAnalysisSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    domain: DomainName,
    status: AnalysisStatus,
    aliasOf: DomainName.optional(),
    generatedAt: z.string().datetime().optional(),
    sources: z.array(SourceSchema).optional(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{16,64}$/)
      .optional(),
    score: z.number().min(0).max(10).optional(),
    findings: z.array(FindingSchema).optional(),
  })
  .passthrough();
export type DomainAnalysis = z.infer<typeof DomainAnalysisSchema>;

/** Parse untrusted JSON (e.g. a fetched artifact) into a DomainAnalysis. */
export function parseDomainAnalysis(input: unknown): DomainAnalysis {
  return DomainAnalysisSchema.parse(input);
}

/** Non-throwing variant returning a zod SafeParseReturnType. */
export function safeParseDomainAnalysis(input: unknown) {
  return DomainAnalysisSchema.safeParse(input);
}

// ---------------------------------------------------------------------------
// Alias table (source of truth) and derived alias map (client-facing).
// ---------------------------------------------------------------------------

export const AliasGroupSchema = z.object({
  canonical: DomainName,
  aliases: z.array(DomainName),
});
export type AliasGroup = z.infer<typeof AliasGroupSchema>;

export const AliasTableSchema = z.object({
  version: z.number().int(),
  comment: z.string().optional(),
  groups: z.array(AliasGroupSchema),
});
export type AliasTable = z.infer<typeof AliasTableSchema>;

/** The derived alias map the client fetches: { aliasDomain: canonicalDomain }. */
export const AliasMapSchema = z.object({
  version: z.number().int(),
  map: z.record(DomainName, DomainName),
});
export type AliasMap = z.infer<typeof AliasMapSchema>;

/** Flatten an alias table into the { alias -> canonical } map published as aliases.json. */
export function deriveAliasMap(table: AliasTable): AliasMap {
  const map: Record<string, string> = {};
  for (const group of table.groups) {
    for (const alias of group.aliases) {
      map[alias] = group.canonical;
    }
  }
  return { version: table.version, map };
}

// ---------------------------------------------------------------------------
// Request ("miss") endpoint contract — the request button.
// ---------------------------------------------------------------------------

/** Body POSTed to the request endpoint when a user asks for analysis of a site. */
export const AnalysisRequestSchema = z.object({
  /** The registrable domain (eTLD+1) the user wants analyzed. */
  domain: DomainName,
  /** Optional: the source URLs the user was on, to help the generator locate the TOS. */
  hintUrls: z.array(z.string().url()).max(8).optional(),
});
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;

export const AnalysisRequestResponseSchema = z.object({
  ok: z.boolean(),
  /** Where the analysis will appear once generated. */
  status: z.enum(["queued", "already_present", "rejected"]),
  /** Total number of times this site has been requested (the demand tally). */
  count: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
});
export type AnalysisRequestResponse = z.infer<
  typeof AnalysisRequestResponseSchema
>;

/** A single entry in the missing-site tally (GET /missing). */
export const MissingSiteSchema = z.object({
  domain: DomainName,
  count: z.number().int().nonnegative(),
});
export type MissingSite = z.infer<typeof MissingSiteSchema>;

/** Response of GET /missing — the ranked tally of requested-but-unanalyzed sites. */
export const MissingTallySchema = z.object({
  generatedAt: z.string().datetime().optional(),
  sites: z.array(MissingSiteSchema),
});
export type MissingTally = z.infer<typeof MissingTallySchema>;
