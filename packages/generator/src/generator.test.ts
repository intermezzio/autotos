import { test } from "node:test";
import assert from "node:assert/strict";
import { TAXONOMY } from "@autotos/contracts";
import type { FetchLike } from "./types.js";
import { classifyLink, toAbsolute, discover } from "./discover.js";
import { lookupOpenTermsArchive, guessServiceFilenames } from "./open-terms-archive.js";
import { extractText, normalizeWhitespace, hashContent, isUsable, MIN_USABLE_CHARS } from "./extract.js";
import { groupClauses, classify, GROUP_SIZE, chunkDocument, MAX_CHUNK_CHARS, type RawFinding } from "./classify.js";
import { verifyFindings } from "./verify.js";
import { emitAnalyzed, emitUnavailable, emitAlias } from "./emit.js";
import { generate } from "./generate.js";
import { fetchHtml } from "./fetch.js";
import type { LLMClient } from "./llm.js";

// --- mock fetch -------------------------------------------------------------

function mockFetch(routes: Record<string, { status?: number; body?: string; contentType?: string; finalUrl?: string }>): FetchLike {
  return async (input) => {
    const route = routes[input] ?? { status: 404 };
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      url: route.finalUrl ?? input,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? route.contentType ?? "text/html" : null) },
      text: async () => route.body ?? "",
    };
  };
}

const now = () => "2026-07-09T00:00:00.000Z";

// --- discover ---------------------------------------------------------------

test("classifyLink buckets privacy, terms, and ignores the rest", () => {
  assert.equal(classifyLink("Privacy Policy", "/privacy"), "privacy");
  assert.equal(classifyLink("Terms of Service", "/tos"), "terms");
  assert.equal(classifyLink("Cookie notice", "/x"), "privacy");
  assert.equal(classifyLink("Careers", "/jobs"), null);
});

test("toAbsolute resolves relative hrefs and rejects non-http", () => {
  assert.equal(toAbsolute("/terms", "https://e.com/x"), "https://e.com/terms");
  assert.equal(toAbsolute("mailto:x@e.com", "https://e.com"), null);
});

test("discover merges hints, homepage links, and well-known paths (deduped, capped)", async () => {
  const fetchImpl = mockFetch({
    "https://e.com": {
      body: `<a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/careers">Jobs</a>`,
    },
  });
  const candidates = await discover("e.com", {
    fetchImpl,
    hintUrls: ["https://e.com/legal/tos"],
    max: 5,
  });
  const urls = candidates.map((c) => c.url);
  assert.equal(urls[0], "https://e.com/legal/tos", "hint comes first");
  assert.ok(urls.includes("https://e.com/privacy"));
  assert.ok(urls.includes("https://e.com/terms"));
  assert.ok(!urls.some((u) => u.includes("careers")), "non-legal links dropped");
  assert.ok(candidates.length <= 5, "respects max");
});

// --- open terms archive -----------------------------------------------------

const RAW = "https://raw.githubusercontent.com/OpenTermsArchive/contrib-declarations/main/declarations";
const CONTENTS = "https://api.github.com/repos/OpenTermsArchive/contrib-declarations/contents/declarations";

const githubDecl = JSON.stringify({
  name: "GitHub",
  terms: {
    "Terms of Service": { fetch: "https://docs.github.com/en/site-policy/github-terms/github-terms-of-service" },
    "Privacy Policy": { fetch: "https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement" },
    "Copyright Claims Policy": { fetch: "https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy" },
  },
});

test("guessServiceFilenames derives capitalized service names from a domain", () => {
  const names = guessServiceFilenames("github.com");
  assert.ok(names.includes("Github.json"));
  assert.ok(names.includes("github.json"));
});

test("OTA lookup: matches a service by filename guess and returns terms-first candidates", async () => {
  const fetchImpl = mockFetch({
    [`${RAW}/Github.json`]: { body: githubDecl, contentType: "application/json" },
  });
  const candidates = await lookupOpenTermsArchive("github.com", { fetchImpl });
  assert.equal(candidates.length, 2, "keeps only ToS + Privacy (drops copyright policy)");
  assert.equal(candidates[0]?.kind, "terms", "terms first");
  assert.equal(candidates[1]?.kind, "privacy");
  assert.match(candidates[0]?.url ?? "", /github-terms-of-service/);
});

