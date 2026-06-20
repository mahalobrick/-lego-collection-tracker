import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Per-copy breakdown is READ-ONLY (regression lock for the editing relocation).
//
// History: 91d721e added a per-copy PAID input here (alongside the per-copy condition
// toggle). Both have now MOVED to the MyCollection Edit window's "Individual copies"
// section — the single, deliberate edit surface. The SetDetailPanel breakdown DISPLAYS
// condition + paid + value with NO controls. The onEditCopy* props were removed from the
// signature, so passing them is inert. This pins the panel half: no editable input or
// toggle ever renders here; the per-copy paid shows as read-only money text.
//
// (The Edit-window relocation half — the section gating + edit→handler→persist routing —
// is pinned in MyCollection.individualCopies.test.jsx.)
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

describe("SetDetailPanel — per-copy breakdown is read-only", () => {
  it("renders NO per-copy edit controls (no paid input, no condition toggle)", () => {
    act(() => root.render(<SetDetailPanel item={ENTRIES_SET} onClose={() => {}} />));
    expect(q('[data-testid="copy-paid-edit"]').length).toBe(0);
    expect(q('[data-testid="copy-cond-edit"]').length).toBe(0);
  });

  it("ignores the legacy onEditCopy* props — still no controls (props removed from the signature)", () => {
    act(() => root.render(
      <SetDetailPanel item={ENTRIES_SET} onClose={() => {}} onEditCopyCondition={() => {}} onEditCopyPaid={() => {}} />,
    ));
    expect(q('[data-testid="copy-paid-edit"]').length).toBe(0);
    expect(q('[data-testid="copy-cond-edit"]').length).toBe(0);
  });

  it("still SHOWS the per-copy breakdown read-only — paid as money text, zero inputs in the panel", () => {
    act(() => root.render(<SetDetailPanel item={ENTRIES_SET} onClose={() => {}} />));
    expect(container.textContent).toContain("Per-Copy Breakdown");
    expect(container.textContent).toContain("$800"); // each copy's paid, rendered as text
    // The panel is now fully display-only: not a single editable field anywhere.
    expect(q("input").length).toBe(0);
  });
});
