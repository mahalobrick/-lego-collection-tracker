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
  const row = q('tr[data-index="0"]');
  expect(row, "owned row should render").toBeTruthy();
  act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const edit = q('[data-testid="mock-edit"]');
  expect(edit, "Edit button should appear after selecting a row").toBeTruthy();
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