test("OTA lookup: drops documents that live off the requested domain", async () => {
  // Declaration matches on the ToS host but bundles an off-domain privacy link.
  const decl = JSON.stringify({
    name: "Example",
    terms: {
      "Terms of Service": { fetch: "https://example.com/tos" },
      "Privacy Policy": { fetch: "https://tracker.other.com/privacy" },
    },
  });
  const fetchImpl = mockFetch({ [`${RAW}/Example.json`]: { body: decl, contentType: "application/json" } });
  const candidates = await lookupOpenTermsArchive("example.com", { fetchImpl });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.url, "https://example.com/tos");
});

test("OTA lookup: falls back to the directory listing when the name isn't guessable", async () => {
  const listing = JSON.stringify([
    { name: "Unrelated.json" },
    { name: "MyCoolApp.json" },
    { name: "MyCoolApp.history.json" }, // must be ignored
  ]);
  const decl = JSON.stringify({
    name: "MyCoolApp",
    terms: { "Terms of Service": { fetch: "https://mycoolapp.io/legal/terms" } },
  });
  const fetchImpl = mockFetch({
    [CONTENTS]: { body: listing, contentType: "application/json" },
    [`${RAW}/MyCoolApp.json`]: { body: decl, contentType: "application/json" },
  });
  const candidates = await lookupOpenTermsArchive("mycoolapp.io", { fetchImpl });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.url, "https://mycoolapp.io/legal/terms");
});

test("OTA lookup: returns [] when the service isn't in the archive", async () => {
  const fetchImpl = mockFetch({ [CONTENTS]: { body: "[]", contentType: "application/json" } });
  assert.deepEqual(await lookupOpenTermsArchive("nowhere.example", { fetchImpl }), []);
});

test("discover puts OTA-curated URLs ahead of well-known paths", async () => {
  const fetchImpl = mockFetch({
    [`${RAW}/Github.json`]: { body: githubDecl, contentType: "application/json" },
    "https://github.com": { body: "<html></html>" },
  });
  const candidates = await discover("github.com", { fetchImpl, max: 6 });
  const urls = candidates.map((c) => c.url);
  assert.match(urls[0] ?? "", /github-terms-of-service/, "OTA terms URL leads");
  assert.ok(urls.some((u) => u.includes("github-privacy-statement")));
});

// --- extract ----------------------------------------------------------------

test("extractText strips chrome and keeps prose", () => {
  const html = `<html><head><style>x{}</style></head><body>
    <nav>Home About</nav><main><p>You agree to these Terms.</p></main>
    <footer>© 2026</footer><script>tracking()</script></body></html>`;
  const text = extractText(html);
  assert.match(text, /You agree to these Terms\./);
  assert.doesNotMatch(text, /tracking\(\)/);
  assert.doesNotMatch(text, /© 2026/);
});

test("normalizeWhitespace collapses runs but keeps paragraph breaks", () => {
  assert.equal(normalizeWhitespace("a   b\n\n\n\nc"), "a b\n\nc");
});

test("normalizeWhitespace folds typographic punctuation to ASCII", () => {
  // Curly apostrophe/quotes, en+em dash, ellipsis, non-breaking space.
  const input = "you don’t “agree”—period… ok";
  assert.equal(normalizeWhitespace(input), 'you don\'t "agree"-period... ok');
});

test("extractText folds smart quotes so evidence matches downstream", () => {
  // The clause a classifier would quote as ASCII must be present verbatim in
  // the extracted text, even though the HTML used curly quotes and an em dash.
  const html = `<html><body><main><p>We provide the Service “AS IS” — you don’t get a warranty.</p></main></body></html>`;
  const text = extractText(html);
  assert.ok(text.includes('"AS IS" - you don\'t get a warranty'));
});

test("hashContent is stable hex and isUsable gates on length", () => {
  const h = hashContent("hello");
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.equal(hashContent("hello"), h);
  assert.equal(isUsable("x".repeat(MIN_USABLE_CHARS)), true);
  assert.equal(isUsable("short"), false);
});

// --- classify ---------------------------------------------------------------

test("groupClauses covers every clause exactly once", () => {
  const groups = groupClauses();
  const flat = groups.flat().map((c) => c.key);
  assert.equal(flat.length, TAXONOMY.clauses.length);
  assert.equal(new Set(flat).size, TAXONOMY.clauses.length);
  assert.ok(groups.every((g) => g.length <= GROUP_SIZE));
});

