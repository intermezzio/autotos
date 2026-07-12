# AutoTOS Privacy Policy

_Last updated: July 11, 2026_

AutoTOS is a browser extension that shows you how fair a website's Terms of
Service are — a 0–10 fairness score and a list of flagged clauses, right in your
browser. This policy explains exactly what data the extension handles and why.
The short version: **AutoTOS sends only the domain name of the site you're
looking at, anonymously, so it can fetch that site's Terms of Service summary.
It does not collect any personal information.**

## What we send, and when

To show a site's grade on the toolbar icon automatically, AutoTOS reads the
address of the tab you navigate to and reduces it to just the **registrable
domain** — for example, `github.com`. It sends that bare domain (never the full
URL, never the path, query string, or page contents) to our data service to look
up a pre-computed Terms of Service analysis for that site. This happens when you
open a page or switch tabs, so the icon reflects the current site's grade
without you having to click.

- **We send:** the registrable domain only (e.g. `github.com`, `nytimes.com`).
- **We do _not_ send:** the full URL, the specific page or path you're on, page
  contents, your IP-linked identity, cookies, account information, or any
  personal identifier.
- The request is **anonymous** — it carries no user ID, account, or tracking
  token, and we do not create a profile of you or your browsing.

**We minimize these lookups by caching.** Each domain's result is stored locally
on your device, so AutoTOS contacts our data service at most once per domain
per day; every subsequent visit to that site is answered from the local cache
with no network request. Only the domain is ever sent, and only to fetch that
domain's public Terms of Service summary — never to log, profile, or track you.

## The "Request analysis" button

If we don't yet have an analysis for a site, the popup shows a **Request
analysis** button. This action is **user-initiated only** — nothing is sent
unless you click it. When you do, the extension sends the site's domain (and, at
most, the current page URL as a hint to help locate the terms) so the site can
be queued for future analysis. We use this only to decide which sites to analyze
next; it is not linked to you.

## Where the data goes

The extension talks to two endpoints, both operated for AutoTOS:

- `https://autotos-data.amascillaro.workers.dev` — a static content delivery
  service that returns the pre-analyzed Terms of Service data as JSON. Read-only
  lookups go here.
- `https://autotos-request.amascillaro.workers.dev` — the endpoint that records
  a "please analyze this site" request when you press the button.

Standard web-server request logs (which may include a coarse count of how often
a domain was requested) may be retained for operating and improving the service.
These logs are not used to identify or track individual users.

## Local storage on your device

AutoTOS uses your browser's local extension storage (the `storage` permission)
to cache a few things, purely for speed and to minimize network requests:

- **analysis results** per domain, so revisiting a site doesn't trigger a new
  network lookup (this cache expires after a day);
- a small **alias map** (which domains redirect to which canonical site); and
- an **outbox** of any "Request analysis" clicks that couldn't be delivered
  immediately, so they can be retried later.

This data stays on your device. You can clear it at any time by removing the
extension.

## Permissions we request, and why

- **`tabs`** — to see the address of the tab you navigate to (or switch to) so
  the toolbar icon can show that site's grade automatically. We read only the
  URL, and only to reduce it to a registrable domain — never the page contents.
- **`activeTab`** — to read the current tab's address when you open the popup,
  so we can show that site's full analysis.
- **`storage`** — to cache the alias map, the per-domain analysis results, and
  the request outbox locally on your device, as described above.

We deliberately do **not** request broad host permissions or the ability to read
page contents.

## Data we do not collect

AutoTOS does not collect names, email addresses, account credentials, precise
location, browsing history, or any other personal information. We do not sell or
share data with third parties, and we do not use the extension for advertising
or tracking.

## Children

AutoTOS is a general-audience utility and is not directed at children. It does
not knowingly collect personal information from anyone.

## Changes to this policy

If this policy changes, the "Last updated" date above will change and the
revised policy will be published at this same URL.

## Contact

Questions about this policy? Open an issue at
<https://github.com/intermezzio/autotos/issues>.
