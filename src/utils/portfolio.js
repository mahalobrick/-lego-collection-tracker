import { asNumber } from "./formatting";
import { toValue } from "./value";

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio rollup (V2a). Pure, no React, no localStorage.
//
// Extracted verbatim from MyCollection.jsx's `stats` useMemo so the combined
// "Collection Value" total has ONE definition that the characterization tests
// pin (value.characterization.test.js). Behavior-preserving: this is the same
// arithmetic the component ran inline.
//
// V2a step 2: each set's contribution is now routed through the Value provenance
// type (toValue) at READ time — basis derived from the set's existing `retired`
// flag, source from its existing `source` label. This is a read-time projection
// only: NOTHING is persisted, the backup shape / dedupHash are untouched, and the
// summed number is byte-identical to the bare formula (consumers still read
// `.amount`). The behavior flips (excluding unknowns, dropping retail-as-value)
// are V2b — not here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw per-set value figure: precomputed `totalValue` (already qty-adjusted) or,
 * failing that, `currentValue × qty`. Returns `null` when the set carries NO value
 * data at all — unknown ≠ $0 (V2b). The combined total still treats unknown as a
 * 0 contribution (it adds nothing), but count-based metrics can now exclude it
 * instead of dragging an average down with a phantom $0 (see {@link knownValueCount}).
 *
 * @param {Object} s
 * @returns {number|null}
 */
function rawSetValue(s) {
  const total = asNumber(s.totalValue);
  if (total) return total;
  const perUnit = asNumber(s.currentValue);
  return perUnit ? perUnit * (asNumber(s.qty) || 1) : null;
}

/**
 * Read-time {@link import("./value").Value} for a set's portfolio contribution.
 * Derived, never persisted. `basis` flips retail→market on retirement (toValue);
 * `amount` is `null` for a set with no value data (unknown ≠ 0, V2b).
 *
 * @param {Object} s
 * @returns {import("./value").Value}
 */
export function setValueProvenance(s) {
  return toValue(rawSetValue(s), {
    source: s.source === "BrickEconomy" ? "brickeconomy" : null,
    condition: s.condition ?? null,
    retired: !!s.retired,
  });
}

/**
 * Combined portfolio value — the headline "Collection Value" total.
 *
 * Each set contributes its provenance-tagged amount, summed into one mixed
 * new+used total. An unknown set (amount `null`) contributes 0 — the sum is
 * unchanged from before; only its EXCLUSION from count metrics is new.
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function portfolioValue(sets) {
  return sets.reduce((sum, s) => sum + (setValueProvenance(s).amount ?? 0), 0);
}

/**
 * How many sets have a KNOWN value (amount !== null). Sets with no value data are
 * excluded, so a value average divides by this — not by the raw set count — instead
 * of being dragged down by phantom $0s. Math only; the "N unknown" surfacing is V2c.
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function knownValueCount(sets) {
  return sets.reduce((n, s) => n + (setValueProvenance(s).amount === null ? 0 : 1), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost basis & ROI (V2 cleanup). Pure, read-time/derived — nothing persisted.
//
// THE RULE: a PERCENTAGE ROI is only meaningful when value AND cost are BOTH known
// and cost > 0. % ROI is computed over exactly that subset; the absolute dollar
// totals (spent / gain) stay inclusive and honest. Two mirror-image exclusions:
//   - unknown value (known cost)      → no computable return → out of %ROI
//   - $0/GWP cost (known value)       → return is ÷0 → out of %ROI, but its full
//                                        value still counts as absolute gain
// Cost model note: a genuine free $0 is indistinguishable from an unrecorded cost
// (no GWP marker exists), so cost ≤ 0 is treated uniformly here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-set cost (qty-adjusted paid): precomputed `totalPaid`, else `paidPrice × qty`.
 * Returns 0 when nothing was paid OR nothing was recorded — the two are not
 * distinguishable in the stored shape. Mirrors MyCollection's inline formula.
 *
 * @param {Object} s
 * @returns {number}
 */
export function setCost(s) {
  return asNumber(s.totalPaid) || asNumber(s.paidPrice) * (asNumber(s.qty) || 1);
}

/**
 * Is a set eligible for the PERCENTAGE ROI? Only when its value is known AND it
 * has a positive cost. Unknown-value and cost ≤ 0 (incl. $0/GWP) are excluded.
 *
 * @param {Object} s
 * @returns {boolean}
 */
function roiEligible(s) {
  return setValueProvenance(s).amount !== null && setCost(s) > 0;
}

/**
 * Per-set % ROI, or `null` when the set is excluded from %ROI (unknown value OR
 * cost ≤ 0). NEVER returns Infinity/NaN — the cost > 0 guard is the ÷0 fix.
 *
 * @param {Object} s
 * @returns {number|null}
 */
export function setROI(s) {
  if (!roiEligible(s)) return null;
  const amount = setValueProvenance(s).amount;
  const cost = setCost(s);
  return ((amount - cost) / cost) * 100;
}

/**
 * Total spent — sum of every set's cost, inclusive ($0 adds $0). The honest
 * absolute; unlike %ROI it excludes nothing.
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function totalSpent(sets) {
  return sets.reduce((sum, s) => sum + setCost(s), 0);
}

/**
 * Combined net gain — Σ(value − cost) over sets whose value is KNOWN. A $0-cost
 * set with a known value contributes its full value as gain. Unknown-value sets
 * are excluded (no value → no computable gain), so their recorded cost no longer
 * drags the total into a phantom loss.
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function portfolioGain(sets) {
  return sets.reduce((sum, s) => {
    const amount = setValueProvenance(s).amount;
    return amount === null ? sum : sum + (amount - setCost(s));
  }, 0);
}

/**
 * Portfolio % ROI over the eligible subset only {value known, cost > 0}:
 * aggregate (Σvalue − Σcost) / Σcost × 100. Returns `null` when NO set is
 * eligible (UI reads "—" rather than 0% or NaN). The predicate guarantees
 * Σcost > 0 whenever the subset is non-empty, so this never divides by zero.
 *
 * @param {Array<Object>} sets
 * @returns {number|null}
 */
export function portfolioROI(sets) {
  let value = 0, cost = 0, n = 0;
  for (const s of sets) {
    if (!roiEligible(s)) continue;
    value += setValueProvenance(s).amount;
    cost += setCost(s);
    n++;
  }
  if (n === 0 || cost <= 0) return null;
  return ((value - cost) / cost) * 100;
}

/**
 * How many sets are EXCLUDED from %ROI — unknown value OR cost ≤ 0. Drives the
 * "N sets excluded from ROI (no value or no cost)" surfacing note (V2 cleanup).
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function roiExcludedCount(sets) {
  return sets.reduce((n, s) => n + (roiEligible(s) ? 0 : 1), 0);
}
