import { asNumber } from "./formatting";
import { apiFetch } from "./apiFetch";
import { setItemSafe } from "./safeStorage";
import { toValue } from "./value";
import { createEntryCache, ISO_TS } from "./enrichmentCache";

const CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours — used by manual sync
const BATCH_DELAY_MS = 400;
const DAILY_BATCH_SIZE = 50; // sets per day for the rolling background sync

// Shared cache instance for the CANONICAL BE engine (this file): the daily batch + manual sync.
// Reproduces brickEconomySetCache byte-for-byte — key "brickEconomySetCache", `-1` de-variant keyFn
// (matches allUniqueNums, net PIN 3), ISO_TS `fetchedAt`, 24h TTL, `data` value field. This engine
// LOADS the whole map, mutates per-entry in its throttled fetch loop (each stamps its own fetchedAt),
// and SAVES once — so it uses getRaw()/saveRaw(), not per-entry put() (which would re-stamp or force
// N writes). The ad-hoc per-set lookup pokes elsewhere (MyCollection/WantedList/BudgetDashboard) use a
// DIFFERENT `-1`-keeping key convention and stay on their own raw reads/writes (not routed here).
// brickEconomySetCache is in SYNC_SKIP_KEYS + stripped from the cloud push; the byte-identical key
// preserves both.
const beSetCache = createEntryCache({
  key: "brickEconomySetCache",
  ttlMs: CACHE_TTL_MS,
  valueField: "data",
  tsField: "fetchedAt",
  ts: ISO_TS,
  keyFn: (n) => String(n).replace(/-1$/, ""),
});

/**
 * Pick the right BE value for a SINGLE condition.
 * "new" / "sealed" → current_value_new
 * "used*"          → current_value_used (fall back to new if absent)
 * "mixed" / null   → the new figure (no synthetic blend — a mixed *set* is valued
 *                    per copy by beValueForSet; this is only the lone-condition fallback).
 *
 * V2b: the old (new+used)/2 blend for "mixed"/null is retired (G3). It invented a
 * price that corresponds to no real market figure and silently assumed a 50/50
 * new/used split regardless of the actual copies owned.
 */
export function beValueForCondition(d, condition) {
  const vNew  = asNumber(d?.current_value_new);
  const vUsed = asNumber(d?.current_value_used);
  if (!vNew && !vUsed) return asNumber(d?.retail_price_us);
  if (condition === "new" || condition === "sealed") return vNew || vUsed;
  if (String(condition).startsWith("used"))           return vUsed || vNew;
  return vNew || vUsed;
}

/**
 * Total current value for an owned set, valuing each copy at its OWN condition.
 *
 * A set's entries[] are individual copies (one CSV row each). A mixed set — copies
 * in different conditions — is summed per copy: new copies at the new figure, used
 * copies at the used figure, NOT averaged into a synthetic (new+used)/2 blend (G3).
 * A single-condition set (every copy alike, or a manual set with no entries[]) is
 * just its one condition's value × quantity — unchanged from the pre-V2b behavior.
 *
 * @param {Object} d  BrickEconomy API data (set-level new/used/retail figures).
 * @param {Object} s  Owned set (may carry entries[], condition, qty/quantity).
 * @returns {number}  Combined value across all copies of this set.
 */
export function beValueForSet(d, s) {
  const entries = s?.entries;
  if (entries?.length) {
    return entries.reduce((sum, e) => sum + beValueForCondition(d, e.condition), 0);
  }
  const qty = asNumber(s?.qty) || asNumber(s?.quantity) || 1;
  return beValueForCondition(d, s?.condition) * qty;
}

/**
 * Per-set value patch from cached BE data — each copy at its OWN condition (mirrors the per-set
 * math in applyCache). Pure: takes the cache `data` directly (no localStorage). Returns
 * `{ currentValue, totalValue }` (currentValue is the per-copy average so currentValue × qty ==
 * totalValue), or `null` when there's no usable figure (no cache data, or the figure is 0/unknown)
 * — the caller then leaves the value to the next value-sync.
 *
 * @param {Object} s  owned set (may carry entries[], condition, qty/quantity)
 * @param {Object} [d]  BrickEconomy cache data for the set (new/used/retail figures)
 * @returns {{ currentValue: number, totalValue: number } | null}
 */
