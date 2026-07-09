import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TAXONOMY,
  CLAUSE_KEYS,
  getClause,
  ClauseKey,
  SCHEMA_VERSION,
  parseDomainAnalysis,
  safeParseDomainAnalysis,
  deriveAliasMap,
  AliasTableSchema,
  AnalysisRequestSchema,
  AnalysisRequestResponseSchema,
  type DomainAnalysis,
} from "./index.js";
import aliasTableJson from "./alias-table.json" with { type: "json" };

// --- taxonomy ---------------------------------------------------------------

test("taxonomy parses and exposes 30 clauses", () => {
  assert.equal(TAXONOMY.clauses.length, 30);
  assert.equal(CLAUSE_KEYS.length, 30);
});

test("taxonomy clause keys are unique", () => {
  assert.equal(new Set(CLAUSE_KEYS).size, CLAUSE_KEYS.length);
});

test("every clause has a valid effect and 0-100 weight", () => {
  for (const c of TAXONOMY.clauses) {
    assert.ok(["good", "bad", "neutral"].includes(c.effect), `${c.key} effect`);
    assert.ok(c.weight >= 0 && c.weight <= 100, `${c.key} weight`);
    assert.match(c.key, /^[a-z0-9_]+$/, `${c.key} key format`);
  }
});

test("every clause references a defined category", () => {
  for (const c of TAXONOMY.clauses) {
    assert.ok(TAXONOMY.categories[c.category], `${c.key} -> unknown category ${c.category}`);
  }
});

test("every bad clause's category has a non-zero penalty", () => {
  for (const c of TAXONOMY.clauses) {
    if (c.effect !== "bad") continue;
    assert.ok(
      TAXONOMY.categories[c.category]!.penalty > 0,
      `${c.key} is bad but category ${c.category} has zero penalty`,
    );
  }
});

test("getClause resolves known keys and rejects unknown", () => {
  const c = getClause("terms_change_without_notice");
  assert.ok(c);
  assert.equal(c?.effect, "bad");
  assert.equal(getClause("not_a_real_clause"), undefined);
});

test("ClauseKey enum accepts taxonomy keys and rejects others", () => {
  assert.ok(ClauseKey.safeParse("does_not_sell_personal_data").success);
  assert.equal(ClauseKey.safeParse("bogus").success, false);
});

// --- domain analysis validation ---------------------------------------------

const validAnalysis: DomainAnalysis = {
  schemaVersion: SCHEMA_VERSION,
  domain: "example.com",
  status: "analyzed",
  score: 5,
  findings: [
    {
      clauseKey: "does_not_sell_personal_data",
      effect: "good",
      weight: 60,
      evidence: "We do not sell your data.",
    },
  ],
};

test("parseDomainAnalysis accepts a valid artifact", () => {
  const parsed = parseDomainAnalysis(validAnalysis);
  assert.equal(parsed.domain, "example.com");
  assert.equal(parsed.findings?.length, 1);
});

test("parseDomainAnalysis is additive-tolerant (keeps unknown fields)", () => {
  const withExtra = { ...validAnalysis, futureField: { nested: true } };
  const parsed = parseDomainAnalysis(withExtra) as Record<string, unknown>;
  assert.deepEqual(parsed.futureField, { nested: true });
});

test("safeParseDomainAnalysis rejects wrong schemaVersion", () => {
  const res = safeParseDomainAnalysis({ ...validAnalysis, schemaVersion: 2 });
  assert.equal(res.success, false);
});

test("safeParseDomainAnalysis rejects a finding without evidence", () => {
  const bad = {
    ...validAnalysis,
    findings: [{ clauseKey: "x", effect: "good", weight: 10 }],
  };
  assert.equal(safeParseDomainAnalysis(bad).success, false);
});

test("safeParseDomainAnalysis rejects out-of-range score", () => {
  assert.equal(safeParseDomainAnalysis({ ...validAnalysis, score: 11 }).success, false);
});

test("safeParseDomainAnalysis rejects an invalid status", () => {
  assert.equal(
    safeParseDomainAnalysis({ ...validAnalysis, status: "done" }).success,
    false,
  );
});

test("a minimal pending artifact is valid", () => {
  const res = safeParseDomainAnalysis({
    schemaVersion: 1,
    domain: "pending.com",
    status: "pending",
  });
  assert.equal(res.success, true);
});

// --- alias table / derivation -----------------------------------------------

test("bundled alias-table.json conforms to the schema", () => {
  assert.equal(AliasTableSchema.safeParse(aliasTableJson).success, true);
});

test("deriveAliasMap flattens groups into alias -> canonical", () => {
  const table = AliasTableSchema.parse(aliasTableJson);
  const { map } = deriveAliasMap(table);
  assert.equal(map["x.com"], "twitter.com");
  assert.equal(map["youtu.be"], "youtube.com");
  // Canonicals should not appear as their own alias keys.
  assert.equal(map["twitter.com"], undefined);
});

test("deriveAliasMap never produces a chained alias", () => {
  const table = AliasTableSchema.parse(aliasTableJson);
  const { map } = deriveAliasMap(table);
  for (const canonical of Object.values(map)) {
    assert.equal(map[canonical], undefined, `${canonical} must be terminal`);
  }
});

// --- request contract -------------------------------------------------------

test("AnalysisRequest requires a dotted domain", () => {
  assert.equal(AnalysisRequestSchema.safeParse({ domain: "github.com" }).success, true);
  assert.equal(AnalysisRequestSchema.safeParse({ domain: "" }).success, false);
});

test("AnalysisRequest caps hintUrls at 8", () => {
  const nine = Array.from({ length: 9 }, (_, i) => `https://e.com/${i}`);
  assert.equal(
    AnalysisRequestSchema.safeParse({ domain: "e.com", hintUrls: nine }).success,
    false,
  );
});

test("AnalysisRequestResponse validates the queued shape", () => {
  assert.equal(
    AnalysisRequestResponseSchema.safeParse({ ok: true, status: "queued" }).success,
    true,
  );
});
