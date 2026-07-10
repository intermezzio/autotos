# AutoTOS Batch Job Design

**Version:** 1.0  
**Date:** 2026-07-11  
**Status:** Design Document (not implemented)

## Executive Summary

This document specifies the design for a batch job to populate the AutoTOS CDN (`autotos-data.amascillaro.workers.dev`) with ToS analysis artifacts for 50-500 domains. The job orchestrates the existing 6-stage generator pipeline (`discover → fetch → extract → classify → verify → emit`) at scale, respecting rate limits, handling failures gracefully, and publishing artifacts safely to the GitHub-backed CDN.

**Key constraint:** The `classify` stage requires an `ANTHROPIC_API_KEY`. Until one is available, a human (or Claude as manual classifier) is the fallback.

---

## 1. Architecture of the Batch Job

### 1.1 Orchestration Strategy

The batch job is **shell-based** and uses the existing `autotos-generate` CLI (`packages/generator/src/cli.ts`) with no new code required. The CLI already supports:

- `autotos-generate <domain>...` — analyze specific domains
- `--seeds <file>` — read domains from a newline-delimited file
- `--drain [--limit N]` — pull top-N from the `/missing` Worker endpoint
- `--write <autotos-data-dir>` — write artifacts to `v1/analysis/<domain>.json`
- `--dry-run` — print artifacts to stdout without writing
- `--limit N` — cap number of domains processed

**The orchestration script is a Bash driver** that:

1. **Splits the domain list into batches** (e.g., 10 domains per batch) to allow checkpointing and resumability.
2. **Runs one batch at a time** sequentially with `autotos-generate --seeds <batch-file> --write <autotos-data-dir>`.
3. **Logs progress** to a timestamped log file for audit and debugging.
4. **Commits artifacts incrementally** (one commit per batch, or every N domains) to avoid a single massive commit.

### 1.2 Concurrency and Rate Limiting

**Within a batch:**
- The CLI processes domains **sequentially** (line 102 in `cli.ts`: `for (const domain of domains)`).
- This is deliberate: sequential execution simplifies rate limiting and avoids overwhelming target sites or the Anthropic API.

**Politeness constraints:**
- **Target sites:** The `fetch` stage already includes a 15s timeout, one retry, and a realistic user-agent (`packages/generator/src/fetch.ts` line 16-17). Sequential processing adds natural spacing (~30-60s per domain). If rate-limiting from specific sites becomes an issue, add a configurable inter-domain delay (`sleep 2` between domains).
- **Anthropic API:** The `classify` stage uses prompt caching (line 152 in `classify.ts`): the document text is sent as a cacheable system block, so repeated grouped calls for the same document cost ~10% of uncached. Sequential processing + caching keeps us well under free-tier or pay-as-you-go limits. **No explicit rate-limiting is needed initially**; Anthropic's API has generous per-minute limits (~50 requests/min for Sonnet), and our grouped calls (4 groups of 4 clauses = 4 API calls per domain) will average ~1 domain per 10-15 seconds.

### 1.3 Idempotency (Skip-if-Unchanged)

The CLI already implements skip-if-unchanged at line 95-105 in `generate.ts`:

```typescript
if (deps.existing?.contentHash === hash && deps.existing.status === "analyzed") {
  log(`${domain}: unchanged (hash match) — skipping LLM`);
  const artifact = emitAnalyzed({ /* reuse existing findings, bump generatedAt */ });
  return { artifact, skipped: true, rejectedCount: 0 };
}
```

**How it works:**
- Before classification, the pipeline computes a `contentHash` (SHA-256 of the combined, normalized text from all fetched sources).
- If an existing artifact exists in `--write <autotos-data-dir>/v1/analysis/<domain>.json` with the same `contentHash`, the LLM call is skipped and the prior findings are reused with an updated `generatedAt` timestamp.
- This makes re-running the batch job on the same domain list **safe and cheap**: only domains with changed ToS trigger re-analysis.

**Implication for the batch job:**
- If the job crashes mid-batch, **simply re-run the same command**. Already-analyzed domains will be skipped (or re-emitted with updated timestamps), and the job will resume from the first un-analyzed domain.

### 1.4 Retries and Backoff

