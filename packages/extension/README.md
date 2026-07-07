# @autotos/extension

The AutoTOS browser extension. One shared WebExtension codebase (WXT +
`webextension-polyfill`) targeting Chrome, Firefox, and Safari.

## What it does

1. On popup open, reads the active tab's URL.
2. Normalizes it to the registrable domain (eTLD+1) via `@autotos/core`.
3. Resolves cross-domain aliases (`x.com` → `twitter.com`) using a cached alias map.
4. `GET`s the static analysis file from the CDN and validates it against `@autotos/contracts`.
5. Renders the fairness score + flagged clauses, **or** on a miss shows an explicit
   **Request analysis** button that POSTs the domain to the request Worker.

The extension never fetches or parses TOS itself, and never auto-sends browsing
data — the request is user-initiated only.

## Layout

```
entrypoints/
  background.ts       # warms the alias cache; minimal MV3 service worker
  popup/
    index.html
    main.ts           # reads active tab, runs lookup, renders states, request button
    style.css
lib/
  config.ts           # CDN + request endpoints, TTLs, storage keys
  alias-cache.ts      # fetch-once/cache-aggressively alias map (chrome.storage)
  store.ts            # the read path: normalize → alias → fetch → validate
wxt.config.ts         # per-target manifests (Chrome/Firefox/Safari)
```

## Build

```bash
npm run dev            # Chrome dev with HMR
npm run dev:firefox
npm run build:chrome
npm run build:firefox
npm run build:safari   # produces the WebExtension bundle to wrap in Xcode
```

Safari: after `build:safari`, wrap `.output/safari-mv3` with
`xcrun safari-web-extension-converter` (see `packages/extension-safari`).
