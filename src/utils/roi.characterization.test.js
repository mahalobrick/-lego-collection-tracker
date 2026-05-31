import { describe, it, expect } from "vitest";
import {
  portfolioValue,
  portfolioROI,
  portfolioGain,
  totalSpent,
  setROI,
  setCost,
  roiExcludedCount,
} from "./portfolio";
import { asNumber } from "./formatting";

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTERIZATION TESTS — pin CURRENT behavior of ROI / cost-basis, bugs included.
//
// These lock in how ROI works RIGHT NOW (V2c state), so the V2-cleanup fix can
// prove the change. The "wrong" assertions here are INTENTIONAL — they pin today's
// reality so STEP 1 can flip them to the corrected rule:
//
//   A percentage ROI is only meaningful when value AND cost are BOTH known and
//   cost > 0. Compute % ROI over exactly that subset; keep absolute dollar totals
//   inclusive and honest.
//
// Two mirror-image bugs this phase fixes:
//   (a) unknown value, known cost → can't compute a return, yet today its cost
//       still drags the portfolio %ROI/gain down (counted as a 0-value loss).
//   (b) $0-cost (GWP), known value → no cost to return against, yet today its
//       value still inflates the portfolio %ROI (gain ÷ a smaller cost base).
//
// COST DATA MODEL (investigated STEP 0): per-set cost is `totalPaid` or
// `paidPrice × qty`; an empty paid field stores 0 (`asNumber("") === 0`), and
// several import paths hard-default 0. There is NO free/GWP marker on a stored
// set — a genuine free $0 is INDISTINGUISHABLE from an unrecorded cost. So this
// phase treats every cost ≤ 0 uniformly (excluded from %ROI); a dedicated "free"
// label would need a new persisted field and is deferred.
// ─────────────────────────────────────────────────────────────────────────────

// Replicas of MyCollection.jsx's CURRENT inline formulas (stats useMemo +
// renderOwnedCell). The value half routes through the REAL portfolioValue;
// the cost/ROI half is inline today, so it's mirrored here to pin the math.
const currentCostBasis = (sets) =>
  sets.reduce((sum, s) => sum + (asNumber(s.totalPaid) || asNumber(s.paidPrice) * (asNumber(s.qty) || 1)), 0);

const currentPortfolioRoi = (sets) => {
  const value = portfolioValue(sets);
  const costBasis = currentCostBasis(sets);
  return costBasis ? ((value - costBasis) / costBasis) * 100 : 0;
};

const currentPortfolioGain = (sets) => portfolioValue(sets) - currentCostBasis(sets);

// renderOwnedCell: paid>0 ? (value-paid)/paid*100 : null, with value laundered to
// 0 for unknown (asNumber(currentValue) → 0).
const currentRowRoi = (s) => {
  const qty = asNumber(s.qty) || 1;
  const paid = asNumber(s.totalPaid) || asNumber(s.paidPrice) * qty;
  const value = asNumber(s.totalValue) || asNumber(s.currentValue) * qty;
  return paid > 0 ? ((value - paid) / paid) * 100 : null;
};

const KNOWN_GAIN = { setNumber: "10300", currentValue: 150, paidPrice: 100, qty: 1 }; // +50% honest
const KNOWN_FLAT = { setNumber: "21322", currentValue: 100, paidPrice: 100, qty: 1 }; // 0% honest
const UNKNOWN_VALUE_WITH_COST = { setNumber: "99999", paidPrice: 50, qty: 1 };         // no value, $50 paid
const ZERO_COST_KNOWN_VALUE = { setNumber: "40178", currentValue: 80, paidPrice: 0, qty: 1 }; // GWP-like

