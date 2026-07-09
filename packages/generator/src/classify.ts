// Stage 4: classify clauses with the LLM — grouped per-clause pass, optimized
// for precision.
//
// The 17-clause taxonomy is split into small groups. For each group we make one
// LLM call asking, for each clause in the group, whether it is present and — if
// so — the verbatim evidence span. The document text and shared instructions are
// sent as CACHEABLE system blocks, so across the grouped calls we pay for the
// document once (cache reads) rather than N times.
//
// The model NEVER sets weight/effect (those come from the taxonomy) and can only
// emit clauseKeys from the group it was asked about — it just locates + quotes.

import { TAXONOMY, getClause, type Clause } from "@autotos/contracts";
import type { LLMClient, PromptBlock } from "./llm.js";

/** A raw, unverified detection from the model. */
export interface RawFinding {
  clauseKey: string;
  present: boolean;
  evidence: string;
  confidence: number;
}

/** Clauses per grouped call. Small groups keep precision high; ~4 keeps cost ~4x. */
export const GROUP_SIZE = 4;

/** Max chars per chunk before splitting. */
export const MAX_CHUNK_CHARS = 40_000;

/** Overlap between chunks to preserve clauses spanning boundaries. */
export const CHUNK_OVERLAP = 500;

/** Split the taxonomy clauses into groups of GROUP_SIZE. */
export function groupClauses(clauses: readonly Clause[] = TAXONOMY.clauses): Clause[][] {
  const groups: Clause[][] = [];
  for (let i = 0; i < clauses.length; i += GROUP_SIZE) {
    groups.push(clauses.slice(i, i + GROUP_SIZE));
  }
  return groups;
}

/**
 * Split a document into chunks if it exceeds MAX_CHUNK_CHARS.
 * Splits on natural boundaries (prefer \n\n, then \n, then hard cut).
 * Adds overlap between chunks to preserve clauses spanning boundaries.
 */
export function chunkDocument(
  text: string,
  opts?: { maxChars?: number; overlap?: number },
): string[] {
  const maxChars = opts?.maxChars ?? MAX_CHUNK_CHARS;
  const overlap = opts?.overlap ?? CHUNK_OVERLAP;

  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = start + maxChars;
    if (end >= text.length) {
      chunks.push(text.slice(start));
      break;
    }

    // Try to split at a paragraph break
    let splitAt = text.lastIndexOf("\n\n", end);
    if (splitAt <= start) {
      // Fall back to single newline
      splitAt = text.lastIndexOf("\n", end);
    }
    if (splitAt <= start) {
      // Hard cut at maxChars
      splitAt = end;
    }

    chunks.push(text.slice(start, splitAt));
    // Next chunk starts with overlap
    start = Math.max(start + 1, splitAt - overlap);
  }

  return chunks;
}

const SHARED_INSTRUCTIONS =
  "You are a precise legal-clause detector for website Terms of Service and " +
  "privacy policies. For each clause you are asked about, decide whether the " +
  "document actually contains that clause. Only mark present=true when the text " +
  "clearly supports it. When present, quote a SHORT verbatim span (<=300 chars) " +
  "copied EXACTLY from the document as evidence — do not paraphrase, summarize, " +
  "or fix typos. If a clause is not clearly present, mark present=false with an " +
  "empty evidence string. Precision matters more than recall: when in doubt, " +
  "mark present=false.";

/** JSON schema for one grouped call's structured reply. */
function schemaForGroup(group: Clause[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["findings"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["clauseKey", "present", "evidence", "confidence"],
          properties: {
            clauseKey: { type: "string", enum: group.map((c) => c.key) },
            present: { type: "boolean" },
            evidence: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  };
}

/** Render the clause definitions the model must consider for this group. */
function renderGroup(group: Clause[]): string {
  const lines = group.map(
    (c) => `- ${c.key}: ${c.title}. ${c.guidance}`,
  );
  return `Consider ONLY these clauses:\n${lines.join("\n")}`;
}

export interface ClassifyOptions {
  llm: LLMClient;
  /** Override the grouping (mainly for tests). */
  groups?: Clause[][];
}

/**
 * Run every clause group against the document and return the raw present
 * findings (unverified — stage 5 checks evidence). The document is a cacheable
 * system block so it is billed once across the grouped calls. For oversized
 * documents, splits into chunks and merges findings.
 */
export async function classify(
  documentText: string,
  opts: ClassifyOptions,
): Promise<RawFinding[]> {
  const groups = opts.groups ?? groupClauses();
  const chunks = chunkDocument(documentText);

  const all: RawFinding[] = [];

  for (const chunk of chunks) {
    const baseSystem: PromptBlock[] = [
      { text: SHARED_INSTRUCTIONS, cache: true },
      { text: `DOCUMENT:\n${chunk}`, cache: true },
    ];

    for (const group of groups) {
      const result = (await opts.llm({
        system: baseSystem,
        user: renderGroup(group),
        schema: schemaForGroup(group),
        toolName: "report_clauses",
      })) as { findings?: RawFinding[] };

      for (const f of result.findings ?? []) {
        // Guard: only accept keys from this group that exist in the taxonomy.
        if (!f.present) continue;
        if (!group.some((c) => c.key === f.clauseKey)) continue;
        if (!getClause(f.clauseKey)) continue;
        all.push(f);
      }
    }
  }

  // Dedupe findings by clauseKey, keeping the highest confidence
  const deduped = new Map<string, RawFinding>();
  for (const f of all) {
    const existing = deduped.get(f.clauseKey);
    if (!existing || f.confidence > existing.confidence) {
      deduped.set(f.clauseKey, f);
    }
  }

  return Array.from(deduped.values());
}