test("classify calls the LLM once per group and keeps only present, in-group keys", async () => {
  const groups = groupClauses();
  let calls = 0;
  const llm: LLMClient = async (req) => {
    calls++;
    // Reply about the first clause in the asked group as present, plus a bogus key.
    const firstKey = (req.schema as { properties: { findings: { items: { properties: { clauseKey: { enum: string[] } } } } } })
      .properties.findings.items.properties.clauseKey.enum[0];
    return {
      findings: [
        { clauseKey: firstKey, present: true, evidence: "some span", confidence: 0.9 },
        { clauseKey: "not_a_real_key", present: true, evidence: "x", confidence: 1 },
        { clauseKey: firstKey, present: false, evidence: "", confidence: 0.1 },
      ],
    };
  };
  const raw = await classify("doc", { llm, groups });
  assert.equal(calls, groups.length, "one call per group");
  assert.equal(raw.length, groups.length, "one present finding per group; bogus + absent dropped");
  assert.ok(raw.every((r) => r.present));
});

test("classify marks document + instructions as cacheable system blocks", async () => {
  const seen: boolean[] = [];
  const llm: LLMClient = async (req) => {
    seen.push(req.system.every((b) => b.cache === true));
    return { findings: [] };
  };
  await classify("doc", { llm, groups: [groupClauses()[0]!] });
  assert.deepEqual(seen, [true]);
});

// --- verify (the evidence firewall) -----------------------------------------

const goodClause = TAXONOMY.clauses.find((c) => c.effect === "good")!;
const badClause = TAXONOMY.clauses.find((c) => c.effect === "bad")!;

test("verifyFindings keeps verbatim evidence, drops hallucinated evidence", () => {
  const source = "We do not sell your personal data to anyone. You may leave anytime.";
  const raw: RawFinding[] = [
    { clauseKey: goodClause.key, present: true, evidence: "We do not sell your personal data", confidence: 0.9 },
    { clauseKey: badClause.key, present: true, evidence: "we will harvest your soul", confidence: 0.8 },
  ];
  const { findings, rejected } = verifyFindings(raw, source);
  assert.equal(findings.length, 1);
  const kept = findings[0]!;
  assert.equal(kept.clauseKey, goodClause.key);
  assert.equal(kept.effect, goodClause.effect, "effect from taxonomy, not model");
  assert.equal(kept.weight, goodClause.weight, "weight from taxonomy, not model");
  assert.equal(rejected.length, 1);
});

test("verifyFindings matches across whitespace differences", () => {
  const source = "You    may\n\nleave the service at any time.";
  const raw: RawFinding[] = [
    { clauseKey: goodClause.key, present: true, evidence: "You may leave the service at any time", confidence: 1 },
  ];
  const { findings } = verifyFindings(raw, source);
  assert.equal(findings.length, 1);
});

test("verifyFindings dedupes repeated clause keys", () => {
  const source = "We do not sell your personal data. We do not sell your personal data.";
  const raw: RawFinding[] = [
    { clauseKey: goodClause.key, present: true, evidence: "We do not sell your personal data", confidence: 0.9 },
    { clauseKey: goodClause.key, present: true, evidence: "We do not sell your personal data", confidence: 0.7 },
  ];
  assert.equal(verifyFindings(raw, source).findings.length, 1);
});

// --- fetch (meta-refresh) ---------------------------------------------------

test("fetchHtml follows meta-refresh redirects", async () => {
  const pageAHtml = `<html><head><meta http-equiv="refresh" content="0; URL=https://example.com/pageB"></head><body>Redirecting...</body></html>`;
  const pageBHtml = `<html><body>Final content page</body></html>`;
  const fetchImpl = mockFetch({
    "https://example.com/pageA": { body: pageAHtml },
    "https://example.com/pageB": { body: pageBHtml },
  });
  const result = await fetchHtml("https://example.com/pageA", { fetchImpl });
  assert.ok(result !== null);
  assert.equal(result.finalUrl, "https://example.com/pageB");
  assert.match(result.html, /Final content page/);
});

test("fetchHtml handles relative meta-refresh URLs", async () => {
  const pageAHtml = `<html><head><meta http-equiv="refresh" content="0; URL=/pageB"></head></html>`;
  const pageBHtml = `<html><body>Final content</body></html>`;
  const fetchImpl = mockFetch({
    "https://example.com/pageA": { body: pageAHtml },
    "https://example.com/pageB": { body: pageBHtml },
  });
  const result = await fetchHtml("https://example.com/pageA", { fetchImpl });
  assert.ok(result !== null);
  assert.equal(result.finalUrl, "https://example.com/pageB");
});

