// @vitest-environment node
//
// Pins the SHARED retail-ladder resolver (makeRetailResolver) — the factory the MSRP
// card (MyCollection.retailFor) AND the collection CSV export both call, so the two can
// never drift (parity by construction). This test fixes the resolver's output for EVERY
// rung of RETAIL_SOURCE_ORDER + both promo branches + the unsourced null, so the
// behaviour-neutral extraction out of the MyCollection closure stays exactly that.
//
// node env: pure data layer, no DOM/localStorage. The clock is frozen so the sourced
// rungs that stamp asOf via toValue's `new Date()` default (manual / cmf / curated_sourced)
// are deterministic and full-Value equality is assertable.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { makeRetailResolver } from "./retailResolver";

const FIXED = "2025-06-01T00:00:00.000Z";
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(FIXED)); });
afterAll(() => { vi.useRealTimers(); });

describe("makeRetailResolver — one resolver, every rung (card ↔ export parity by construction)", () => {
  it("brickset rung: a cached US retail → basis 'retail', source 'brickset', asOf = the fetch stamp", () => {
    const cache = { "brickset_10300-1": { data: { retail_price_us: 100 }, fetchedAt: FIXED } };
    const r = makeRetailResolver(cache)({ setNumber: "10300-1", condition: "new" });
    expect(r).toEqual({ amount: 100, source: "brickset", condition: "new", basis: "retail", asOf: FIXED, lots: null });
  });

  it("override rung: msrpOverride BEATS Brickset — the explicit Edit-drawer correction wins (gate Option B)", () => {
    const cache = { "brickset_10300-1": { data: { retail_price_us: 100 }, fetchedAt: FIXED } };
    const r = makeRetailResolver(cache)({ setNumber: "10300-1", condition: "new", msrp: 4.99, msrpOverride: 250 });
    expect(r).toEqual({ amount: 250, source: "override", condition: "new", basis: "retail", asOf: FIXED, lots: null });
  });

  it("NO override → Brickset still beats the add-baked manual msrp (precedence below override UNCHANGED)", () => {
    const cache = { "brickset_10300-1": { data: { retail_price_us: 100 }, fetchedAt: FIXED } };
    const r = makeRetailResolver(cache)({ setNumber: "10300-1", condition: "new", msrp: 4.99 });
    expect(r.source).toBe("brickset");
    expect(r.amount).toBe(100);
  });

  it("a blank/0/absent override is skipped (valueAmount coalescing) → falls through to Brickset", () => {
    const cache = { "brickset_10300-1": { data: { retail_price_us: 100 }, fetchedAt: FIXED } };
    expect(makeRetailResolver(cache)({ setNumber: "10300-1", msrpOverride: 0 }).source).toBe("brickset");
    expect(makeRetailResolver(cache)({ setNumber: "10300-1", msrpOverride: null }).source).toBe("brickset");
    expect(makeRetailResolver(cache)({ setNumber: "10300-1" }).source).toBe("brickset");
  });

  it("manual rung: a hand-entered msrp when nothing else has a figure", () => {
    const r = makeRetailResolver({})({ setNumber: "11111-1", msrp: 49.99 });
    expect(r).toEqual({ amount: 49.99, source: "manual", condition: null, basis: "retail", asOf: FIXED, lots: null });
  });

  it("curated_sourced rung: basis 'retail' + carries curatedConfidence/curatedSource (real CSV row)", () => {
    const r = makeRetailResolver({})({ setNumber: "30303-1" });
    expect(r).toEqual({
      amount: 3.99, source: "curated_sourced", condition: null, basis: "retail", asOf: FIXED, lots: null,
      curatedConfidence: "B", curatedSource: "Brickset website RRP (verified live)",
    });
  });

  it("cmf rung: numeric CMF series era-table fallback (Series 23 → $4.99), below curated_sourced", () => {
    const r = makeRetailResolver({})({ setNumber: "71034-3" });
    expect(r).toEqual({ amount: 4.99, source: "cmf", condition: null, basis: "retail", asOf: FIXED, lots: null });
  });

  it("curated_estimated rung: basis 'estimated' (NOT folded into sourced), asOf null (not toValue-stamped)", () => {
    const r = makeRetailResolver({})({ setNumber: "30370-1" });
    expect(r).toEqual({
      amount: 4.99, source: "curated_estimated", condition: null, basis: "estimated", asOf: null, lots: null,
      curatedConfidence: "C", curatedSource: "Retail polybag standard",
    });
  });

  it("promo + curated ARV → basis 'promo' (Option C: a GWP value is never sourced/estimated)", () => {
    const r = makeRetailResolver({})({ setNumber: "6490363-1" }); // 7-digit base → isPromoNoRetail
    expect(r).toEqual({
      amount: 19.99, source: "curated_estimated", condition: null, basis: "promo", asOf: null, lots: null,
      curatedConfidence: "D", curatedSource: "Seasonal GWP value proxy",
    });
  });

  it("promo + no source → first-class 'no RRP' state (basis 'promo', amount null)", () => {
    const r = makeRetailResolver({})({ setNumber: "9999999-1" }); // 7-digit, not in any source
    expect(r).toEqual({ amount: null, source: null, condition: null, basis: "promo", asOf: null, lots: null });
  });

  it("unsourced, non-promo → null ('—')", () => {
    expect(makeRetailResolver({})({ setNumber: "22222-1" })).toBeNull();
  });

  it("walks the FULL unstripped setNumber — curated keys on '30303-1', a stripped '30303' would miss", () => {
    expect(makeRetailResolver({})({ setNumber: "30303-1" })?.source).toBe("curated_sourced");
    expect(makeRetailResolver({})({ setNumber: "30303" })).toBeNull(); // stripped → curated miss → unsourced
  });
});
