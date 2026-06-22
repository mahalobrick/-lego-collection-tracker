import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Column restructure Pass 2 — Set#/Name/Theme collapse into ONE stacked Identity cell. Locks:
//   • the identity cell renders Set Name + Set # + Theme; a "Retired" pill shows ONLY when set.retired;
//   • the now-headerless identity sorts live in the Sort menu (Set Name / Set # / Theme, both ways);
//   • ROI header-sort is NUMERIC (a +ROI row sorts above a −ROI row) — was a string mis-sort;
//   • mobile cards are unaffected (still show name + set # + theme).
// Mirrors the established god-module harness. ConditionPill/TriValueCell stubbed (identity uses neither).
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
vi.mock("./ConditionPill", () => ({ default: () => null }));
vi.mock("./utils/valueCache", async (io) => ({ ...(await io()), fetchValues: vi.fn(async () => ({})), peekValueCache: vi.fn(() => ({})) }));
vi.mock("./utils/brickset", async (io) => ({ ...(await io()), fetchBricksetSet: vi.fn(async () => null), fetchLegoThemes: vi.fn(async () => []), searchBricksetCatalog: vi.fn(async () => []) }));
vi.mock("./utils/rebrickable", () => ({ loadRebrickable: vi.fn(), rbLookupSet: vi.fn(), rbReady: () => false }));
vi.mock("./utils/bricklink-client", () => ({ fetchBrickLinkPriceGuide: vi.fn(), hasBrickLinkAuth: () => false }));
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

const mk = (o) => ({ quantity: 1, averagePaid: o.totalPaid, entries: [{ paid_price: o.totalPaid, current_value: o.totalValue, condition: "new" }], ...o });

let container, root;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

const q = (sel) => container.querySelector(sel);
const renderWith = (blob) => { localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(blob)); act(() => root.render(React.createElement(MyCollection))); };
const rows = () => [...container.querySelectorAll("tr[data-index]")];
const rowByText = (txt) => rows().find(r => r.textContent.includes(txt));
const firstRowText = () => q('tr[data-index="0"]')?.textContent || "";
const thByLabel = (label) => [...container.querySelectorAll("thead th")].find(t => t.textContent.replace(/[↑↓]/g, "").trim() === label);
const sortSelect = () => [...container.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "name:desc"));
const selectSort = (value) => { const s = sortSelect(); act(() => { s.value = value; s.dispatchEvent(new Event("change", { bubbles: true })); }); };

describe("MyCollection — stacked Identity cell", () => {
  it("renders Set Name + Set # + Theme in one cell, with a Retired pill only when set.retired", () => {
    renderWith([
      mk({ setNumber: "75313-1", name: "AT-AT", theme: "Star Wars", totalPaid: 800, totalValue: 1000, retired: false }),
      mk({ setNumber: "10497-1", name: "Galaxy Explorer", theme: "Space", totalPaid: 100, totalValue: 120, retired: true }),
    ]);
    // Active set: name + set# + theme all present in the single identity cell, no Retired pill.
    const active = rowByText("AT-AT");
    const idCell = active.querySelector('[data-testid="owned-identity"]');
    expect(idCell, "identity cell renders").toBeTruthy();
    expect(idCell.textContent).toContain("AT-AT");      // Set Name
    expect(idCell.textContent).toContain("75313-1");    // Set #
    expect(idCell.textContent).toContain("Star Wars");  // Theme
    expect(active.querySelector('[data-testid="retired-pill"]'), "no Retired pill on an active set").toBeNull();
    // Retired set: the pill shows.
    const retired = rowByText("Galaxy Explorer");
    expect(retired.querySelector('[data-testid="retired-pill"]'), "Retired pill on a retired set").toBeTruthy();
  });
});

describe("MyCollection — Sort menu carries the identity sorts", () => {
  beforeEach(() => {
    renderWith([
      mk({ setNumber: "10000-1", name: "Apple", theme: "Aardvark", totalPaid: 100, totalValue: 150 }),
      mk({ setNumber: "20000-1", name: "Zebra", theme: "Zoo", totalPaid: 200, totalValue: 250 }),
    ]);
  });
  it("sorts by Set Name both directions", () => {
    selectSort("name:asc");  expect(firstRowText()).toContain("Apple");
    selectSort("name:desc"); expect(firstRowText()).toContain("Zebra");
  });
  it("sorts by Set # both directions", () => {
    selectSort("setNumber:asc");  expect(firstRowText()).toContain("10000");
    selectSort("setNumber:desc"); expect(firstRowText()).toContain("20000");
  });
  it("sorts by Theme both directions", () => {
    selectSort("theme:asc");  expect(firstRowText()).toContain("Apple"); // Aardvark
    selectSort("theme:desc"); expect(firstRowText()).toContain("Zebra"); // Zoo
  });
});

describe("MyCollection — ROI header sort is numeric", () => {
  it("a +ROI row sorts above a −ROI row on ROI header click (was a broken string sort)", () => {
    renderWith([
      mk({ setNumber: "10000-1", name: "LowROI",  theme: "X", totalPaid: 100, totalValue: 90 }),   // ROI −10%, default first (setNumber asc)
      mk({ setNumber: "90000-1", name: "HighROI", theme: "Y", totalPaid: 100, totalValue: 300 }),  // ROI +200%, default second
    ]);
    expect(firstRowText()).toContain("10000"); // default setNumber asc → LowROI first
    act(() => thByLabel("ROI").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    // Numeric desc → +200% above −10%. A string sort of "+200.0%" vs "−10.0%" would NOT do this.
    expect(firstRowText()).toContain("90000");
    expect(firstRowText()).toContain("HighROI");
  });
});

describe("MyCollection — mobile cards unaffected", () => {
  let origWidth;
  beforeEach(() => { origWidth = window.innerWidth; window.innerWidth = 500; });
  afterEach(() => { window.innerWidth = origWidth; });
  it("the card still shows Set Name + Set # + Theme", () => {
    renderWith([mk({ setNumber: "75313-1", name: "AT-AT", theme: "Star Wars", totalPaid: 800, totalValue: 1000 })]);
    const cards = q(".owned-cards-scroll");
    expect(cards, "mobile card-list renders").toBeTruthy();
    expect(q("tr[data-index]"), "desktop table not rendered on mobile").toBeNull();
    expect(cards.textContent).toContain("AT-AT");
    expect(cards.textContent).toContain("75313-1");
    expect(cards.textContent).toContain("Star Wars");
  });
});
