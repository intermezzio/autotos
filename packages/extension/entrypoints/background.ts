import { defineBackground } from "wxt/sandbox";
import { getAliasMap } from "../lib/alias-cache.js";
import { flushOutbox } from "../lib/request-outbox.js";

// The AutoTOS background is intentionally minimal. The heavy lifting (lookup,
// rendering, request button) lives in the popup, which only runs when the user
// clicks the toolbar icon. We warm the alias cache on install/startup so the
// first popup open is fast, but everything degrades gracefully without it.
export default defineBackground(() => {
  // Prime the alias-map cache in the background (best-effort).
  void getAliasMap().catch(() => {});
  // Deliver any requests queued while the tally Worker was unreachable.
  void flushOutbox().catch(() => {});
});
