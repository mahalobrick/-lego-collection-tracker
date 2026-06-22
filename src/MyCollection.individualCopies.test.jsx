import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Edit window — "Individual copies" section (the relocated per-copy edit surface).
//
// Per-copy condition + paid editing moved OUT of SetDetailPanel (now read-only — see
// SetDetailPanel.copyPaid.test.jsx) INTO the MyCollection Edit side panel. This pins the
// Edit-window half end-to-end on the REAL component:
//   • the "Individual copies" section + a condition toggle and paid input PER copy render
//     ONLY for a multi-copy holding (>1 copy); a single-copy holding shows neither;
//   • a per-copy CONDITION edit routes through the existing editCopyCondition handler →
//     persists only that copy to the BE blob (divergence preserved) → the set reads Mixed;
//   • a per-copy PAID edit routes through the existing editCopyPaid handler → persists that
//     copy (others preserved), re-derives totalPaid / averagePaid / roiPct, and survives reload.
//
// Same god-module harness as MyCollection.holdingEdit.test.jsx: SetDetailPanel is stubbed to
// the single Edit button that opens the side panel (row → Edit → panel), recharts/virtual are
// neutralized, and the BE blob is the store the panel reads + persistBESetEdit writes.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C, LineChart: C, Line: C };
});
// SetDetailPanel is now read-only; the side panel (selectedSetIndex) opens ONLY via its onEdit
// callback. Stub it to a single Edit button so the test gets the row→Edit→panel path without the
// real (network-bound) panel — exactly as MyCollection.holdingEdit.test.jsx does.
vi.mock("./SetDetailPanel", () => ({
  default: ({ item, onEdit }) => (item && onEdit
    ? React.createElement("button", { "data-testid": "mock-edit", onClick: onEdit }, "Edit")
    : null),
  openSetDetail: (n) => ({ setNumber: n }),
}));
vi.mock("./WatchDetailPanel", () => ({ default: () => null }));
vi.mock("./TriValueCell", () => ({ default: () => null }));
vi.mock("./RowHoverCard", () => ({ default: () => null }));
vi.mock("./ConditionPill", () => ({ default: () => null }));
vi.mock("./utils/valueCache", async (io) => ({ ...(await io()), fetchValues: vi.fn(async () => ({})), peekValueCache: vi.fn(() => ({})) }));
vi.mock("./utils/brickset", async (io) => ({ ...(await io()), fetchBricksetSet: vi.fn(async () => null), fetchLegoThemes: vi.fn(async () => []), searchBricksetCatalog: vi.fn(async () => []) }));
vi.mock("./utils/rebrickable", () => ({ loadRebrickable: vi.fn(), rbLookupSet: vi.fn(), rbReady: () => false }));
vi.mock("./utils/bricklink-client", () => ({ fetchBrickLinkPriceGuide: vi.fn(), hasBrickLinkAuth: () => false }));
// Render every owned row in jsdom (0-height viewport → no measured rows otherwise).
vi.mock("@tanstack/react-virtual", () => {
  const vmock = ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 40, size: 40 })),
    getTotalSize: () => count * 40,
    measureElement: () => {},
  });
  return { useVirtualizer: vmock, useWindowVirtualizer: vmock };
});

import MyCollection from "./MyCollection";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Multi-copy BE holding: 2 real copies, both New, $800 paid each ($1,600 total), $2,000 value.
const MULTI = [{
  setNumber: "75313-1", name: "AT-AT", theme: "Star Wars",
  quantity: 2, averagePaid: 800, totalPaid: 1600, totalValue: 2000,
  retailPrice: 850, totalRetailPrice: 1700, roiPct: 25, msrp: null,
  entries: [
    { paid_price: 800, current_value: 1000, condition: "new" },
    { paid_price: 800, current_value: 1000, condition: "new" },
  ],
}];

// Single-copy BE holding: one copy.
const SINGLE = [{
  setNumber: "75192-1", name: "Millennium Falcon", theme: "Star Wars",
  quantity: 1, averagePaid: 700, totalPaid: 700, totalValue: 900,
  retailPrice: 800, totalRetailPrice: 800, roiPct: 28, msrp: null,
  entries: [{ paid_price: 700, current_value: 900, condition: "new" }],
}];

