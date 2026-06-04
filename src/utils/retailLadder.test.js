import { describe, it, expect } from "vitest";
import { setRetailProvenance } from "./portfolio";
import { retailSourceMarker } from "./valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// Retail Phase 3a/3c — the manual msrp rung. Ladder order: Brickset → manual, then the
// promo no-RRP state, then null ("—"). A real sourced Brickset RRP still wins; manual fills
// where Brickset has none. BrickEconomy was REMOVED from the retail ladder in 3c — a
// `brickeconomy` source key is now IGNORED (BE stays a VALUE fallback only). A manual-sourced
// retail carries source:"manual" so it's visibly distinguishable.
// ─────────────────────────────────────────────────────────────────────────────

const bs = (amount) => ({ amount });
const man = (amount) => ({ amount });
const be = (amount) => ({ amount });

describe("retail ladder — Brickset → manual rung order (BE removed in 3c)", () => {
  it("Brickset present → Brickset wins over manual (a brickeconomy key is ignored)", () => {
    const v = setRetailProvenance({ brickset: bs(199.99), manual: man(150), brickeconomy: be(180) });
    expect(v).toMatchObject({ amount: 199.99, source: "brickset", basis: "retail" });
  });

  it("Brickset absent + manual present → manual wins (tagged source 'manual')", () => {
    const v = setRetailProvenance({ brickset: bs(null), manual: man(4.99), brickeconomy: be(8.99) });
    expect(v).toMatchObject({ amount: 4.99, source: "manual", basis: "retail" });
  });

  it("Brickset + manual absent → \"—\": a brickeconomy figure is NOT a fallback (3c)", () => {
    const v = setRetailProvenance({ brickset: bs(null), manual: man(0), brickeconomy: be(8.99) });
    expect(v).toBeNull();
  });

  it("manual is below Brickset: a Brickset 0 (unknown) falls through to manual", () => {
    const v = setRetailProvenance({ brickset: bs(0), manual: man(12.5), brickeconomy: be(20) });
    expect(v).toMatchObject({ amount: 12.5, source: "manual" });
  });

  it("manual 0 / blank / absent is skipped (no set has a $0 MSRP); a BE key cannot rescue it", () => {
    expect(setRetailProvenance({ manual: man(0), brickeconomy: be(5) })).toBeNull();
    expect(setRetailProvenance({ manual: man(""), brickeconomy: be(5) })).toBeNull();
    expect(setRetailProvenance({ manual: man(7.5) })).toMatchObject({ amount: 7.5, source: "manual" });
  });
});

describe("retail ladder — interaction with the promo no-RRP state", () => {
  it("a manual figure WINS over promo (a hand-entered RRP beats 'no RRP exists')", () => {
    const v = setRetailProvenance({ brickset: bs(null), manual: man(9.99) }, { promo: true });
    expect(v).toMatchObject({ amount: 9.99, source: "manual" });
  });

  it("promo wins only when NO sourced and NO manual figure", () => {
    const v = setRetailProvenance({ brickset: bs(null), manual: man(0), brickeconomy: be(0) }, { promo: true });
    expect(v).toMatchObject({ amount: null, basis: "promo" });
  });

  it("all absent + not promo → null (\"—\")", () => {
    expect(setRetailProvenance({ brickset: bs(null), manual: man(0), brickeconomy: be(null) })).toBeNull();
  });
});

describe("retailSourceMarker — manual vs clean Brickset (no BE marker after 3c)", () => {
  it("manual → 'manual' marker", () => {
    const v = setRetailProvenance({ manual: man(4.99) });
    expect(retailSourceMarker(v)).toMatchObject({ marker: "manual" });
  });
  it("a brickeconomy key never produces a 'be' marker — it resolves to no retail (3c)", () => {
    const v = setRetailProvenance({ brickeconomy: be(8.99) });
    expect(v).toBeNull();
    expect(retailSourceMarker(v)).toBeNull();
  });
  it("Brickset-sourced → no marker (canonical, clean)", () => {
    const v = setRetailProvenance({ brickset: bs(199.99) });
    expect(retailSourceMarker(v)).toBeNull();
  });
  it("promo / null → no marker", () => {
    expect(retailSourceMarker(setRetailProvenance({}, { promo: true }))).toBeNull();
    expect(retailSourceMarker(null)).toBeNull();
  });
});