// PINS FLIPPED (V2 cleanup): each test shows the OLD inline formula's bug value
// for contrast, then asserts the CORRECTED behavior from the real pure functions.
describe("portfolio %ROI — CORRECTED behavior (pins flipped)", () => {
  it("(a) an unknown-value set is EXCLUDED from %ROI — the +50% is no longer dragged to 0%", () => {
    const sets = [KNOWN_GAIN, UNKNOWN_VALUE_WITH_COST];
    expect(currentPortfolioRoi(sets)).toBeCloseTo(0, 5);     // OLD bug: dragged to 0%
    expect(portfolioROI(sets)).toBeCloseTo(50, 5);           // FIXED: only the eligible {KNOWN_GAIN}
  });

  it("(a) net gain excludes the unknown set's cost — +$50, not $0", () => {
    expect(currentPortfolioGain([KNOWN_GAIN, UNKNOWN_VALUE_WITH_COST])).toBeCloseTo(0, 5); // OLD bug
    expect(portfolioGain([KNOWN_GAIN, UNKNOWN_VALUE_WITH_COST])).toBeCloseTo(50, 5);       // FIXED
  });

  it("(b) a $0-cost set is EXCLUDED from %ROI — its value no longer inflates it to +80%", () => {
    const sets = [KNOWN_FLAT, ZERO_COST_KNOWN_VALUE];
    expect(currentPortfolioRoi(sets)).toBeCloseTo(80, 5);    // OLD bug: inflated to +80%
    expect(portfolioROI(sets)).toBeCloseTo(0, 5);            // FIXED: only the eligible {KNOWN_FLAT}
  });

  it("(b) net gain still counts the GWP's full value (unchanged, $80)", () => {
    // Absolute gain = value − cost over value-known sets = (100−100) + (80−0) = 80.
    expect(portfolioGain([KNOWN_FLAT, ZERO_COST_KNOWN_VALUE])).toBeCloseTo(80, 5);
  });

  it("%ROI never produces Infinity/NaN, even for an all-$0-cost collection", () => {
    expect(portfolioROI([ZERO_COST_KNOWN_VALUE])).toBeNull();           // no eligible set → "—"
    expect(portfolioROI([UNKNOWN_VALUE_WITH_COST])).toBeNull();         // unknown value → "—"
    expect(portfolioROI([])).toBeNull();
    expect(Number.isFinite(portfolioROI([KNOWN_GAIN]))).toBe(true);
  });

  it("total spent stays inclusive of every set ($0 adds $0) — matches the old sum", () => {
    expect(totalSpent([KNOWN_GAIN, UNKNOWN_VALUE_WITH_COST])).toBeCloseTo(150, 5);
    expect(totalSpent([KNOWN_FLAT, ZERO_COST_KNOWN_VALUE])).toBeCloseTo(100, 5);
    // The fix did NOT touch the absolute spent total — same as the old formula.
    expect(totalSpent([KNOWN_GAIN, UNKNOWN_VALUE_WITH_COST]))
      .toBeCloseTo(currentCostBasis([KNOWN_GAIN, UNKNOWN_VALUE_WITH_COST]), 5);
  });

  it("counts how many sets are excluded from %ROI (unknown value OR cost ≤ 0)", () => {
    expect(roiExcludedCount([KNOWN_GAIN, UNKNOWN_VALUE_WITH_COST])).toBe(1); // the unknown
    expect(roiExcludedCount([KNOWN_FLAT, ZERO_COST_KNOWN_VALUE])).toBe(1);   // the $0-cost
    expect(roiExcludedCount([KNOWN_GAIN, UNKNOWN_VALUE_WITH_COST, ZERO_COST_KNOWN_VALUE])).toBe(2);
    expect(roiExcludedCount([KNOWN_GAIN, KNOWN_FLAT])).toBe(0);
  });
});

describe("per-row ROI cell — CORRECTED behavior (pins flipped)", () => {
  it("a known gainer still reads +50%", () => {
    expect(currentRowRoi(KNOWN_GAIN)).toBeCloseTo(50, 5);
    expect(setROI(KNOWN_GAIN)).toBeCloseTo(50, 5);
  });

  it("an unknown-value set reads '—' (null), not a false −100%", () => {
    expect(currentRowRoi(UNKNOWN_VALUE_WITH_COST)).toBeCloseTo(-100, 5); // OLD bug
    expect(setROI(UNKNOWN_VALUE_WITH_COST)).toBeNull();                  // FIXED
  });

  it("a $0-cost set reads '—' (null) — no ÷0, no Infinity", () => {
    expect(setROI(ZERO_COST_KNOWN_VALUE)).toBeNull();
    expect(setCost(ZERO_COST_KNOWN_VALUE)).toBe(0);
  });
});
