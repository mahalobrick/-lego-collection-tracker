import { describe, it, expect } from "vitest";
import { setRetailProvenance, RETAIL_SOURCE_ORDER } from "./portfolio";
import { retailTooltip } from "./valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// MSRP Step 1 — setRetailProvenance: ordered-source retail (MSRP) read.
//
// Source order is settled empirically (BrickLink catalog has no MSRP — scripts/bl-catalog-probe):
// brickset (canonical) → manual (hand-entered, Phase 3a). BrickEconomy was REMOVED from retail in
// Phase 3c — a `brickeconomy` source key is now IGNORED by the ladder (BE stays a VALUE fallback
// only). The cases below pin that: a former-BE-only set resolves to "—" (or manual/promo), never a
// BE figure. The "Brickset leads" cases keep documenting that a real Brickset figure wins.
// ─────────────────────────────────────────────────────────────────────────────

const AS_OF = "2026-06-02T00:00:00.000Z";

describe("setRetailProvenance — ordered-source retail read", () => {
  it("order is brickset → manual → cmf (BL has no catalog MSRP; BE removed in 3c; cmf is the gated CMF fallback)", () => {
    expect(RETAIL_SOURCE_ORDER).toEqual(["brickset", "manual", "cmf"]);
  });

  it("Brickset leads: a Brickset figure wins; a brickeconomy key is ignored", () => {
    const v = setRetailProvenance({
      brickset: { amount: 849.99, asOf: AS_OF },
      brickeconomy: { amount: 799.99, asOf: AS_OF },
    });
    expect(v).toMatchObject({ amount: 849.99, source: "brickset", basis: "retail", asOf: AS_OF });
  });

  it("former BE-only set → \"—\": no Brickset, no manual, a brickeconomy key is ignored (3c)", () => {
    // Pre-3c this fell back to the BE figure; the BE rung is gone, so the ladder returns null.
    const v = setRetailProvenance({
      brickset: { amount: null },
      brickeconomy: { amount: 59.99, asOf: AS_OF },
    });
    expect(v).toBeNull();
  });

  it("former BE-only set with a manual figure → manual wins (the reclaim path)", () => {
    const v = setRetailProvenance({ brickset: { amount: null }, manual: { amount: 4.99 }, brickeconomy: { amount: 8.99 } });
    expect(v).toMatchObject({ amount: 4.99, source: "manual", basis: "retail" });
  });

  it("only a brickeconomy key present → null (it is not a ladder source)", () => {
    expect(setRetailProvenance({ brickeconomy: { amount: 120 } })).toBeNull();
  });

  it("no retail anywhere → null (caller renders \"—\")", () => {
    expect(setRetailProvenance({ brickset: { amount: null }, brickeconomy: { amount: null } })).toBeNull();
    expect(setRetailProvenance({})).toBeNull();
    expect(setRetailProvenance(undefined)).toBeNull();
  });

  it("0 / blank / unparseable is unknown (no set has a $0 MSRP) → skips that source", () => {
    // Brickset 0 must NOT win — it's unknown; fall through to the real manual figure (BE is ignored).
    expect(setRetailProvenance({ brickset: { amount: 0 }, manual: { amount: 49.99 } }))
      .toMatchObject({ amount: 49.99, source: "manual" });
    expect(setRetailProvenance({ brickset: { amount: "" }, manual: { amount: 49.99 } }))
      .toMatchObject({ amount: 49.99, source: "manual" });
    // 0 in both → unknown overall.
    expect(setRetailProvenance({ brickset: { amount: 0 }, manual: { amount: 0 } })).toBeNull();
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
