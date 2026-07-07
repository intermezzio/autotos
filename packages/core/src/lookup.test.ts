import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lookupAnalysis,
  requestAnalysis,
  buildAnalysisRequest,
  type FetchLike,
} from "./lookup.js";
import type { AliasMap, DomainAnalysis } from "@autotos/contracts";

const aliasMap: AliasMap = { version: 1, map: { "x.com": "twitter.com" } };
const analysisUrl = (d: string) => `https://data.test/v1/analysis/${d}.json`;

/** Build a mock fetch from a map of url -> { status, body }. Records calls. */
function mockFetch(routes: Record<string, { status: number; body?: unknown }>): {
  fetchImpl: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    calls.push(input);
    const route = routes[input] ?? { status: 404 };
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.body ?? {},
    };
  };
  return { fetchImpl, calls };
}

function analyzed(domain: string, findings: DomainAnalysis["findings"] = []): DomainAnalysis {
  return { schemaVersion: 1, domain, status: "analyzed", score: 5, findings };
}

test("lookup returns not-analyzable for internal URLs", async () => {
  const { fetchImpl, calls } = mockFetch({});
  const res = await lookupAnalysis("chrome://extensions", { fetchImpl, analysisUrl });
  assert.equal(res.kind, "not-analyzable");
  assert.equal(calls.length, 0, "must not hit the network");
});

test("lookup normalizes to eTLD+1 before fetching", async () => {
  const { fetchImpl, calls } = mockFetch({
    [analysisUrl("github.com")]: { status: 200, body: analyzed("github.com") },
  });
  const res = await lookupAnalysis("https://www.github.com/torvalds/linux", {
    fetchImpl,
    analysisUrl,
  });
  assert.equal(res.kind, "hit");
  assert.deepEqual(calls, [analysisUrl("github.com")]);
});

test("lookup resolves an alias to the canonical domain", async () => {
  const { fetchImpl, calls } = mockFetch({
    [analysisUrl("twitter.com")]: { status: 200, body: analyzed("twitter.com") },
  });
  const res = await lookupAnalysis("https://x.com/home", {
    aliasMap,
    fetchImpl,
    analysisUrl,
  });
  assert.equal(res.kind, "hit");
  if (res.kind === "hit") assert.equal(res.domain, "twitter.com");
  assert.deepEqual(calls, [analysisUrl("twitter.com")]);
});

test("lookup returns miss on 404", async () => {
  const { fetchImpl } = mockFetch({});
  const res = await lookupAnalysis("https://unknown.example", { fetchImpl, analysisUrl });
  assert.equal(res.kind, "miss");
  if (res.kind === "miss") assert.equal(res.domain, "unknown.example");
});

test("lookup returns error on 5xx", async () => {
  const { fetchImpl } = mockFetch({
    [analysisUrl("example.com")]: { status: 503 },
  });
  const res = await lookupAnalysis("https://example.com", { fetchImpl, analysisUrl });
  assert.equal(res.kind, "error");
  if (res.kind === "error") assert.match(res.message, /503/);
});

test("lookup returns error on invalid artifact format", async () => {
  const { fetchImpl } = mockFetch({
    [analysisUrl("example.com")]: { status: 200, body: { nonsense: true } },
  });
  const res = await lookupAnalysis("https://example.com", { fetchImpl, analysisUrl });
  assert.equal(res.kind, "error");
  if (res.kind === "error") assert.match(res.message, /Invalid/);
});

test("lookup treats a non-analyzed artifact with no aliasOf as a miss", async () => {
  const { fetchImpl } = mockFetch({
    [analysisUrl("example.com")]: {
      status: 200,
      body: { schemaVersion: 1, domain: "example.com", status: "pending" },
    },
  });
  const res = await lookupAnalysis("https://example.com", { fetchImpl, analysisUrl });
  assert.equal(res.kind, "miss");
});

test("lookup follows a server-side aliasOf pointer once", async () => {
  const { fetchImpl, calls } = mockFetch({
    [analysisUrl("x.com")]: {
      status: 200,
      body: { schemaVersion: 1, domain: "x.com", status: "unavailable", aliasOf: "twitter.com" },
    },
    [analysisUrl("twitter.com")]: { status: 200, body: analyzed("twitter.com") },
  });
  // No client alias map here — exercise the server-side follow path.
  const res = await lookupAnalysis("https://x.com/home", { fetchImpl, analysisUrl });
  assert.equal(res.kind, "hit");
  if (res.kind === "hit") assert.equal(res.domain, "twitter.com");
  assert.deepEqual(calls, [analysisUrl("x.com"), analysisUrl("twitter.com")]);
});

test("lookup does not chase an aliasOf pointing at itself", async () => {
  const { fetchImpl, calls } = mockFetch({
    [analysisUrl("loop.com")]: {
      status: 200,
      body: { schemaVersion: 1, domain: "loop.com", status: "unavailable", aliasOf: "loop.com" },
    },
  });
  const res = await lookupAnalysis("https://loop.com", { fetchImpl, analysisUrl });
  assert.equal(res.kind, "miss");
  assert.equal(calls.length, 1, "must not loop");
});

test("lookup surfaces a hit's parsed findings", async () => {
  const body = analyzed("example.com", [
    { clauseKey: "does_not_sell_personal_data", effect: "good", weight: 60, evidence: "..." },
  ]);
  const { fetchImpl } = mockFetch({ [analysisUrl("example.com")]: { status: 200, body } });
  const res = await lookupAnalysis("https://example.com", { fetchImpl, analysisUrl });
  assert.equal(res.kind, "hit");
  if (res.kind === "hit") assert.equal(res.analysis.findings?.length, 1);
});

// --- request path -----------------------------------------------------------

test("buildAnalysisRequest omits hintUrls when empty and clamps to 8", () => {
  assert.deepEqual(buildAnalysisRequest("e.com"), { domain: "e.com" });
  assert.deepEqual(buildAnalysisRequest("e.com", []), { domain: "e.com" });
  const many = Array.from({ length: 12 }, (_, i) => `https://e.com/${i}`);
  const built = buildAnalysisRequest("e.com", many);
  assert.equal(built.hintUrls?.length, 8);
});

test("requestAnalysis POSTs the domain and returns the parsed response", async () => {
  let seen: { method?: string; body?: string } | undefined;
  const fetchImpl: FetchLike = async (_input, init) => {
    seen = init;
    return { ok: true, status: 200, json: async () => ({ ok: true, status: "queued" }) };
  };
  const res = await requestAnalysis("github.com", ["https://github.com/x"], {
    fetchImpl,
    endpoint: "https://api.test/request",
  });
  assert.equal(res.status, "queued");
  assert.equal(seen?.method, "POST");
  assert.deepEqual(JSON.parse(seen?.body ?? "{}"), {
    domain: "github.com",
    hintUrls: ["https://github.com/x"],
  });
});

test("requestAnalysis reports rejected when the network throws", async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error("offline");
  };
  const res = await requestAnalysis("github.com", undefined, {
    fetchImpl,
    endpoint: "https://api.test/request",
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, "rejected");
  assert.match(res.message ?? "", /offline/);
});

test("requestAnalysis falls back to status from HTTP code on unparseable body", async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ garbage: true }),
  });
  const res = await requestAnalysis("github.com", undefined, {
    fetchImpl,
    endpoint: "https://api.test/request",
  });
  assert.equal(res.status, "rejected");
});