// Multi-copy holding whose copies DIVERGE on acquired_date + notes (the receipt scenario).
const DIVERGE = [{
  setNumber: "75313-1", name: "AT-AT", theme: "Star Wars",
  quantity: 2, averagePaid: 800, totalPaid: 1600, totalValue: 2000,
  retailPrice: 850, totalRetailPrice: 1700, roiPct: 25, msrp: null,
  entries: [
    { paid_price: 800, current_value: 1000, condition: "new", acquired_date: "2020-01-01", notes: "first" },
    { paid_price: 800, current_value: 1000, condition: "new", acquired_date: "2023-05-05", notes: "second" },
  ],
}];

let container, root;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

const q = (sel) => container.querySelector(sel);
const qa = (sel) => [...container.querySelectorAll(sel)];
const blob = () => JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection"));

function seed(b) { localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(b)); }

// Open the holding-level Edit side panel: render → click row 0 → click the (stubbed) Edit button.
function openEditPanel() {
  act(() => root.render(React.createElement(MyCollection)));
  // Phase 3: detail-open is the eye icon (a plain row click now selects). The mock SetDetailPanel
  // renders its Edit button once the eye sets detailSet.
  const eye = q('[data-testid="row-action-view"]');
  expect(eye, "row view (eye) action should render").toBeTruthy();
  act(() => eye.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const edit = q('[data-testid="mock-edit"]');
  expect(edit, "Edit button should appear after opening detail").toBeTruthy();
  act(() => edit.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

// Click a New/Used button inside the copyIndex-th per-copy condition toggle.
function clickCopyCond(copyIndex, label) {
  const toggle = qa('[data-testid="copy-cond-edit"]')[copyIndex];
  expect(toggle, `copy ${copyIndex} condition toggle`).toBeTruthy();
  const btn = [...toggle.querySelectorAll("button")].find(b => b.textContent.trim() === label);
  expect(btn, `${label} button on copy ${copyIndex}`).toBeTruthy();
  act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

// Commit a value into the copyIndex-th per-copy paid input (uncontrolled → blur via focusout).
function commitCopyPaid(copyIndex, value) {
  const input = qa('[data-testid="copy-paid-edit"]')[copyIndex];
  expect(input, `copy ${copyIndex} paid input`).toBeTruthy();
  act(() => {
    input.value = value;
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

// A CONTROLLED input carries React's value tracker, whose wrapped setter swallows a direct
// `input.value = x` (the tracker updates, so the 'input' event reads as "no change" → onChange
// never fires). Go through the native prototype setter to leave the tracker stale → change detected.
function setNativeValue(input, value) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
}
// Per-copy date is a CONTROLLED <input type="date"> → commits on change ('input' event → onChange).
// Notes is uncontrolled → commits on blur (focusout), like paid.
function commitCopyDate(copyIndex, value) {
  const input = qa('[data-testid="copy-date-edit"]')[copyIndex];
  expect(input, `copy ${copyIndex} date input`).toBeTruthy();
  act(() => { setNativeValue(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
function commitCopyNotes(copyIndex, value) {
  const input = qa('[data-testid="copy-notes-edit"]')[copyIndex];
  expect(input, `copy ${copyIndex} notes input`).toBeTruthy();
  act(() => { input.value = value; input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
}
// Bulk "Set all copies": date commits on change, notes commits on blur.
function commitBulkDate(value) {
  const input = q('[data-testid="holding-date-edit"]');
  expect(input, "bulk date input").toBeTruthy();
  act(() => { setNativeValue(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
function commitBulkNotes(value) {
  const input = q('[data-testid="holding-notes-edit"]');
  expect(input, "bulk notes input").toBeTruthy();
  act(() => { input.value = value; input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
}

describe("Edit window — Individual copies section gating", () => {
  it("MULTI-copy: renders the Individual section with a condition toggle + paid input per copy", () => {
    seed(MULTI);
    openEditPanel();
    expect(q('[data-testid="individual-copies"]'), "Individual section renders for >1 copy").toBeTruthy();
    expect(qa('[data-testid="copy-cond-edit"]').length).toBe(2);
    expect(qa('[data-testid="copy-paid-edit"]').length).toBe(2);
    // Seeded per-copy paids show via defaultValue.
    expect(qa('[data-testid="copy-paid-edit"]')[0].value).toBe("800");
    expect(qa('[data-testid="copy-paid-edit"]')[1].value).toBe("800");
  });

  it("SINGLE-copy: no Individual section, no per-copy controls", () => {
    seed(SINGLE);
    openEditPanel();
    expect(q('[data-testid="individual-copies"]')).toBeNull();
    expect(qa('[data-testid="copy-cond-edit"]').length).toBe(0);
    expect(qa('[data-testid="copy-paid-edit"]').length).toBe(0);
    // The holding-level fields still render (Set all copies).
    expect(q('[data-testid="holding-paid-edit"]')).toBeTruthy();
  });
});

describe("Edit window — per-copy edits route through the existing handlers + persist", () => {
  it("per-copy CONDITION edit persists only that copy (divergence preserved) → the set reads Mixed", () => {
    seed(MULTI);
    openEditPanel();
    clickCopyCond(0, "Used"); // flip copy 0 → Used; copy 1 stays New
    expect(blob()[0].entries[0].condition).toBe("used");
    expect(blob()[0].entries[1].condition).toBe("new"); // the OTHER copy is untouched
    // The derived bulk condition recomputes to Mixed (nothing "mixed" is stored — it falls out
    // of setConditionDisplay from the disagreeing copies) and the Mixed indicator now renders.
    expect(q('[data-testid="bulk-cond-mixed"]'), "bulk Condition shows derived Mixed").toBeTruthy();
  });

  it("per-copy PAID edit (decimal) persists that copy, preserves the other, recomputes totals + survives reload", () => {
    seed(MULTI);
    openEditPanel();
    commitCopyPaid(1, "950.50"); // set copy 1 → $950.50; copy 0 stays $800
    const b = blob()[0];
    expect(b.entries[1].paid_price).toBe(950.5); // decimal intact on the targeted copy
    expect(b.entries[0].paid_price).toBe(800);   // divergence preserved
    expect(b.totalPaid).toBe(1750.5);            // Σ per-copy recomputed (800 + 950.50)
    expect(b.averagePaid).toBe(875.25);          // totalPaid / copies
    expect(b.roiPct).toBeCloseTo(14.25, 1);      // gain snapshot re-derived off the new cost

    // Reload: tear down + remount from localStorage, reopen the panel — the decimals read back.
    act(() => root.unmount());
    root = createRoot(container);
    openEditPanel();
    expect(qa('[data-testid="copy-paid-edit"]')[0].value).toBe("800");
    expect(qa('[data-testid="copy-paid-edit"]')[1].value).toBe("950.5");
  });
});

describe("Edit window — per-copy acquired-date + notes (pure metadata)", () => {
  it("MULTI-copy renders a date + notes input per copy; SINGLE-copy renders neither", () => {
    seed(MULTI);
    openEditPanel();
    expect(qa('[data-testid="copy-date-edit"]').length).toBe(2);
    expect(qa('[data-testid="copy-notes-edit"]').length).toBe(2);

    act(() => root.unmount()); root = createRoot(container);
    seed(SINGLE);
    openEditPanel();
    expect(qa('[data-testid="copy-date-edit"]').length).toBe(0);
    expect(qa('[data-testid="copy-notes-edit"]').length).toBe(0);
  });

  it("per-copy DATE edit persists only that copy (other byte-exact), with NO value/ROI recompute, + survives reload", () => {
    seed(MULTI);
    openEditPanel();
    commitCopyDate(0, "2025-03-14"); // copy 0 acquired; copy 1 untouched
    const b = blob()[0];
    expect(b.entries[0].acquired_date).toBe("2025-03-14");
    expect(b.entries[1]).toEqual({ paid_price: 800, current_value: 1000, condition: "new" }); // byte-exact, no acquired_date
    // Pure metadata: value / cost / ROI aggregates are unchanged.
    expect(b.totalValue).toBe(2000); expect(b.currentValue ?? 2000).toBe(2000);
    expect(b.totalPaid).toBe(1600); expect(b.averagePaid).toBe(800); expect(b.roiPct).toBe(25);
    expect(b.entries[0].current_value).toBe(1000); expect(b.entries[0].paid_price).toBe(800);

    act(() => root.unmount()); root = createRoot(container);
    openEditPanel();
    expect(qa('[data-testid="copy-date-edit"]')[0].value).toBe("2025-03-14");
    expect(qa('[data-testid="copy-date-edit"]')[1].value).toBe(""); // the other copy stayed empty
  });

  it("per-copy NOTES edit persists only that copy (other byte-exact), with NO value/ROI recompute, + survives reload", () => {
    seed(MULTI);
    openEditPanel();
    commitCopyNotes(1, "minty, sealed");
    const b = blob()[0];
    expect(b.entries[1].notes).toBe("minty, sealed");
    expect(b.entries[0]).toEqual({ paid_price: 800, current_value: 1000, condition: "new" }); // byte-exact, no notes
    expect(b.totalValue).toBe(2000); expect(b.totalPaid).toBe(1600); expect(b.roiPct).toBe(25);

    act(() => root.unmount()); root = createRoot(container);
    openEditPanel();
    expect(qa('[data-testid="copy-notes-edit"]')[1].value).toBe("minty, sealed");
    expect(qa('[data-testid="copy-notes-edit"]')[0].value).toBe("");
  });
});

describe("Edit window — bulk 'Set all copies' date + notes (the revert-on-reload fix)", () => {
  it("bulk DATE writes EVERY copy + the holding scalar, no value/ROI change, + survives reload", () => {
    seed(MULTI);
    openEditPanel();
    commitBulkDate("2024-12-25");
    const b = blob()[0];
    expect(b.entries.map(e => e.acquired_date)).toEqual(["2024-12-25", "2024-12-25"]); // every copy
    expect(b.acquiredDate).toBe("2024-12-25"); // holding scalar rides along (column freshness)
    expect(b.totalValue).toBe(2000); expect(b.totalPaid).toBe(1600); expect(b.roiPct).toBe(25);

    act(() => root.unmount()); root = createRoot(container);
    openEditPanel();
    expect(q('[data-testid="holding-date-edit"]').value).toBe("2024-12-25"); // shared → shows the value
  });

  it("bulk NOTES writes EVERY copy + survives reload", () => {
    seed(MULTI);
    openEditPanel();
    commitBulkNotes("warehouse A, bin 3");
    const b = blob()[0];
    expect(b.entries.map(e => e.notes)).toEqual(["warehouse A, bin 3", "warehouse A, bin 3"]);
    expect(b.notes).toBe("warehouse A, bin 3");
    expect(b.totalValue).toBe(2000); expect(b.roiPct).toBe(25);

    act(() => root.unmount()); root = createRoot(container);
    openEditPanel();
    expect(q('[data-testid="holding-notes-edit"]').value).toBe("warehouse A, bin 3");
  });

  it("DIVERGENT copies → both bulk inputs render BLANK (overwrite-all intent)", () => {
    seed(DIVERGE);
    openEditPanel();
    expect(q('[data-testid="holding-date-edit"]').value).toBe("");  // dates differ → blank
    expect(q('[data-testid="holding-notes-edit"]').value).toBe(""); // notes differ → blank
    // A bulk edit from the divergent (blank) state flattens every copy.
    commitBulkDate("2026-01-01");
    expect(blob()[0].entries.map(e => e.acquired_date)).toEqual(["2026-01-01", "2026-01-01"]);
    expect(q('[data-testid="holding-date-edit"]').value).toBe("2026-01-01"); // now shared → shows it
  });
});
