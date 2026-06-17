// @vitest-environment node
//
// Curated MSRP rungs in the retail ladder (steps 2–3 of docs/curated-msrp-plan.md).
// RETAIL_SOURCE_ORDER = ["brickset","manual","curated_sourced","cmf","curated_estimated"]:
//   - curated_sourced (researched RRP / LEGO-stated value) → basis "retail", ABOVE cmf (a real
//     figure beats the era guess), BELOW brickset/manual.
//   - curated_estimated (proxy/ARV) → new basis "estimated", LAST (only fills when nothing real).
//   - a promo (isPromoNoRetail) set's curated value STAYS basis "promo" (Option C) — a valued GWP
//     ARV, never counted sourced/estimated, regardless of tier.
//   - confidence + the CSV source string ride along as curatedConfidence/curatedSource (detail/tooltip).
import { describe, it, expect } from "vitest";
import { setRetailProvenance, RETAIL_SOURCE_ORDER } from "./portfolio";

const S = (sources, opts = {}) => setRetailProvenance(sources, opts);

describe("RETAIL_SOURCE_ORDER — curated rungs placed correctly", () => {
  it("is exactly brickset → manual → curated_sourced → cmf → curated_estimated", () => {
    expect(RETAIL_SOURCE_ORDER).toEqual(["brickset", "manual", "curated_sourced", "cmf", "curated_estimated"]);
  });
});

describe("setRetailProvenance — curated basis tagging (non-promo)", () => {
  it("curated_sourced → basis 'retail', carrying confidence + source", () => {
    const r = S({ curated_sourced: { amount: 3.99, confidence: "B", source: "Brickset website RRP" } });
    expect(r.amount).toBe(3.99);
    expect(r.basis).toBe("retail");
    expect(r.source).toBe("curated_sourced");
    expect(r.curatedConfidence).toBe("B");
    expect(r.curatedSource).toBe("Brickset website RRP");
  });

  it("curated_estimated → new basis 'estimated' (NOT retail), carrying confidence + source", () => {
    const r = S({ curated_estimated: { amount: 4.99, confidence: "C", source: "Retail polybag standard" } });
    expect(r.amount).toBe(4.99);
    expect(r.basis).toBe("estimated");
    expect(r.source).toBe("curated_estimated");
    expect(r.curatedConfidence).toBe("C");
    expect(r.curatedSource).toBe("Retail polybag standard");
  });
});

describe("setRetailProvenance — rung ranking", () => {
  it("brickset and manual outrank curated_sourced", () => {
    expect(S({ brickset: { amount: 50 }, curated_sourced: { amount: 9.99 } }).source).toBe("brickset");
    expect(S({ manual: { amount: 50 }, curated_sourced: { amount: 9.99 } }).source).toBe("manual");
  });
  it("curated_sourced outranks cmf (a documented RRP beats the era guess)", () => {
    const r = S({ cmf: { amount: 4.99 }, curated_sourced: { amount: 7.99, confidence: "A", source: "LEGO page" } });
    expect(r.source).toBe("curated_sourced");
    expect(r.basis).toBe("retail");
  });
  it("curated_estimated is LAST — cmf wins over it", () => {
    const r = S({ cmf: { amount: 4.99 }, curated_estimated: { amount: 9.99 } });
    expect(r.source).toBe("cmf");
    expect(r.basis).toBe("retail"); // cmf stays sourced
  });
});

describe("setRetailProvenance — promo override (Option C)", () => {
  it("promo + curated_sourced ARV → basis 'promo' (NOT retail), carrying the amount + provenance", () => {
    const r = S({ curated_sourced: { amount: 29.99, confidence: "A", source: "Official LEGO ARV" } }, { promo: true });
    expect(r.basis).toBe("promo");
    expect(r.amount).toBe(29.99);
    expect(r.curatedConfidence).toBe("A");
    expect(r.curatedSource).toBe("Official LEGO ARV");
  });
  it("promo + curated_estimated ARV → basis 'promo', carrying the amount", () => {
    const r = S({ curated_estimated: { amount: 19.99, confidence: "C", source: "value proxy" } }, { promo: true });
    expect(r.basis).toBe("promo");
    expect(r.amount).toBe(19.99);
  });
  it("promo + NO curated value → basis 'promo', amount null (unchanged no-RRP state)", () => {
    const r = S({}, { promo: true });
    expect(r.basis).toBe("promo");
    expect(r.amount).toBeNull();
  });
});

describe("setRetailProvenance — unchanged for the existing rungs", () => {
  it("brickset alone → basis 'retail', no curated metadata", () => {
    const r = S({ brickset: { amount: 99.99 } });
    expect(r.basis).toBe("retail");
    expect(r.source).toBe("brickset");
    expect(r.curatedConfidence).toBeUndefined();
    expect(r.curatedSource).toBeUndefined();
  });
  it("nothing sourced, non-promo → null", () => {
    expect(S({})).toBeNull();
  });
});
