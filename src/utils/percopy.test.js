import { describe, it, expect, beforeEach } from "vitest";
import { materializeEntries, applyCopyConditionEdit, applyQtyEdit } from "./percopy";
import { portfolioValue, setCost } from "./portfolio";
import { setConditionDisplay } from "./condition";

// ─────────────────────────────────────────────────────────────────────────────
// G4 PHASE 1 — materializeEntries(set) read funnel (INERT). Pins the full contract.
// The headline assertion is §1: feeding the funnel output back as entries[] must move
// NO money aggregate (the plan's money-neutrality bar), no-overlay AND with overlay —
// mirroring the Phase-0 dual pin (g4-percopy.characterization.test.js §1/§3).
// ─────────────────────────────────────────────────────────────────────────────

// Holding "10300-1": 2 copies, $100 paid each, $150 value each (New) — same fixture math
// as the Phase-0 net, expressed line-level vs entries[]-backed.
const MANUAL_2X = {
  setNumber: "10300-1", name: "Eiffel Tower", theme: "Icons",
  condition: "new", qty: 2, paidPrice: 100, currentValue: 150,
};
const BE_2X = {
  setNumber: "10300-1", name: "Eiffel Tower", theme: "Icons",
  source: "BrickEconomy", condition: "new",
  qty: 2, quantity: 2, paidPrice: 100, currentValue: 300,
  totalPaid: 200, totalValue: 300, averagePaid: 100,
  entries: [
    { condition: "new", paid_price: 100, current_value: 150 },
    { condition: "new", paid_price: 100, current_value: 150 },
  ],
};
const MANUAL_UNKNOWN = {
  setNumber: "21330-1", name: "Home Alone", theme: "Icons",
  condition: "new", qty: 1, paidPrice: 80,
};
// Promoted (Wanted/Budget → collection): a blob row whose copies already arrive value-null.
const PROMOTED_2X = {
  setNumber: "75313-1", name: "AT-AT", theme: "Star Wars",
  source: "BrickEconomy", condition: "new", qty: 2, quantity: 2, totalPaid: 800,
  entries: [
    { condition: "new", paid_price: 400, current_value: null, origin: "purchase" },
    { condition: "new", paid_price: 400, current_value: null, origin: "purchase" },
  ],
};

const VALUE_MAP = { "10300-1": { new: { amount: 150, basis: "sold", lots: 5, asOf: "2026-01-01" } } };

const sumPaid = (copies) => copies.reduce((s, c) => s + c.paid_price, 0);

beforeEach(() => localStorage.clear()); // money()/currency default → USD

