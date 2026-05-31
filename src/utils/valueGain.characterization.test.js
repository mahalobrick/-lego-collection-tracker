import { describe, it, expect, beforeEach } from "vitest";
import { portfolioValue, portfolioGain } from "./portfolio";
import { asNumber, money } from "./formatting";

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTERIZATION TESTS — pin the REMAINING "unknown value treated as $0" leaks,
// bug included. These are the sites the headline rollup / avgValue / ROI fixes did
// NOT yet cover (per the STEP 0 inventory of the unknown≠0 sweep):
//
//   - per-row GAIN cell        → value laundered to $0 → shows a phantom −$cost loss
//   - Value-by-Theme / Theme   → unknown set sits in the theme at $0, dragging the
//     Performance rollups         theme's gain (and ROI) down by its cost
//   - Most Valuable Sets list  → unknown set renders "$0.00" instead of "—"
//
// docs/valuation.md rule 6: unknown ≠ 0 — never silently counted as $0. STEP 2 of
// this phase flips these pins to the corrected behavior via the null-aware funcs.
// ─────────────────────────────────────────────────────────────────────────────

// Replicas of the CURRENT inline formulas in MyCollection.jsx (renderOwnedCell gain
// cell; themeChartData / themePerformance accumulation; Most Valuable display). The
// value half is `asNumber(totalValue) || asNumber(currentValue) * qty` — which is 0
// for an unknown-value set (the leak), NOT null.
const rawValue = (s) => asNumber(s.totalValue) || asNumber(s.currentValue) * (asNumber(s.qty) || 1);
const rawCost  = (s) => asNumber(s.totalPaid)  || asNumber(s.paidPrice)    * (asNumber(s.qty) || 1);
const currentRowGain = (s) => rawValue(s) - rawCost(s);
const currentThemeValue = (sets) => sets.reduce((sum, s) => sum + rawValue(s), 0);
const currentThemePaid  = (sets) => sets.reduce((sum, s) => sum + rawCost(s), 0);
const currentThemeGain  = (sets) => currentThemeValue(sets) - currentThemePaid(sets);

const KNOWN   = { theme: "Icons", currentValue: 150, paidPrice: 100, qty: 1 }; // gain +50
const UNKNOWN = { theme: "Icons", paidPrice: 50, qty: 1 };                      // no value, $50 paid

describe("per-row GAIN cell — CURRENT behavior (characterization, bug pinned)", () => {
  beforeEach(() => localStorage.clear()); // money() default → USD

  it("a known set's gain is value − cost (+$50)", () => {
    expect(currentRowGain(KNOWN)).toBeCloseTo(50, 5);
  });

  it("an UNKNOWN-value set shows a phantom −$50 loss (value laundered to $0)", () => {
    // value → 0, cost 50 → gain = −50. Honest answer: no value → no gain → "—"/null.
    expect(currentRowGain(UNKNOWN)).toBeCloseTo(-50, 5); // BUG — should be null → "—"
    expect(money(currentRowGain(UNKNOWN))).toBe("-$50.00"); // and it renders as a real loss
  });
});

describe("theme rollup — CURRENT behavior (characterization, bug pinned)", () => {
  it("a theme's gain is dragged down by an unknown set's cost (reads $0, not +$50)", () => {
    // Icons = KNOWN(+50 gain) + UNKNOWN($50 cost, $0 value). Theme gain collapses to
    // (150 − 150) = 0; over known-value sets only it should be +50.
    const icons = [KNOWN, UNKNOWN];
    expect(currentThemeGain(icons)).toBeCloseTo(0, 5);   // BUG — should be +50
    // The theme VALUE sum already matches known-only numerically (unknown adds 0)…
    expect(currentThemeValue(icons)).toBeCloseTo(150, 5);
    // …but the unknown set is silently folded in with no "N unknown" signal — the
    // leak is the gain/roi drag above, plus the missing per-theme unknown count.
  });
});

describe("Most Valuable Sets display — CURRENT behavior (characterization, bug pinned)", () => {
  beforeEach(() => localStorage.clear());

  it("an unknown-value set renders \"$0.00\", not \"—\"", () => {
    expect(money(rawValue(UNKNOWN))).toBe("$0.00"); // BUG — should be "—"
    expect(money(rawValue(KNOWN))).toBe("$150.00");
  });
});

// Sanity: the null-aware headline funcs already exclude the unknown set correctly —
// this is the target the leaking sites above must match after STEP 2.
describe("headline funcs already correct (the target to match)", () => {
  it("portfolioValue sums known only; portfolioGain excludes the unknown set's cost", () => {
    expect(portfolioValue([KNOWN, UNKNOWN])).toBeCloseTo(150, 5);
    expect(portfolioGain([KNOWN, UNKNOWN])).toBeCloseTo(50, 5); // unknown's $50 cost excluded
  });
});
