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

test("computeScore deducts one category penalty per distinct bad concern", () => {
  const findings: Finding[] = [
    { clauseKey: "does_not_sell_personal_data", effect: "good", weight: 60, evidence: "..." },
    { clauseKey: "terms_change_without_notice", effect: "bad", weight: 70, evidence: "..." },
  ];
  // good clause ignored; terms_changes category penalty = 22; score = (100 - 22) / 10 = 7.8
  assert.equal(computeScore(findings), 7.8);
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
  // Both are category "tracking" (penalty 12); deducted ONCE => (100 - 12) / 10 = 8.8
  assert.equal(computeScore(twoTracking), 8.8);
});

test("computeScore sums penalties across distinct bad categories", () => {
  const hostile: Finding[] = [
    { clauseKey: "terms_change_without_notice", effect: "bad", weight: 70, evidence: "..." }, // terms_changes 22
    { clauseKey: "class_action_waiver", effect: "bad", weight: 60, evidence: "..." }, // legal_rights 20
    { clauseKey: "content_used_for_ai_training", effect: "bad", weight: 60, evidence: "..." }, // ai_data_use 16
  ];
  // distinct categories: 22 + 20 + 16 = 58; score = (100 - 58) / 10 = 4.2
  assert.equal(computeScore(hostile), 4.2);
});

test("computeScore uses an explicit finding.category over the taxonomy lookup", () => {
  const findings: Finding[] = [
    // unknown clauseKey, but category is denormalized on the finding
    { clauseKey: "some_future_clause", effect: "bad", weight: 50, category: "data_sale", evidence: "..." },
  ];
  // data_sale penalty = 25; score = (100 - 25) / 10 = 7.5
  assert.equal(computeScore(findings), 7.5);
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
