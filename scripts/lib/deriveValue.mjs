// Pure value-ladder core for the BrickLink value-refresh batch (scripts/refresh-values.mjs).
//
// NO I/O, NO clock, NO network — every input (including `asOf`) is passed in, so the
// whole value decision is deterministic and unit-testable (deriveValue.test.mjs covers
// every branch). The fetching/throttle/Upstash side lives in the caller.
//
// Implements the per-copy resolution ladder from docs/value-source-decision.md §3,
// in the exact branch order the build task fixed:
//
//   NEW  copy:
//     sold/new lots ≥10            → amount = sold/new avg_price        basis "sold"
//     sold/new lots 1–9            → amount = sold/new avg_price        basis "sold_thin"
//     sold/new lots 0 + stock      → amount = stock/new min_price       basis "asking"   (residual only)
//     otherwise                    → amount = null                      basis "unknown"
//
//   USED copy (ladder order = doc §3 rungs 1→2→3→4→6; rung 5/MSRP is OUT of v1):
//     sold/used lots ≥10           → amount = sold/used avg_price       basis "sold"
//     sold/new  lots ≥10           → amount = 0.75 × sold/new avg_price basis "modeled"  (new healthy ⇒ model used off it)
//     sold/used lots 1–9           → amount = sold/used avg_price       basis "sold_thin"
//     sold/used lots 0 + stock     → amount = stock/used min_price      basis "asking"   (residual only)
//     otherwise                    → amount = null                      basis "unknown"
//
// Records align with the Workstream A provenance model so the later app-read step is a
// clean map: { amount, source:"BrickLink", condition, basis, asOf, lots }. `lots` is the
// sample size backing the amount (for "modeled" it is the NEW sold sample the figure was
// derived from; for "asking" it is the stock listing count; for "unknown" it is 0).

export const USED_FROM_NEW_MULTIPLIER = 0.75; // global 0.75 (doc §3 rung 2 / §4 — median 0.746, IQR 0.689–0.802)
const HEALTHY_LOTS = 10; // doc §3 rung 1 — ≥10 sold lots = trustworthy average

const round2 = (n) => Math.round(n * 100) / 100;

// A sold/stock sample is usable only if it carries a positive amount.
const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const lotsOf = (s) => (s && Number.isFinite(s.lots) ? s.lots : 0);
const avgOf = (s) => (s ? num(s.avg) : 0);
const minOf = (s) => (s ? num(s.min) : 0);

const rec = (amount, basis, asOf, condition, lots) => ({
  amount: amount === null ? null : round2(amount),
  source: "BrickLink",
  condition,
  basis,
  asOf,
  lots,
});

/**
 * Derive {new, used} value records for one set from its BrickLink price-guide samples.
 *
 * @param {Object}  args
 * @param {{avg:number,lots:number}|null} [args.soldNew]   sold/new  price-guide (avg_price, unit_quantity)
 * @param {{avg:number,lots:number}|null} [args.soldUsed]  sold/used price-guide
 * @param {{min:number,lots:number}|null} [args.stockNew]  stock/new lowest listing (US) — residual sets only
 * @param {{min:number,lots:number}|null} [args.stockUsed] stock/used lowest listing (US) — residual sets only
 * @param {string} args.asOf                               ISO timestamp stamped onto every record (passed in — keeps this pure)
 * @param {number} [args.multiplier]                       used-from-new multiplier (default 0.75)
 * @returns {{new: Object, used: Object}}  two provenance records (basis "unknown"/amount null when nothing resolves)
 */
export function deriveValue({ soldNew, soldUsed, stockNew, stockUsed, asOf, multiplier = USED_FROM_NEW_MULTIPLIER } = {}) {
  const newLots = lotsOf(soldNew);
  const newAvg = avgOf(soldNew);
  const usedLots = lotsOf(soldUsed);
  const usedAvg = avgOf(soldUsed);

  const newHealthy = newLots >= HEALTHY_LOTS && newAvg > 0;
  const usedHealthy = usedLots >= HEALTHY_LOTS && usedAvg > 0;

  // ── NEW record ──────────────────────────────────────────────────────────────
  let newRec;
  if (newHealthy) {
    newRec = rec(newAvg, "sold", asOf, "new", newLots);
  } else if (newLots >= 1 && newAvg > 0) {
    newRec = rec(newAvg, "sold_thin", asOf, "new", newLots);
  } else if (minOf(stockNew) > 0) {
    newRec = rec(minOf(stockNew), "asking", asOf, "new", lotsOf(stockNew));
  } else {
    newRec = rec(null, "unknown", asOf, "new", 0);
  }

  // ── USED record (rung order 1→2→3→4→6) ────────────────────────────────────────
  let usedRec;
  if (usedHealthy) {
    usedRec = rec(usedAvg, "sold", asOf, "used", usedLots);                 // rung 1
  } else if (newHealthy) {
    usedRec = rec(newAvg * multiplier, "modeled", asOf, "used", newLots);   // rung 2 — model off healthy new
  } else if (usedLots >= 1 && usedAvg > 0) {
    usedRec = rec(usedAvg, "sold_thin", asOf, "used", usedLots);            // rung 3 — sparse used, new not healthy
  } else if (minOf(stockUsed) > 0) {
    usedRec = rec(minOf(stockUsed), "asking", asOf, "used", lotsOf(stockUsed)); // rung 4 — residual asking floor
  } else {
    usedRec = rec(null, "unknown", asOf, "used", 0);                        // rung 6
  }

  return { new: newRec, used: usedRec };
}