**Transient failures are already handled at the fetch stage** (`fetch.ts` line 113-116):

```typescript
let first = await attempt(url);
if (!first) {
  first = await attempt(url); // one retry
}
```

**Persistent failures** (e.g., JS-rendered sites, 403/404 errors, empty content) result in a status `unavailable` artifact (line 86-89 in `generate.ts`):

```typescript
if (docs.length === 0) {
  log(`${domain}: no usable content`);
  return unavailable(domain, now, "empty-content");
}
```

**No exponential backoff is needed** because:
- Fetch failures are either transient (one retry fixes them) or structural (the site blocks bots / is JS-only).
- The Anthropic API client will raise an exception on rate-limit errors, which will fail the domain and log the error. The operator can re-run the batch later.

**Error handling in the CLI** (line 129-132 in `cli.ts`):
- Each domain is wrapped in a try-catch.
- Failures are logged to stderr with `✗ <domain> — <error>`.
- The job continues to the next domain.
- Exit code is 1 only if **all domains failed**; partial success exits 0.

**Recommendation:**
- For a large batch run, wrap the orchestration script in a loop that checks the exit code and retries failed domains once after a 5-minute cooldown:
  ```bash
  for domain in $(grep '✗' batch-1.log | awk '{print $2}'); do
    echo "$domain" >> batch-1-retry.txt
  done
  autotos-generate --seeds batch-1-retry.txt --write autotos-data --limit 100
  ```

### 1.5 Handling JS-Rendered Sites

The pipeline uses **cheerio** (no browser), so JS-rendered sites will fail at the extract stage with status `unavailable`, reason `empty-content` (line 47 in `extract.ts`: text length < 400 chars).

**Mitigation strategies (not implemented yet):**
1. **Manual fallback:** Inspect the `unavailable` artifacts and manually fetch the ToS text for high-priority sites.
2. **Browser automation:** Add a `--use-browser` flag to the CLI that falls back to Playwright/Puppeteer when the initial fetch yields empty content. This is out of scope for the initial batch job but is a natural extension.

**For the first batch run:**
- Accept that JS-heavy sites (e.g., SPAs with ToS behind authentication) will fail.
- Track these in a separate list for manual review.
- The CDN will serve `status: "unavailable"` artifacts for them, which the client can render as "ToS not available."

### 1.6 Resumability

**The batch job is fully resumable** because:
1. **Artifacts are written incrementally** (one file per domain, line 119 in `cli.ts`).
2. **Skip-if-unchanged checks existing artifacts** (line 104 in `cli.ts` calls `readExisting`).
3. **Progress is logged** to stderr with `✓` or `✗` per domain.

**To resume after a crash or Ctrl-C:**
1. Check the log for the last successfully processed domain.
2. Remove already-processed domains from the seed file, or simply re-run the same command (skip-if-unchanged will handle it).

**Optional enhancement (not required initially):**
- Add a `--skip-existing` flag that checks for the presence of any artifact (not just matching contentHash) and skips that domain entirely. This avoids re-fetching domains that already have `unavailable` artifacts.

---

## 2. Seed List Strategy

### 2.1 Sources for Domain Lists

For a first big run targeting 100-500 domains, use a combination of:

#### **A. ToS;DR Ground Truth** (10 domains)
- **File:** `/tmp/tosdr-ground-truth.json`
- **Domains:** `google.com`, `youtube.com`, `github.com`, `facebook.com`, `amazon.com`, `netflix.com`, `reddit.com`, `wikipedia.org`, `spotify.com`, `discord.com`
- **Rationale:** These are curated, high-quality sites with known ToS. Useful for validating the pipeline against human-reviewed labels.

#### **B. User Requests via `/missing` Endpoint**
- **Endpoint:** `https://autotos-request.amascillaro.workers.dev/missing?limit=50`
- **CLI Flag:** `autotos-generate --drain --limit 50`
- **Rationale:** These are organically requested by users, so they have real demand. Prioritize these after the ground truth set.

#### **C. Public Top Sites Lists**
For broader coverage, use one of these datasets:

