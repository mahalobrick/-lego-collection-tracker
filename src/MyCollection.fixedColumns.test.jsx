import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Column restructure Pass 1 — configurability retired. The owned table is now a FIXED
// column set/order (no gear, no reorder, no show/hide, no resize). Locks:
//   • desktop renders the fixed columns in order, ALL visible (thumb + condition included),
//     with no column-gear button;
//   • header-click sort still works for every column (e.g. Set Name);
//   • mobile cards still render — and, because thumb + condition are now always visible,
//     the card shows the thumbnail + condition pill.
// Mirrors the MyCollection.rowActions/editDrawer god-module harness (same mocks + forced
// virtualizer). ConditionPill is stubbed to a detectable marker so the condition slot is observable.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C, LineChart: C, Line: C };
});
vi.mock("./SetDetailPanel", () => ({ default: () => null, openSetDetail: (n) => ({ setNumber: n }) }));
vi.mock("./WatchDetailPanel", () => ({ default: () => null }));
vi.mock("./TriValueCell", () => ({ default: () => null }));
vi.mock("./RowHoverCard", () => ({ default: () => null }));
vi.mock("./ConditionPill", () => ({ default: () => React.createElement("span", { "data-testid": "cond-pill" }, "Cond") }));
vi.mock("./utils/valueCache", async (io) => ({ ...(await io()), fetchValues: vi.fn(async () => ({})), peekValueCache: vi.fn(() => ({})) }));
vi.mock("./utils/brickset", async (io) => ({ ...(await io()), fetchBricksetSet: vi.fn(async () => null), fetchLegoThemes: vi.fn(async () => []), searchBricksetCatalog: vi.fn(async () => []) }));
vi.mock("./utils/rebrickable", () => ({ loadRebrickable: vi.fn(), rbLookupSet: vi.fn(), rbReady: () => false }));
vi.mock("./utils/bricklink-client", () => ({ fetchBrickLinkPriceGuide: vi.fn(), hasBrickLinkAuth: () => false }));
// Force both virtualizers to render every row/card in jsdom. Desktop uses useVirtualizer
// (count = visibleSets unless mobile), mobile uses useWindowVirtualizer — the component zeroes
// the idle one, so the same mock serves both.
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

// Two sets whose setNumber-asc order (default) differs from name-asc order, so a header sort is
// observable by which row lands first: setNumber asc → 10000 (Zebra); name asc → Apple (20000).
const BLOB = [
  { setNumber: "10000-1", name: "Zebra Set", theme: "Star Wars",
    quantity: 1, averagePaid: 100, totalPaid: 100, totalValue: 150, condition: "new",
    entries: [{ paid_price: 100, current_value: 150, condition: "new" }] },
  { setNumber: "20000-1", name: "Apple Set", theme: "City",
    quantity: 1, averagePaid: 200, totalPaid: 200, totalValue: 250, condition: "used",
    entries: [{ paid_price: 200, current_value: 250, condition: "used" }] },
];

let container, root;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(BLOB));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

const render = () => act(() => root.render(React.createElement(MyCollection)));
const q = (sel) => container.querySelector(sel);
const headerLabels = () => [...container.querySelectorAll("thead th")].map(t => t.textContent.replace(/[↑↓]/g, "").trim());
const thByLabel = (label) => [...container.querySelectorAll("thead th")].find(t => t.textContent.replace(/[↑↓]/g, "").trim() === label);

describe("MyCollection — fixed columns (desktop), gear retired (Pass 1)", () => {
  it("renders the fixed columns in order, all visible (thumb + condition), with no column gear", () => {
    render();
    const labels = headerLabels();
    // [checkbox, ...data columns..., Actions]
    expect(labels[0]).toBe("");                     // leading checkbox column
    expect(labels[labels.length - 1]).toBe("Actions"); // trailing fixed actions column
    expect(labels.slice(1, -1)).toEqual([
      "Img", "Set", "Set Name", "Theme", "MSRP", "Paid", "Value", "Cond", "Qty", "Gain", "ROI",
    ]);
    // thumb + condition are now always present
    expect(labels).toContain("Img");
    expect(labels).toContain("Cond");
    // gear is gone: no "Column visibility" toggle, no "Reset widths" button
    expect(container.querySelector('[title*="Column visibility"]')).toBeNull();
    expect([...container.querySelectorAll("button")].some(b => b.textContent.includes("Reset widths"))).toBe(false);
  });

  it("header-click sort still works (Set Name reorders the rows)", () => {
    render();
    const firstRowText = () => q('tr[data-index="0"]')?.textContent || "";
    expect(firstRowText()).toContain("10000");      // default: setNumber asc → Zebra (10000) first
    act(() => thByLabel("Set Name").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(firstRowText()).toContain("20000");      // name asc → Apple (20000) first
    expect(localStorage.getItem("blOwnedSort")).toBe("name");
  });
});

describe("MyCollection — mobile cards still render with thumb + condition", () => {
  let origWidth;
  beforeEach(() => { origWidth = window.innerWidth; window.innerWidth = 500; }); // <=600 → isMobile
  afterEach(() => { window.innerWidth = origWidth; });

  it("renders the card-list (no desktop table) showing the thumbnail + condition pill", () => {
    render();
    expect(q(".owned-cards-scroll"), "mobile card-list renders").toBeTruthy();
    expect(q("tr[data-index]"), "desktop table is not rendered on mobile").toBeNull();
    expect(q(".owned-cards-scroll img"), "thumbnail now shown (thumb always visible)").toBeTruthy();
    expect(q('.owned-cards-scroll [data-testid="cond-pill"]'), "condition pill now shown").toBeTruthy();
  });
});