export function revalueBESet(s, d) {
  if (!d) return null;
  const total = beValueForSet(d, s);
  if (!total) return null;
  const qty = asNumber(s?.qty) || asNumber(s?.quantity) || 1;
  return { currentValue: total / qty, totalValue: total };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Collect all unique set numbers across both stores. */
function allUniqueNums(normalized, manual) {
  return [...new Set(
    [...normalized, ...manual]
      .map(s => String(s.setNumber || "").replace(/-1$/, "").trim())
      .filter(Boolean)
  )];
}

/** Apply cached BE data back to both localStorage collections. Returns updated count. */
function applyCache(normalized, manual, cache) {
  let updatedCount = 0;

  const updatedNormalized = normalized.map(s => {
    const key = String(s.setNumber || "").replace(/-1$/, "");
    const d   = cache[key]?.data;
    if (!d) return s;
    // V2b: value each copy at its OWN condition (beValueForSet) — mixed sets are
    // summed per entry, retiring the synthetic blend. The result is the qty-adjusted
    // total; currentValue is the per-copy average so currentValue × qty == totalValue.
    const v     = toValue(beValueForSet(d, s), {
      source: "brickeconomy", condition: s.condition, retired: d.retired,
    });
    const total = v.amount;
    if (!total) return s;
    const qty = asNumber(s.qty) || asNumber(s.quantity) || 1;
    updatedCount++;
    return { ...s, currentValue: total / qty, totalValue: total };
  });
  setItemSafe("brickEconomyNormalizedCollection", JSON.stringify(updatedNormalized));

  const updatedManual = manual.map(s => {
    const key = String(s.setNumber || "").replace(/-1$/, "");
    const d   = cache[key]?.data;
    if (!d) return s;
    const v   = toValue(beValueForCondition(d, s.condition), {
      source: "brickeconomy", condition: s.condition, retired: d.retired,
    });
    const val = v.amount;
    if (!val) return s;
    updatedCount++;
    return { ...s, currentValue: val };
  });
  setItemSafe("blOwnedSets", JSON.stringify(updatedManual));

  return updatedCount;
}

/** Fetch a single set from the BE API and update the cache in place. */
async function fetchSet(key, cache) {
  const res  = await apiFetch(`/api/brickeconomy-set?number=${encodeURIComponent(key)}&currency=USD`);
  const json = await res.json();
  if (res.ok && !json.error) {
    cache[key] = { fetchedAt: new Date().toISOString(), data: json.data || json };
    return true;
  }
  return false;
}

// ── Daily rolling batch ───────────────────────────────────────────────────────

/**
 * Background auto-sync: runs 50 sets per day, cycling oldest-cached first.
 * Cycle length = ceil(totalSets / 50) — grows automatically as you add sets.
 * New/never-cached sets bubble to the front so they're valued within a day.
 *
 * Fires silently on app open; skips if already ran in the last 24 hours.
 * Returns { skipped } if cooldown is active, otherwise { updated, failed, total, cycledays }.
 */
export async function runDailyBEBatch() {
  const lastBatch = localStorage.getItem("beValueBatchLast");
  if (lastBatch && (Date.now() - new Date(lastBatch).getTime()) < CACHE_TTL_MS) {
    return { skipped: true };
  }

  const normalized = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]");
  const manual     = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");
  const cache      = beSetCache.getRaw();

  const allNums = allUniqueNums(normalized, manual);
  if (allNums.length === 0) return { updated: 0, failed: 0, total: 0, cycledays: 0 };

  // Sort oldest-fetched first; never-fetched (missing fetchedAt) → epoch 0 → top priority
  const sorted = [...allNums].sort((a, b) => {
    const aTime = cache[a]?.fetchedAt ? new Date(cache[a].fetchedAt).getTime() : 0;
    const bTime = cache[b]?.fetchedAt ? new Date(cache[b].fetchedAt).getTime() : 0;
    return aTime - bTime;
  });

  const batch = sorted.slice(0, DAILY_BATCH_SIZE);
  let failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const ok = await fetchSet(batch[i], cache).catch(() => false);
    if (!ok) failed++;
    if (i < batch.length - 1) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }

  beSetCache.saveRaw(cache);
  setItemSafe("beValueBatchLast", new Date().toISOString());

  const updated  = applyCache(normalized, manual, cache);
  const cycledays = Math.ceil(allNums.length / DAILY_BATCH_SIZE);

  return { updated, failed, total: allNums.length, batchSize: batch.length, cycledays };
}

// ── Manual full sync (Settings button) ───────────────────────────────────────

/**
 * Batch-refresh current value from BrickEconomy for all owned sets.
 * Updates brickEconomyNormalizedCollection, blOwnedSets, and brickEconomySetCache.
 *
 * @param {function} [onProgress] - optional ({done, total}) callback for progress UI
 * @param {boolean}  [force]      - if true, bypass the 24h cache TTL and re-fetch everything
 * @returns {{ updated: number, skipped: number, failed: number }}
 */
export async function syncBEValues(onProgress, force = false) {
  const normalized = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]");
  const manual     = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");
  const cache      = beSetCache.getRaw();
  const now        = Date.now();

  const allNums = allUniqueNums(normalized, manual);
  if (allNums.length === 0) return { updated: 0, skipped: 0, failed: 0 };

  const toFetch = force
    ? allNums
    : allNums.filter(key => {
        const c = cache[key];
        return !c || (now - new Date(c.fetchedAt).getTime()) > CACHE_TTL_MS;
      });

  const skippedCount = allNums.length - toFetch.length;
  onProgress?.({ done: skippedCount, total: allNums.length });

  let failed = 0;
  for (let i = 0; i < toFetch.length; i++) {
    const ok = await fetchSet(toFetch[i], cache).catch(() => false);
    if (!ok) failed++;
    onProgress?.({ done: skippedCount + i + 1, total: allNums.length });
    if (i < toFetch.length - 1) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }

  beSetCache.saveRaw(cache);
  setItemSafe("beValueSyncLast", new Date().toISOString());

  const updated = applyCache(normalized, manual, cache);
  return { updated, skipped: skippedCount, failed };
}

/** Returns true if a background auto-refresh is due (never synced, or > staleDays ago). */
export function isBEValueSyncStale(staleDays = 7) {
  const last = localStorage.getItem("beValueSyncLast");
  if (!last) return true;
  return (Date.now() - new Date(last).getTime()) > staleDays * 86400000;
}
