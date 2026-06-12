import { describe, it, expect } from "vitest";
import { setValueProvenance, copyValueProvenance, portfolioValue, valueKnown } from "./portfolio";
import { FROZEN_VALUE_ASOF } from "./frozenValue";

// ─────────────────────────────────────────────────────────────────────────────
// BE-removal D1 — the 2 promos resolve their value from the STORED collection number
// with an honest "frozen" basis, decoupled from the live BE path. The critical pin:
// a path that simulates the BE machinery being GONE (no value map, cache-miss) does
// NOT blank them, and nothing about the OTHER (BrickEconomy-provenance) sets regresses.
//
// Real stored shapes (post-CMF re-probe, be-removal-plan.md §1): both promos are owned
// `new`, cron-deferred (no value:SET → BL cache miss), last BE number frozen in the store.
// ─────────────────────────────────────────────────────────────────────────────

const FIREPLACE = { setNumber: "6490363-1", source: "BrickEconomy", retired: true, condition: "new", qty: 1, totalValue: 23.72, currentValue: 23.72 };
const GINGER    = { setNumber: "6550806-1", source: "BrickEconomy", retired: true, condition: "new", qty: 1, totalValue: 32.96, currentValue: 32.96 };
// A normal BE-provenance set (NOT frozen) — the regression anchor.
const NORMAL_BE = { setNumber: "75298-1", source: "BrickEconomy", retired: true, condition: "new", qty: 1, totalValue: 50, currentValue: 50, entries: [{ condition: "new", current_value: 50 }] };

describe("setValueProvenance — the 2 promos resolve as frozen provenance", () => {
  it("reads the stored number with basis+source 'frozen' and the freeze date (no map)", () => {
    const v = setValueProvenance(FIREPLACE);
    expect(v.amount).toBe(23.72); // the stored, frozen figure — unchanged number
    expect(v.basis).toBe("frozen");
    expect(v.source).toBe("frozen");
    expect(v.asOf).toBe(FROZEN_VALUE_ASOF);
    expect(v.condition).toBe("new");
  });

  it("stays frozen when the value map is present but MISSES them (cron-deferred)", () => {
    // valueMap has no record for these (they 404 on BL's SET endpoint) → blOverlayValue null.
    const map = { "75298-1": { new: { amount: 22.09, basis: "sold", lots: 59, asOf: "x" } } };
    expect(setValueProvenance(GINGER, map).amount).toBe(32.96);
    expect(setValueProvenance(GINGER, map).basis).toBe("frozen");
  });

  it("does NOT override a live BL figure if one ever appears (BL still wins)", () => {
    const map = { "6490363-1": { new: { amount: 19.5, basis: "sold", lots: 7, asOf: "y" } } };
    const v = setValueProvenance(FIREPLACE, map);
    expect(v.amount).toBe(19.5);
    expect(v.source).toBe("bricklink"); // freeze is only the FALLBACK label, never a BL override
  });

  it("falls through to unknown (not a phantom frozen $0) when there is no stored number", () => {
    const v = setValueProvenance({ setNumber: "6490363-1", condition: "new", qty: 1 });
    expect(v.amount).toBeNull();
    expect(v.basis).toBe("unknown"); // frozen labeling applies only to a real stored figure
  });
});

describe("setValueProvenance — machinery-GONE simulation must NOT blank them", () => {
  // Simulate the BE cache/proxy/batch being torn down: NO value map at all, and the set
  // carries only its stored field (no live fetch is possible). The value must survive.
  for (const s of [FIREPLACE, GINGER]) {
    it(`${s.setNumber} keeps its frozen value with no live source available`, () => {
      const v = setValueProvenance(s); // no valueMap → no BL, no live BE — store only
      expect(v.amount).toBe(s.totalValue);
      expect(v.amount).not.toBeNull();
      expect(v.basis).toBe("frozen");
      expect(valueKnown(s)).toBe(true);
    });
  }

  it("the frozen promos still contribute to the portfolio total (no map)", () => {
    expect(portfolioValue([FIREPLACE, GINGER])).toBeCloseTo(23.72 + 32.96, 2);
  });
});

describe("setValueProvenance — non-frozen BE sets are UNCHANGED (regression anchor)", () => {
  it("a normal BE set keeps source 'brickeconomy' + market basis (no map)", () => {
    const v = setValueProvenance(NORMAL_BE);
    expect(v.amount).toBe(50);
    expect(v.source).toBe("brickeconomy");
    expect(v.basis).toBe("market"); // retired BE → market, exactly as before
  });

  it("a normal BE set still prefers the BL overlay when the map covers it", () => {
    const map = { "75298-1": { new: { amount: 22.09, basis: "sold", lots: 59, asOf: "z" } } };
    expect(setValueProvenance(NORMAL_BE, map).source).toBe("bricklink");
  });
});

describe("copyValueProvenance — per-copy frozen label (SetDetailPanel path)", () => {
  it("a frozen promo copy resolves frozen from its stored value (cache miss)", () => {
    const v = copyValueProvenance(23.72, { setNumber: "6490363-1", condition: "new", retired: true });
    expect(v.amount).toBe(23.72);
    expect(v.basis).toBe("frozen");
    expect(v.source).toBe("frozen");
  });

  it("a non-frozen copy is unchanged (BE fallback, no source)", () => {
    const v = copyValueProvenance(50, { setNumber: "75298-1", condition: "new", retired: true });
    expect(v.amount).toBe(50);
    expect(v.basis).toBe("market");
  });

  it("BL coverage still wins for a frozen promo copy", () => {
    const map = { "6490363-1": { new: { amount: 19.5, basis: "sold", lots: 7, asOf: "y" } } };
    const v = copyValueProvenance(23.72, { setNumber: "6490363-1", condition: "new", retired: true }, map);
    expect(v.amount).toBe(19.5);
    expect(v.source).toBe("bricklink");
  });
});
