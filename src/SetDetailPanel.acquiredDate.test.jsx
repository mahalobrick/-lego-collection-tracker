import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Per-copy acquired_date renders in the breakdown (regression lock).
//
// Before: shortDate did new Date(value + "T00:00:00"), which returned null for the
// real "M/D/YYYY" stored format — so ~29 real per-copy dates rendered as NOTHING.
// Now: materializeEntries normalizes to ISO and shortDate parses locally, so the date
// shows — with the correct month (no UTC off-by-one on first-of-month values).
//
// Renders the REAL panel (history/BrickLink are self-guarding in jsdom), like
// SetDetailPanel.costbasis.test.jsx.
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

// Two copies: one legacy M/D/YYYY (first-of-month), one already-ISO (first-of-month).
const SET = {
  setNumber: "40557-1", name: "Defence of Hoth", theme: "Star Wars",
  quantity: 2, qty: 2, totalPaid: 60, totalValue: 120, currentValue: 120, averagePaid: 30,
  entries: [
    { condition: "new", paid_price: 30, current_value: 60, acquired_date: "12/1/2023" }, // M/D/YYYY
    { condition: "new", paid_price: 30, current_value: 60, acquired_date: "2024-03-01" }, // ISO
  ],
};

describe("SetDetailPanel — per-copy acquired_date renders with the correct month", () => {
  it("shows the M/D/YYYY date that was previously invisible (→ 'Dec 2023')", () => {
    act(() => root.render(<SetDetailPanel item={SET} onClose={() => {}} />));
    expect(container.textContent).toContain("Dec 2023");
  });

  it("shows an ISO first-of-month date with no UTC off-by-one (→ 'Mar 2024', not 'Feb 2024')", () => {
    act(() => root.render(<SetDetailPanel item={SET} onClose={() => {}} />));
    expect(container.textContent).toContain("Mar 2024");
    expect(container.textContent).not.toContain("Feb 2024"); // off-by-one would land here
    expect(container.textContent).not.toContain("Nov 2023"); // …or here for the Dec value
  });
});
