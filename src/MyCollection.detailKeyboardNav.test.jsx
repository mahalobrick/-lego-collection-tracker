import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Detail-panel keyboard nav — MyCollection owns the list + detail state, so the window keydown
// listener lives here (not in SetDetailPanel). Locks:
//   • Esc closes the detail (detailSet → null) when the Edit drawer is NOT open;
//   • ← / → open the previous / next set by the VISIBLE (sorted/filtered) order, clamped (no wrap);
//   • suppressed while the Edit drawer is open (selectedSetIndex set) or focus is in an input.
// SetDetailPanel is stubbed to surface detailSet.setNumber; openSetDetail mocked to {setNumber}.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C, LineChart: C, Line: C };
});
vi.mock("./SetDetailPanel", () => ({
  default: ({ item }) => (item ? React.createElement("div", { "data-testid": "detail-open" }, item.setNumber || "") : null),
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

const mk = (sn, name) => ({
  setNumber: sn, name, theme: "Star Wars",
  quantity: 1, averagePaid: 100, totalPaid: 100, totalValue: 150,
  entries: [{ paid_price: 100, current_value: 150, condition: "new" }],
});
// Default sort is setNumber asc → visible order is [10000, 20000, 30000].
const BLOB = [mk("20000-1", "Beta"), mk("10000-1", "Alpha"), mk("30000-1", "Gamma")];

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
const rows = () => [...container.querySelectorAll("tr[data-index]")];
const rowByText = (txt) => rows().find(r => r.textContent.includes(txt));
const detailNum = () => q('[data-testid="detail-open"]')?.textContent ?? null;
const press = (key) => act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
const openDetail = (setNum) => {
  const btn = rowByText(setNum).querySelector('[data-testid="row-action-view"]');
  act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

describe("MyCollection — detail keyboard nav (Esc + ←/→)", () => {
  it("Esc closes the open detail (detailSet → null)", () => {
    render();
    openDetail("20000");
    expect(detailNum()).toBe("20000-1");
    press("Escape");
    expect(detailNum(), "Esc resets detailSet").toBeNull();
  });

  it("ArrowRight opens the NEXT set, ArrowLeft the PREVIOUS, by visible (sorted) order", () => {
    render();
    openDetail("20000");                 // middle of [10000, 20000, 30000]
    expect(detailNum()).toBe("20000-1");
    press("ArrowRight");
    expect(detailNum(), "→ next").toBe("30000-1");
    press("ArrowLeft");
    expect(detailNum(), "← previous").toBe("20000-1");
    press("ArrowLeft");
    expect(detailNum(), "← previous again").toBe("10000-1");
  });

  it("clamps at both ends — no wrap", () => {
    render();
    openDetail("10000");                 // first
    press("ArrowLeft");
    expect(detailNum(), "ArrowLeft at first → no change").toBe("10000-1");
    openDetail("30000");                 // last
    press("ArrowRight");
    expect(detailNum(), "ArrowRight at last → no change").toBe("30000-1");
  });

  it("does nothing while the Edit drawer is open (Esc and arrows suppressed)", () => {
    render();
    openDetail("20000");
    // Open the Edit drawer via the row's edit action (detail stays open underneath).
    act(() => rowByText("20000").querySelector('[data-testid="row-action-edit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(q('[data-testid="edit-drawer"]'), "edit drawer open").toBeTruthy();
    press("ArrowRight");
    expect(detailNum(), "arrows suppressed while editing").toBe("20000-1");
    press("Escape");
    expect(detailNum(), "Esc suppressed while editing").toBe("20000-1");
    expect(q('[data-testid="edit-drawer"]'), "edit drawer still open").toBeTruthy();
  });

  it("does not hijack arrows when focus is in an input", () => {
    render();
    openDetail("20000");
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(detailNum(), "arrow ignored while typing in an input").toBe("20000-1");
    input.remove();
  });
});
