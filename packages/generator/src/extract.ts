// Stage 3: HTML -> clean plain text, plus a content hash.
//
// We use cheerio (no browser): drop script/style/nav/footer chrome, then take
// the text of the densest content container. Legal pages are mostly prose, so
// this is enough — and if the result is near-empty, the page was likely
// JS-rendered and we report it rather than analyze garbage.

import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

/** Below this many chars of extracted text, treat the page as empty/JS-only. */
export const MIN_USABLE_CHARS = 400;

const STRIP = "script, style, noscript, nav, header, footer, aside, svg, form, iframe";

/** Extract clean, whitespace-normalized text from a raw HTML document. */
export function extractText(html: string): string {
  const $ = cheerio.load(html);
  $(STRIP).remove();

  // Prefer an obvious main-content container; fall back to <body>.
  const container =
    ["main", "article", '[role="main"]', "#content", ".content", ".legal", ".terms"]
      .map((sel) => $(sel).first())
      .find((el) => el.length > 0) ?? $("body");

  const raw = (container.length ? container : $("body")).text();
  return normalizeWhitespace(raw);
}

/** Collapse runs of whitespace, keeping paragraph breaks readable. */
export function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** sha256 (hex) of the text — matches the schema's contentHash pattern. */
export function hashContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Whether extracted text is substantial enough to be worth classifying. */
export function isUsable(text: string): boolean {
  return text.length >= MIN_USABLE_CHARS;
}
