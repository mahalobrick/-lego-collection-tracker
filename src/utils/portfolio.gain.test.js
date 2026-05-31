import { describe, it, expect } from "vitest";
import { setGain, groupRollup, portfolioGain, portfolioValue } from "./portfolio";

// ─────────────────────────────────────────────────────────────────────────────
// Null-aware gain + group-sum primitives (unknown ≠ 0 sweep, STEP 1).
//   - setGain: null when value unknown; full value when cost is $0; never −cost.
//   - groupRollup: per-group figures via the same null-aware portfolio funcs.
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_GAIN = { theme: "Icons", currentValue: 150, paidPrice: 100, qty: 1 }; // +50
const KNOWN_FLAT = { theme: "Star Wars", currentValue: 100, paidPrice: 100, qty: 1 }; // 0
const UNKNOWN    = { theme: "Icons", paidPrice: 50, qty: 1 };                      // value unknown
const GWP        = { theme: "Promo", currentValue: 80, paidPrice: 0, qty: 1 };     // $0 cost, known value

describe("setGain()", () => {
  it("is value − cost for a known set (+$50)", () => {
    expect(setGain(KNOWN_GAIN)).toBeCloseTo(50, 5);
    expect(setGain(KNOWN_FLAT)).toBeCloseTo(0, 5);
  });

  it("is null for an unknown-value set — never a phantom −cost loss", () => {
    expect(setGain(UNKNOWN)).toBeNull();
    expect(setGain({})).toBeNull();
    expect(setGain({ paidPrice: 999 })).toBeNull();
  });

  it("gains the full value for a $0-cost (GWP) set with a known value", () => {
    expect(setGain(GWP)).toBeCloseTo(80, 5);
  });

  it("reconciles: Σ setGain over value-known sets === portfolioGain", () => {
    const sets = [KNOWN_GAIN, KNOWN_FLAT, UNKNOWN, GWP];
    const summed = sets.map(setGain).filter(g => g !== null).reduce((a, b) => a + b, 0);
    expect(summed).toBeCloseTo(portfolioGain(sets), 5);
    expect(summed).toBeCloseTo(50 + 0 + 80, 5); // 130
  });
});

describe("groupRollup()", () => {
  const sets = [KNOWN_GAIN, KNOWN_FLAT, UNKNOWN, GWP];
  const byTheme = groupRollup(sets, s => s.theme);
  const get = (k) => byTheme.find(g => g.key === k);

  it("groups by key, falsy key → 'Other'", () => {
    expect(byTheme.map(g => g.key).sort()).toEqual(["Icons", "Promo", "Star Wars"]);
    expect(groupRollup([{ currentValue: 5, qty: 1 }], s => s.theme).find(g => g.key === "Other")).toBeTruthy();
  });

  it("Icons (known +50 plus unknown): value 150, gain +50, 1 unknown counted", () => {
    const icons = get("Icons");
    expect(icons.count).toBe(2);
    expect(icons.value).toBeCloseTo(150, 5);   // unknown adds 0
    expect(icons.spent).toBeCloseTo(150, 5);   // inclusive: 100 + 50
    expect(icons.gain).toBeCloseTo(50, 5);     // unknown's $50 cost excluded from gain
    expect(icons.knownValueCount).toBe(1);
    expect(icons.unknownValueCount).toBe(1);
    expect(icons.roi).toBeCloseTo(50, 5);      // over {KNOWN_GAIN} only
  });

  it("Promo (GWP $0 cost): value 80, gain 80, ROI null (excluded — no positive cost)", () => {
    const promo = get("Promo");
    expect(promo.value).toBeCloseTo(80, 5);
    expect(promo.gain).toBeCloseTo(80, 5);
    expect(promo.roi).toBeNull();
    expect(promo.unknownValueCount).toBe(0);
  });

  it("group totals reconcile with the portfolio headline", () => {
    const sumValue = byTheme.reduce((a, g) => a + g.value, 0);
    const sumGain = byTheme.reduce((a, g) => a + g.gain, 0);
    expect(sumValue).toBeCloseTo(portfolioValue(sets), 5);
    expect(sumGain).toBeCloseTo(portfolioGain(sets), 5);
  });
});
