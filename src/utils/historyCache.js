/**
 * historyCache — client read of the BrickLink value-history cache (/api/history).
 *
 * Phase 1 of the trend BE→BL swap (docs/trend-history-swap-plan.md): fetch the `history:SET:{n}`
 * series for a set (or batch) and return them as a map. INERT — nothing in the app calls this yet
 * (Phase 2 wires an owned-set value-trend into SetDetailPanel). Mirrors valueCache.js exactly,
 * delegating its mechanics to the shared `createEntryCache` factory.
 *
 * Contract (per the proxy): { [setNumber]: Array<{ asOf, new, used }> } — newest-first as stored;
 * [] for a set with no history. `source` is implied "BrickLink". The newest-first→ASC [{date,value}]
 * chart mapping is the pure adapter `historyFromBL` (src/utils/historyEvents.js), not this module.
 *
 * Caching (§3): device-local only. Key "blHistoryCache", MS_TS ms-epoch `fetchedAt`, trim-only keys
 * (no -1 de-variant), 24h TTL (server batch refreshes ~weekly), `series` value field, array guard.
 * This key is REGENERATABLE and MUST stay out of BACKUP_KEYS (never synced). Unlike blValueCache —
 * which is intentionally NOT skip-listed so its writes drive the enrichment-snapshot auto-push (it
 * IS in that snapshot) — blHistoryCache is NOT part of the snapshot, so it follows the
 * blPriceGuideCache precedent and IS in safeStorage's SYNC_SKIP_KEYS (a write must not churn sync).
 *
 * Failures route through the readSource funnel (inside readThrough) — never a silent throw. On
 * failure we return whatever is already cached rather than nothing.
 */

import { apiFetch } from "./apiFetch";
import { createEntryCache, MS_TS } from "./enrichmentCache";

const CACHE_KEY = "blHistoryCache"; // device-local, NOT in BACKUP_KEYS; in SYNC_SKIP_KEYS (no churn)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h client cache; server refreshes ~weekly
const SOURCE = "bricklink";

// A series is an array of points; a malformed response coerces to [] (never poison the cache).
const cache = createEntryCache({
  key: CACHE_KEY,
  ttlMs: CACHE_TTL_MS,
  valueField: "series",
  tsField: "fetchedAt",
  ts: MS_TS,
  keyFn: (n) => String(n).trim(),
  validate: (s) => (Array.isArray(s) ? s : []),
});

/**
 * Fetch history series for the given set numbers (single-set is the primary use — a detail panel
 * opens one set — but the batch form mirrors valueCache for cache-factory parity).
 * @param {string[]} setNumbers
 * @param {{force?: boolean}} [opts]  force=true bypasses the client cache for a fresh read.
 * @returns {Promise<Object<string, Array<{asOf,new,used}>>>}  map keyed by the requested set number.
 */
export async function fetchHistory(setNumbers, { force = false } = {}) {
  return cache.readThrough(setNumbers, {
    source: SOURCE,
    force,
    fetch: (need) =>
      apiFetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setNumbers: need }),
      }),
  });
}

/**
 * SYNCHRONOUS peek at the cached history map — fresh (non-expired) entries only, no network.
 * Pairs with an async {@link fetchHistory} refresh so a warm panel paints from the device cache.
 * @param {string[]} setNumbers
 * @returns {Object<string, Array<{asOf,new,used}>>}
 */
export function peekHistoryCache(setNumbers) {
  return cache.peek(setNumbers);
}

/** Drop the in-memory + localStorage history cache (used by tests / a manual refresh). */
export function clearHistoryCache() {
  cache.clear();
}
