import { describe, it, expect } from "vitest";
import { setValueProvenance, portfolioValue, knownValueCount } from "./portfolio";

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTERIZATION — app-read Step 2 (BrickLink value overlay).
//
// Net-first: this file FIRST pins the CURRENT (BrickEconomy-provenance) resolution
// for a few representative owned copies — proving exactly what the value funnel does
// today — and is THEN extended (below the divider) with the BL-preference behavior
// once the overlay lands. The "current" block must keep passing unchanged after the
// overlay: with NO value map, setValueProvenance is byte-identical to today (the
// overlay is non-destructive — BE provenance stays in storage as the fallback).
// ─────────────────────────────────────────────────────────────────────────────

// Representative owned copies in their real stored shapes.
// BE sets carry source:"BrickEconomy", totalValue (== Σ entries.current_value), and entries[].
const NEW_BE   = { setNumber: "75298-1", source: "BrickEconomy", retired: true, condition: "new", qty: 1, totalValue: 50, currentValue: 50, entries: [{ condition: "new", current_value: 50 }] };
const USED_BE  = { setNumber: "30303-1", source: "BrickEconomy", retired: true, condition: "usedcomplete", qty: 1, totalValue: 8, currentValue: 8, entries: [{ condition: "usedcomplete", current_value: 8 }] };
const MIXED_BE = { setNumber: "10698-1", source: "BrickEconomy", retired: true, condition: "mixed", qty: 2, totalValue: 90, currentValue: 45, entries: [{ condition: "new", current_value: 60 }, { condition: "usedasnew", current_value: 30 }] };
const MANUAL   = { setNumber: "10294", retired: true, condition: "new", qty: 1, currentValue: 1140 }; // no source, no entries
const CMF_BE   = { setNumber: "71045-12", source: "BrickEconomy", retired: false, condition: "new", qty: 1, totalValue: 13, currentValue: 13, entries: [{ condition: "new", current_value: 13 }] };
const UNKNOWN  = { setNumber: "99999-1", condition: "new", qty: 1 }; // no value data

const ALL = [NEW_BE, USED_BE, MIXED_BE, MANUAL, CMF_BE, UNKNOWN];

