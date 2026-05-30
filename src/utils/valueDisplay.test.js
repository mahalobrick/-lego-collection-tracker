import { describe, it, expect } from "vitest";
import { formatValueCell, unknownValueNote, retailTooltip } from "./valueDisplay";
import { money } from "./formatting";
import { toValue } from "./value";

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
