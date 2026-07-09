// Stage 6: assemble the domain.json artifact, compute the score deterministically,
// and validate against the contract before returning. Nothing here calls the LLM.

import {
  parseDomainAnalysis,
  SCHEMA_VERSION,
  type DomainAnalysis,
  type Finding,
  type Source,
} from "@autotos/contracts";
import { computeScore } from "@autotos/core";

export interface EmitInput {
  domain: string;
  findings: Finding[];
  sources: Source[];
  contentHash: string;
  generatedAt: string; // ISO-8601, injected for determinism/testability
}

/** Build a validated `analyzed` artifact. Score is computed, never from the LLM. */
export function emitAnalyzed(input: EmitInput): DomainAnalysis {
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    domain: input.domain,
    status: "analyzed" as const,
    generatedAt: input.generatedAt,
    sources: input.sources,
    contentHash: input.contentHash,
    score: computeScore(input.findings),
    findings: input.findings,
  };
  // Throws if we ever produce something the client couldn't read — a hard guard
  // that the write path and read path can't drift.
  return parseDomainAnalysis(artifact);
}

/** Build a validated `unavailable` artifact (TOS not found / not fetchable). */
export function emitUnavailable(
  domain: string,
  generatedAt: string,
  reason: string,
): DomainAnalysis {
  return parseDomainAnalysis({
    schemaVersion: SCHEMA_VERSION,
    domain,
    status: "unavailable",
    generatedAt,
    reason, // extra field; schema is additive (passthrough)
  });
}

/** Build a validated `aliasOf` pointer artifact. */
export function emitAlias(
  domain: string,
  canonical: string,
  generatedAt: string,
): DomainAnalysis {
  return parseDomainAnalysis({
    schemaVersion: SCHEMA_VERSION,
    domain,
    status: "unavailable",
    aliasOf: canonical,
    generatedAt,
  });
}
