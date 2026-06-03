import { describe, it, expect } from "vitest";
import { reconcilePaidEdit, setCost, setPaidProvenance, buildPurchaseMap } from "./portfolio";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical paid edit (reconcilePaidEdit) — the fix that makes the detail-panel
// "Paid" edit actually move setCost. paidPrice is per-unit, but setCost reads the
// precomputed `totalPaid` FIRST, so editing paidPrice alone was a silent no-op on
// any set carrying totalPaid (every BrickEconomy import). reconcilePaidEdit
// re-derives the canonical (totalPaid + entries[].paid_price) from the new per-unit
// fields. Pure, no React. Mirrors what updateSet merges on a paidPrice/qty edit.
// ─────────────────────────────────────────────────────────────────────────────

// Simulate updateSet's merge: set the new per-unit paidPrice, then reconcile.
function editPaid(set, newPaidPrice) {
  const withEdit = { ...set, paidPrice: newPaidPrice };
  return { ...withEdit, ...reconcilePaidEdit(withEdit) };
}

describe("reconcilePaidEdit — the edit moves the canonical setCost", () => {
  it("BE set with stale totalPaid: editing paidPrice now moves setCost (was a no-op)", () => {
    // Before the fix: setCost reads totalPaid (400) and ignores the edited paidPrice.
    const set = { setNumber: "10300-1", paidPrice: 100, qty: 4, totalPaid: 400 };
    expect(setCost(set)).toBe(400);

    const edited = editPaid(set, 150);
    expect(edited.totalPaid).toBe(600); // 150 × 4 — totalPaid reconciled
    expect(setCost(edited)).toBe(600); // setCost now reflects the edit
  });

  it("manual set (no totalPaid): edit still works and totalPaid is now set", () => {
    const set = { setNumber: "21322-1", paidPrice: 50, qty: 2 };
    const edited = editPaid(set, 80);
    expect(edited.totalPaid).toBe(160);
    expect(setCost(edited)).toBe(160);
  });

  it("propagates the new per-unit paid into every entries[].paid_price", () => {
    const set = {
      setNumber: "75192-1",
      paidPrice: 4.99,
      qty: 3,
      totalPaid: 14.97,
      entries: [
        { paid_price: 4.99, condition: "new" },
        { paid_price: 4.99, condition: "new" },
        { paid_price: 4.99, condition: "used_good" },
      ],
    };
    const edited = editPaid(set, 10);
    expect(edited.totalPaid).toBe(30);
    expect(edited.entries.map((e) => e.paid_price)).toEqual([10, 10, 10]);
    // condition (and any other per-copy field) is preserved
    expect(edited.entries.map((e) => e.condition)).toEqual(["new", "new", "used_good"]);
  });

  it("omits entries in the patch when the set has none", () => {
    const patch = reconcilePaidEdit({ paidPrice: 20, qty: 1 });
    expect(patch).toEqual({ totalPaid: 20 });
    expect("entries" in patch).toBe(false);
  });

  it("qty edit also reconciles totalPaid (keeps per-unit × qty consistent)", () => {
    const set = { setNumber: "10300-1", paidPrice: 100, qty: 1, totalPaid: 100 };
    const withQty = { ...set, qty: 3 };
    const edited = { ...withQty, ...reconcilePaidEdit(withQty) };
    expect(edited.totalPaid).toBe(300);
    expect(setCost(edited)).toBe(300);
  });

  it("provenance reclassifies msrp → manual for free once paid ≠ retail", () => {
    const map = buildPurchaseMap([]); // no ledger purchases
    // paid == retail, no purchase → msrp placeholder
    const set = { setNumber: "10300-1", paidPrice: 200, qty: 1, totalPaid: 200, retailPrice: 200, totalRetailPrice: 200 };
    expect(setPaidProvenance(set, map).source).toBe("msrp");

    // user enters a real per-unit cost (≠ retail) → reconciled → reclassifies to manual
    const edited = editPaid(set, 150);
    const prov = setPaidProvenance(edited, map);
    expect(prov.amount).toBe(150);
    expect(prov.source).toBe("manual");
  });
});
