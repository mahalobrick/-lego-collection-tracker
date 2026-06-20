import { describe, it, expect } from "vitest";
import { conditionValueBuckets, portfolioValue } from "./portfolio";

// ─────────────────────────────────────────────────────────────────────────────
// New / Used value partition — COPY-GRAIN (supersedes the set-grain New/Used/Mixed).
//
// THE DECISION: each owned COPY's condition-matched value scores New or Used by its
// OWN condition; "Mixed" stops being a value bucket — a multi-condition set's new
// copies count New and its used copies count Used.
//
// THE INVARIANT (pinned below): two exhaustive + disjoint buckets, value anchored to
// each set's authoritative setValueProvenance amount, so
//     new.value + used.value === portfolioValue(sets, valueMap)
// by construction — no value falls between buckets. This REPLACES the old set-grain
// new.value + used.value + mixed.value === portfolioValue, with the same "no dropped
// value" guarantee (no return of the ~$3.4k mixed gap), two buckets not three.
//
// `copies` is COPY-grain and reconciles to the all-copies "Total Sets" figure (Σ qty):
// resolveCopies yields exactly `qty` copies per set (entries.length for BE — quantity
// === entries by aggregateFromEntries — or `qty` synthesized for manual).
// ─────────────────────────────────────────────────────────────────────────────

const PURE_NEW    = { setNumber: "10300-1", currentValue: 100, condition: "new",          qty: 1 }; // 1 new copy, $100
const SEALED_NEW  = { setNumber: "75313-1", currentValue: 75,  condition: "sealed",       qty: 1 }; // sealed → new, $75
const PURE_USED   = { setNumber: "10221-1", currentValue: 50,  condition: "usedcomplete", qty: 1 }; // 1 used copy, $50
const UNKNOWN_NEW = { setNumber: "21330-1", condition: "new", qty: 1 };                              // 1 new copy, value unknown
// BE multi-copy mixed set: 1 new + 1 used copy; qty matches entries.length (aggregateFromEntries
// guarantees quantity === entries). No per-copy current_value (lazy) + no valueMap → the known row
// total ($200) splits evenly across its copies so nothing is dropped.
const MIXED = {
  setNumber: "71043-1", condition: "mixed", qty: 2, totalValue: 200,
  entries: [{ condition: "new" }, { condition: "usedcomplete" }],
};
// Manual multi-qty used set: no entries[] → materializeEntries synthesizes `qty` copies, all used.
const MANUAL_MULTI = { setNumber: "10256-1", currentValue: 300, condition: "used", qty: 3 };          // 3 used copies, $900

const ALL = [PURE_NEW, SEALED_NEW, PURE_USED, UNKNOWN_NEW, MIXED, MANUAL_MULTI];
// The all-copies figure the Overview "Total Sets" card sums (Σ qty) — the donut must reconcile to THIS.
const TOTAL_COPIES = ALL.reduce((n, s) => n + (Number(s.qty) || 1), 0); // 1+1+1+1+2+3 = 9

describe("conditionValueBuckets() — copy-grain New / Used", () => {
  it("value: new + used === portfolioValue (zero gap — the copy-grain invariant)", () => {
    const b = conditionValueBuckets(ALL);
    expect(b.new.value + b.used.value).toBeCloseTo(portfolioValue(ALL), 5);
    // Concrete partition: new = 100 + 75 + 0(unknown) + 100(mixed half) = 275;
    //                     used = 50 + 100(mixed half) + 900(manual×3) = 1050.
    expect(b.new.value).toBeCloseTo(275, 5);
    expect(b.used.value).toBeCloseTo(1050, 5);
    // Two buckets, not three — Mixed is gone as a value bucket.
    expect(b).not.toHaveProperty("mixed");
  });

  it("counts copies (not sets) and reconciles to the all-copies Total Sets figure (Σ qty)", () => {
    const b = conditionValueBuckets(ALL);
    expect(b.new.copies + b.used.copies).toBe(TOTAL_COPIES); // 9 — donut total === Total Sets
    expect(b.new.copies).toBe(4);  // PURE_NEW, SEALED_NEW, UNKNOWN_NEW, MIXED's new copy
    expect(b.used.copies).toBe(5); // PURE_USED, MIXED's used copy, MANUAL_MULTI's 3 copies
  });

  it("excludes unknown value from the known-count but still counts the copy", () => {
    const b = conditionValueBuckets(ALL);
    expect(b.new.copies).toBe(4);  // includes UNKNOWN_NEW's copy
    expect(b.new.known).toBe(3);   // …but UNKNOWN_NEW contributes no known value
  });

  it("splits a mixed set across New and Used — its value is not dropped from both (the old gap)", () => {
    const b = conditionValueBuckets([MIXED]);
    // no per-copy value + no cache → the known row total ($200) splits evenly across its 2 copies
    expect(b.new.value).toBeCloseTo(100, 5);
    expect(b.used.value).toBeCloseTo(100, 5);
    expect(b.new.copies).toBe(1);
    expect(b.used.copies).toBe(1);
    expect(b.new.value + b.used.value).toBeCloseTo(portfolioValue([MIXED]), 5); // 200, fully present
  });

  it("a mixed set with a condition-matched cache splits by the EXACT per-copy values, not evenly", () => {
    // BL covers both conditions at different prices: new $300, used $100.
    const valueMap = { "71043-1": { new: { amount: 300, basis: "sold" }, used: { amount: 100, basis: "sold" } } };
    const b = conditionValueBuckets([MIXED], valueMap);
    expect(b.new.value).toBeCloseTo(300, 5);  // the new copy's own condition-matched value
    expect(b.used.value).toBeCloseTo(100, 5); // the used copy's own condition-matched value
    expect(b.new.value + b.used.value).toBeCloseTo(portfolioValue([MIXED], valueMap), 5); // === 400
    expect(portfolioValue([MIXED], valueMap)).toBeCloseTo(400, 5);
  });

  it("a manual multi-qty set: whole value + all copies land in its single bucket (never mixed)", () => {
    const b = conditionValueBuckets([MANUAL_MULTI]);
    expect(b.used.value).toBeCloseTo(900, 5); // 3 × $300
    expect(b.used.copies).toBe(3);
    expect(b.new.value).toBe(0);
    expect(b.new.copies).toBe(0);
    expect(b.new.value + b.used.value).toBeCloseTo(portfolioValue([MANUAL_MULTI]), 5);
  });
});