test("fetchHtml caps meta-refresh hops", async () => {
  const redirect1 = `<meta http-equiv="refresh" content="0; URL=https://example.com/p2">`;
  const redirect2 = `<meta http-equiv="refresh" content="0; URL=https://example.com/p3">`;
  const redirect3 = `<meta http-equiv="refresh" content="0; URL=https://example.com/p4">`;
  const redirect4 = `<meta http-equiv="refresh" content="0; URL=https://example.com/p5">`;
  const fetchImpl = mockFetch({
    "https://example.com/p1": { body: `<html><head>${redirect1}</head></html>` },
    "https://example.com/p2": { body: `<html><head>${redirect2}</head></html>` },
    "https://example.com/p3": { body: `<html><head>${redirect3}</head></html>` },
    "https://example.com/p4": { body: `<html><head>${redirect4}</head></html>` },
    "https://example.com/p5": { body: `<html><body>Too far</body></html>` },
  });
  const result = await fetchHtml("https://example.com/p1", { fetchImpl, maxMetaRefreshHops: 3 });
  assert.ok(result !== null);
  // Should stop at p4 (3 hops: p1->p2->p3->p4)
  assert.equal(result.finalUrl, "https://example.com/p4");
});

// --- chunk ------------------------------------------------------------------

test("chunkDocument returns single chunk for small text", () => {
  const text = "x".repeat(MAX_CHUNK_CHARS);
  const chunks = chunkDocument(text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], text);
});

test("chunkDocument splits oversized text into multiple chunks with overlap", () => {
  const text = "a".repeat(MAX_CHUNK_CHARS + 10000);
  const chunks = chunkDocument(text);
  assert.ok(chunks.length > 1, "should split into multiple chunks");
  for (const chunk of chunks) {
    assert.ok(chunk.length <= MAX_CHUNK_CHARS, "each chunk <= MAX_CHUNK_CHARS");
  }
  // Verify reassembly covers the whole text (with some overlap duplication)
  const totalUnique = new Set(chunks.join("")).size;
  assert.equal(totalUnique, 1, "only 'a' characters present");
});

test("chunkDocument splits on paragraph boundaries when possible", () => {
  const paragraph = "This is a paragraph.\n\n";
  const text = paragraph.repeat(2000); // ~46k chars
  const chunks = chunkDocument(text);
  assert.ok(chunks.length > 1);
  // Each chunk should end with a complete paragraph (or near a boundary)
  for (const chunk of chunks.slice(0, -1)) {
    assert.ok(chunk.length <= MAX_CHUNK_CHARS);
  }
});

test("classify over oversized document processes all chunks", async () => {
  const groups = [groupClauses()[0]!]; // Single group for simplicity
  const oversizedDoc = "Document text. ".repeat(3000); // ~45k chars
  let callCount = 0;
  const llm: LLMClient = async () => {
    callCount++;
    return { findings: [] };
  };
  await classify(oversizedDoc, { llm, groups });
  const expectedChunks = chunkDocument(oversizedDoc).length;
  assert.equal(callCount, expectedChunks * groups.length, "should call LLM for each chunk × each group");
});

// --- emit -------------------------------------------------------------------

test("emitAnalyzed computes score deterministically and validates", () => {
  const artifact = emitAnalyzed({
    domain: "e.com",
    findings: [
      { clauseKey: goodClause.key, title: goodClause.title, effect: "good", weight: 60, evidence: "x" },
    ],
    sources: [{ url: "https://e.com/privacy", kind: "privacy" }],
    contentHash: hashContent("x"),
    generatedAt: now(),
  });
  assert.equal(artifact.status, "analyzed");
  assert.equal(artifact.score, 10, "all-good -> 10");
  assert.equal(artifact.schemaVersion, 1);
});

test("emitUnavailable and emitAlias produce valid artifacts", () => {
  const u = emitUnavailable("e.com", now(), "empty-content");
  assert.equal(u.status, "unavailable");
  const a = emitAlias("x.com", "twitter.com", now());
  assert.equal(a.aliasOf, "twitter.com");
});

// --- generate (orchestration) ----------------------------------------------

const PRIVACY_HTML = `<html><body><main>
  We do not sell your personal data to third parties. You have the right to leave
  the service at any time and close your account. This is a reasonably long privacy
  policy so that it passes the usable-content length threshold used by the extractor.
  ${"Additional boilerplate legal text. ".repeat(20)}
</main></body></html>`;

