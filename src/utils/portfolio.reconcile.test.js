import { describe, it, expect } from "vitest";
import { portfolioValue, portfolioGain, portfolioValuedCost, totalSpent, knownValueCount } from "./portfolio";

// ─────────────────────────────────────────────────────────────────────────────
// Headline reconciliation invariant (backlog #4 / B1). The Net Gain tile is computed
// over the value-known subset, so it must equal `value − the valued-subset cost` — NOT
// `value − the inclusive Cost Basis`. portfolioValuedCost is that subset denominator,
// and it shares portfolioValue/portfolioGain's exact value-known predicate so the
// identity holds BY CONSTRUCTION. These tests pin the bug class (tiles drifting out of
// reconciliation) so it can't silently return.
// ─────────────────────────────────────────────────────────────────────────────

const VALUED_GAIN = { currentValue: 777, paidPrice: 200, qty: 1 }; // known value, +577
const UNVALUED_A  = { paidPrice: 160, qty: 1 };                    // value unknown, $160 cost
const UNVALUED_B  = { paidPrice: 100, qty: 1 };                    // value unknown, $100 cost
const GWP_VALUED  = { currentValue: 80, paidPrice: 0, qty: 1 };    // known value, $0 cost

describe("headline reconciliation — value − valuedCost === gain", () => {
  const sets = [VALUED_GAIN, UNVALUED_A, UNVALUED_B, GWP_VALUED];

  it("computes the mixed-coverage figures (value 857, cost 460, valuedCost 200, gain 657)", () => {
    expect(portfolioValue(sets)).toBeCloseTo(857, 5);       // 777 + 80 (unknowns add 0)
    expect(totalSpent(sets)).toBeCloseTo(460, 5);           // inclusive: 200 + 160 + 100 + 0
    expect(portfolioValuedCost(sets)).toBeCloseTo(200, 5);  // valued subset only: 200 + 0
    expect(portfolioGain(sets)).toBeCloseTo(657, 5);        // (777−200) + (80−0)
  });

  it("INVARIANT: value − valuedCost === gain (exact)", () => {
    expect(portfolioValue(sets) - portfolioValuedCost(sets)).toBeCloseTo(portfolioGain(sets), 10);
  });

  it("INVARIANT: costBasis − valuedCost === Σ(unvalued sets' cost)", () => {
    const unvaluedCost = 160 + 100; // UNVALUED_A + UNVALUED_B
    expect(totalSpent(sets) - portfolioValuedCost(sets)).toBeCloseTo(unvaluedCost, 5);
  });

  it("valuedCost === costBasis exactly when every cost-bearing set is valued (tiles self-reconcile)", () => {
    const allValued = [VALUED_GAIN, GWP_VALUED];
    expect(portfolioValuedCost(allValued)).toBeCloseTo(totalSpent(allValued), 5);
    expect(portfolioValue(allValued) - totalSpent(allValued)).toBeCloseTo(portfolioGain(allValued), 10);
  });

  it("an unvalued set with $0 cost does NOT break reconciliation (valuedCost === costBasis)", () => {
    const withFreeUnknown = [VALUED_GAIN, { qty: 1 }]; // unknown value, no cost
    expect(portfolioValuedCost(withFreeUnknown)).toBeCloseTo(totalSpent(withFreeUnknown), 5);
  });

  it("valuedCost iterates the same subset as knownValueCount", () => {
    expect(knownValueCount(sets)).toBe(2); // VALUED_GAIN + GWP_VALUED
  });
});
