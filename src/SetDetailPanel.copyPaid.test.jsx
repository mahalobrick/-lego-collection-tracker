import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Per-copy paid input — render contract (regression lock for the gate fix).
//
// 91d721e added per-copy paid editing, but its render gate keyed on detailSet.source
// === "BrickEconomy" — and openSetDetail hands the panel the raw blob row, which has
// NO `source` field — so the gate was always false and the input never rendered. The
// gate now keys on entries-bearing (Array.isArray(detailSet.entries)), the same sets
// where editCopyPaid is valid. This pins the panel half: when per-copy paid editing is
// enabled (onEditCopyPaid provided), the input renders + is wired ALONGSIDE the per-copy
// condition control; otherwise the paid figure stays read-only.
// ─────────────────────────────────────────────────────────────────────────────

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

// Entries-bearing (BE-shaped) set — two real per-copy rows, $800 paid each.
const ENTRIES_SET = {
  setNumber: "75313-1", name: "AT-AT", theme: "Star Wars",
  quantity: 2, qty: 2, totalPaid: 1600, totalValue: 2000, currentValue: 2000, averagePaid: 800,
  entries: [
    { condition: "new", paid_price: 800, current_value: 1000 },
    { condition: "new", paid_price: 800, current_value: 1000 },
  ],
};

const q = (sel) => [...container.querySelectorAll(sel)];

describe("SetDetailPanel — per-copy paid input render contract", () => {
  it("renders an editable paid input per copy when onEditCopyPaid is provided, alongside the condition control", () => {
    act(() => root.render(
      <SetDetailPanel item={ENTRIES_SET} onClose={() => {}} onEditCopyCondition={() => {}} onEditCopyPaid={() => {}} />,
    ));
    // Was 0 under the source-gate regression; now one input per copy.
    expect(q('[data-testid="copy-paid-edit"]').length).toBe(2);
    // The per-copy condition control still renders alongside (both show together for BE sets).
    expect(q('[data-testid="copy-cond-edit"]').length).toBe(2);
  });

  it("the paid input is wired to onEditCopyPaid(copyIndex, amount) on commit", () => {
    const calls = [];
    act(() => root.render(
      <SetDetailPanel item={ENTRIES_SET} onClose={() => {}} onEditCopyPaid={(i, amt) => calls.push([i, amt])} />,
    ));
    const input = q('[data-testid="copy-paid-edit"]')[0];
    act(() => {
      input.value = "950";
      // React delegates onBlur via the bubbling focusout event.
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(calls).toEqual([[0, 950]]); // first copy, committed numeric amount
  });

  it("is ABSENT (paid stays read-only) when onEditCopyPaid is not provided — the no-entries/manual path", () => {
    act(() => root.render(<SetDetailPanel item={ENTRIES_SET} onClose={() => {}} />));
    expect(q('[data-testid="copy-paid-edit"]').length).toBe(0);
  });
});
