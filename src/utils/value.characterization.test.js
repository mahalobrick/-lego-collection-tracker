import { describe, it, expect, beforeEach } from "vitest";
import { beValueForCondition } from "./beSyncValues";
import { portfolioValue } from "./portfolio";
import { asNumber, money } from "./formatting";

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTERIZATION TESTS — pin CURRENT behavior of the value layer, bugs included.
//
// These lock in how value works RIGHT NOW (pre-V1), so the V2 behavior fixes can
// prove the change. Anywhere a test asserts something "wrong" (unknown counted as
// $0, retail laundered as value, new+used blended), that is INTENTIONAL: it pins
// today's reality per docs/value-layer-plan.md §2/§3. Do not "fix" these here.
// ─────────────────────────────────────────────────────────────────────────────

// Fixtures mirror the real BrickEconomy API responses verified in V0
// (docs/value-layer-plan.md §1a). At-retail sets carry current_value_new == retail
// and NO used value; only retired sets carry a used value + low/high band.
const AT_RETAIL = {
  // 10300-1 (BTTF) — at primary retail: new value mirrors the sticker price.
  current_value_new: 199.99,
  retail_price_us: 199.99,
};

const RETIRED = {
  // 21322-1 (Barracuda Bay) — retired: real secondary market, new + used + band.
  current_value_new: 372.20,
  current_value_used: 298.99,
  current_value_used_low: 265.00,
  current_value_used_high: 355.99,
  retail_price_us: 199.99,
  retired: true,
};

const NO_VALUE = {
  // ~3% of sets: no value fields at all, and no retail to fall back on.
  retail_price_us: undefined,
};

const NO_VALUE_BUT_RETAIL = {
  // No modeled value, but a retail price exists → current code launders retail as value.
  retail_price_us: 49.99,
};

