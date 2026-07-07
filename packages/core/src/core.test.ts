import { test } from "node:test";
import assert from "node:assert/strict";
import { toRegistrableDomain, isAnalyzableUrl } from "./domain.js";
import { resolveCanonical } from "./alias.js";
import { computeScore, scoreVerdict } from "./score.js";
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

test("computeScore returns neutral 5 with no findings", () => {
  assert.equal(computeScore([]), 5);
});

test("computeScore signs weights by effect", () => {
  const findings: Finding[] = [
    { clauseKey: "does_not_sell_personal_data", effect: "good", weight: 60, evidence: "..." },
    { clauseKey: "terms_change_without_notice", effect: "bad", weight: 70, evidence: "..." },
  ];
  // signed = 60 - 70 = -10; total = 130; normalized = -0.0769; score = 4.6
  assert.equal(computeScore(findings), 4.6);
});

test("scoreVerdict buckets correctly", () => {
  assert.equal(scoreVerdict(2), "bad");
  assert.equal(scoreVerdict(5), "neutral");
  assert.equal(scoreVerdict(8), "good");
});