function findingLLM(): LLMClient {
  return async (req) => {
    const keys = (req.schema as { properties: { findings: { items: { properties: { clauseKey: { enum: string[] } } } } } })
      .properties.findings.items.properties.clauseKey.enum as string[];
    const findings: RawFinding[] = [];
    if (keys.includes(goodClause.key)) {
      findings.push({ clauseKey: goodClause.key, present: true, evidence: "We do not sell your personal data", confidence: 0.95 });
    }
    return { findings };
  };
}

test("generate: full happy path yields an analyzed artifact", async () => {
  const fetchImpl = mockFetch({
    "https://e.com": { body: `<a href="/privacy">Privacy</a>` },
    "https://e.com/privacy": { body: PRIVACY_HTML },
  });
  const res = await generate("e.com", { fetchImpl, llm: findingLLM(), now });
  assert.equal(res.artifact.status, "analyzed");
  assert.equal(res.artifact.findings?.[0]?.clauseKey, goodClause.key);
  assert.ok((res.artifact.sources?.length ?? 0) >= 1);
  assert.equal(res.skipped, false);
});

test("generate: no candidates -> unavailable(no-candidates)", async () => {
  // Homepage 404s and every well-known path 404s.
  const res = await generate("nope.com", { fetchImpl: mockFetch({}), llm: findingLLM(), now, maxCandidates: 0 });
  assert.equal(res.artifact.status, "unavailable");
});

test("generate: pages fetched but empty text -> unavailable(empty-content)", async () => {
  const fetchImpl = mockFetch({
    "https://js.com": { body: `<a href="/terms">Terms</a>` },
    "https://js.com/terms": { body: `<html><body><div id="app"></div></body></html>` },
  });
  const res = await generate("js.com", { fetchImpl, llm: findingLLM(), now });
  assert.equal(res.artifact.status, "unavailable");
});

test("generate: unchanged contentHash skips the LLM", async () => {
  const fetchImpl = mockFetch({
    "https://e.com": { body: `<a href="/privacy">Privacy</a>` },
    "https://e.com/privacy": { body: PRIVACY_HTML },
  });
  // First run to learn the hash + findings.
  const first = await generate("e.com", { fetchImpl, llm: findingLLM(), now });
  let llmCalls = 0;
  const countingLLM: LLMClient = async (r) => {
    llmCalls++;
    return findingLLM()(r);
  };
  const second = await generate("e.com", {
    fetchImpl,
    llm: countingLLM,
    now,
    existing: first.artifact,
  });
  assert.equal(second.skipped, true);
  assert.equal(llmCalls, 0, "LLM not called when content unchanged");
  assert.deepEqual(second.artifact.findings, first.artifact.findings);
});

test("generate: hallucinated evidence is rejected end-to-end", async () => {
  const fetchImpl = mockFetch({
    "https://e.com": { body: `<a href="/privacy">Privacy</a>` },
    "https://e.com/privacy": { body: PRIVACY_HTML },
  });
  const lyingLLM: LLMClient = async (req) => {
    const keys = (req.schema as { properties: { findings: { items: { properties: { clauseKey: { enum: string[] } } } } } })
      .properties.findings.items.properties.clauseKey.enum as string[];
    return { findings: keys.map((k) => ({ clauseKey: k, present: true, evidence: "text that is not in the document at all", confidence: 1 })) };
  };
  const res = await generate("e.com", { fetchImpl, llm: lyingLLM, now });
  assert.equal(res.artifact.findings?.length, 0, "no unverifiable findings survive");
  assert.ok(res.rejectedCount > 0);
  assert.equal(res.artifact.score, 10, "no bad findings -> clean 10 (penalty model)");
});

test("generate: dedupes candidates that redirect to same finalUrl", async () => {
  const fetchImpl = mockFetch({
    "https://e.com": { body: `<a href="/terms">Terms</a><a href="/tos">TOS</a>` },
    "https://e.com/terms": { body: PRIVACY_HTML, finalUrl: "https://docs.e.com/terms" },
    "https://e.com/tos": { body: PRIVACY_HTML, finalUrl: "https://docs.e.com/terms" },
  });
  let llmCalls = 0;
  const countingLLM: LLMClient = async (r) => {
    llmCalls++;
    return findingLLM()(r);
  };
  const res = await generate("e.com", { fetchImpl, llm: countingLLM, now });
  // Both /terms and /tos redirect to the same finalUrl, so should only process once
  assert.equal(res.artifact.sources?.length, 1, "only one source kept after finalUrl dedupe");
  // The document should appear only once in the LLM calls
  const groups = groupClauses();
  assert.equal(llmCalls, groups.length, "LLM called only once per group for the single doc");
});
