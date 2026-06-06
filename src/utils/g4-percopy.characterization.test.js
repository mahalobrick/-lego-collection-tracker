import { describe, it, expect, beforeEach } from "vitest";
import {
  portfolioValue,
  portfolioValuedCost,
  portfolioGain,
  portfolioROI,
  knownValueCount,
  valueKnown,
  totalSpent,
  setCost,
  setGain,
  setROI,
  setValueProvenance,
  reconcilePaidEdit,
} from "./portfolio";
import { setConditionDisplay, conditionBucket } from "./condition";
import { valueGroups } from "./portfolio";
import { materializeEntries, applyCopyConditionEdit, applyQtyEdit } from "./percopy";
import { revalueBESet } from "./beSyncValues";

// ─────────────────────────────────────────────────────────────────────────────
// G4 / PER-COPY UNIFICATION — PHASE 0 CHARACTERIZATION NET
//
// Pins TODAY's behavior (current defects included, labeled as such) so each later
// phase visibly flips a line in the diff. NO production code is changed by this file.
//
// The governing contract is the plan's MONEY-NEUTRALITY acceptance bar
// (docs/g4-per-copy-plan.md): materializing per-copy entries (Phases 1–4) must change
// ONLY the per-copy view + per-copy editing — NEVER a headline aggregate. The §1 snapshots
// below ARE that contract; Phases 1–4 must reproduce them byte-for-byte.
//
// Functions pinned, by file:line:
//   • portfolioValue / portfolioValuedCost / portfolioGain / portfolioROI / knownValueCount
//       — src/utils/portfolio.js:283 / :637 / :617 / :650 / :335 (the headline aggregates)
//   • setCost / setGain / setROI / setValueProvenance — :389 / :690 / :462 / :154
//   • rawSetValue (internal) — :39 (no-map path reads totalValue → currentValue×qty, NOT entries)
//   • valueGroups / resolveCopies (internal) — :65 / :91 (with-map path; manual → qty units)
//   • setConditionDisplay — src/utils/condition.js:51 (entries → Mixed; manual never Mixed)
//   • reconcilePaidEdit — src/utils/portfolio.js:406 (what the qty handler calls,
//       MyCollection.jsx:1187)
// ─────────────────────────────────────────────────────────────────────────────

// ── Fixtures — the SAME holding expressed two ways, plus an unknown-value manual set ──
// Holding "10300-1": 2 copies, each paid $100, each worth $150 (New). Cost 200 / Value 300.

// Manual (line-level) form — NO entries[]; qty is a scalar, currentValue is PER-UNIT.
const MANUAL_2X = {
  setNumber: "10300-1", name: "Eiffel Tower", theme: "Icons",
  condition: "new", qty: 2, paidPrice: 100, currentValue: 150,
};

// BrickEconomy-imported form — entries[]-backed; the loaded UI-row shape carries the
// AGGREGATE totalValue/totalPaid (rawSetValue reads totalValue first), plus per-copy entries.
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

// Unknown-value manual set — value field absent → contributes 0 to value, excluded from
// the value-known subset; its $80 cost stays in the INCLUSIVE totalSpent only.
const MANUAL_UNKNOWN = {
  setNumber: "21330-1", name: "Home Alone", theme: "Icons",
  condition: "new", qty: 1, paidPrice: 80,
};

// A multi-qty BE line whose copies DISAGREE — the only shape that derives "mixed" today.
const BE_MIXED_2X = {
  setNumber: "75313-1", name: "AT-AT", theme: "Star Wars",
  source: "BrickEconomy", condition: "new",
  qty: 2, quantity: 2, totalPaid: 800, totalValue: 1000,
  entries: [
    { condition: "new",          paid_price: 400, current_value: 500 },
    { condition: "usedcomplete", paid_price: 400, current_value: 500 },
  ],
};

// Condition-matched BL overlay map (the with-overlay headline path). New copies read `.new`.
const VALUE_MAP = {
  "10300-1": { new: { amount: 150, basis: "sold", lots: 5, asOf: "2026-01-01" } },
};

beforeEach(() => localStorage.clear()); // money()/currency default → USD

// ─────────────────────────────────────────────────────────────────────────────
// 1. HEADLINE AGGREGATES — the money-neutrality baseline (most important).
//    These exact numbers are the contract Phases 1–4 must reproduce byte-for-byte.
// ─────────────────────────────────────────────────────────────────────────────
describe("§1 headline aggregates — money-neutrality baseline (no overlay)", () => {
  const PORTFOLIO = [MANUAL_2X, BE_2X, MANUAL_UNKNOWN];

  it("portfolio value / valued-cost / gain / ROI / known-count snapshot", () => {
    expect(portfolioValue(PORTFOLIO)).toBeCloseTo(600, 5);       // 300 + 300 + 0(unknown)
    expect(portfolioValuedCost(PORTFOLIO)).toBeCloseTo(400, 5);  // 200 + 200 (unknown excluded)
    expect(portfolioGain(PORTFOLIO)).toBeCloseTo(200, 5);        // 600 − 400
    expect(portfolioROI(PORTFOLIO)).toBeCloseTo(50, 5);          // 200 / 400
    expect(knownValueCount(PORTFOLIO)).toBe(2);                  // unknown set excluded
    expect(totalSpent(PORTFOLIO)).toBeCloseTo(480, 5);           // INCLUSIVE: 200 + 200 + 80
  });

  it("the value-known split (fix-#4 valueKnown predicate) — must not regress", () => {
    expect(PORTFOLIO.map(s => valueKnown(s))).toEqual([true, true, false]);
    // By construction (portfolio.js:629): value − valuedCost === gain over the same membership.
    expect(portfolioValue(PORTFOLIO) - portfolioValuedCost(PORTFOLIO))
      .toBeCloseTo(portfolioGain(PORTFOLIO), 5);
  });
});