// ─────────────────────────────────────────────────────────────────────────────
// 1. MONEY-NEUTRALITY AT THE FUNNEL (the key one)
// ─────────────────────────────────────────────────────────────────────────────
describe("§1 money-neutrality — the funnel is additive, moves no aggregate", () => {
  it("synthesized copies' paid SUMS to the line's cost (manual + multi-qty)", () => {
    expect(sumPaid(materializeEntries(MANUAL_2X))).toBeCloseTo(setCost(MANUAL_2X), 5);   // 200
    expect(sumPaid(materializeEntries(MANUAL_UNKNOWN))).toBeCloseTo(setCost(MANUAL_UNKNOWN), 5); // 80
  });

  it("attaching the materialized entries leaves value + cost unchanged (NO overlay)", () => {
    const asEntries = { ...MANUAL_2X, entries: materializeEntries(MANUAL_2X) };
    expect(portfolioValue([asEntries])).toBeCloseTo(portfolioValue([MANUAL_2X]), 5);     // 300
    expect(setCost(asEntries)).toBeCloseTo(setCost(MANUAL_2X), 5);                        // 200
  });

  it("attaching the materialized entries leaves value unchanged (WITH BL overlay)", () => {
    // Guards Phase 5 (valueGroups delegating to the funnel): resolveCopies must total
    // identically whether the set carries synthesized entries or none.
    const asEntries = { ...MANUAL_2X, entries: materializeEntries(MANUAL_2X) };
    expect(portfolioValue([asEntries], VALUE_MAP)).toBeCloseTo(portfolioValue([MANUAL_2X], VALUE_MAP), 5);
  });

  it("a value-unknown manual line stays unknown after materialization", () => {
    const asEntries = { ...MANUAL_UNKNOWN, entries: materializeEntries(MANUAL_UNKNOWN) };
    expect(portfolioValue([asEntries])).toBeCloseTo(0, 5);          // unknown → 0, not phantom
    expect(setCost(asEntries)).toBeCloseTo(80, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. entries[] PASS-THROUGH + IDEMPOTENCY
// ─────────────────────────────────────────────────────────────────────────────
describe("§2 entries[] pass-through + idempotency", () => {
  it("returns the existing copies, value-PRESERVED (faithful, not synthesized)", () => {
    const out = materializeEntries(BE_2X);
    expect(out).toHaveLength(2);
    expect(out.map(c => c.condition)).toEqual(["new", "new"]);
    expect(out.map(c => c.paid_price)).toEqual([100, 100]);
    expect(out.map(c => c.current_value)).toEqual([150, 150]); // REAL value kept, not nulled
  });

  it("is idempotent — re-materializing yields an equivalent array, ids stable", () => {
    const once  = materializeEntries(BE_2X);
    const twice = materializeEntries({ ...BE_2X, entries: once });
    expect(twice).toEqual(once); // same length, ids, condition, paid, value
  });

  it("a promoted set passes through value-null copies untouched (origin preserved)", () => {
    const out = materializeEntries(PROMOTED_2X);
    expect(out).toHaveLength(2);
    expect(out.map(c => c.current_value)).toEqual([null, null]);  // invariant #1 already true
    expect(out.map(c => c.origin)).toEqual(["purchase", "purchase"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SYNTHESIZED COPIES — value null, correct condition, summing paid, deterministic ids
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 synthesized copies (manual line-level set)", () => {
  it("each copy: current_value null, line condition, paid that sums to cost", () => {
    const out = materializeEntries(MANUAL_2X);
    expect(out).toHaveLength(2);
    expect(out.every(c => c.current_value === null)).toBe(true); // invariant #1
    expect(out.every(c => c.condition === "new")).toBe(true);
    expect(sumPaid(out)).toBeCloseTo(200, 5);
  });

  it("deterministic ids, stable across re-materialization", () => {
    const out = materializeEntries(MANUAL_2X);
    expect(out.map(c => c.id)).toEqual(["10300-1#0", "10300-1#1"]);
    // re-materialize the synthesized set → same ids (no Date.now()/random drift)
    const again = materializeEntries(MANUAL_2X);
    expect(again.map(c => c.id)).toEqual(out.map(c => c.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────
describe("§4 edge cases", () => {
  it("qty 1 → a single copy", () => {
    expect(materializeEntries({ setNumber: "1", condition: "new", qty: 1, paidPrice: 50 })).toHaveLength(1);
  });

  it("missing / zero qty → at least one copy (guarded, like buildCopyEntries)", () => {
    expect(materializeEntries({ setNumber: "1", condition: "new", paidPrice: 50 })).toHaveLength(1);
    expect(materializeEntries({ setNumber: "1", condition: "new", qty: 0, paidPrice: 50 })).toHaveLength(1);
  });

  it("empty or absent entries[] → synthesize from the line", () => {
    expect(materializeEntries({ ...MANUAL_2X, entries: [] })).toHaveLength(2);   // empty → line-level
    expect(materializeEntries(MANUAL_2X)).toHaveLength(2);                       // absent → line-level
  });

  it("null / undefined input → []", () => {
    expect(materializeEntries(null)).toEqual([]);
    expect(materializeEntries(undefined)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. applyCopyConditionEdit — Phase 3 write helper. The id-FREEZE guarantee (watch-item B):
//    first edit returns the FULL array with stable ids; a second edit references the same ones.
// ─────────────────────────────────────────────────────────────────────────────
describe("§5 applyCopyConditionEdit — full-array edit + id freeze", () => {
  it("first edit returns ALL N copies (not just the edited one) with frozen ids", () => {
    const out = applyCopyConditionEdit(MANUAL_2X, 0, "used"); // qty 2
    expect(out).toHaveLength(2);                               // full array, not 1
    expect(out.map(c => c.id)).toEqual(["10300-1#0", "10300-1#1"]);
    expect(out.map(c => c.condition)).toEqual(["used", "new"]); // only copy 0 changed
    expect(out.every(c => c.current_value === null)).toBe(true); // invariant #1 preserved
  });

  it("after persisting, a SECOND edit references the same stored ids (no drift)", () => {
    const first = applyCopyConditionEdit(MANUAL_2X, 0, "used");
    const persisted = { ...MANUAL_2X, entries: first };        // simulate the blOwnedSets persist
    const second = applyCopyConditionEdit(persisted, 1, "used");
    expect(second.map(c => c.id)).toEqual(first.map(c => c.id)); // ids stable across edits
    expect(second.map(c => c.condition)).toEqual(["used", "used"]); // first edit retained + second applied
  });

  it("drives the Mixed state: one copy flipped → setConditionDisplay reads 'mixed'", () => {
    expect(setConditionDisplay(MANUAL_2X)).toBe("new");        // uniform → not mixed
    const edited = { ...MANUAL_2X, entries: applyCopyConditionEdit(MANUAL_2X, 0, "used") };
    expect(setConditionDisplay(edited)).toBe("mixed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. applyQtyEdit — Phase 4 qty mechanism. Grow/shrink with id stability.
// ─────────────────────────────────────────────────────────────────────────────
describe("§6 applyQtyEdit — resize with stable ids", () => {
  it("grow: appends fresh-id copies, per-unit paid, value null (invariant #1)", () => {
    const out = applyQtyEdit(MANUAL_2X, 4);                  // qty 2 → 4
    expect(out).toHaveLength(4);
    expect(out.map(c => c.id)).toEqual(["10300-1#0", "10300-1#1", "10300-1#2", "10300-1#3"]);
    expect(out.slice(2).every(c => c.current_value === null)).toBe(true);
    expect(out.reduce((s, e) => s + e.paid_price, 0)).toBeCloseTo(setCost({ ...MANUAL_2X, qty: 4 }), 5); // 100×4
  });

  it("shrink: drops the LAST copy, survivors keep their exact ids (no reindex)", () => {
    const three = applyQtyEdit(MANUAL_2X, 3);                // [#0,#1,#2]
    const two   = applyQtyEdit({ ...MANUAL_2X, entries: three }, 2);
    expect(two.map(c => c.id)).toEqual(["10300-1#0", "10300-1#1"]); // #2 dropped, NOT renumbered
  });

  it("after a shrink, a per-copy edit on a survivor still maps to its id", () => {
    const three = applyQtyEdit(MANUAL_2X, 3);
    const two   = applyQtyEdit({ ...MANUAL_2X, entries: three }, 2);
    const edited = applyCopyConditionEdit({ ...MANUAL_2X, entries: two }, 1, "used");
    expect(edited.find(c => c.id === "10300-1#1").condition).toBe("used"); // right copy edited
    expect(edited.map(c => c.id)).toEqual(["10300-1#0", "10300-1#1"]);     // ids intact
  });

  it("same qty → idempotent passthrough; qty 0/missing → at least 1", () => {
    expect(applyQtyEdit(MANUAL_2X, 2)).toEqual(materializeEntries(MANUAL_2X));
    expect(applyQtyEdit(MANUAL_2X, 0)).toHaveLength(1);
  });
});