1. **Tranco Top 1K** (https://tranco-list.eu/)
   - Academic project ranking the top 1M sites by aggregating multiple sources (Alexa, Cloudflare Radar, Umbrella).
   - Download the latest daily list: `curl https://tranco-list.eu/top-1m.csv.zip | unzip -p | head -1000 | cut -d, -f2 > tranco-top-1k.txt`
   - **Pros:** Stable, resists manipulation, widely used in research.
   - **Cons:** Includes many non-English and region-specific sites.

2. **Cloudflare Radar Top Sites** (https://radar.cloudflare.com/domains)
   - Top 100 domains by HTTP traffic (Cloudflare's view of the internet).
   - **Pros:** Reflects real user traffic, regularly updated.
   - **Cons:** Only top 100 available publicly without an API key.

3. **Chrome User Experience Report (CrUX)** (https://developer.chrome.com/docs/crux)
   - Google's dataset of real-world user visits from Chrome browsers.
   - **Pros:** Reflects actual user behavior.
   - **Cons:** Requires BigQuery access to query the dataset.

4. **Alexa Top Sites (archived)** or **SimilarWeb**
   - Historical Alexa top 1M is available in archived datasets.
   - **Cons:** Alexa was retired in 2022; use Tranco instead.

**Recommendation for the first batch run:**
- **Phase 1:** ToS;DR ground truth (10 domains) — validate the pipeline.
- **Phase 2:** `/missing` endpoint (up to 100 domains) — satisfy user demand.
- **Phase 3:** Tranco top 500, filtered to English-language or globally relevant sites (e.g., `*.com`, `*.org`, `*.net`, exclude Chinese/Russian TLDs unless relevant).

### 2.2 Seed File Format

The CLI expects a newline-delimited text file (line 58-63 in `cli.ts`):

```
google.com
github.com
reddit.com
# Comments are ignored
netflix.com
```

**Domain normalization:**
- Domains are lowercased automatically (line 46 in `cli.ts`).
- Strip `www.` prefixes if present (the discover stage tries `https://<domain>`, not `https://www.<domain>`).

---

## 3. Write and Publish Strategy

### 3.1 Artifact Storage

**Location:** `/Users/andrew.mascillaro/Documents/autotos/autotos-data/v1/analysis/<domain>.json`

**Format (from `github.com.json`):**
```json
{
  "schemaVersion": 1,
  "domain": "github.com",
  "status": "analyzed",
  "generatedAt": "2026-07-01T00:00:00.000Z",
  "sources": [
    { "url": "https://docs.github.com/...", "kind": "terms" },
    { "url": "https://docs.github.com/...", "kind": "privacy" }
  ],
  "contentHash": "9f2c1a7b3e4d5f60",
  "score": 4.6,
  "findings": [ /* array of Finding objects */ ]
}
```

**Validation:**
- The `emit.ts` stage (line 35) calls `parseDomainAnalysis(artifact)` which validates against the Zod schema before writing. **The pipeline will crash if an invalid artifact is produced**, so no additional validation is needed.

### 3.2 Commit Strategy

**Problem:** Committing 500 new JSON files in one commit creates a 1 MB+ diff that's hard to review.

**Solution:** Commit **incrementally** after each batch (e.g., every 10-50 domains).

**Batch commit workflow:**
```bash
cd /Users/andrew.mascillaro/Documents/autotos/autotos-data
git add v1/analysis/*.json
git commit --author="intermezzio <intermezzio@users.noreply.github.com>" \
  -m "Add batch 1 analysis artifacts (domains 1-50)"
git push origin main
```

**Rationale:**
- Incremental commits allow rollback if a batch has issues.
- Smaller diffs are easier to review (though artifact JSON is machine-generated and not hand-reviewed).
- If the job crashes, already-committed batches are safely published to the CDN.

**Recommendation:**
- Commit every 25 domains.
- Use descriptive commit messages: `"Batch N: add {google.com, github.com, ...} (domains X-Y)"`

### 3.3 Avoiding Clobbering Existing Artifacts

**Problem:** Re-running the batch job might overwrite good artifacts with `unavailable` (e.g., if a site goes down temporarily).

**Solution:**
The skip-if-unchanged logic (line 95-105 in `generate.ts`) already handles this:
- If an existing artifact has status `analyzed` and the `contentHash` matches, the LLM is skipped and findings are reused.
- If the `contentHash` differs (ToS changed), the artifact is re-generated.
- If the existing artifact is `unavailable` and the site is now fetchable, it's upgraded to `analyzed`.

**Additional safeguard:**
Before committing a batch, run:
```bash
git diff v1/analysis/ | grep '"status": "unavailable"' | wc -l
```
If many `analyzed → unavailable` downgrades appear, investigate (likely a fetch issue). Otherwise, commit normally.

### 3.4 Manifest / Index

**Question:** Should there be a `v1/analysis/index.json` listing all analyzed domains?

**Answer:** **Not required initially**, but useful for the client UI.

**Manifest format (if implemented):**
```json
{
  "generatedAt": "2026-07-11T12:00:00.000Z",
  "domains": [
    { "domain": "google.com", "status": "analyzed", "score": 3.2 },
    { "domain": "github.com", "status": "analyzed", "score": 4.6 },
    { "domain": "broken-site.com", "status": "unavailable" }
  ]
}
```

**Generation:**
After each batch commit, run a post-commit hook or manual script:
```bash
cd /Users/andrew.mascillaro/Documents/autotos/autotos-data/v1/analysis
for f in *.json; do
  domain=$(jq -r '.domain' "$f")
  status=$(jq -r '.status' "$f")
  score=$(jq -r '.score // "null"' "$f")
  echo "{\"domain\":\"$domain\",\"status\":\"$status\",\"score\":$score}"
done | jq -s '{generatedAt: (now | strftime("%Y-%m-%dT%H:%M:%S.000Z")), domains: .}' > index.json
```

**Recommendation:**
- Defer the manifest until after the first 100-domain batch is complete.
- The CDN Worker can generate it on-demand by listing `v1/analysis/` files if needed.

---

## 4. Cost and Throughput Estimate

### 4.1 Token Costs per Domain

**Model:** `claude-opus-4-8` (default in `llm.ts` line 49)

**Pricing (as of 2025-01):**
- Input: $15 / 1M tokens
- Output: $75 / 1M tokens
- Cache writes: $18.75 / 1M tokens (1.25x input)
- Cache reads: $1.50 / 1M tokens (0.1x input)

**Token usage per domain (estimated):**

1. **System blocks (cacheable across grouped calls):**
   - Shared instructions: ~150 tokens (line 85-93 in `classify.ts`)
   - Document text: ~5,000-15,000 tokens (typical ToS is 10-40k chars, ~2.5k-10k words, ~4 chars/token)
   - **Average:** 10,000 tokens cached

2. **Grouped calls (4 groups of 4 clauses = 4 API calls per domain):**
   - First call: cache write (10,000 tokens × 1.25 = 12,500 token-equivalents)
   - Calls 2-4: cache read (10,000 tokens × 0.1 = 1,000 token-equivalents each)
   - User prompt per call: ~200 tokens (line 121-126 in `classify.ts`)
   - Output per call: ~500 tokens (4 findings × ~100 tokens each)

**Total input tokens per domain:**
- Cache write: 12,500 (first call)
- Cache reads: 3,000 (calls 2-4)
- User prompts: 800 (4 calls × 200)
- **Total input:** ~16,300 token-equivalents

**Total output tokens per domain:** ~2,000 (4 calls × 500)

**Cost per domain:**
- Input: 16,300 × $15/1M = $0.245
- Output: 2,000 × $75/1M = $0.150
- **Total: ~$0.40 per domain**

**Caveats:**
- This assumes a 10k-token document (average ToS). Large sites (e.g., AWS ToS at 30k words) could cost 2-3x more.
- Cache effectiveness depends on the 5-minute cache TTL. Sequential processing ensures all 4 grouped calls reuse the cache.

### 4.2 Throughput Estimate

**Time per domain (measured experimentally or estimated):**

1. **Discovery + fetch:** 5-10 seconds (4 candidates × 2-3s per fetch, accounting for redirects and timeouts)
2. **Extract:** <1 second (cheerio is fast)
3. **Classify:** 10-20 seconds (4 API calls × 2-5s each, depending on model latency)
4. **Verify + emit:** <1 second (CPU-bound)
5. **Write file:** <1 second

**Total:** ~20-30 seconds per domain on average.

**For a 100-domain batch:**
- Sequential: ~40 minutes (100 × 25s avg)
- With 10% failures (unavailable sites, faster): ~35 minutes

**For a 500-domain batch:**
- Sequential: ~3.5 hours
- Practical: ~4 hours (accounting for occasional rate-limit pauses or slow sites)

### 4.3 Total Cost for a 100-Domain Run

- **Token cost:** 100 domains × $0.40 = **$40**
- **CDN cost:** Cloudflare Workers free tier (100k requests/day) — negligible for writes.
- **Compute cost:** Free (runs locally).

**Total: ~$40 for 100 domains.**

**For a 500-domain run:** ~$200.

**Budget-conscious alternative:**
- Use `claude-sonnet-4-5-20250929` instead of `opus-4-8`:
  - Input: $3 / 1M tokens (5x cheaper)
  - Output: $15 / 1M tokens (5x cheaper)
  - Cost per domain: ~$0.08
  - **100 domains: $8; 500 domains: $40**
- Trade-off: Sonnet may have slightly lower precision on edge cases (e.g., ambiguous clauses).

**Recommendation:**
- Start with Opus for the first 100 domains to establish quality.
- Switch to Sonnet for the next 400 if results are acceptable.

---

## 5. Concrete Runbook

### 5.1 Prerequisites

1. **Environment:**
   - Node.js 18+ (for the CLI).
   - `autotos-generate` CLI built and available on PATH:
     ```bash
     cd /Users/andrew.mascillaro/Documents/autotos/autotos/packages/generator
     npm install
     npm run build
     npm link  # makes `autotos-generate` globally available
     ```

2. **ANTHROPIC_API_KEY:**
   - If available: `export ANTHROPIC_API_KEY=sk-ant-...`
   - If NOT available: the runbook includes a dry-run phase (fetch coverage check) that works without a key.

3. **Data repo cloned:**
   ```bash
   cd /Users/andrew.mascillaro/Documents/autotos
   # autotos-data/ should exist at this path
   ```

### 5.2 Phase 0: Dry-Run (No API Key Required)

**Goal:** Validate fetch coverage (can we retrieve usable ToS text?) without calling the LLM.

**Note:** The CLI currently **requires** `ANTHROPIC_API_KEY` (line 94-97 in `cli.ts`). To bypass this for a dry-run, temporarily comment out the key check and the `classify` call (line 108 in `generate.ts`). Alternatively, use a dummy key and catch the error.

**Workaround for dry-run without modifying code:**
```bash
# Create a seeds file
cat > seeds-phase-0.txt <<EOF
google.com
github.com
reddit.com
EOF

# Run with a dummy key (will fail at classify, but fetch/extract will complete)
ANTHROPIC_API_KEY=dummy autotos-generate --seeds seeds-phase-0.txt --dry-run 2>&1 | tee phase-0.log

# Inspect the log for fetch failures
grep "no usable content\|no candidates" phase-0.log
```

**Expected output:**
- `✓ google.com — unavailable` (or similar) — this means fetch succeeded but classify failed due to the dummy key.
- `✗ broken-site.com — ...` — this means fetch failed.

**Action:** Remove domains that fail fetch from the seed list before the real run.

### 5.3 Phase 1: Ground Truth Validation (10 Domains)

**Seed file:**
```bash
cat > seeds-phase-1.txt <<EOF
google.com
youtube.com
github.com
facebook.com
amazon.com
netflix.com
reddit.com
wikipedia.org
spotify.com
discord.com
EOF
```

**Run:**
```bash
export ANTHROPIC_API_KEY=sk-ant-...  # your real key
cd /Users/andrew.mascillaro/Documents/autotos/autotos

autotos-generate --seeds seeds-phase-1.txt \
  --write /Users/andrew.mascillaro/Documents/autotos/autotos-data \
  2>&1 | tee batch-1.log

# Check results
echo "Success: $(grep -c '✓' batch-1.log)"
echo "Failures: $(grep -c '✗' batch-1.log)"
```

**Commit:**
```bash
cd /Users/andrew.mascillaro/Documents/autotos/autotos-data
git add v1/analysis/*.json
git commit --author="intermezzio <intermezzio@users.noreply.github.com>" \
  -m "$(cat <<EOF
Add batch 1: ToS;DR ground truth (10 domains)

Domains: google.com, youtube.com, github.com, facebook.com, 
amazon.com, netflix.com, reddit.com, wikipedia.org, 
spotify.com, discord.com.

Generated with autotos-generate v1.0.
EOF
)"
git push origin main
```

**Validation:**
- Compare the `score` values in the artifacts to the ToS;DR grades in `/tmp/tosdr-ground-truth.json`.
- Example: ToS;DR gives GitHub a "D" (bad), and our scoring should give it a low score (0-4 range). Check if the findings align (e.g., `terms_change_without_notice`, `indemnify_service`).

### 5.4 Phase 2: User Requests (50-100 Domains)

**Seed file:**
```bash
curl -s "https://autotos-request.amascillaro.workers.dev/missing?limit=100" \
  | jq -r '.sites[]?.domain' \
  > seeds-phase-2.txt

# Or use the CLI's built-in drain:
# autotos-generate --drain --limit 100 --write autotos-data
```

**Run:**
```bash
autotos-generate --seeds seeds-phase-2.txt \
  --write /Users/andrew.mascillaro/Documents/autotos/autotos-data \
  2>&1 | tee batch-2.log
```

**Commit (every 25 domains):**
```bash
cd /Users/andrew.mascillaro/Documents/autotos/autotos-data

# After processing 25 domains:
git add v1/analysis/*.json
git commit --author="intermezzio <intermezzio@users.noreply.github.com>" \
  -m "Batch 2a: user requests (domains 1-25)"
git push origin main

# After processing 50 domains:
git add v1/analysis/*.json
git commit --author="intermezzio <intermezzio@users.noreply.github.com>" \
  -m "Batch 2b: user requests (domains 26-50)"
git push origin main

# ...and so on
```

### 5.5 Phase 3: Top Sites (Tranco Top 500)

**Seed file:**
```bash
# Download Tranco top 1M
curl -s https://tranco-list.eu/top-1m.csv.zip \
  | unzip -p \
  | head -500 \
  | cut -d, -f2 \
  > seeds-phase-3-raw.txt

# Filter to .com/.org/.net (optional, to focus on English-language sites)
grep -E '\.(com|org|net)$' seeds-phase-3-raw.txt > seeds-phase-3.txt

# Remove domains already analyzed in Phase 1-2
comm -23 <(sort seeds-phase-3.txt) <(ls autotos-data/v1/analysis/ | sed 's/\.json$//') \
  > seeds-phase-3-filtered.txt
```

**Run (batched):**
```bash
# Split into 10-domain batches
split -l 10 seeds-phase-3-filtered.txt batch-3-

for batch_file in batch-3-*; do
  echo "Processing $batch_file..."
  autotos-generate --seeds "$batch_file" \
    --write /Users/andrew.mascillaro/Documents/autotos/autotos-data \
    2>&1 | tee "$batch_file.log"
  
  # Commit after each batch
  cd /Users/andrew.mascillaro/Documents/autotos/autotos-data
  git add v1/analysis/*.json
  git commit --author="intermezzio <intermezzio@users.noreply.github.com>" \
    -m "Batch 3: Tranco top sites ($(basename $batch_file))"
  git push origin main
  cd -
  
  # Optional: add a 30-second cooldown between batches
  sleep 30
done
```

### 5.6 Handling Failures

**After a batch run, extract failed domains:**
```bash
grep '✗' batch-2.log | awk '{print $2}' > batch-2-failures.txt

# Inspect the errors
grep '✗' batch-2.log
```

**Common failure modes:**
1. **`no usable content`** — JS-rendered site. Defer for manual handling or browser automation.
2. **`no candidates`** — Discovery failed (site has no obvious `/terms` or `/privacy` page). Likely a false positive in the seed list.
3. **`fetch-failed`** — Network timeout or 403/404. Retry once:
   ```bash
   autotos-generate --seeds batch-2-failures.txt --write autotos-data
   ```

**For persistent failures:**
- Manually inspect the site (open the domain in a browser, check for ToS links).
- Add `hintUrls` to the CLI invocation (requires a small code change to accept `--hint-url <url>` flag).

### 5.7 Post-Batch Validation

**After Phase 3 (500 domains analyzed):**

1. **Count artifacts:**
   ```bash
   cd /Users/andrew.mascillaro/Documents/autotos/autotos-data/v1/analysis
   echo "Total artifacts: $(ls -1 *.json | wc -l)"
   echo "Analyzed: $(jq -r '.status' *.json | grep -c analyzed)"
   echo "Unavailable: $(jq -r '.status' *.json | grep -c unavailable)"
   ```

2. **Score distribution:**
   ```bash
   jq -r '.score // "null"' *.json | grep -v null | sort -n | uniq -c
   ```

3. **Spot-check findings:**
   ```bash
   # Inspect a random analyzed artifact
   jq . "$(ls *.json | shuf -n 1)"
   ```

4. **Generate manifest (optional):**
   ```bash
   for f in *.json; do
     jq '{domain, status, score}' "$f"
   done | jq -s '{generatedAt: (now | strftime("%Y-%m-%dT%H:%M:%SZ")), domains: .}' \
     > index.json
   git add index.json
   git commit -m "Add index.json manifest (500 domains)"
   git push
   ```

---

## 6. Fallback Strategy (No API Key Available)

**Constraint:** If `ANTHROPIC_API_KEY` is not available, the `classify` stage cannot run automatically.

**Workaround: Manual Classification by Claude (you, the AI assistant)**

1. **Run stages 1-3 only (discover + fetch + extract):**
   - Modify `generate.ts` line 108 to skip the `classify` call and instead write the extracted text to a file:
     ```typescript
     await writeFile(`/tmp/autotos-text-${domain}.txt`, text);
     ```
   - Run the CLI without a key; it will produce text dumps for each domain.

2. **Manually classify each domain:**
   - Read `/tmp/autotos-text-<domain>.txt`.
   - For each of the 17 clauses in the taxonomy (see `packages/contracts/src/taxonomy.json`), decide if it's present and quote verbatim evidence.
   - Write the findings to a JSON file matching the `RawFinding[]` schema.

3. **Run stages 5-6 (verify + emit):**
   - Modify `generate.ts` to load the manual findings JSON and skip the LLM call.
   - Emit the artifact as usual.

**Practical alternative:**
- Use a **free-tier Anthropic API key** (available at https://console.anthropic.com). The free tier includes $5 of credits, enough for ~12 domains (at $0.40/domain).
- For a larger batch, request a pay-as-you-go account (no upfront cost; $15/1M input tokens).

---

## 7. Key Files and Functions Referenced

### CLI and Orchestration
- **`packages/generator/src/cli.ts`** (lines 1-138):
  - `parseArgs()` — handles `--seeds`, `--drain`, `--write`, `--dry-run`, `--limit`
  - `resolveDomains()` — fetches from `/missing` or reads seed file
  - `readExisting()` — loads prior artifact for skip-if-unchanged
  - `main()` — sequential loop over domains (line 102)

### Pipeline Stages
- **`packages/generator/src/generate.ts`** (lines 1-137):
  - `generate()` — 6-stage orchestrator
  - `combine()` — merges fetched docs into one text blob + hash (lines 37-46)
  - Skip-if-unchanged logic (lines 95-105)
  
- **`packages/generator/src/discover.ts`** (lines 1-112):
  - `discover()` — returns up to 4 candidate URLs (well-known paths + homepage scraping)
  
- **`packages/generator/src/fetch.ts`** (lines 1-121):
  - `fetchHtml()` — HTTP fetch with timeout, retry, meta-refresh handling
  
- **`packages/generator/src/extract.ts`** (lines 1-49):
  - `extractText()` — cheerio-based HTML → plain text
  - `isUsable()` — checks for MIN_USABLE_CHARS (400)
  
- **`packages/generator/src/classify.ts`** (lines 1-183):
  - `classify()` — grouped LLM calls with prompt caching
  - `groupClauses()` — splits taxonomy into 4-clause groups
  - `chunkDocument()` — splits oversized docs (>40k chars)
  
- **`packages/generator/src/verify.ts`** (lines 1-62):
  - `verifyFindings()` — hallucination firewall (evidence must match source verbatim)
  
- **`packages/generator/src/emit.ts`** (lines 1-66):
  - `emitAnalyzed()` — assembles artifact, validates schema
  - `computeScore()` — imported from `@autotos/core`

### Scoring
- **`packages/core/src/score.ts`** (lines 1-94):
  - `computeScore()` — penalty model (100 − Σ category penalties, then / 10)
  - Score scale: 10 = no bad clauses, 0 = maximally hostile
  - Grades: A (≥8), B (≥6), C (≥4), D (≥2), E (<2)

### Contracts
- **`packages/contracts/src/taxonomy.ts`** (lines 1-65):
  - 17 clauses, grouped into ~10 categories
  - Category penalties (0-100 points)
  
- **`packages/contracts/src/domain.ts`** (artifact schema):
  - `schemaVersion: 1`
  - `status: "analyzed" | "unavailable"`
  - `contentHash`: SHA-256 of normalized text
  - `score`: 0-10, one decimal place
  - `findings[]`: clauseKey, evidence, confidence, weight, effect

### CDN
- **`autotos-data/v1/analysis/<domain>.json`** — artifact storage
- **Served via:** `https://autotos-data.amascillaro.workers.dev/v1/analysis/<domain>.json`
- **Git commits:** must be authored as `intermezzio <intermezzio@users.noreply.github.com>` (per project metadata)

---

## 8. Open Questions and Future Enhancements

### 8.1 Browser Automation for JS-Rendered Sites
**Problem:** Sites that require JavaScript (e.g., React SPAs) yield `empty-content` failures.

**Solution:** Add a `--use-browser` flag that launches Playwright/Puppeteer when the initial fetch yields <400 chars.

**Implementation sketch:**
```typescript
// In fetch.ts, add a fallback:
if (!isUsable(extractText(html))) {
  if (opts.useBrowser) {
    const browser = await playwright.chromium.launch();
    const page = await browser.newPage();
    await page.goto(url);
    html = await page.content();
    await browser.close();
  }
}
```

**Trade-off:** Slower (10-30s per fetch) and more resource-intensive. Reserve for high-priority sites.

### 8.2 Incremental CDN Updates Without Redeployment
**Problem:** Right now, artifacts are deployed via `git push` to the `autotos-data` repo, which triggers a Cloudflare Worker redeploy. This is fast (<1 min) but couples artifact generation to deployment.

**Alternative:** Upload artifacts directly to Cloudflare R2 (object storage) via the Cloudflare API, and have the Worker serve from R2. This decouples generation from deployment.

**Trade-off:** More complex setup; current git-based flow is simple and auditable.

### 8.3 Parallel Processing
**Problem:** Sequential processing (20-30s per domain) means 500 domains take 4 hours.

**Solution:** Add a `--concurrency N` flag to process N domains in parallel.

**Implementation:** Use a worker pool (e.g., `p-queue` npm package) with a max concurrency of 5-10.

**Trade-off:** Must add explicit rate-limiting to avoid overwhelming target sites or the Anthropic API (e.g., 1 request per second per target site).

### 8.4 Alias Detection
**Problem:** Some domains redirect to others (e.g., `x.com` → `twitter.com`). We should detect this and emit an `aliasOf` artifact rather than duplicating the analysis.

**Implementation:** In `generate.ts`, after fetch, check if all finalUrl domains are different from the input domain. If so, emit `emitAlias(domain, canonical, now)`.

**Example:** `x.com.json` → `{"status": "unavailable", "aliasOf": "twitter.com"}`

---

## 9. Summary

This design specifies a **shell-based batch job** using the existing `autotos-generate` CLI to analyze 50-500 domains. The job is:

- **Idempotent** (skip-if-unchanged via contentHash)
- **Resumable** (incremental file writes + progress logs)
- **Cost-effective** (~$0.40/domain with Opus, ~$0.08/domain with Sonnet)
- **Safe** (schema validation at emit, incremental commits, no clobbering)
- **Polite** (sequential processing + retry logic respects rate limits)

The runbook provides concrete commands for:
1. Dry-run fetch validation (no API key needed)
2. Ground truth validation (10 domains)
3. User-requested domains (50-100 domains via `/missing`)
4. Top sites (Tranco 500)

**Next step:** Once `ANTHROPIC_API_KEY` is available, execute Phase 1 (10 domains) to validate the end-to-end flow, then scale to Phases 2-3.
