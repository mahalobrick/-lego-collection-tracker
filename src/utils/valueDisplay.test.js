import { describe, it, expect } from "vitest";
import { formatValueCell, unknownValueNote, retailTooltip, roiExclusionNote, valueConfidence, lotsLabel, estimatedValueNote } from "./valueDisplay";
import { money } from "./formatting";
import { toValue } from "./value";

// A BL-overlay Value (what setValueProvenance returns with a value map) for the Step-3 helpers.
const bl = (basis, { lots = null, confidence, amount = 50 } = {}) =>
  ({ amount, source: "bricklink", condition: "new", basis, asOf: "2026-06-02T00:00:00.000Z", lots, confidence });

// ─────────────────────────────────────────────────────────────────────────────
// V2c value-surfacing display helpers. These pin the three display rules:
//   - formatValueCell: unknown → "—", known → money() (incl. a genuine 0)
//   - unknownValueNote: "N of M sets have no value data", omitted when N === 0
//   - retailTooltip:    present for basis:retail, absent for market/unknown
// money() is imported (not hardcoded) so the assertions hold across currency/locale.
// ─────────────────────────────────────────────────────────────────────────────

describe("formatValueCell()", () => {
  it("renders an unknown value (amount null) as an em dash, never $0", () => {
    const v = toValue(null, { source: "brickeconomy" });
    expect(v.amount).toBeNull();
    expect(formatValueCell(v)).toBe("—");
  });

  it("renders a known amount via money()", () => {
    const v = toValue(199.99, { source: "brickeconomy", retired: true });
    expect(formatValueCell(v)).toBe(money(199.99));
  });

  it("renders a genuine known 0 as money(0), NOT an em dash (0 ≠ unknown)", () => {
    const v = toValue(0, { source: "brickeconomy", retired: true });
    expect(v.amount).toBe(0);
    expect(formatValueCell(v)).toBe(money(0));
    expect(formatValueCell(v)).not.toBe("—");
  });

  it("renders a negative known amount via money()", () => {
    const v = toValue(-5, { source: "brickeconomy", retired: true });
    expect(formatValueCell(v)).toBe(money(-5));
  });

  it("treats a missing/nullish struct as unknown", () => {
    expect(formatValueCell(null)).toBe("—");
    expect(formatValueCell(undefined)).toBe("—");
  });
});

describe("unknownValueNote()", () => {
  it("returns null when every set has a known value (N === 0)", () => {
    expect(unknownValueNote(5, 5)).toBeNull();
  });

  it("returns null for an empty collection", () => {
    expect(unknownValueNote(0, 0)).toBeNull();
  });

  it("phrases the count as 'N of M sets have no value data'", () => {
    expect(unknownValueNote(3, 5)).toBe("2 of 5 sets have no value data");
  });

  it("handles all-unknown (N === M)", () => {
    expect(unknownValueNote(0, 4)).toBe("4 of 4 sets have no value data");
  });
});

describe("retailTooltip()", () => {
  it("is present for a retail-basis (at-retail) value", () => {
    const v = toValue(372.2, { source: "brickeconomy", retired: false }); // at-retail → retail
    expect(v.basis).toBe("retail");
    const tip = retailTooltip(v);
    expect(tip).toBeTruthy();
    // Covers BOTH caveats: it's the sticker price, and ROI = discount vs retail.
    expect(tip).toMatch(/retail/i);
    expect(tip).toMatch(/ROI/i);
    expect(tip).toMatch(/market/i);
  });

  it("is absent for a market-basis value", () => {
    const v = toValue(372.2, { source: "brickeconomy", retired: true }); // retired → market
    expect(v.basis).toBe("market");
    expect(retailTooltip(v)).toBeNull();
  });

  it("is absent for an unknown value", () => {
    const v = toValue(null, { source: "brickeconomy" });
    expect(v.basis).toBe("unknown");
    expect(retailTooltip(v)).toBeNull();
  });

  it("is absent for a missing/nullish struct", () => {
    expect(retailTooltip(null)).toBeNull();
    expect(retailTooltip(undefined)).toBeNull();
  });
});

