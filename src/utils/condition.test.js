import { describe, it, expect } from "vitest";
import {
  conditionBucket,
  setConditionDisplay,
  conditionDisplayLabel,
  conditionDisplayColor,
} from "./condition";

// ─────────────────────────────────────────────────────────────────────────────
// Condition normalizer — the single read-time coalescing point (peer of
// value.zero-unknown.test.js / paidEdit.test.js). The headline guard below feeds
// EVERY known token (live + aspirational) through bucket → label and asserts each
// resolves to New/Used/Mixed — never a raw passthrough. That is what makes the
// "353 copies render as the literal 'usedasnew'" class impossible to recur.
// ─────────────────────────────────────────────────────────────────────────────

// Every condition token the app has ever stored or offered:
//   live (BrickEconomy):   new, usedasnew, usedcomplete, usedincomplete
//   aspirational (UI/map): sealed, used_as_new, used_good, used_acceptable, used, mixed
//   absent:                null / undefined
const KNOWN_TOKENS = [
  "new",
  "sealed",
  "usedasnew",
  "used_as_new",
  "usedcomplete",
  "usedincomplete",
  "used_good",
  "used_acceptable",
  "used",
  "mixed",
  null,
  undefined,
];

describe("conditionBucket — binary coalescing (matches former blCondition exactly)", () => {
  it("new / sealed / null / undefined / unknown → 'new' (valuation fallback)", () => {
    for (const t of ["new", "sealed", null, undefined, "", "weird"]) {
      expect(conditionBucket(t)).toBe("new");
    }
  });

  it("every used* variant (live + aspirational) → 'used'", () => {
    for (const t of [
      "usedasnew", "used_as_new", "usedcomplete", "usedincomplete",
      "used_good", "used_acceptable", "used",
    ]) {
      expect(conditionBucket(t)).toBe("used");
    }
  });

  it("the raw 'mixed' token is not a used* grade → 'new' (Mixed arises only via setConditionDisplay)", () => {
    expect(conditionBucket("mixed")).toBe("new");
  });
});

describe("GUARD — no token ever passes through raw (closes the 353-raw-token class)", () => {
  it("every known token → bucket ∈ {new,used} → label ∈ {New,Used}, never the raw string", () => {
    for (const t of KNOWN_TOKENS) {
      const bucket = conditionBucket(t);
      expect(["new", "used"]).toContain(bucket);
      const label = conditionDisplayLabel(bucket);
      expect(["New", "Used"]).toContain(label);
      expect(label).not.toBe(t); // raw token is never the rendered label
    }
  });

  it("the three display values map to fixed labels (and back-stop raw input to a bucket)", () => {
    expect(conditionDisplayLabel("new")).toBe("New");
    expect(conditionDisplayLabel("used")).toBe("Used");
    expect(conditionDisplayLabel("mixed")).toBe("Mixed");
    // even a stray raw token handed to the label fn resolves via its bucket, never raw:
    expect(conditionDisplayLabel("usedasnew")).toBe("Used");
    expect(conditionDisplayLabel("sealed")).toBe("New");
  });
});

describe("setConditionDisplay — bucketed, multi-copy aware", () => {
  it("uniform new entries → 'new'", () => {
    expect(setConditionDisplay({ entries: [{ condition: "new" }, { condition: "new" }] })).toBe("new");
  });

  it("used-grade variance buckets uniform → 'used', NOT mixed (false-Mixed avoided)", () => {
    expect(
      setConditionDisplay({
        entries: [{ condition: "usedasnew" }, { condition: "usedcomplete" }, { condition: "used_good" }],
      }),
    ).toBe("used");
  });

  it("a genuine new + used mix → 'mixed'", () => {
    expect(setConditionDisplay({ entries: [{ condition: "new" }, { condition: "usedasnew" }] })).toBe("mixed");
  });

  it("manual set (no entries) → bucket of set.condition, never mixed", () => {
    expect(setConditionDisplay({ condition: "used_good" })).toBe("used");
    expect(setConditionDisplay({ condition: "sealed" })).toBe("new");
    expect(setConditionDisplay({ condition: null })).toBe("new");
    expect(setConditionDisplay({})).toBe("new");
  });

  it("empty entries [] falls back to the set-level condition", () => {
    expect(setConditionDisplay({ entries: [], condition: "usedasnew" })).toBe("used");
  });

  it("entries with a null condition bucket to 'new' (matches the fallback)", () => {
    expect(setConditionDisplay({ entries: [{ condition: null }, { condition: "new" }] })).toBe("new");
  });
});

// Self-consistent data invariant (no private counts committed to the repo — same
// discipline as the paid snapshot test): build a synthetic collection, derive Mixed
// by bucketing, and assert the derivation is internally consistent — a set is Mixed
// IFF it has copies in BOTH the new and used buckets.
describe("setConditionDisplay — Mixed invariant (self-consistent, no real data baked in)", () => {
  const COLLECTION = [
    { setNumber: "a", entries: [{ condition: "new" }, { condition: "new" }] },                       // new
    { setNumber: "b", entries: [{ condition: "usedasnew" }, { condition: "usedcomplete" }] },         // used (grade variance)
    { setNumber: "c", entries: [{ condition: "new" }, { condition: "usedasnew" }] },                  // mixed
    { setNumber: "d", condition: "used_good" },                                                       // used (manual)
    { setNumber: "e", entries: [{ condition: "used_as_new" }, { condition: "used_acceptable" }, { condition: "usedincomplete" }] }, // used
    { setNumber: "f", entries: [{ condition: "new" }, { condition: "new" }, { condition: "used" }] }, // mixed
  ];

  const bucketsOf = (s) => new Set((s.entries ?? [{ condition: s.condition }]).map((e) => conditionBucket(e.condition)));

  it("display == derived (mixed IFF both buckets present among copies)", () => {
    for (const s of COLLECTION) {
      const b = bucketsOf(s);
      const expected = b.size > 1 ? "mixed" : [...b][0];
      expect(setConditionDisplay(s)).toBe(expected);
    }
  });

  it("Mixed count equals the count of both-bucket sets — derived, not hardcoded", () => {
    const mixedCount = COLLECTION.filter((s) => setConditionDisplay(s) === "mixed").length;
    const bothBucketCount = COLLECTION.filter((s) => bucketsOf(s).size > 1).length;
    expect(mixedCount).toBe(bothBucketCount);
  });
});

describe("conditionDisplayColor — Mixed is visually distinct (no reuse)", () => {
  it("new=green, used=amber, mixed=its own color", () => {
    const nu = conditionDisplayColor("new");
    const us = conditionDisplayColor("used");
    const mx = conditionDisplayColor("mixed");
    expect(nu).toBe("#5aa832");
    expect(us).toBe("#f59e0b");
    expect(mx).not.toBe(nu);
    expect(mx).not.toBe(us);
  });
});
