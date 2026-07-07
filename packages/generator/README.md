# @autotos/generator

**Placeholder.** Service 3 — the offline analysis generator.

Left as-is for now. When built, this package will:

1. Take a domain (from a curated seed list, the request queue, or manual input).
2. Discover and fetch its TOS / privacy-policy pages, extract clean text.
3. Hash the text; skip re-analysis if the hash is unchanged (cost control + change detection).
4. Classify clauses with an LLM using structured output constrained to the
   taxonomy in `@autotos/contracts` (`taxonomy.json`), requiring a verbatim
   `evidence` span per finding (validated by `str.includes` against the source).
5. Compute the fairness score deterministically via `@autotos/core`'s `computeScore`.
6. Write a `domain.json` artifact (validated against `domain.schema.json`) and
   publish it to the `autotos-data` repo, plus republish the derived `aliases.json`
   from the alias table.

It shares the taxonomy, schema, and scoring with the extension through
`@autotos/contracts` and `@autotos/core`, so the write path and read path can
never drift on the contract.
