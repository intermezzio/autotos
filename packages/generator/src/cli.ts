#!/usr/bin/env node
// CLI entrypoint for the generator.
//
// Usage:
//   autotos-generate <domain> [<domain> ...]     analyze specific domains
//   autotos-generate --seeds <file>              analyze one domain per line
//   autotos-generate --drain [--limit N]         pull top-N from GET /missing
//   Common flags:
//     --write <autotos-data-dir>   write artifacts into the data repo's v1/analysis/
//     --dry-run                    print artifacts to stdout, do not write
//     --limit N                    cap number of domains (with --drain)
//
// Requires ANTHROPIC_API_KEY in the environment (unless --dry-run with no LLM,
// which will fail once classification runs — the key is needed for real work).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { safeParseDomainAnalysis, type DomainAnalysis } from "@autotos/contracts";
import { generate } from "./generate.js";
import { createAnthropicClient } from "./llm.js";

const MISSING_ENDPOINT =
  process.env.AUTOTOS_MISSING_URL ??
  "https://autotos-request.amascillaro.workers.dev/missing";

interface Args {
  domains: string[];
  seeds?: string;
  drain: boolean;
  write?: string;
  dryRun: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { domains: [], drain: false, dryRun: false, limit: 25 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--seeds") args.seeds = argv[++i];
    else if (a === "--drain") args.drain = true;
    else if (a === "--write") args.write = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit") args.limit = Number(argv[++i]) || args.limit;
    else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else args.domains.push(a.toLowerCase());
  }
  return args;
}

async function resolveDomains(args: Args): Promise<string[]> {
  if (args.drain) {
    const res = await fetch(`${MISSING_ENDPOINT}?limit=${args.limit}`);
    const body = (await res.json()) as { sites?: Array<{ domain: string }> };
    return (body.sites ?? []).map((s) => s.domain);
  }
  if (args.seeds) {
    const raw = await readFile(args.seeds, "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith("#"));
  }
  return args.domains;
}

/** Read an existing artifact from the data repo, if present (for skip-if-unchanged). */
async function readExisting(
  writeDir: string | undefined,
  domain: string,
): Promise<DomainAnalysis | null> {
  if (!writeDir) return null;
  try {
    const raw = await readFile(
      join(writeDir, "v1", "analysis", `${domain}.json`),
      "utf8",
    );
    const parsed = safeParseDomainAnalysis(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const domains = await resolveDomains(args);
  if (domains.length === 0) {
    console.error("No domains to process. Pass domains, --seeds <file>, or --drain.");
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is required.");
    process.exit(1);
  }
  const llm = await createAnthropicClient({ apiKey });

  let ok = 0;
  let failed = 0;
  for (const domain of domains) {
    try {
      const existing = await readExisting(args.write, domain);
      const { artifact, skipped, rejectedCount } = await generate(domain, {
        fetchImpl: globalThis.fetch as never,
        llm,
        now: () => new Date().toISOString(),
        existing,
        log: (m) => console.error(`  ${m}`),
      });

      const json = JSON.stringify(artifact, null, 2);
      if (args.dryRun || !args.write) {
        console.log(json);
      } else {
        const dir = join(args.write, "v1", "analysis");
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${domain}.json`), json + "\n");
      }
      console.error(
        `✓ ${domain} — ${artifact.status}` +
          (artifact.status === "analyzed"
            ? ` score=${artifact.score} findings=${artifact.findings?.length}` +
              (skipped ? " (unchanged)" : ` (${rejectedCount} rejected)`)
            : ""),
      );
      ok++;
    } catch (err) {
      console.error(`✗ ${domain} — ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }
  console.error(`\nDone: ${ok} ok, ${failed} failed.`);
  if (failed > 0 && ok === 0) process.exit(1);
}

void main();