describe("roiExclusionNote()", () => {
  it("is omitted (null) when nothing is excluded", () => {
    expect(roiExclusionNote(0)).toBeNull();
    expect(roiExclusionNote(undefined)).toBeNull();
    expect(roiExclusionNote(-1)).toBeNull();
  });

  it("uses the singular for one excluded set", () => {
    expect(roiExclusionNote(1)).toBe("1 set excluded from ROI (no value or no cost)");
  });

  it("uses the plural for several", () => {
    expect(roiExclusionNote(3)).toBe("3 sets excluded from ROI (no value or no cost)");
  });
});

describe("valueConfidence() — basis → subtle marker + tooltip (Step 3)", () => {
  it("sold → NO marker (clean default)", () => {
    expect(valueConfidence(bl("sold", { lots: 53 }))).toBeNull();
  });

  it("sold_thin → 'thin' marker, tooltip names the (few) sales count", () => {
    expect(valueConfidence(bl("sold_thin", { lots: 4 }))).toEqual({ marker: "thin", tooltip: "Based on few recent sales (4)" });
  });

  it("modeled → 'est.' marker, tooltip says estimated from new sold price (no sales count)", () => {
    const c = valueConfidence(bl("modeled", { lots: 50 }));
    expect(c).toEqual({ marker: "est.", tooltip: "Estimated from new sold price" });
    expect(c.tooltip).not.toMatch(/\d/); // lots (new-sample size) is NOT surfaced as a count
  });

  it("asking → 'ask' marker, tooltip says current listings not completed sales", () => {
    expect(valueConfidence(bl("asking", { lots: 7 }))).toEqual({ marker: "ask", tooltip: "Based on current listings, not completed sales" });
  });

  it("mixed set with an estimate → 'est.' / 'Contains estimated values'", () => {
    expect(valueConfidence(bl("mixed", { confidence: "estimates" }))).toEqual({ marker: "est.", tooltip: "Contains estimated values" });
  });

  it("mixed set, thin only → 'thin' / 'Contains thin sold data'", () => {
    expect(valueConfidence(bl("mixed", { confidence: "thin" }))).toEqual({ marker: "thin", tooltip: "Contains thin sold data" });
  });

  it("mixed set of only clean sold copies → no marker", () => {
    expect(valueConfidence(bl("mixed", { confidence: "clean" }))).toBeNull();
  });

  it("non-BrickLink (BE) value and unknown value → no marker (Step 3 is BL-basis only)", () => {
    expect(valueConfidence(toValue(50, { source: "brickeconomy", retired: true }))).toBeNull();
    expect(valueConfidence({ amount: null, source: "bricklink", basis: "unknown" })).toBeNull();
    expect(valueConfidence(null)).toBeNull();
  });
});

describe("lotsLabel() — per-basis interpretation of `lots`", () => {
  it("sold / sold_thin → 'N sales'", () => {
    expect(lotsLabel(bl("sold", { lots: 53 }))).toBe("53 sales");
    expect(lotsLabel(bl("sold_thin", { lots: 4 }))).toBe("4 sales");
  });

  it("modeled → 'from new price' (NOT a sales count)", () => {
    expect(lotsLabel(bl("modeled", { lots: 50 }))).toBe("from new price");
  });

  it("asking → 'N listings'", () => {
    expect(lotsLabel(bl("asking", { lots: 7 }))).toBe("7 listings");
  });

  it("non-BrickLink value → null", () => {
    expect(lotsLabel(toValue(50, { source: "brickeconomy" }))).toBeNull();
  });
});

describe("estimatedValueNote() — quiet aggregate disclosure", () => {
  it("omitted (null) at 0%", () => {
    expect(estimatedValueNote(0)).toBeNull();
    expect(estimatedValueNote(undefined)).toBeNull();
  });

  it("rounds to whole percent ≥1%", () => {
    expect(estimatedValueNote(0.123)).toBe("12% of value estimated");
    expect(estimatedValueNote(0.5)).toBe("50% of value estimated");
  });

  it("shows one decimal for a sub-1% share (honest about a small share)", () => {
    expect(estimatedValueNote(0.004)).toBe("0.4% of value estimated");
  });
});
