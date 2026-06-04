import { describe, it, expect } from "vitest";
import { setRetailProvenance, RETAIL_SOURCE_ORDER } from "./portfolio";
import { retailTooltip } from "./valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// MSRP Step 1 — setRetailProvenance: ordered-source retail (MSRP) read.
//
// NET-FIRST: the detail-panel MSRP chip USED to read only `retail_price_us` from the
// BrickEconomy set cache: `asNumber(be.retail_price_us) || null`. The "BE-only" cases below
// PIN that prior behavior — when Brickset has no figure, the result amount is byte-identical to
// the old BE read (incl. the 0 → unknown coalescing). The "Brickset leads" cases document the
// intended CHANGE: a Brickset figure now wins over BE.
//
// Source order is settled empirically (BrickLink catalog has no MSRP — scripts/bl-catalog-probe):
// brickset (canonical) → brickeconomy (deprecated fallback).
// ─────────────────────────────────────────────────────────────────────────────

const AS_OF = "2026-06-02T00:00:00.000Z";

describe("setRetailProvenance — ordered-source retail read", () => {
  it("order is brickset → manual → brickeconomy (BrickLink excluded — no catalog MSRP)", () => {
    expect(RETAIL_SOURCE_ORDER).toEqual(["brickset", "manual", "brickeconomy"]);
  });

  it("Brickset leads: a Brickset figure wins over a different BrickEconomy figure", () => {
    const v = setRetailProvenance({
      brickset: { amount: 849.99, asOf: AS_OF },
      brickeconomy: { amount: 799.99, asOf: AS_OF },
    });
    expect(v).toMatchObject({ amount: 849.99, source: "brickset", basis: "retail", asOf: AS_OF });
  });

  it("BE-only fallback (pins old chip behavior): no Brickset → BrickEconomy figure, byte-identical amount", () => {
    const beFigure = 59.99;
    const v = setRetailProvenance({
      brickset: { amount: null },
      brickeconomy: { amount: beFigure, asOf: AS_OF },
    });
    // Old chip: asNumber(be.retail_price_us) || null === 59.99. New fallback matches exactly.
    expect(v).toMatchObject({ amount: beFigure, source: "brickeconomy", basis: "retail" });
  });

  it("missing Brickset source object → still falls back to BrickEconomy", () => {
    const v = setRetailProvenance({ brickeconomy: { amount: 120 } });
    expect(v).toMatchObject({ amount: 120, source: "brickeconomy", basis: "retail" });
  });

  it("no retail anywhere → null (caller renders \"—\")", () => {
    expect(setRetailProvenance({ brickset: { amount: null }, brickeconomy: { amount: null } })).toBeNull();
    expect(setRetailProvenance({})).toBeNull();
    expect(setRetailProvenance(undefined)).toBeNull();
  });

  it("0 / blank / unparseable is unknown (no set has a $0 MSRP) → skips that source", () => {
    // Brickset 0 must NOT win — it's unknown; fall through to a real BE figure.
    expect(setRetailProvenance({ brickset: { amount: 0 }, brickeconomy: { amount: 49.99 } }))
      .toMatchObject({ amount: 49.99, source: "brickeconomy" });
    expect(setRetailProvenance({ brickset: { amount: "" }, brickeconomy: { amount: 49.99 } }))
      .toMatchObject({ amount: 49.99, source: "brickeconomy" });
    // 0 in both → unknown overall.
    expect(setRetailProvenance({ brickset: { amount: 0 }, brickeconomy: { amount: 0 } })).toBeNull();
  });

  it("parses string amounts the same way value reads do ($/commas tolerated)", () => {
    expect(setRetailProvenance({ brickset: { amount: "$1,299.99" } }))
      .toMatchObject({ amount: 1299.99, source: "brickset", basis: "retail" });
  });

  it("always basis:'retail' even for a retired set (MSRP never flips to market)", () => {
    // No `retired` input at all — retail is retail by construction.
    const v = setRetailProvenance({ brickset: { amount: 200, asOf: AS_OF } }, { condition: "new" });
    expect(v.basis).toBe("retail");
    expect(v.condition).toBe("new");
  });

  it("the result is recognised as retail by retailTooltip (reused display predicate)", () => {
    const v = setRetailProvenance({ brickset: { amount: 200 } });
    expect(retailTooltip(v)).toBeTruthy();
    // and a null (no-retail) result carries no tooltip
    expect(retailTooltip(setRetailProvenance({}))).toBeNull();
  });
});
