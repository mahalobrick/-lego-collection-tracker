/**
 * Value-freshness helpers (staleness indicator). Pure + null-safe; no I/O, no imports.
 *
 * The signal is `asOf` — when the weekly VPS cron (scripts/refresh-values.mjs, Sun 03:00) COMPUTED a
 * value — NOT the device-side `fetchedAt` (when THIS device fetched the cache). `asOf` rides inside
 * each value record (api/values → valueCache preserves it), so a value served from a stale device
 * cache still reports the cron's `asOf`, and a silently-failed cron surfaces as an old `asOf`.
 * See docs/staleness-indicator-plan.md.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Weekly cron + 1-day grace. days > STALE_DAYS → 'stale' (amber). i.e. fresh THROUGH day 8, stale FROM day 9.
export const STALE_DAYS = 8;

/**
 * Newest `asOf` across a valueMap's records (record.new.asOf / record.used.asOf), or null when none.
 * A null record (deferred CMF) or an `asOf:null` condition (BE-fallback) contributes nothing — so an
 * all-fallback / not-yet-loaded map yields null (→ the indicator stays hidden).
 *
 * @param {Object<string,{new?:{asOf?:string|null}|null, used?:{asOf?:string|null}|null}|null>|undefined} valueMap
 * @returns {string|null} the newest ISO-8601 `asOf`, or null
 */
export function valuesAsOf(valueMap) {
  if (!valueMap || typeof valueMap !== "object") return null;
  let bestMs = -Infinity;
  let best = null;
  for (const rec of Object.values(valueMap)) {
    if (!rec || typeof rec !== "object") continue;
    for (const cond of [rec.new, rec.used]) {
      const asOf = cond && typeof cond.asOf === "string" ? cond.asOf : null;
      if (!asOf) continue;
      const ms = Date.parse(asOf);
      if (Number.isFinite(ms) && ms > bestMs) {
        bestMs = ms;
        best = asOf;
      }
    }
  }
  return best;
}

/**
 * Whole-day freshness of an `asOf` timestamp, on an absolute (timezone-independent) ms basis.
 *
 * @param {string|null} asOf  ISO-8601, or null
 * @param {number} [now=Date.now()]  ms-epoch "now"
 * @returns {{days:number, label:string, level:'fresh'|'stale'}|null} null when asOf is missing/unparseable
 */
export function freshness(asOf, now = Date.now()) {
  if (!asOf) return null;
  const ms = Date.parse(asOf);
  if (!Number.isFinite(ms)) return null;
  // max(0, …) guards a future asOf (clock skew) → reads as "today" rather than a negative count.
  const days = Math.max(0, Math.floor((now - ms) / DAY_MS));
  const level = days > STALE_DAYS ? "stale" : "fresh";
  const label =
    days <= 0
      ? "Values updated today"
      : days === 1
        ? "Values updated 1 day ago"
        : `Values updated ${days} days ago`;
  return { days, label, level };
}
