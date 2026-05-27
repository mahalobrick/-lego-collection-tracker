/**
 * Price history snapshots for BrickLedger.
 *
 * Stores daily snapshots of market value and BrickLink prices per set.
 * One snapshot per calendar day per set (upserts today's entry).
 * Keeps up to MAX_SNAPSHOTS entries per set (rolling window, oldest dropped).
 *
 * Storage key: "blPriceHistory"
 * Shape: { [setNumber]: [{ date, msrp?, value?, blPriceNew?, blPriceUsed? }, ...] }
 */

const STORAGE_KEY = "blPriceHistory";
const MAX_SNAPSHOTS = 60; // ~2 months of daily snapshots

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {}
}

function normalizeKey(setNumber) {
  return String(setNumber || "").replace(/-1$/, "").trim();
}

/**
 * Record (or update) today's price snapshot for a set.
 * Silently skips if no numeric price fields are provided.
 *
 * @param {string|number} setNumber
 * @param {{ msrp?, value?, blPriceNew?, blPriceUsed? }} prices
 */
export function recordPriceSnapshot(setNumber, prices = {}) {
  const key = normalizeKey(setNumber);
  if (!key) return;

  const today = new Date().toISOString().slice(0, 10);
  const snapshot = { date: today };

  for (const field of ["msrp", "value", "blPriceNew", "blPriceUsed"]) {
    const v = prices[field];
    if (v != null && v !== "" && !isNaN(Number(v)) && Number(v) > 0) {
      snapshot[field] = Number(v);
    }
  }

  // Skip if we got nothing worth storing
  if (Object.keys(snapshot).length === 1) return; // only "date" key

  const history = loadHistory();
  const existing = history[key] || [];

  // Upsert today: remove any existing entry for today, then append
  const filtered = existing.filter(s => s.date !== today);
  const merged = [...filtered, snapshot]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_SNAPSHOTS);

  history[key] = merged;
  saveHistory(history);
}

/**
 * Return all snapshots for a set, sorted oldest → newest.
 *
 * @param {string|number} setNumber
 * @returns {Array<{ date: string, msrp?: number, value?: number, blPriceNew?: number, blPriceUsed?: number }>}
 */
export function getPriceHistory(setNumber) {
  const key = normalizeKey(setNumber);
  if (!key) return [];
  return loadHistory()[key] || [];
}

/**
 * Compute a price trend for a given field.
 * Compares the most-recent snapshot to the earliest available snapshot
 * that also contains that field. Returns null if fewer than 2 data points.
 *
 * @param {string|number} setNumber
 * @param {"value"|"msrp"|"blPriceNew"|"blPriceUsed"} field
 * @returns {"up"|"down"|"flat"|null}
 */
export function getPriceTrend(setNumber, field = "value") {
  const snapshots = getPriceHistory(setNumber).filter(s => s[field] != null);
  if (snapshots.length < 2) return null;

  const oldest = snapshots[0];
  const newest = snapshots[snapshots.length - 1];

  const refVal    = oldest[field];
  const recentVal = newest[field];

  const pctChange = refVal > 0 ? Math.abs((recentVal - refVal) / refVal) : 0;
  if (pctChange < 0.01) return "flat"; // < 1% change treated as flat

  return recentVal > refVal ? "up" : "down";
}