describe("beValueForCondition() — CURRENT behavior (characterization)", () => {
  describe("at-retail set (new mirrors retail)", () => {
    it("new condition returns the new value, which == retail (laundered, G2)", () => {
      expect(beValueForCondition(AT_RETAIL, "new")).toBe(199.99);
    });

    it("sealed condition behaves like new", () => {
      expect(beValueForCondition(AT_RETAIL, "sealed")).toBe(199.99);
    });

    it("used condition falls back to the new value (no used value exists)", () => {
      expect(beValueForCondition(AT_RETAIL, "used")).toBe(199.99);
    });

    it("null/mixed condition returns the lone new value (nothing to blend)", () => {
      expect(beValueForCondition(AT_RETAIL, null)).toBe(199.99);
      expect(beValueForCondition(AT_RETAIL, "mixed")).toBe(199.99);
    });
  });

  describe("retired set (used value + band present)", () => {
    it("new condition returns current_value_new", () => {
      expect(beValueForCondition(RETIRED, "new")).toBe(372.20);
    });

    it("used condition returns current_value_used", () => {
      expect(beValueForCondition(RETIRED, "used")).toBe(298.99);
    });

    it("used_good (used* prefix) routes to the used value", () => {
      expect(beValueForCondition(RETIRED, "used_good")).toBe(298.99);
    });

    it("null/mixed condition BLENDS new+used into a synthetic average (G3)", () => {
      // (372.20 + 298.99) / 2 — a price that corresponds to no real market figure.
      expect(beValueForCondition(RETIRED, null)).toBeCloseTo(335.595, 5);
      expect(beValueForCondition(RETIRED, "mixed")).toBeCloseTo(335.595, 5);
    });
  });

  describe("set with no value data", () => {
    it("returns the retail price when one exists (laundered as value, G2)", () => {
      expect(beValueForCondition(NO_VALUE_BUT_RETAIL, "new")).toBe(49.99);
      expect(beValueForCondition(NO_VALUE_BUT_RETAIL, "used")).toBe(49.99);
    });

    it("returns 0 (NOT a first-class unknown) when there is no value and no retail", () => {
      // The falsy-zero bug: genuinely-unknown collapses to 0, indistinguishable
      // from a worthless set (docs/value-layer-plan.md §3b). Pinned for V2.
      expect(beValueForCondition(NO_VALUE, "new")).toBe(0);
      expect(beValueForCondition(NO_VALUE, "used")).toBe(0);
      expect(beValueForCondition(NO_VALUE, null)).toBe(0);
    });

    it("returns 0 for an entirely empty/undefined input", () => {
      expect(beValueForCondition({}, "new")).toBe(0);
      expect(beValueForCondition(undefined, "new")).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio rollup — pins MyCollection.jsx's `value` reduce in `stats`.
//
// As of V2a step 1 this imports the REAL extracted function (src/utils/portfolio.js)
// instead of a mirror. The component now calls the same `portfolioValue` inside its
// useMemo, so these green assertions prove the extraction changed no behavior.
// ─────────────────────────────────────────────────────────────────────────────

describe("portfolio value rollup — CURRENT behavior (characterization)", () => {
  it("counts an unknown-value set as $0 (the bug, pinned for V2)", () => {
    // A set whose value is genuinely unknown (no currentValue/totalValue) contributes
    // 0 to the total — unknown ≠ $0, but today the math says it is.
    const sets = [
      { setNumber: "10300", currentValue: 199.99, qty: 1 },
      { setNumber: "99999" /* never valued → unknown */, qty: 1 },
    ];
    expect(portfolioValue(sets)).toBeCloseTo(199.99, 5);
    // Drop the known set and the unknown one alone totals exactly 0.
    expect(portfolioValue([{ setNumber: "99999", qty: 1 }])).toBe(0);
  });

  it("prefers a precomputed totalValue over currentValue × qty", () => {
    const sets = [{ currentValue: 100, totalValue: 250, qty: 3 }];
    // totalValue wins (already qty-adjusted); currentValue×qty (300) is ignored.
    expect(portfolioValue(sets)).toBe(250);
  });

  it("falls back to currentValue × qty when totalValue is absent", () => {
    const sets = [{ currentValue: 50, qty: 4 }];
    expect(portfolioValue(sets)).toBe(200);
  });

  it("treats missing qty as 1", () => {
    expect(portfolioValue([{ currentValue: 75 }])).toBe(75);
  });
});

describe("combined collection total — CURRENT behavior (characterization)", () => {
  it("sums across BOTH new and used sets into one mixed total", () => {
    // Each set's currentValue was computed for ITS condition by beValueForCondition:
    // the new set carries its new value, the used set carries its used value.
    const newSet  = { condition: "new",  currentValue: beValueForCondition(RETIRED, "new"),  qty: 1 };
    const usedSet = { condition: "used", currentValue: beValueForCondition(RETIRED, "used"), qty: 1 };

    // The combined headline total mixes new (372.20) + used (298.99) into one number.
    expect(newSet.currentValue).toBe(372.20);
    expect(usedSet.currentValue).toBe(298.99);
    expect(portfolioValue([newSet, usedSet])).toBeCloseTo(671.19, 5);
  });

  it("a single combined total spans conditions and quantities", () => {
    const sets = [
      { condition: "new",  currentValue: 372.20, qty: 2 }, // 744.40
      { condition: "used", currentValue: 298.99, qty: 1 }, // 298.99
    ];
    expect(portfolioValue(sets)).toBeCloseTo(1043.39, 5);
  });
});

describe("money()/formatting on undefined — CURRENT behavior (characterization)", () => {
  beforeEach(() => localStorage.clear()); // default display currency → USD

  it("renders undefined value as \"$0.00\" (unknown looks worthless, pinned for V2)", () => {
    expect(money(undefined)).toBe("$0.00");
  });

  it("renders null and empty-string the same way", () => {
    expect(money(null)).toBe("$0.00");
    expect(money("")).toBe("$0.00");
  });

  it("asNumber() collapses undefined/null/\"\"/unparseable to 0 (the falsy-zero source)", () => {
    expect(asNumber(undefined)).toBe(0);
    expect(asNumber(null)).toBe(0);
    expect(asNumber("")).toBe(0);
    expect(asNumber("not a number")).toBe(0);
  });
});
