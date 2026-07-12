import { test } from "node:test";
import assert from "node:assert/strict";
import { toRegistrableDomain, isAnalyzableUrl } from "./domain.js";
import { resolveCanonical } from "./alias.js";
import { computeScore, scoreVerdict, scoreGrade } from "./score.js";
import type { Finding } from "@autotos/contracts";

test("toRegistrableDomain normalizes subdomains and www", () => {
  assert.equal(toRegistrableDomain("https://www.github.com/torvalds/linux"), "github.com");
  assert.equal(toRegistrableDomain("gist.github.com"), "github.com");
  assert.equal(toRegistrableDomain("https://app.github.com/settings"), "github.com");
});

test("toRegistrableDomain handles multi-part public suffixes", () => {
  assert.equal(toRegistrableDomain("https://www.bbc.co.uk/news"), "bbc.co.uk");
  assert.equal(toRegistrableDomain("shop.amazon.co.uk"), "amazon.co.uk");
  // github.io is itself a public suffix, so each subdomain is its own site.
  assert.equal(toRegistrableDomain("foo.github.io"), "foo.github.io");
});

test("toRegistrableDomain rejects IPs and internal hosts", () => {
  assert.equal(toRegistrableDomain("http://localhost:3000"), null);
  assert.equal(toRegistrableDomain("http://127.0.0.1"), null);
});

test("isAnalyzableUrl filters non-http and internal schemes", () => {
  assert.equal(isAnalyzableUrl("https://github.com"), true);
  assert.equal(isAnalyzableUrl("chrome://extensions"), false);
  assert.equal(isAnalyzableUrl("about:blank"), false);
  assert.equal(isAnalyzableUrl("http://localhost"), false);
});

test("resolveCanonical maps aliases and passes through unknowns", () => {
  const aliasMap = { version: 1, map: { "x.com": "twitter.com", "fb.com": "facebook.com" } };
  assert.equal(resolveCanonical("x.com", aliasMap), "twitter.com");
  assert.equal(resolveCanonical("github.com", aliasMap), "github.com");
  assert.equal(resolveCanonical("x.com", null), "x.com");
});

test("computeScore returns a clean 10 with no findings", () => {
  // Penalty model: nothing bad found => nothing to deduct => top score.
  assert.equal(computeScore([]), 10);
});

test("computeScore caps at the worst tier's ceiling for a single bad concern", () => {
  const findings: Finding[] = [
    { clauseKey: "does_not_sell_personal_data", effect: "good", weight: 60, evidence: "..." },
    { clauseKey: "terms_change_without_notice", effect: "bad", weight: 70, evidence: "..." },
  ];
  // good clause ignored; terms_changes is a SEVERE concern: ceiling 5.9, one
  // deduct of 1.0 => 5.9 - 1.0 = 4.9 (a C, the max grade a severe concern allows).
  assert.equal(computeScore(findings), 4.9);
});

test("computeScore ignores good and neutral clauses entirely", () => {
  const goodAndNeutral: Finding[] = [
    { clauseKey: "does_not_sell_personal_data", effect: "good", weight: 60, evidence: "..." },
    { clauseKey: "has_last_updated_date", effect: "neutral", weight: 100, evidence: "..." },
  ];
  // No bad clauses => no penalty => a clean 10, regardless of good/neutral weight.
  assert.equal(computeScore(goodAndNeutral), 10);
});

test("computeScore counts a category once even with several bad clauses in it", () => {
  const twoTracking: Finding[] = [
    { clauseKey: "third_party_cookies_ads", effect: "bad", weight: 70, evidence: "..." },
    { clauseKey: "tracking_pixels_fingerprinting", effect: "bad", weight: 50, evidence: "..." },
  ];
  // Both are category "tracking" (MODERATE); one distinct concern => ceiling 7.9
  // with a single moderate deduct of 0.6 => 7.9 - 0.6 = 7.3 (a B).
  assert.equal(computeScore(twoTracking), 7.3);
});

test("computeScore lets the worst tier dominate, with diminishing extra deducts", () => {
  const hostile: Finding[] = [
    { clauseKey: "terms_change_without_notice", effect: "bad", weight: 70, evidence: "..." }, // terms_changes: severe
    { clauseKey: "class_action_waiver", effect: "bad", weight: 60, evidence: "..." }, // legal_rights: moderate
    { clauseKey: "content_used_for_ai_training", effect: "bad", weight: 60, evidence: "..." }, // ai_data_use: severe
  ];
  // Worst tier present is SEVERE => ceiling 5.9. Ordered worst-first the tiers are
  // [severe, severe, moderate] with deducts 1.0, 1.0, 0.6 and decay 0.6^i:
  //   5.9 - (1.0*1 + 1.0*0.6 + 0.6*0.36) = 5.9 - 1.816 = 4.084 -> 4.1 (a C).
  assert.equal(computeScore(hostile), 4.1);
});

test("computeScore caps a data-seller at the Critical ceiling (<= D)", () => {
  const seller: Finding[] = [
    { clauseKey: "can_sell_personal_data", effect: "bad", weight: 80, evidence: "..." }, // data_sale: critical
  ];
  // Critical concern => ceiling 3.9, one critical deduct of 1.5 => 3.9 - 1.5 = 2.4 (a D).
  assert.equal(computeScore(seller), 2.4);
});

test("computeScore uses an explicit finding.category over the taxonomy lookup", () => {
  const findings: Finding[] = [
    // unknown clauseKey, but category is denormalized on the finding
    { clauseKey: "some_future_clause", effect: "bad", weight: 50, category: "data_sale", evidence: "..." },
  ];
  // data_sale is CRITICAL: ceiling 3.9 - 1.5 = 2.4, resolved from the explicit category.
  assert.equal(computeScore(findings), 2.4);
});

test("scoreVerdict buckets correctly", () => {
  assert.equal(scoreVerdict(2), "bad");
  assert.equal(scoreVerdict(5), "neutral");
  assert.equal(scoreVerdict(8), "good");
});

test("scoreGrade maps scores to letters", () => {
  assert.equal(scoreGrade(9), "A");
  assert.equal(scoreGrade(7), "B");
  assert.equal(scoreGrade(5), "C");
  assert.equal(scoreGrade(3), "D");
  assert.equal(scoreGrade(1), "E");
  // Boundary tests
  assert.equal(scoreGrade(8), "A");
  assert.equal(scoreGrade(6), "B");
  assert.equal(scoreGrade(4), "C");
  assert.equal(scoreGrade(2), "D");
});
