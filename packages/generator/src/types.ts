// Shared types for the generator pipeline. Kept dependency-free so every stage
// stays pure and testable with injected fetch / LLM implementations.

/** Minimal fetch signature — the platform fetch or a mock in tests. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; redirect?: string },
) => Promise<{
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  text: () => Promise<string>;
}>;

/** A candidate document to fetch and analyze. */
export interface Candidate {
  url: string;
  kind: "terms" | "privacy" | "other";
}

/** A successfully fetched + cleaned document. */
export interface FetchedDoc {
  url: string;
  kind: "terms" | "privacy" | "other";
  /** Cleaned, boilerplate-stripped plain text. */
  text: string;
}

/** Why a domain could not be analyzed (emitted as status: "unavailable"). */
export type UnavailableReason =
  | "no-candidates" // discovery found nothing
  | "fetch-failed" // every candidate failed to fetch
  | "empty-content" // pages fetched but yielded no usable text (likely JS-rendered)
  | "no-findings"; // classified but nothing matched (rare; still emit analyzed with score 5)
