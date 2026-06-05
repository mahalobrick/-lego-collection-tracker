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
import { setConditionDisplay } from "./condition";
import { materializeEntries } from "./percopy";

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

  it("only an entries[]-backed set can read 'mixed'; a manual set never does", () => {
    expect(setConditionDisplay(BE_MIXED_2X)).toBe("mixed");
    expect(setConditionDisplay(MANUAL_2X)).toBe("new");   // single bucket, never mixed
    // A manual set given a raw 'mixed' string still can't BE mixed without entries[]:
    expect(setConditionDisplay({ ...MANUAL_2X, condition: "mixed" })).not.toBe("mixed");
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
// 4. QTY DEFECT (backlog #2) — pinned AS-IS at the unit level (reconcilePaidEdit, the
//    function the qty handler calls at MyCollection.jsx:1187). The known-bad parts are
//    labeled; Phase 4 flips them so the change shows in the diff.
// ─────────────────────────────────────────────────────────────────────────────
describe("§4 qty edit — current unit-level behavior (Phase 4 will flip the defects)", () => {
  it("entries[] line: cost re-derives, but entries[].length does NOT track the new qty", () => {
    const patch = reconcilePaidEdit({ ...BE_2X, qty: 3 }); // user bumps 2 → 3 copies
    expect(patch.totalPaid).toBeCloseTo(300, 5);           // cost DOES update (100 × 3)
    // KNOWN DEFECT: Phase 4 flips this — entries should grow to length 3, but reconcilePaidEdit
    // only remaps the EXISTING copies' paid_price; it never adds/removes rows. So qty and
    // entries.length (the value copy-count) silently desync.
    expect(patch.entries).toHaveLength(2);                 // KNOWN DEFECT: should become 3
    // (The OTHER half of backlog #2 — the new qty never persisting to the blob — lives in the
    // component: updateSet's persist branch (MyCollection.jsx:1195-1216) has no "qty" case for
    // a BE set, so it falls to the in-memory-only else. Phase 4 adds that persist branch.)
  });

  it("line-level (manual) set: cost re-derives and there is no entries[] to desync", () => {
    const patch = reconcilePaidEdit({ ...MANUAL_2X, qty: 3 });
    expect(patch.totalPaid).toBeCloseTo(300, 5);           // 100 × 3
    expect("entries" in patch).toBe(false);                // no per-copy array → nothing to desync
    // Manual qty IS persisted today (the blOwnedSets effect, MyCollection.jsx:317-321) — so qty is
    // correct on manual sets and broken on BE sets. Phase 4 unifies both onto add/remove-a-copy.
  });
});