describe("§1 headline aggregates — money-neutrality baseline (WITH BL overlay)", () => {
  // Guards the Phase-5 change where valueGroups delegates to materializeEntries: the
  // per-copy overlay path (resolveCopies) must still total identically across both shapes.
  const PORTFOLIO = [MANUAL_2X, BE_2X, MANUAL_UNKNOWN];

  it("overlay value / gain / known-count snapshot", () => {
    expect(portfolioValue(PORTFOLIO, VALUE_MAP)).toBeCloseTo(600, 5);
    expect(portfolioGain(PORTFOLIO, VALUE_MAP)).toBeCloseTo(200, 5);
    expect(knownValueCount(PORTFOLIO, VALUE_MAP)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PER-COPY VIEW ASYMMETRY — CLOSED by Phase 2 (pin flipped red→green).
//    The panel's per-copy DISPLAY gate (SetDetailPanel.jsx) now reads its rows through
//    materializeEntries(item), so every set renders a breakdown. (The separate EDIT gate
//    MyCollection.jsx:2076 stays storage-shape-based — manual sets stay read-only until
//    Phase 3 persists real entries[]; that asymmetry is intentional, not closed here.)
// ─────────────────────────────────────────────────────────────────────────────
// OLD gate (storage shape): a per-copy view existed only when the set carried a real entries[].
const hasStoredEntries = (s) => Array.isArray(s.entries) && s.entries.length > 0;
// NEW gate (Phase 2): the panel reads its rows through the funnel — manual sets included.
const hasPerCopyView = (s) => materializeEntries(s).length > 0;

describe("§2 per-copy view asymmetry — CLOSED by Phase 2 (pin flipped)", () => {
  it("a manual set NOW HAS a per-copy breakdown via the funnel (was: none)", () => {
    expect(hasStoredEntries(MANUAL_2X)).toBe(false);  // OLD: manual carried no stored entries[]
    expect(hasPerCopyView(MANUAL_2X)).toBe(true);      // FIXED: materialized rows now render
    expect(hasPerCopyView(BE_2X)).toBe(true);          // imported unchanged
  });

  it("a manual set reads 'mixed' once its per-copy conditions DIVERGE (Phase 3)", () => {
    expect(setConditionDisplay(BE_MIXED_2X)).toBe("mixed");
    // Unedited / uniform manual set — still not mixed (single bucket):
    expect(setConditionDisplay(MANUAL_2X)).toBe("new");
    expect(setConditionDisplay({ ...MANUAL_2X, condition: "mixed" })).not.toBe("mixed"); // raw string ≠ mixed
    // Phase 3: a per-copy edit gives the manual set divergent entries[] → NOW it reads mixed.
    const edited = { ...MANUAL_2X, entries: applyCopyConditionEdit(MANUAL_2X, 0, "used") };
    expect(setConditionDisplay(edited)).toBe("mixed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. IDENTICAL-HOLDINGS MONEY — the same holding (2×$100 paid / $150 value) must
//    contribute identically whether stored line-level or entries[]-backed. The
//    invariant a Phase-1 read funnel must not disturb.
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 identical holdings → identical money (line-level vs entries[])", () => {
  it("setCost / value / gain / ROI match across the two shapes (no overlay)", () => {
    expect(setCost(MANUAL_2X)).toBeCloseTo(setCost(BE_2X), 5);                       // 200
    expect(setValueProvenance(MANUAL_2X).amount)
      .toBeCloseTo(setValueProvenance(BE_2X).amount, 5);                              // 300
    expect(setGain(MANUAL_2X)).toBeCloseTo(setGain(BE_2X), 5);                        // 100
    expect(setROI(MANUAL_2X)).toBeCloseTo(setROI(BE_2X), 5);                          // 50
  });

  it("they roll up identically as one-set portfolios (no overlay AND with overlay)", () => {
    expect(portfolioValue([MANUAL_2X])).toBeCloseTo(portfolioValue([BE_2X]), 5);
    expect(portfolioGain([MANUAL_2X])).toBeCloseTo(portfolioGain([BE_2X]), 5);
    expect(portfolioValue([MANUAL_2X], VALUE_MAP))
      .toBeCloseTo(portfolioValue([BE_2X], VALUE_MAP), 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. QTY UNIFICATION (backlog #2) — defects FLIPPED by Phase 4. entries.length now tracks
//    qty on BOTH stores via applyQtyEdit (the mechanism behind updateSet's qty branch). The
//    persistence-across-reload half is component-level — covered by the browser smoke.
// ─────────────────────────────────────────────────────────────────────────────
describe("§4 qty unification — defects flipped (Phase 4)", () => {
  it("entries[] line: qty→3 GROWS entries to length 3 (was stuck at 2)", () => {
    const next = applyQtyEdit(BE_2X, 3);                            // was: reconcilePaidEdit kept length 2
    expect(next).toHaveLength(3);                                   // FIXED
    expect(next.reduce((s, e) => s + e.paid_price, 0)).toBeCloseTo(300, 5); // cost = Σ per-copy = 100×3
    expect(next[2].current_value).toBeNull();                      // new copy unvalued (invariant #1)
  });

  it("manual line-level: qty→3 materializes 3 copies (was: no entries[] to track qty)", () => {
    const next = applyQtyEdit(MANUAL_2X, 3);
    expect(next).toHaveLength(3);                                   // FIXED
    expect(next.reduce((s, e) => s + e.paid_price, 0)).toBeCloseTo(300, 5); // 100 × 3
  });

  it("qty↓ drops the LAST copy; survivors keep ids (NOT reindexed)", () => {
    const three = applyQtyEdit(MANUAL_2X, 3);                       // [#0,#1,#2]
    const two   = applyQtyEdit({ ...MANUAL_2X, entries: three }, 2);
    expect(two.map(c => c.id)).toEqual(["10300-1#0", "10300-1#1"]); // #2 dropped, survivors NOT reindexed
    // re-grow fills the freed slot deterministically (#2); the point is survivors #0/#1 are untouched.
    const grown = applyQtyEdit({ ...MANUAL_2X, entries: two }, 3);
    expect(grown.map(c => c.id)).toEqual(["10300-1#0", "10300-1#1", "10300-1#2"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4b. QTY-CHANGE MONEY — Phase 4 MOVES money on purpose (a copy added/removed). The bar is
//     that it moves CORRECTLY (per-unit × qty) and still reconciles at the new qty.
// ─────────────────────────────────────────────────────────────────────────────
describe("§4b qty-change money — moves correctly and reconciles at the new qty", () => {
  it("manual: cost + value scale per-unit × newQty and reconcile (no overlay)", () => {
    const next = { ...MANUAL_2X, qty: 3, entries: applyQtyEdit(MANUAL_2X, 3), totalPaid: 300 };
    expect(setCost(next)).toBeCloseTo(300, 5);                     // 100 × 3 (was 200 at qty 2)
    expect(portfolioValue([next])).toBeCloseTo(450, 5);           // currentValue 150 × 3 (was 300)
    expect(portfolioValue([next]) - portfolioValuedCost([next]))
      .toBeCloseTo(portfolioGain([next]), 5);                     // reconciles at qty 3
  });

  it("BE: revalue from cache scales totalValue with the new copy count", () => {
    const d = { current_value_new: 150 }; // BE cache: $150 / new copy
    const rev = revalueBESet({ ...BE_2X, entries: applyQtyEdit(BE_2X, 3), qty: 3 }, d);
    expect(rev.totalValue).toBeCloseTo(450, 5);                   // 150 × 3 copies (scaled with qty)
    expect(rev.currentValue).toBeCloseTo(150, 5);                 // per-copy average
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE LOCK (Phase 5) — valueGroups DELEGATES to materializeEntries: ONE source of truth for
//    per-copy enumeration. The value layer can't drift from the funnel across any store shape.
// ─────────────────────────────────────────────────────────────────────────────
describe("§5 invariant — valueGroups enumerates exactly materializeEntries' copies", () => {
  const PROMOTED = {
    setNumber: "75313-1", source: "BrickEconomy", condition: "new",
    entries: [
      { condition: "new", paid_price: 400, current_value: null, origin: "purchase" },
      { condition: "new", paid_price: 400, current_value: null, origin: "purchase" },
    ],
  };
  const DIVERGENT_MANUAL = { ...MANUAL_2X, entries: applyCopyConditionEdit(MANUAL_2X, 0, "used") };

  const cases = {
    "manual (line-level)": MANUAL_2X,
    "imported (entries[])": BE_2X,
    "promoted (value-null)": PROMOTED,
    "divergent manual": DIVERGENT_MANUAL,
    "value-unknown manual": MANUAL_UNKNOWN,
  };

  for (const [label, set] of Object.entries(cases)) {
    it(`${label}: one group per materialized copy, conditions aligned`, () => {
      const groups = valueGroups(set);
      const copies = materializeEntries(set);
      expect(groups).toHaveLength(copies.length);                       // one group per copy (no qty-units)
      expect(groups.every(g => g.units === 1)).toBe(true);             // delegation → per-copy units
      expect(groups.map(g => g.cond))
        .toEqual(copies.map(c => conditionBucket(c.condition)));        // conditions come from the funnel
    });
  }
});