describe("CURRENT behavior — BE provenance (no value map)", () => {
  it("new BE set → totalValue, source brickeconomy, market basis (retired)", () => {
    const v = setValueProvenance(NEW_BE);
    expect(v.amount).toBe(50);
    expect(v.source).toBe("brickeconomy");
    expect(v.basis).toBe("market");
  });

  it("used BE set → its stored value", () => {
    expect(setValueProvenance(USED_BE).amount).toBe(8);
  });

  it("mixed BE set → blended totalValue (90), condition 'mixed'", () => {
    const v = setValueProvenance(MIXED_BE);
    expect(v.amount).toBe(90);
    expect(v.condition).toBe("mixed");
  });

  it("manual set (no source) → currentValue × qty, market basis (retired)", () => {
    const v = setValueProvenance(MANUAL);
    expect(v.amount).toBe(1140);
    expect(v.source).toBeNull();
    expect(v.basis).toBe("market");
  });

  it("CMF BE set → its stored BE value (13)", () => {
    expect(setValueProvenance(CMF_BE).amount).toBe(13);
  });

  it("no value data → unknown (null amount)", () => {
    expect(setValueProvenance(UNKNOWN).amount).toBeNull();
  });

  it("portfolio total = Σ known BE values (1301), 5 of 6 known", () => {
    expect(portfolioValue(ALL)).toBe(50 + 8 + 90 + 1140 + 13); // 1301
    expect(knownValueCount(ALL)).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BL-PREFERENCE behavior — the overlay (passing a value map). BL where available
// (condition-matched), BE fallback on a cache-miss/unknown, unknown→null. The BE
// provenance is untouched in storage — the no-map block above still passes.
// ─────────────────────────────────────────────────────────────────────────────
const ASOF = "2026-06-02T00:57:57.212Z";
// A BE set whose BL record is all-unknown (basis "unknown") → must fall back to BE.
const UNKNOWN_BL = { setNumber: "55555-1", source: "BrickEconomy", retired: true, condition: "new", qty: 1, totalValue: 40, currentValue: 40, entries: [{ condition: "new", current_value: 40 }] };

const MAP = {
  "75298-1": { new: { amount: 22.09, basis: "sold", lots: 59, asOf: ASOF }, used: { amount: 14.54, basis: "sold", lots: 13, asOf: ASOF } },
  "30303-1": { new: { amount: 6.88, basis: "sold", lots: 45, asOf: ASOF }, used: { amount: 5.16, basis: "modeled", lots: 45, asOf: ASOF } },
  "10698-1": { new: { amount: 33.66, basis: "sold_thin", lots: 2, asOf: ASOF }, used: { amount: 25.37, basis: "modeled", lots: 2, asOf: ASOF } },
  "10294":   { new: { amount: 900, basis: "sold", lots: 30, asOf: ASOF }, used: { amount: 700, basis: "sold", lots: 5, asOf: ASOF } },
  "71045-12": null, // deferred CMF → cache miss
  "55555-1": { new: { amount: null, basis: "unknown", lots: 0, asOf: ASOF }, used: { amount: null, basis: "unknown", lots: 0, asOf: ASOF } },
  // 99999-1 absent from the map entirely → also a cache miss
};

describe("BL-PREFERENCE behavior — overlay (with value map)", () => {
  it("new copy → condition-matched BL .new, source bricklink, basis+lots+asOf carried", () => {
    const v = setValueProvenance(NEW_BE, MAP);
    expect(v.amount).toBe(22.09);          // moved 50 (BE) → 22.09 (BL sold)
    expect(v.source).toBe("bricklink");
    expect(v.basis).toBe("sold");
    expect(v.lots).toBe(59);
    expect(v.asOf).toBe(ASOF);
  });

  it("used copy → condition-matched BL .used (modeled), not .new", () => {
    const v = setValueProvenance(USED_BE, MAP);
    expect(v.amount).toBe(5.16);           // moved 8 (BE) → 5.16 (BL modeled)
    expect(v.basis).toBe("modeled");
    expect(v.lots).toBe(45);
  });

  it("mixed set → per-copy sum (33.66 new + 25.37 used = 59.03); mixed basis → 'market', lots null", () => {
    const v = setValueProvenance(MIXED_BE, MAP);
    expect(v.amount).toBeCloseTo(59.03, 2); // moved 90 (BE) → 59.03 (BL per-copy)
    expect(v.source).toBe("bricklink");
    expect(v.basis).toBe("market");
    expect(v.lots).toBeNull();
  });

  it("manual set → condition-matched BL .new × qty", () => {
    expect(setValueProvenance(MANUAL, MAP).amount).toBe(900); // moved 1140 (BE) → 900 (BL)
  });

  it("cache miss (deferred CMF, map value null) → BE fallback unchanged", () => {
    const v = setValueProvenance(CMF_BE, MAP);
    expect(v.amount).toBe(13);
    expect(v.source).toBe("brickeconomy");
  });

  it("cache miss (set absent from map) → BE fallback (unknown stays unknown)", () => {
    expect(setValueProvenance(UNKNOWN, MAP).amount).toBeNull();
  });

  it("BL record present but basis 'unknown'/amount null → BE fallback (40), source brickeconomy", () => {
    const v = setValueProvenance(UNKNOWN_BL, MAP);
    expect(v.amount).toBe(40);
    expect(v.source).toBe("brickeconomy");
  });

  it("portfolio total reflects BL realizable and is LOWER than the BE total", () => {
    const sets = [NEW_BE, USED_BE, MIXED_BE, MANUAL, CMF_BE, UNKNOWN];
    const blTotal = portfolioValue(sets, MAP);
    expect(blTotal).toBeCloseTo(22.09 + 5.16 + 59.03 + 900 + 13, 2); // 999.28
    expect(blTotal).toBeLessThan(portfolioValue(sets)); // 999.28 < 1301 (BE)
    expect(knownValueCount(sets, MAP)).toBe(5);
  });

  it("NON-DESTRUCTIVE: with no map, resolution stays BE (byte-identical)", () => {
    expect(setValueProvenance(NEW_BE).amount).toBe(50);
    expect(setValueProvenance(NEW_BE).source).toBe("brickeconomy");
  });
});
