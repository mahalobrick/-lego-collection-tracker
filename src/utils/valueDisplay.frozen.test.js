import { describe, it, expect } from "vitest";
import { valueConfidence, formatValueCell } from "./valueDisplay";
import { frozenValue, FROZEN_VALUE_ASOF } from "./frozenValue";
import { money } from "./formatting";
import { toValue } from "./value";

// ─────────────────────────────────────────────────────────────────────────────
// BE-removal D1 — a frozen-value cell reads HONESTLY: the number renders normally,
// but a quiet "frozen" marker + dated tooltip tells the reader it's a static last
// recorded value with no live source. Reuses the existing valueConfidence channel
// (TriValueCell / SetDetailPanel already render its marker+tooltip), so no component
// wiring changes. Non-frozen values keep their exact prior markers (regression).
// ─────────────────────────────────────────────────────────────────────────────

describe("valueConfidence — frozen marker", () => {
  it("frozen value → 'frozen' marker with a dated 'no longer updated' tooltip", () => {
    const c = valueConfidence(frozenValue(23.72, { condition: "new", setNumber: "6490363-1" }));
    expect(c).toBeTruthy();
    expect(c.marker).toBe("frozen");
    expect(c.tooltip).toMatch(/no longer updated/i);
    expect(c.tooltip).toContain(FROZEN_VALUE_ASOF); // honest as-of date surfaced
  });

  it("a frozen value with no amount carries no marker (nothing to label)", () => {
    expect(valueConfidence({ amount: null, source: "frozen", basis: "frozen", asOf: null })).toBeNull();
  });

  it("non-frozen values are UNCHANGED: BE/market → null, BL sold → null, BL modeled → est.", () => {
    expect(valueConfidence(toValue(50, { source: "brickeconomy", retired: true }))).toBeNull();
    expect(valueConfidence({ amount: 50, source: "bricklink", basis: "sold", lots: 9 })).toBeNull();
    expect(valueConfidence({ amount: 50, source: "bricklink", basis: "modeled", lots: 9 })).toEqual({ marker: "est.", tooltip: "Estimated from new sold price" });
  });
});

describe("formatValueCell — a frozen value still renders its number (never a phantom em dash)", () => {
  it("renders the frozen amount via money()", () => {
    expect(formatValueCell(frozenValue(32.96, { setNumber: "6550806-1" }))).toBe(money(32.96));
  });
});
