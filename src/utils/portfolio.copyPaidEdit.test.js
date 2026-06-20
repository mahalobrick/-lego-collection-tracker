import { describe, it, expect } from "vitest";
import { reconcileCopyPaidEdit, setCost, setROI } from "./portfolio";

// ─────────────────────────────────────────────────────────────────────────────
// Per-copy paid edit (reconcileCopyPaidEdit) — the per-copy twin of reconcilePaidEdit.
// Locks the paid-truth contract: editing ONE copy's paid leaves the others UNCHANGED
// (divergence preserved — the receipt scenario), and re-derives the holding's paid
// aggregates from entries (totalPaid = Σ per-copy, paidPrice/averagePaid = avg, roiPct),
// so setCost / setROI — which read totalPaid FIRST — track the edit live.
// ─────────────────────────────────────────────────────────────────────────────

const make = () => ({
  setNumber: "75313-1",
  qty: 3,
  totalValue: 900,
  totalPaid: 300,   // 3 × $100 uniform to start
  paidPrice: 100,
  entries: [
    { condition: "new", paid_price: 100 },
    { condition: "new", paid_price: 100 },
    { condition: "new", paid_price: 100 },
  ],
});

describe("reconcileCopyPaidEdit() — per-copy paid, no flatten", () => {
  it("changes only the targeted copy; the others are untouched (divergence preserved)", () => {
    const patch = reconcileCopyPaidEdit(make(), 0, 250);
    expect(patch.entries.map(e => e.paid_price)).toEqual([250, 100, 100]);
  });

  it("re-derives totalPaid (Σ per-copy) and paidPrice/averagePaid (avg) from entries", () => {
    const patch = reconcileCopyPaidEdit(make(), 0, 250);
    expect(patch.totalPaid).toBe(450);            // 250 + 100 + 100
    expect(patch.paidPrice).toBeCloseTo(150, 5);  // 450 / 3
    expect(patch.averagePaid).toBeCloseTo(150, 5);
  });

  it("recomputes roiPct off the stored value and the new cost", () => {
    const patch = reconcileCopyPaidEdit(make(), 0, 250);
    expect(patch.roiPct).toBeCloseTo(100, 5);     // (900 − 450) / 450 × 100
  });

  it("the recomputed totalPaid flows through setCost → setROI (live ROI tracks the edit)", () => {
    const before = make();
    expect(setCost(before)).toBe(300);
    const edited = { ...before, ...reconcileCopyPaidEdit(before, 0, 250) };
    expect(setCost(edited)).toBe(450);            // setCost reads the new totalPaid first
    // no valueMap → setROI uses rawSetValue (totalValue 900): (900 − 450) / 450 = 100%
    expect(setROI(edited)).toBeCloseTo(100, 5);
  });

  it("a manual set (no entries[]) returns null — caller keeps the holding-level paid path", () => {
    expect(reconcileCopyPaidEdit({ setNumber: "x", qty: 2, paidPrice: 50 }, 0, 99)).toBeNull();
  });

  it("alias-coalesces a sibling's legacy paid (Paid/paid) so totalPaid never undercounts", () => {
    const set = {
      setNumber: "y", qty: 2, totalValue: 400,
      entries: [{ condition: "new", Paid: 80 }, { condition: "new", paid_price: 120 }],
    };
    const patch = reconcileCopyPaidEdit(set, 1, 200);
    expect(patch.entries[0].Paid).toBe(80);       // sibling's legacy alias untouched
    expect(patch.totalPaid).toBe(280);            // 80 (alias-read) + 200, not 0 + 200
  });
});
