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

describe("deriveValue — modeled_thin (rung-gap close: thin new ⇒ last-resort used model)", () => {
  it("thin new + ZERO used sales + no used stock → 0.75 × thin-new avg, basis 'modeled_thin', lots = new sample", () => {
    const u = d({ soldNew: { avg: 100, lots: 3 }, soldUsed: { avg: 0, lots: 0 } }).used;
    expect(u).toEqual({ amount: 75, source: "BrickLink", condition: "used", basis: "modeled_thin", asOf: ASOF, lots: 3 });
  });

  it("honours a custom multiplier, like the modeled rung", () => {
    const u = d({ soldNew: { avg: 100, lots: 2 }, soldUsed: { avg: 0, lots: 0 }, multiplier: 0.6 }).used;
    expect(u).toMatchObject({ amount: 60, basis: "modeled_thin" });
  });

  // ── Additive-placement pins: every EXISTING outcome is unchanged ────────────
  it("does NOT outrank rung 3: thin new + thin used → still sold_thin (real used data wins)", () => {
    const u = d({ soldNew: { avg: 100, lots: 9 }, soldUsed: { avg: 55, lots: 2 } }).used;
    expect(u).toMatchObject({ amount: 55, basis: "sold_thin" });
  });

  it("does NOT outrank rung 4: thin new + used stock → still asking", () => {
    const u = d({ soldNew: { avg: 100, lots: 5 }, soldUsed: { avg: 0, lots: 0 }, stockUsed: { min: 80, lots: 2 } }).used;
    expect(u).toMatchObject({ amount: 80, basis: "asking" });
  });

  it("does NOT replace rung 2: HEALTHY new still models as 'modeled', never 'modeled_thin'", () => {
    const u = d({ soldNew: { avg: 200, lots: 40 }, soldUsed: { avg: 0, lots: 0 } }).used;
    expect(u).toMatchObject({ amount: 150, basis: "modeled" });
  });

  it("does NOT fire without thin-new data: new 0 lots + nothing else → still unknown", () => {
    const u = d({ soldNew: { avg: 0, lots: 0 }, soldUsed: { avg: 0, lots: 0 } }).used;
    expect(u).toMatchObject({ amount: null, basis: "unknown", lots: 0 });
  });

  // ── The 7 real rung-gap sets from docs/be-fallback-gap-audit.md §2 — each previously
  //    resolved used:{amount:null, basis:"unknown"}; all now model off their thin new. ──
  const AUDIT_SETS = [
    { n: "11028-1", avg: 18.99, lots: 3 },
    { n: "42637-1", avg: 29.99, lots: 2 },
    { n: "43253-1", avg: 19.63, lots: 1 },
    { n: "76293-1", avg: 31.02, lots: 5 },
    { n: "40816-1", avg: 19.99, lots: 1 },
    { n: "40811-1", avg: 24.71, lots: 4 },
    { n: "40825-1", avg: 46.84, lots: 1 },
  ];
  it.each(AUDIT_SETS)("$n: new sold_thin ($avg × 0.75) → used modeled_thin, not unknown/BE-fallback", ({ avg, lots }) => {
    const { new: n, used: u } = d({ soldNew: { avg, lots }, soldUsed: { avg: 0, lots: 0 } });
    expect(n).toMatchObject({ basis: "sold_thin", amount: avg, lots });
    expect(u).toMatchObject({ basis: "modeled_thin", amount: round2(avg * USED_FROM_NEW_MULTIPLIER), lots });
    expect(u.amount).not.toBeNull();
  });
});
