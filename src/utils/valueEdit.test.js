import { describe, it, expect } from "vitest";
import { reconcileValueEdit, setValueProvenance, setGain, setROI } from "./portfolio";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical value edit (reconcileValueEdit) — the value twin of reconcilePaidEdit.
// It is what makes the holding-level "Value" edit actually move the value layer AND
// persist. For a BE set the field holds the AGGREGATE (ownedSetFromBlob loads
// currentValue from the blob's totalValue), and rawSetValue reads totalValue FIRST —
// so editing currentValue alone was invisible (totalValue shadowed it) and reverted
// on reload (no blob branch). reconcileValueEdit re-derives the canonical totalValue +
// currentValue + per-copy split + the roiPct hover snapshot. Pure, no React; mirrors
// what updateSet's BE+currentValue branch persists via persistBESetEdit.
// ─────────────────────────────────────────────────────────────────────────────

// Simulate updateSet's BE Value commit: reconcile the new aggregate onto the set.
const editValue = (set, newTotal) => ({ ...set, ...reconcileValueEdit(set, newTotal) });

describe("reconcileValueEdit — the edit moves the value layer and recomputes derived", () => {
  it("BE set: editing Value now moves totalValue (was shadowed → a no-op)", () => {
    // currentValue mirrors totalValue (the BE load convention); rawSetValue reads totalValue first.
    const set = { setNumber: "10300-1", qty: 1, currentValue: 300, totalValue: 300, totalPaid: 200 };
    expect(setValueProvenance(set).amount).toBe(300);

    const edited = editValue(set, 450);
    expect(edited.totalValue).toBe(450);
    expect(edited.currentValue).toBe(450); // kept == totalValue
    expect(setValueProvenance(edited).amount).toBe(450); // value layer now reflects the edit
  });

  it("a DECIMAL commits intact — \"49.50\" → 49.5, NOT 0 (the bug)", () => {
    const set = { setNumber: "21034-1", qty: 1, currentValue: 60, totalValue: 60, totalPaid: 40 };
    const edited = editValue(set, "49.50"); // string, as the input hands it over
    expect(edited.totalValue).toBe(49.5);
    expect(edited.currentValue).toBe(49.5);
    expect(setValueProvenance(edited).amount).toBe(49.5);
  });

  it("recomputes gain / ROI (derived) off the new value", () => {
    const set = { setNumber: "75313-1", qty: 1, currentValue: 1000, totalValue: 1000, totalPaid: 800 };
    expect(setGain(set)).toBe(200);
    expect(setROI(set)).toBeCloseTo(25, 5);

    const edited = editValue(set, 1200);
    expect(setGain(edited)).toBe(400); // 1200 − 800
    expect(setROI(edited)).toBeCloseTo(50, 5); // (1200 − 800)/800
    // roiPct hover snapshot tracks it too (RowHoverCard reads set.roiPct).
    expect(edited.roiPct).toBeCloseTo(50, 5);
  });

  it("multi-copy: distributes the new total per-copy so Σ entries.current_value === totalValue", () => {
    const set = {
      setNumber: "75192-1", qty: 2, currentValue: 2000, totalValue: 2000, totalPaid: 1600,
      entries: [
        { paid_price: 800, current_value: 1000, condition: "new" },
        { paid_price: 800, current_value: 1000, condition: "new" },
      ],
    };
    const edited = editValue(set, 2500);
    expect(edited.totalValue).toBe(2500);
    expect(edited.entries.map((e) => e.current_value)).toEqual([1250, 1250]); // 2500 / 2 copies
    const sum = edited.entries.reduce((s, e) => s + e.current_value, 0);
    expect(sum).toBe(edited.totalValue); // overlay invariant preserved
    // per-copy paid (and any other field) is untouched by a value edit
    expect(edited.entries.map((e) => e.paid_price)).toEqual([800, 800]);
  });

  it("roiPct is null when the set has no cost (÷0 guard), never NaN/Infinity", () => {
    const set = { setNumber: "30001-1", qty: 1, currentValue: 50, totalValue: 50, totalPaid: 0 };
    const edited = editValue(set, 75);
    expect(edited.roiPct).toBeNull();
    expect(edited.totalValue).toBe(75);
  });

  it("omits entries in the patch when the set has none", () => {
    const patch = reconcileValueEdit({ qty: 1, totalPaid: 100 }, 250);
    expect(patch).toEqual({ currentValue: 250, totalValue: 250, roiPct: 150 });
    expect("entries" in patch).toBe(false);
  });
});
