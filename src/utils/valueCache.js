/**
 * valueCache — client read of the BrickLink value cache (/api/values).
 *
 * Step 1 of the app-read (docs/integration-standard.md): fetch basis-tagged value records for
 * a batch of owned set numbers and return them as a map.
 *
 * Contract (per the proxy): { [setNumber]: { new: {amount,basis,lots,asOf}|null, used: {…}|null } | null }
 * — null for a set with no cached value (e.g. a deferred CMF). `source` is implied "BrickLink".
 *
 * Caching (§3): device-local only. As of P3.2 this module DELEGATES its cache mechanics to the shared
 * `createEntryCache` factory (src/utils/enrichmentCache.js) — the in-memory memo de-dupes within a
 * session and a short-TTL localStorage mirror survives reloads. This refactor is behaviour-neutral:
 * the instance is configured to reproduce the prior blValueCache EXACTLY (key "blValueCache", MS_TS
 * ms-epoch `fetchedAt`, trim-only keys — NO de-variant, 24h TTL, `record` value field, isRecord
 * validation). The public exports below are unchanged in name, signature, and behaviour. This key is
 * REGENERATABLE and MUST stay out of BACKUP_KEYS (it is never synced). The batch refresh runs ~weekly,
 * so a 24h client TTL is safe.
 *
 * Failures route through the readSource funnel (inside readThrough) — never a silent throw. On failure
 * we return whatever is already cached rather than nothing.
 */

import { apiFetch } from "./apiFetch";
import { createEntryCache, MS_TS } from "./enrichmentCache";

const CACHE_KEY = "blValueCache"; // device-local, NOT in BACKUP_KEYS
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h client cache; server refreshes ~weekly
const SOURCE = "bricklink";

// ── Shape validation — a malformed response must not poison the cache ─────────
function isCondition(c) {
  if (c === null) return true;
  if (!c || typeof c !== "object") return false;
  const amountOk = c.amount === null || typeof c.amount === "number";
  const basisOk = c.basis === null || typeof c.basis === "string";
  return amountOk && basisOk;
}
function isRecord(r) {
  if (r === null) return true;
  if (!r || typeof r !== "object") return false;
  return isCondition(r.new) && isCondition(r.used);
}

// The shared cache instance, configured to reproduce blValueCache byte-for-byte:
//   ms-epoch `fetchedAt`, trim-only keys (no -1 de-variant), 24h TTL, `record` value field.
const cache = createEntryCache({
  key: CACHE_KEY,
  ttlMs: CACHE_TTL_MS,
  valueField: "record",
  tsField: "fetchedAt",
  ts: MS_TS,
  keyFn: (n) => String(n).trim(),
  validate: (r) => (isRecord(r) ? r : null),
});

/**
 * Fetch value records for the given owned set numbers.
 * @param {string[]} setNumbers
 * @param {{force?: boolean}} [opts]  force=true bypasses the client cache for a fresh read.
 * @returns {Promise<Object<string, ({new, used}|null)>>}  map keyed by the requested set number.
 */
export async function fetchValues(setNumbers, { force = false } = {}) {
  return cache.readThrough(setNumbers, {
    source: SOURCE,
    force,
    fetch: (need) =>
      apiFetch("/api/values", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setNumbers: need }),
      }),
  });
}

/**
 * SYNCHRONOUS peek at the cached value map — fresh (non-expired) entries only, no network.
 * Used to seed a component's initial render from the device cache so a warm load shows BL
 * values from the first paint (no BE→BL flash); pair it with an async {@link fetchValues}
 * refresh. Returns only the requested numbers that are present AND fresh.
 *
 * @param {string[]} setNumbers
 * @returns {Object<string, ({new, used}|null)>}
 */
export function peekValueCache(setNumbers) {
  return cache.peek(setNumbers);
}

/** Drop the in-memory + localStorage value cache (used by tests / a manual refresh). */
export function clearValueCache() {
  cache.clear();
}
