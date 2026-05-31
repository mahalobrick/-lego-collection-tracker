import { describe, it, expect, beforeEach } from "vitest";
import { portfolioValue, portfolioGain, setGain, groupRollup } from "./portfolio";
import { formatValueCell } from "./valueDisplay";
import { setValueProvenance } from "./portfolio";
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

// PINS FLIPPED (unknown≠0 sweep, STEP 2): each test shows the OLD inline-formula bug
// value for contrast, then asserts the CORRECTED behavior via the null-aware funcs the
// leaking sites now route through.
describe("per-row GAIN cell — CORRECTED behavior (pins flipped)", () => {
  beforeEach(() => localStorage.clear()); // money() default → USD

  it("a known set's gain is value − cost (+$50)", () => {
    expect(currentRowGain(KNOWN)).toBeCloseTo(50, 5);
    expect(setGain(KNOWN)).toBeCloseTo(50, 5);
  });

  it("an UNKNOWN-value set's gain is null → '—', not a phantom −$50 loss", () => {
    expect(currentRowGain(UNKNOWN)).toBeCloseTo(-50, 5); // OLD bug: phantom −$50
    expect(setGain(UNKNOWN)).toBeNull();                 // FIXED → cell renders "—"
  });
});

describe("theme rollup — CORRECTED behavior (pins flipped)", () => {
  it("a theme's gain excludes the unknown set's cost (+$50, not $0) and counts it unknown", () => {
    const icons = groupRollup([KNOWN, UNKNOWN], s => s.theme).find(g => g.key === "Icons");
    expect(currentThemeGain([KNOWN, UNKNOWN])).toBeCloseTo(0, 5); // OLD bug: dragged to 0
    expect(icons.gain).toBeCloseTo(50, 5);                        // FIXED
    expect(icons.value).toBeCloseTo(150, 5);
    expect(icons.unknownValueCount).toBe(1);                      // unknown now surfaced
  });
});

describe("Most Valuable Sets display — CORRECTED behavior (pins flipped)", () => {
  beforeEach(() => localStorage.clear());

  it("an unknown-value set renders '—', not '$0.00'", () => {
    expect(money(rawValue(UNKNOWN))).toBe("$0.00");                 // OLD bug
    expect(formatValueCell(setValueProvenance(UNKNOWN))).toBe("—"); // FIXED
    expect(formatValueCell(setValueProvenance(KNOWN))).toBe("$150.00");
  });
});

// Reconciliation: the per-row gains (null-aware) sum to the headline Net Gain.
describe("per-row gains reconcile with the headline Net Gain", () => {
  it("Σ setGain over value-known sets === portfolioGain", () => {
    const sets = [KNOWN, UNKNOWN];
    const summed = sets.map(setGain).filter(g => g !== null).reduce((a, b) => a + b, 0);
    expect(summed).toBeCloseTo(portfolioGain(sets), 5);
    expect(portfolioValue(sets)).toBeCloseTo(150, 5);
    expect(portfolioGain(sets)).toBeCloseTo(50, 5);
  });
});
