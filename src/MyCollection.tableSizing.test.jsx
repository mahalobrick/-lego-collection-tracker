import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — owned-table sizing on both axes. Structural locks (jsdom has no layout
// engine, so pixel behavior — no clipping / fills viewport — is verified live; these
// pin the FIX SHAPE so a regression to the clipping/fixed-cap model is caught):
//   • vertical: the scroll box no longer uses the fixed maxHeight:560 cap (now viewport-derived)
//   • horizontal: table is width:<px columns> + minWidth:100% (stretch-or-scroll), in a
//     min-width:0 grid item so a wide column set scrolls instead of blowing out the grid
//   • numeric width floor: a stale-narrow persisted width is raised to the widened default so
//     money/percent values can't ellipsis-clip ("+71…" / "−$25.…"); a wider user choice is kept
// Reuses the god-module harness of MyCollection.holdingEdit.test.jsx.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C, LineChart: C, Line: C };
});
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

const BLOB = [{
  setNumber: "75313-1", name: "AT-AT", theme: "Star Wars",
  quantity: 1, averagePaid: 800, totalPaid: 800, totalValue: 1000,
  retailPrice: 850, totalRetailPrice: 850, roiPct: 25, msrp: null,
  entries: [{ paid_price: 800, current_value: 1000, condition: "new" }],
}];

let container, root;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(BLOB));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

const q = (sel) => container.querySelector(sel);
const render = () => act(() => root.render(React.createElement(MyCollection)));
const thByText = (txt) => [...container.querySelectorAll("thead th")].find(h => h.textContent.includes(txt));

describe("MyCollection — vertical fill height (Phase 2)", () => {
  it("the scroll box drops the fixed maxHeight:560 for a viewport-derived cap", () => {
    render();
    const table = q(".owned-table-scroll table");
    const box = table.parentElement; // inner scroll box (overflow:auto + viewport maxHeight)
    expect(box.style.maxHeight).not.toBe("560px"); // the old fixed cap is gone
    if (box.style.maxHeight) expect(box.style.maxHeight).toMatch(/vh/); // viewport-relative when stored
  });
});

describe("MyCollection — horizontal scroll-not-clip model (Phase 2)", () => {
  it("table is sized to its columns (px width) and stretches via minWidth:100% — not width:100%", () => {
    render();
    const table = q(".owned-table-scroll table");
    expect(table.style.minWidth).toBe("100%");        // stretch to fill when it fits
    expect(table.style.width).toMatch(/^\d+px$/);     // px column total → overflows + scrolls when crowded
  });
  it("the scroll wrapper is a min-width:0 grid item (a wide table scrolls, doesn't blow out the grid)", () => {
    render();
    const table = q(".owned-table-scroll table");
    const outer = table.parentElement.parentElement;  // the grid-item wrapper
    expect(outer.style.minWidth).toMatch(/^0(px)?$/);
  });
});

describe("MyCollection — numeric columns never clip (width-floor migration)", () => {
  it("raises a stale-narrow persisted numeric width up to the widened default", () => {
    // An OLD saved config with the pre-fix narrow widths that clipped "+71.4%" / "−$25.50".
    localStorage.setItem("blOwnedColWidths", JSON.stringify({ roi: 50, gain: 60, value: 70 }));
    render();
    expect(parseInt(thByText("ROI").style.width, 10)).toBeGreaterThanOrEqual(92);   // floored from 50
    expect(parseInt(thByText("Gain").style.width, 10)).toBeGreaterThanOrEqual(104);  // floored from 60
  });
  it("preserves a user's WIDER numeric width (Math.max, not overwrite)", () => {
    localStorage.setItem("blOwnedColWidths", JSON.stringify({ roi: 200 }));
    render();
    expect(parseInt(thByText("ROI").style.width, 10)).toBe(200);
  });
});
