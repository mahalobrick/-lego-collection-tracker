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
 * failing that, `currentValue × qty`. Today this collapses an unknown set to 0
 * (the falsy-zero behavior pinned for V2b).
 *
 * @param {Object} s
 * @returns {number}
 */
function rawSetValue(s) {
  return asNumber(s.totalValue) || asNumber(s.currentValue) * (asNumber(s.qty) || 1);
}

/**
 * Read-time {@link import("./value").Value} for a set's portfolio contribution.
 * Derived, never persisted. `basis` flips retail→market on retirement (toValue);
 * `amount` is the bare figure today (0 for an as-yet-unknown set — V2b changes that).
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
 * new+used total. Identical numbers to the pre-V2a inline reduce.
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function portfolioValue(sets) {
  return sets.reduce((sum, s) => sum + setValueProvenance(s).amount, 0);
}
