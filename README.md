# AutoTOS

Automatic Terms of Service & Privacy Policy parser and summarizer, delivered as a
browser extension. AutoTOS flags legally-relevant clauses in a site's terms
(e.g. "this service can sell your data", "terms may change without notice"),
tags each as good / bad / neutral, and rolls them into a single **A–E grade**.

This is a from-scratch re-architecture of the original
[AutoTOS](https://github.com/intermezzio/autoTOS) (PennApps XXI, *Best use of Google Cloud*),
which used a fine-tuned RoBERTa model. The generator now uses an LLM with structured
output instead of a trained model.

## Architecture

AutoTOS is a **write-path / read-path split**:

```
Generator (offline)  ──writes──►  Static JSON on CDN  ◄──reads──  Extension (client)
   Service 3                          Service 1                      Service 2
```

- **Generator** (`packages/generator`) — offline batch pipeline with six stages:
  discover → fetch → extract → classify → verify → emit. Fetches a site's TOS/privacy
  pages, classifies clauses with an LLM against a fixed taxonomy, and writes one
  `domain.json` artifact per registrable domain. Two guarantees hold it together:
  the **LLM never scores** (it only locates clauses and quotes verbatim evidence; the
  grade is computed in code), and an **evidence firewall** rejects any finding whose
  quote isn't present verbatim in the source. All I/O is injected, so every stage but
  `classify` runs without network or API access.
- **Store** — the `autotos-data` repo (sibling of this one), served as static JSON from
  Cloudflare Pages. Reads are pure CDN lookups; a small Cloudflare Worker handles the
  "request analysis" button.
- **Extension** (`packages/extension`) — thin client. Detects the active domain, normalizes
  it to eTLD+1, resolves aliases, fetches the matching `domain.json`, and renders it. On a
  miss, an explicit button lets the user request analysis.

## Packages

| Package | Purpose |
| --- | --- |
| `packages/contracts` | The generator↔client hinge: JSON schemas, the class taxonomy, the alias table, and generated TS types + zod validators. |
| `packages/core` | Shared logic used by both sides: eTLD+1 normalization, alias resolution, deterministic scoring/grading. |
| `packages/extension` | The WebExtension (Chrome / Firefox / Safari) built with WXT. |
| `packages/generator` | The offline analysis generator (Service 3). |

Published JSON artifacts live in the separate **`autotos-data`** repo — different lifecycle
(commit-per-analysis), pointed straight at Cloudflare Pages.

## Scoring

A **category-based penalty model**. Only user-*hostile* clauses count — a "good"
clause (e.g. "we don't sell your data") is the baseline expectation, not a merit, so
it never lifts the grade. Each clause in the taxonomy belongs to a category, and the
score deducts each **distinct bad category once**, no matter how many clauses fall in
it (three tracking clauses raise one "tracking" concern, not three):

```
penalty = Σ over distinct bad categories present ( category.penalty )
score   = clamp(100 − penalty, 0, 100) / 10        # 0–10
```

| Grade | Score | Meaning            |
|-------|-------|--------------------|
| A     | ≥ 8   | Very user-friendly |
| B     | ≥ 6   | User-friendly      |
| C     | ≥ 4   | Mixed              |
| D     | ≥ 2   | Unfriendly         |
| E     | < 2   | Very unfriendly    |

Spot-checked against [ToS;DR](https://tosdr.org) grades — e.g. GitHub → D, Wikipedia → B.

## Development

```bash
npm install
npm run build            # build all packages
npm run ext:dev          # run the extension in dev (Chrome)
npm run ext:build:chrome # produce a Chrome build
npm run ext:build:firefox
npm run ext:build:safari # produces the WebExtension bundle to wrap in Xcode
```

## Cross-browser

One shared WebExtension codebase covers Chrome and Firefox via `webextension-polyfill`
and WXT's per-target manifests. Safari (macOS + iOS) reuses the same built output wrapped
in an Xcode app (`packages/extension-safari`, generated via
`xcrun safari-web-extension-converter`) and shipped through the App Store.
