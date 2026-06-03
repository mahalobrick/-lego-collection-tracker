import { describe, it, expect } from "vitest";
import { reconcileConditionEdit, reconcilePaidEdit } from "./portfolio";
import { setConditionDisplay } from "./condition";
import { revalueBESet } from "./beSyncValues";
import { dedupHash } from "./exportBackup";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 Step 1 — reconcileConditionEdit (pure) + the round-trip proof that a
// persisted blob edit WOULD push: changing entries[] flips the dedupHash of the
// backup projection (A11 push-guard), so the debounced auto-push fires. Synthetic
// fixtures only — no real data. The companion reload smoke proves persistence.
// ─────────────────────────────────────────────────────────────────────────────

describe("reconcileConditionEdit — per-copy", () => {
  it("moves one copy → the set becomes Mixed", () => {
    const set = { setNumber: "10300-1", entries: [{ condition: "new" }, { condition: "new" }, { condition: "new" }] };
    const edited = { ...set, ...reconcileConditionEdit(set, "used", 2) };
    expect(edited.entries.map((e) => e.condition)).toEqual(["new", "new", "used"]);
    expect(setConditionDisplay(edited)).toBe("mixed");
  });

  it("never stores 'mixed' — it falls out of setConditionDisplay", () => {
    const set = { setNumber: "x", entries: [{ condition: "new" }, { condition: "new" }] };
    const edited = { ...set, ...reconcileConditionEdit(set, "used", 0) };
    expect(JSON.stringify(edited)).not.toContain("mixed");
    expect(setConditionDisplay(edited)).toBe("mixed");
  });
});

describe("reconcileConditionEdit — bulk + manual", () => {
  it("bulk sets every copy to the bucket → uniform", () => {
    const set = { setNumber: "x", entries: [{ condition: "new" }, { condition: "usedasnew" }] };
    const edited = { ...set, ...reconcileConditionEdit(set, "used") };
    expect(edited.entries.every((e) => e.condition === "used")).toBe(true);
    expect(setConditionDisplay(edited)).toBe("used");
  });

  it("manual set (no entries) patches set-level condition, with no entries key", () => {
    const patch = reconcileConditionEdit({ setNumber: "21322-1", condition: "new" }, "used");
    expect(patch).toEqual({ condition: "used" });
    expect("entries" in patch).toBe(false);
  });
});

describe("round-trip — a persisted edit would push (dedupHash flips)", () => {
  // Model the BE blob as persistBESetEdit writes it, wrapped the way the sync backup
  // projects it: brickEconomyNormalizedCollection → field 'brickEconomyNormalized'.
  const wrap = (blob) => ({ version: 4, brickEconomyNormalized: blob, settings: {} });
  const clone = (x) => JSON.parse(JSON.stringify(x));

  it("a per-copy condition edit changes the blob's dedupHash", () => {
    const before = [{ setNumber: "10300-1", entries: [{ condition: "new" }, { condition: "new" }] }];
    const after = before.map((s) => ({ ...s, ...reconcileConditionEdit(s, "used", 1) }));
    expect(dedupHash(wrap(after))).not.toBe(dedupHash(wrap(before)));
  });

  it("an identical blob hashes identically (guard isn't trivially always-different)", () => {
    const blob = [{ setNumber: "10300-1", entries: [{ condition: "new" }] }];
    expect(dedupHash(wrap(blob))).toBe(dedupHash(wrap(clone(blob))));
  });

  it("a paid true-up (reconcilePaidEdit on a BE set) also flips the hash", () => {
    const before = [{ setNumber: "75192-1", qty: 2, paidPrice: 100, totalPaid: 200, averagePaid: 100, entries: [{ paid_price: 100 }, { paid_price: 100 }] }];
    const after = before.map((s) => {
      const rec = { ...s, paidPrice: 150 };
      Object.assign(rec, reconcilePaidEdit(rec));
      // mirror persistBESetEdit's paid patch (paidPrice↔averagePaid alias + totalPaid + entries)
      return { ...s, paidPrice: 150, averagePaid: 150, totalPaid: rec.totalPaid, entries: rec.entries };
    });
    expect(after[0].totalPaid).toBe(300);
    expect(dedupHash(wrap(after))).not.toBe(dedupHash(wrap(before)));
  });
});

describe("revalueBESet — per-copy re-value math (locks the edit-time recompute)", () => {
  const d = { current_value_new: 160, current_value_used: 100, retired: true };

  it("uniform New → new figure × qty", () => {
    const s = { setNumber: "10300-1", qty: 2, entries: [{ condition: "new" }, { condition: "new" }] };
    expect(revalueBESet(s, d)).toEqual({ currentValue: 160, totalValue: 320 });
  });

  it("one copy flipped to Used → mixed sum (one used + rest new), avg per copy", () => {
    const s = { setNumber: "10300-1", qty: 2, entries: [{ condition: "new" }, { condition: "used" }] };
    // 160 + 100 = 260 total; 260 / 2 = 130 avg
    expect(revalueBESet(s, d)).toEqual({ currentValue: 130, totalValue: 260 });
  });

  it("uniform Used → used figure × qty", () => {
    const s = { setNumber: "10300-1", qty: 2, entries: [{ condition: "used" }, { condition: "used" }] };
    expect(revalueBESet(s, d)).toEqual({ currentValue: 100, totalValue: 200 });
  });

  it("no cache data → null (caller leaves value to the next value-sync)", () => {
    expect(revalueBESet({ setNumber: "x", qty: 1, entries: [{ condition: "new" }] }, undefined)).toBeNull();
  });

  it("cache with no usable figure → null", () => {
    const s = { setNumber: "x", qty: 1, entries: [{ condition: "new" }] };
    expect(revalueBESet(s, { current_value_new: 0, current_value_used: 0, retail_price_us: 0 })).toBeNull();
  });
});
