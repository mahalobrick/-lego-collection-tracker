import { describe, it, expect } from "vitest";
import { portfolioValue } from "./portfolio";
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

describe("portfolio %ROI — CURRENT behavior (characterization, bug pinned)", () => {
  it("(a) an unknown-value set's cost DRAGS portfolio ROI down to a false 0%", () => {
    // Known set alone is +50%. The unknown-value set adds $50 cost but $0 value,
    // cancelling the gain: (150 − 150)/150 = 0%. The unknown ought to be excluded.
    const sets = [KNOWN_GAIN, UNKNOWN_VALUE_WITH_COST];
    expect(currentPortfolioRoi(sets)).toBeCloseTo(0, 5);   // BUG — honest answer is +50%
  });

  it("(a) the same drag pulls net gain to $0 instead of +$50", () => {
    expect(currentPortfolioGain([KNOWN_GAIN, UNKNOWN_VALUE_WITH_COST])).toBeCloseTo(0, 5); // BUG — honest +50
  });

  it("(b) a $0-cost set's value INFLATES portfolio ROI", () => {
    // Flat set is 0%. The GWP's $80 value lands on a $100 cost base it didn't add to:
    // (180 − 100)/100 = +80%. The GWP ought to be excluded from the %.
    const sets = [KNOWN_FLAT, ZERO_COST_KNOWN_VALUE];
    expect(currentPortfolioRoi(sets)).toBeCloseTo(80, 5);  // BUG — honest answer is 0%
  });

  it("(b) net gain already counts the GWP's full value (this stays correct)", () => {
    // Absolute gain = value − cost over both-known sets = (100−100) + (80−0) = 80.
    // This is the honest answer and must NOT change after the fix.
    expect(currentPortfolioGain([KNOWN_FLAT, ZERO_COST_KNOWN_VALUE])).toBeCloseTo(80, 5);
  });

  it("total spent is inclusive of every set ($0 adds $0) — stays honest", () => {
    expect(currentCostBasis([KNOWN_GAIN, UNKNOWN_VALUE_WITH_COST])).toBeCloseTo(150, 5);
    expect(currentCostBasis([KNOWN_FLAT, ZERO_COST_KNOWN_VALUE])).toBeCloseTo(100, 5);
  });
});

describe("per-row ROI cell — CURRENT behavior (characterization, bug pinned)", () => {
  it("a known gainer reads +50%", () => {
    expect(currentRowRoi(KNOWN_GAIN)).toBeCloseTo(50, 5);
  });

  it("an unknown-value set with a cost reads a FALSE −100% (value laundered to $0)", () => {
    // value→0, paid 50 → (0 − 50)/50 = −100%. Should read "—" (no value → no return).
    expect(currentRowRoi(UNKNOWN_VALUE_WITH_COST)).toBeCloseTo(-100, 5); // BUG — should be "—"/null
  });

  it("a $0-cost set already reads '—' (the paid>0 guard means no ÷0 here today)", () => {
    // The per-row guard already returns null on $0 cost — pinned so the fix keeps it.
    expect(currentRowRoi(ZERO_COST_KNOWN_VALUE)).toBeNull();
  });
});
