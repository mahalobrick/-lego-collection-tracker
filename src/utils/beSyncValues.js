import { asNumber } from "./formatting";

const CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours — used by manual sync
const BATCH_DELAY_MS = 400;
const DAILY_BATCH_SIZE = 50; // sets per day for the rolling background sync

/**
 * Pick the right BE value based on the set's condition.
 * "new" / "sealed" → current_value_new
 * "used*"          → current_value_used (fall back to new if absent)
 * "mixed" / null   → average of both if both present, else whichever exists
 */
export function beValueForCondition(d, condition) {
  const vNew  = asNumber(d?.current_value_new);
  const vUsed = asNumber(d?.current_value_used);
  if (!vNew && !vUsed) return asNumber(d?.retail_price_us);
  if (!condition || condition === "mixed") {
    return (vNew && vUsed) ? (vNew + vUsed) / 2 : (vNew || vUsed);
  }
  if (condition === "new" || condition === "sealed") return vNew || vUsed;
  if (String(condition).startsWith("used"))           return vUsed || vNew;
  return vNew || vUsed;
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
    const val = beValueForCondition(d, s.condition);
    if (!val) return s;
    const qty = asNumber(s.qty) || asNumber(s.quantity) || 1;
    updatedCount++;
    return { ...s, currentValue: val, totalValue: val * qty };
  });
  localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(updatedNormalized));

  const updatedManual = manual.map(s => {
    const key = String(s.setNumber || "").replace(/-1$/, "");
    const d   = cache[key]?.data;
    if (!d) return s;
    const val = beValueForCondition(d, s.condition);
    if (!val) return s;
    updatedCount++;
    return { ...s, currentValue: val };
  });
  localStorage.setItem("blOwnedSets", JSON.stringify(updatedManual));

  return updatedCount;
}

/** Fetch a single set from the BE API and update the cache in place. */
async function fetchSet(key, cache) {
  const res  = await fetch(`/api/brickeconomy-set?number=${encodeURIComponent(key)}&currency=USD`);
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
  const cache      = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");

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

  localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
  localStorage.setItem("beValueBatchLast", new Date().toISOString());

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
  const cache      = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
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

  localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
  localStorage.setItem("beValueSyncLast", new Date().toISOString());

  const updated = applyCache(normalized, manual, cache);
  return { updated, skipped: skippedCount, failed };
}

/** Returns true if a background auto-refresh is due (never synced, or > staleDays ago). */
export function isBEValueSyncStale(staleDays = 7) {
  const last = localStorage.getItem("beValueSyncLast");
  if (!last) return true;
  return (Date.now() - new Date(last).getTime()) > staleDays * 86400000;
}
