import { asNumber } from "./formatting";

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio rollup (V2a). Pure, no React, no localStorage.
//
// Extracted verbatim from MyCollection.jsx's `stats` useMemo so the combined
// "Collection Value" total has ONE definition that the characterization tests
// pin (value.characterization.test.js). Behavior-preserving: this is the same
// arithmetic the component ran inline.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combined portfolio value — the headline "Collection Value" total.
 *
 * Each set contributes its precomputed `totalValue` (already qty-adjusted) or,
 * failing that, `currentValue × qty`. Summed into one mixed new+used total.
 * Unknown sets currently collapse to 0 and are silently counted (V2b fixes that).
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function portfolioValue(sets) {
  return sets.reduce(
    (sum, s) => sum + (asNumber(s.totalValue) || asNumber(s.currentValue) * (asNumber(s.qty) || 1)),
    0,
  );
}
