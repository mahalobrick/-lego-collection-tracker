import { describe, it, expect } from "vitest";
import { materializeEntries } from "./percopy";
import { asNumber } from "./formatting";

// ─────────────────────────────────────────────────────────────────────────────
// Quick Add form → per-copy acquired_date wiring.
//
// The Add form (MyCollection.jsx addSet) builds a manual set as HOLDING-LEVEL
// scalars — { ...lookupData, ...form, qty, paidPrice, ... } with NO entries[].
// Per-copy entries are synthesized on read by materializeEntries, which seeds
// each copy's acquired_date from the holding `acquiredDate` scalar (percopy.js).
// So the form's new acquired-date field flows to ALL copies exactly the way
// condition / notes / paid already do. These tests pin that contract end-to-end:
//   form field  → (…form)  → holding `acquiredDate`  → every copy's acquired_date.
// ─────────────────────────────────────────────────────────────────────────────

// Mirror of addSet's set construction, restricted to the per-copy-relevant fields
// (the explicit qty/paidPrice keys override the `...form` strings, as in addSet).
function buildAddedSet(form) {
  const qty = asNumber(form.qty) || 1;
  const paidPrice = asNumber(form.paidPrice);
  return { ...form, qty, paidPrice };
}

describe("Add form seeds per-copy acquired_date", () => {
  it("with a date → holding scalar carries it AND all copies' entries carry the ISO date", () => {
    const set = buildAddedSet({
      setNumber: "10300-1", condition: "new", qty: 2, paidPrice: "169.99", acquiredDate: "2026-06-20", notes: "",
    });
    // ...form carried the field to the holding scalar (the derived-from-entries source).
    expect(set.acquiredDate).toBe("2026-06-20");
    // …and the per-copy funnel seeds every synthesized copy from it.
    const entries = materializeEntries(set);
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.acquired_date)).toEqual(["2026-06-20", "2026-06-20"]);
  });

  it("without a date → entries get \"\" (no regression; back-fill stays un-dated)", () => {
    const set = buildAddedSet({
      setNumber: "21034-1", condition: "new", qty: 1, paidPrice: "39.99", acquiredDate: "", notes: "",
    });
    expect(materializeEntries(set).map(e => e.acquired_date)).toEqual([""]);
  });

  it("qty > 1 → every copy gets the same date", () => {
    const set = buildAddedSet({
      setNumber: "75192-1", condition: "new", qty: 5, paidPrice: "799.99", acquiredDate: "2025-12-01", notes: "",
    });
    const dates = materializeEntries(set).map(e => e.acquired_date);
    expect(dates).toHaveLength(5);
    expect(dates.every(d => d === "2025-12-01")).toBe(true);
  });
});
