import { describe, it, expect } from "vitest";
import { deriveValue, USED_FROM_NEW_MULTIPLIER } from "./deriveValue.mjs";

// 75298-style fixtures (AT-AT). All branches of the value ladder in docs/value-source-decision.md §3.
const ASOF = "2026-06-01T00:00:00.000Z";
const d = (args) => deriveValue({ asOf: ASOF, ...args });
const round2 = (n) => Math.round(n * 100) / 100;

describe("deriveValue — record shape & provenance alignment", () => {
  it("stamps source/condition/asOf and rounds to 2dp on every record", () => {
    const { new: n, used: u } = d({
      soldNew: { avg: 159.999, lots: 50 },
      soldUsed: { avg: 119.991, lots: 20 },
    });
    expect(n).toEqual({ amount: 160, source: "BrickLink", condition: "new", basis: "sold", asOf: ASOF, lots: 50 });
    expect(u).toEqual({ amount: 119.99, source: "BrickLink", condition: "used", basis: "sold", asOf: ASOF, lots: 20 });
  });
});

describe("deriveValue — NEW ladder", () => {
  it("sold: new lots ≥10 → avg_price, basis 'sold'", () => {
    expect(d({ soldNew: { avg: 159.99, lots: 53 } }).new).toMatchObject({ amount: 159.99, basis: "sold", lots: 53 });
  });

  it("sold_thin: new lots 1–9 → avg_price, basis 'sold_thin'", () => {
    expect(d({ soldNew: { avg: 200, lots: 4 } }).new).toMatchObject({ amount: 200, basis: "sold_thin", lots: 4 });
  });

  it("asking: new lots 0 but stock/new present → min_price, basis 'asking'", () => {
    const n = d({ soldNew: { avg: 0, lots: 0 }, stockNew: { min: 210.5, lots: 7 } }).new;
    expect(n).toMatchObject({ amount: 210.5, basis: "asking", lots: 7 });
  });

  it("unknown: new lots 0 and no stock → amount null, basis 'unknown'", () => {
    expect(d({ soldNew: { avg: 0, lots: 0 } }).new).toMatchObject({ amount: null, basis: "unknown", lots: 0 });
  });

  it("unknown: nothing supplied at all → amount null, basis 'unknown'", () => {
    expect(d({}).new).toMatchObject({ amount: null, basis: "unknown" });
  });

  it("stock is ignored for NEW when a sold/new figure exists", () => {
    const n = d({ soldNew: { avg: 159.99, lots: 53 }, stockNew: { min: 999, lots: 3 } }).new;
    expect(n).toMatchObject({ amount: 159.99, basis: "sold" });
  });
});

describe("deriveValue — USED ladder (rung order 1→2→3→4→6)", () => {
  it("rung 1 sold: used lots ≥10 → avg_price, basis 'sold' (wins over modeling)", () => {
    const u = d({ soldNew: { avg: 160, lots: 50 }, soldUsed: { avg: 120, lots: 15 } }).used;
    expect(u).toMatchObject({ amount: 120, basis: "sold", lots: 15 });
  });

  it("rung 2 modeled: used THIN + new healthy → 0.75 × new, basis 'modeled', lots = new sample", () => {
    const u = d({ soldNew: { avg: 160, lots: 50 }, soldUsed: { avg: 999, lots: 3 } }).used;
    expect(u).toMatchObject({ amount: round2(160 * USED_FROM_NEW_MULTIPLIER), basis: "modeled", lots: 50 });
    expect(u.amount).toBe(120); // 0.75 × 160
  });

  it("rung 2 modeled: used ZERO + new healthy → 0.75 × new (modeled, not unknown)", () => {
    const u = d({ soldNew: { avg: 200, lots: 40 }, soldUsed: { avg: 0, lots: 0 } }).used;
    expect(u).toMatchObject({ amount: 150, basis: "modeled", lots: 40 });
  });

  it("rung 2 honours a custom multiplier (per-theme refinement hook)", () => {
    const u = d({ soldNew: { avg: 100, lots: 40 }, soldUsed: { avg: 0, lots: 0 }, multiplier: 0.6 }).used;
    expect(u).toMatchObject({ amount: 60, basis: "modeled" });
  });

  it("rung 3 sold_thin: used 1–9 AND new NOT healthy → used avg, basis 'sold_thin'", () => {
    const u = d({ soldNew: { avg: 100, lots: 5 }, soldUsed: { avg: 70, lots: 6 } }).used;
    expect(u).toMatchObject({ amount: 70, basis: "sold_thin", lots: 6 });
  });

  it("rung 4 asking: used 0 + new NOT healthy + stock/used present → min_price, basis 'asking'", () => {
    const u = d({ soldNew: { avg: 100, lots: 5 }, soldUsed: { avg: 0, lots: 0 }, stockUsed: { min: 80, lots: 2 } }).used;
    expect(u).toMatchObject({ amount: 80, basis: "asking", lots: 2 });
  });

  it("rung 6 unknown: used 0, new not healthy, no stock → amount null, basis 'unknown'", () => {
    const u = d({ soldNew: { avg: 0, lots: 0 }, soldUsed: { avg: 0, lots: 0 } }).used;
    expect(u).toMatchObject({ amount: null, basis: "unknown", lots: 0 });
  });

  it("modeling does NOT fire when new is only thin (1–9): falls to used sold_thin", () => {
    const u = d({ soldNew: { avg: 100, lots: 9 }, soldUsed: { avg: 55, lots: 2 } }).used;
    expect(u.basis).toBe("sold_thin");
    expect(u.amount).toBe(55);
  });
});
