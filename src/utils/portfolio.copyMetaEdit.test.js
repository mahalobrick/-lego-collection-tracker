import { describe, it, expect } from "vitest";
import { reconcileCopyMetaEdit, setCost, setROI, setGain } from "./portfolio";

// ─────────────────────────────────────────────────────────────────────────────
// Per-copy / bulk PURE-METADATA edit (reconcileCopyMetaEdit) — the acquired_date / notes
// twin of reconcileConditionEdit, minus any aggregate. Locks the contract: per-copy edits
// one copy and leaves the others byte-exact (divergence preserved); bulk (no copyIndex)
// writes every copy; the patch is JUST `entries` (no value/cost/ROI re-derivation); a manual
// set (no entries[]) returns null so the caller keeps the holding-level path.
// ─────────────────────────────────────────────────────────────────────────────

const make = () => ({
  setNumber: "75313-1",
  qty: 3,
  totalValue: 900,
  totalPaid: 300,
  paidPrice: 100,
  roiPct: 200,
  entries: [
    { condition: "new", paid_price: 100, current_value: 300, acquired_date: "2020-01-01", notes: "a" },
    { condition: "new", paid_price: 100, current_value: 300, acquired_date: "2021-02-02", notes: "b" },
    { condition: "new", paid_price: 100, current_value: 300, acquired_date: "2022-03-03", notes: "c" },
  ],
});

describe("reconcileCopyMetaEdit() — per-copy metadata, no aggregate", () => {
  it("per-copy: changes only the targeted copy's field; the others pass through byte-exact", () => {
    const patch = reconcileCopyMetaEdit(make(), "acquired_date", "2025-12-25", 1);
    expect(patch.entries.map(e => e.acquired_date)).toEqual(["2020-01-01", "2025-12-25", "2022-03-03"]);
    // the other copies are byte-exact (object equality of the unchanged fields)
    expect(patch.entries[0]).toEqual({ condition: "new", paid_price: 100, current_value: 300, acquired_date: "2020-01-01", notes: "a" });
    expect(patch.entries[2]).toEqual({ condition: "new", paid_price: 100, current_value: 300, acquired_date: "2022-03-03", notes: "c" });
  });

  it("per-copy notes: same divergence-preserving behavior for the notes field", () => {
    const patch = reconcileCopyMetaEdit(make(), "notes", "minty, sealed", 0);
    expect(patch.entries.map(e => e.notes)).toEqual(["minty, sealed", "b", "c"]);
  });

  it("bulk (no copyIndex): writes the SAME value to EVERY copy", () => {
    const patch = reconcileCopyMetaEdit(make(), "acquired_date", "2024-07-04");
    expect(patch.entries.map(e => e.acquired_date)).toEqual(["2024-07-04", "2024-07-04", "2024-07-04"]);
  });

  it("the patch is JUST entries — no value/cost/ROI keys (pure metadata)", () => {
    const patch = reconcileCopyMetaEdit(make(), "notes", "x", 0);
    expect(Object.keys(patch)).toEqual(["entries"]);
    // and value/cost/ROI are unchanged when the patch is merged onto the set
    const edited = { ...make(), ...patch };
    expect(setCost(edited)).toBe(300);
    expect(setGain(edited)).toBe(setGain(make())); // value − cost unchanged
    expect(setROI(edited)).toBe(setROI(make()));
  });

  it("never mutates paid_price / current_value / condition on the edited copy", () => {
    const patch = reconcileCopyMetaEdit(make(), "acquired_date", "2030-01-01", 2);
    expect(patch.entries[2].paid_price).toBe(100);
    expect(patch.entries[2].current_value).toBe(300);
    expect(patch.entries[2].condition).toBe("new");
  });

  it("a manual set (no entries[]) returns null — caller keeps the holding-level path", () => {
    expect(reconcileCopyMetaEdit({ setNumber: "x", qty: 2 }, "notes", "z", 0)).toBeNull();
    expect(reconcileCopyMetaEdit({ setNumber: "x", entries: [] }, "acquired_date", "2020-01-01")).toBeNull();
  });
});
