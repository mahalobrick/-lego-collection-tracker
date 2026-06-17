import { describe, it, expect } from "vitest";
import { conditionValueBuckets, portfolioValue } from "./portfolio";

// ─────────────────────────────────────────────────────────────────────────────
// New / Used / Mixed value partition (Overview gap fix).
//
// THE BUG this pins: the Overview's New/Used value cards bucketed on the RAW
// set-level condition string —
//     new  = s.condition === "new" || s.condition === "sealed"
//     used = s.condition.startsWith("used")
// so a BE multi-copy set with both new and used copies (stored set-level
// condition "mixed", via setConditionDisplay in beCollection.js) matched
// NEITHER filter. Its value vanished from New+Used — the ~$3,388 gap vs the
// Collection Value headline.
//
// THE INVARIANT (pinned below): the three buckets are total + disjoint over
// setConditionDisplay's 'new'|'used'|'mixed', so
//     new.value + used.value + mixed.value === portfolioValue(sets)
// by construction — no set's value can fall between buckets.
// ─────────────────────────────────────────────────────────────────────────────

const PURE_NEW   = { setNumber: "10300-1", currentValue: 100, condition: "new",          qty: 1 }; // new
const SEALED_NEW = { setNumber: "75313-1", currentValue: 75,  condition: "sealed",       qty: 1 }; // sealed → new
const PURE_USED  = { setNumber: "10221-1", currentValue: 50,  condition: "usedcomplete", qty: 1 }; // used
const UNKNOWN_NEW = { setNumber: "21330-1", condition: "new", qty: 1 };                            // new, value unknown
// A BE multi-copy set: one new copy + one used copy. beCollection.js stores set-level
// condition = setConditionDisplay(item) === "mixed" (the exact shape that made the old raw
// `!s.condition`/`startsWith("used")` filters drop it from BOTH New and Used).
const MIXED = {
  setNumber: "71043-1",
  condition: "mixed",
  totalValue: 200,
  entries: [{ condition: "new" }, { condition: "usedcomplete" }],
};

const ALL = [PURE_NEW, SEALED_NEW, PURE_USED, UNKNOWN_NEW, MIXED];

describe("conditionValueBuckets()", () => {
  it("partitions value into New / Used / Mixed that sum to the Collection Value headline", () => {
    const b = conditionValueBuckets(ALL);
    // THE pinned invariant: New + Used + Mixed === portfolioValue (value-known total).
    expect(b.new.value + b.used.value + b.mixed.value).toBeCloseTo(portfolioValue(ALL), 5);
    // Concrete partition: new = 100 + 75 + 0(unknown), used = 50, mixed = 200.
    expect(b.new.value).toBeCloseTo(175, 5);
    expect(b.used.value).toBeCloseTo(50, 5);
    expect(b.mixed.value).toBeCloseTo(200, 5);
  });

  it("lands a mixed (new+used copies) set in Mixed — not dropped from both buckets", () => {
    const b = conditionValueBuckets(ALL);
    expect(b.mixed.count).toBe(1);
    expect(b.mixed.value).toBeCloseTo(200, 5); // the mixed set's value, present (was the gap)

    // The exact regression: the OLD raw-condition filters dropped the mixed set's value.
    const rawNew  = ALL.filter(s => !s.condition || s.condition === "new" || s.condition === "sealed");
    const rawUsed = ALL.filter(s => s.condition && s.condition.startsWith("used"));
    const rawSplit = portfolioValue(rawNew) + portfolioValue(rawUsed);
    expect(rawSplit).toBeLessThan(portfolioValue(ALL));            // old way leaked $200
    expect(portfolioValue(ALL) - rawSplit).toBeCloseTo(200, 5);    // …exactly the mixed set
  });

  it("counts every set into exactly one bucket (counts sum to sets.length)", () => {
    const b = conditionValueBuckets(ALL);
    expect(b.new.count + b.used.count + b.mixed.count).toBe(ALL.length);
    expect(b.new.count).toBe(3);  // PURE_NEW, SEALED_NEW, UNKNOWN_NEW
    expect(b.used.count).toBe(1);
    expect(b.mixed.count).toBe(1);
  });

  it("excludes unknown value from the known-count but keeps it in the set count", () => {
    const b = conditionValueBuckets(ALL);
    expect(b.new.count).toBe(3);  // includes UNKNOWN_NEW
    expect(b.new.known).toBe(2);  // …but only PURE_NEW + SEALED_NEW have a value
  });
});
