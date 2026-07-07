import browser from "webextension-polyfill";
import { toRegistrableDomain, resolveCanonical, scoreVerdict } from "@autotos/core";
import type { DomainAnalysis, Finding } from "@autotos/contracts";
import { getAliasMap } from "../../lib/alias-cache.js";
import { lookupForUrl, requestAnalysis, type LookupResult } from "../../lib/store.js";

const content = document.getElementById("content")!;
const domainLabel = document.getElementById("domain-label")!;

void main();

async function main(): Promise<void> {
  const tab = await getActiveTab();
  const url = tab?.url ?? "";

  const result = await lookupForUrl(url);
  render(result, url);
}

async function getActiveTab(): Promise<browser.Tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function render(result: LookupResult, pageUrl: string): void {
  switch (result.kind) {
    case "not-analyzable":
      domainLabel.textContent = "";
      content.innerHTML = message(
        "Nothing to analyze",
        "AutoTOS works on regular websites. This page isn't one we can look up.",
      );
      return;

    case "hit":
      domainLabel.textContent = result.domain;
      renderAnalysis(result.analysis);
      return;

    case "miss":
      domainLabel.textContent = result.domain;
      renderMiss(result.domain, pageUrl);
      return;

    case "error":
      domainLabel.textContent = result.domain;
      content.innerHTML = message(
        "Couldn't load analysis",
        escapeHtml(result.message) + ". Please try again in a moment.",
      );
      return;
  }
}

function renderAnalysis(analysis: DomainAnalysis): void {
  const findings = analysis.findings ?? [];
  const score = analysis.score ?? 5;
  const verdict = scoreVerdict(score);

  const root = document.createElement("div");
  root.className = "state analysis";

  // Score header
  const scoreEl = document.createElement("div");
  scoreEl.className = `score score--${verdict}`;
  scoreEl.innerHTML = `
    <div class="score__number">${score.toFixed(1)}<span class="score__max">/10</span></div>
    <div class="score__verdict">${verdictLabel(verdict)}</div>
  `;
  root.appendChild(scoreEl);

  if (findings.length === 0) {
    root.appendChild(fragment(message("No notable clauses", "We didn't identify any flagged clauses in these terms.")));
  } else {
    const list = document.createElement("ul");
    list.className = "findings";
    for (const f of sortFindings(findings)) {
      list.appendChild(findingItem(f));
    }
    root.appendChild(list);
  }

  if (analysis.generatedAt) {
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = `Analyzed ${formatDate(analysis.generatedAt)}`;
    root.appendChild(meta);
  }

  content.replaceChildren(root);
}

function findingItem(f: Finding): HTMLElement {
  const li = document.createElement("li");
  li.className = `finding finding--${f.effect}`;

  const icon = document.createElement("span");
  icon.className = "finding__icon";
  icon.textContent = effectIcon(f.effect);
  icon.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "finding__body";

  const title = document.createElement("div");
  title.className = "finding__title";
  title.textContent = f.title ?? f.clauseKey;
  body.appendChild(title);

  if (f.evidence) {
    const toggle = document.createElement("button");
    toggle.className = "finding__toggle";
    toggle.type = "button";
    toggle.textContent = "Show evidence";

    const quote = document.createElement("blockquote");
    quote.className = "finding__evidence";
    quote.hidden = true;
    quote.textContent = f.evidence;

    toggle.addEventListener("click", () => {
      quote.hidden = !quote.hidden;
      toggle.textContent = quote.hidden ? "Show evidence" : "Hide evidence";
    });

    body.appendChild(toggle);
    body.appendChild(quote);
  }

  li.appendChild(icon);
  li.appendChild(body);
  return li;
}

function renderMiss(domain: string, pageUrl: string): void {
  const root = document.createElement("div");
  root.className = "state miss";

  root.appendChild(
    fragment(
      message(
        "Not analyzed yet",
        `We don't have an analysis for <strong>${escapeHtml(domain)}</strong> yet.`,
      ),
    ),
  );

  const button = document.createElement("button");
  button.className = "request-button";
  button.type = "button";
  button.textContent = "Request analysis";

  const status = document.createElement("p");
  status.className = "request-status";

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Requesting…";
    // Only send the canonical domain (and, at most, the current page URL as a
    // hint). We never auto-send browsing data — this is user-initiated.
    const registrable = toRegistrableDomain(pageUrl);
    const aliasMap = await getAliasMap();
    const canonical = registrable ? resolveCanonical(registrable, aliasMap) : domain;
    const hintUrls = pageUrl ? [pageUrl] : undefined;

    const res = await requestAnalysis(canonical, hintUrls);
    if (res.ok || res.status === "already_present") {
      button.hidden = true;
      status.className = "request-status request-status--ok";
      if (res.message) {
        // A specific message (e.g. saved-offline) takes precedence.
        status.textContent = res.message;
      } else {
        const demand =
          res.count && res.count > 1 ? ` You're one of ${res.count} people who asked.` : "";
        status.textContent =
          (res.status === "already_present"
            ? "Analysis is on its way — check back shortly."
            : "Thanks! We've queued this site for analysis.") + demand;
      }
    } else {
      button.disabled = false;
      button.textContent = "Request analysis";
      status.className = "request-status request-status--err";
      status.textContent = res.message ?? "Couldn't submit the request. Try again.";
    }
  });

  root.appendChild(button);
  root.appendChild(status);
  content.replaceChildren(root);
}

// --- rendering helpers ------------------------------------------------------

function sortFindings(findings: readonly Finding[]): Finding[] {
  const order: Record<string, number> = { bad: 0, neutral: 1, good: 2 };
  return [...findings].sort(
    (a, b) => (order[a.effect] ?? 1) - (order[b.effect] ?? 1) || b.weight - a.weight,
  );
}

function effectIcon(_effect: Finding["effect"]): string {
  // A filled circle; color is applied per-effect via the .finding--{effect} class.
  return "●";
}

function verdictLabel(v: ReturnType<typeof scoreVerdict>): string {
  return v === "good" ? "User-friendly" : v === "bad" ? "Unfriendly" : "Mixed";
}

function message(title: string, bodyHtml: string): string {
  return `<div class="msg"><h2 class="msg__title">${escapeHtml(title)}</h2><p class="msg__body">${bodyHtml}</p></div>`;
}

function fragment(html: string): DocumentFragment {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return tpl.content;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
