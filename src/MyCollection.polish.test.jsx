import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CARD_DEFS } from "./utils/collectionLayout";

// ─────────────────────────────────────────────────────────────────────────────
// Collection-page polish pass (cosmetic). Locks:
//   • performance-mode page subtitle removed (no subtitle in either mode)
//   • aggregate cards echo the per-set vocabulary — "Total Paid" / "Total MSRP"
//     (dropped "Cost Basis" / "MSRP Value"); "Collection Value" kept
//   • Set#/Name/Theme collapse into ONE stacked Identity cell; headers stay short (Img / Set / Cond)
//   • ROI cell renders as plain color-coded text like Gain (no shrunk fontSize-12 badge)
// ─────────────────────────────────────────────────────────────────────────────

// ── Pure const checks (no render) — items 2 + 3 labels ──────────────────────
describe("Collection polish — aggregate card labels echo Value / Paid / MSRP", () => {
  it("renames the Paid + MSRP cards (and keeps Collection Value)", () => {
    expect(CARD_DEFS.cost.label).toBe("Total Paid");        // was "Cost Basis"
    expect(CARD_DEFS.retailValue.label).toBe("Total MSRP"); // was "MSRP Value"
    expect(CARD_DEFS.value.label).toBe("Collection Value");  // kept (echoes "Value")
  });
});

describe("Collection polish — Set#/Name/Theme collapsed into one Identity column", () => {
  it("renders the fixed header order with a single 'Set' identity column (no separate Set Name / Theme)", () => {
    act(() => root.render(React.createElement(MyCollection)));
    const headers = [...container.querySelectorAll(".owned-table-scroll thead th")]
      .map(h => h.textContent.replace(/[↑↓]/g, "").trim());
    // [...data columns (thumb header blank), Actions]; identity header is the short "Set" label.
    // Phase 3 removed the leading checkbox column → drop only the trailing Actions (slice 0,-1).
    expect(headers.slice(0, -1)).toEqual(["", "Set", "MSRP", "Paid", "Value", "Cond", "Qty", "Gain", "ROI"]);
    expect(headers).not.toContain("Set Name");
    expect(headers).not.toContain("Theme");
  });
});

// ── Render checks — items 1 + 4 ─────────────────────────────────────────────
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C, LineChart: C, Line: C };
});
vi.mock("./SetDetailPanel", () => ({
  default: ({ item, onEdit }) => (item && onEdit ? React.createElement("button", { "data-testid": "mock-edit", onClick: onEdit }, "Edit") : null),
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

describe("Collection polish — no page subtitle in performance mode", () => {
  it("renders the Performance heading with no subtitle paragraph", () => {
    act(() => root.render(React.createElement(MyCollection, { mode: "performance" })));
    expect(container.textContent).not.toContain("Track collection value");
    expect(container.textContent).not.toContain("Browse, search, and manage");
    // the renamed aggregate cards still render (the const test locks the rename). The Theme
    // Performance table's cost column now reads "Paid" too (money-terminology unification).
    expect(container.textContent).toContain("Total Paid");
    expect(container.textContent).toContain("Total MSRP");
  });
});

describe("Collection polish — ROI numerals match the other numeric cells", () => {
  it("renders ROI as plain color-coded text (no shrunk fontSize-12 badge span), like Gain", () => {
    act(() => root.render(React.createElement(MyCollection)));
    const table = container.querySelector(".owned-table-scroll table");
    const headers = [...table.querySelectorAll("thead th")].map(h => h.textContent.replace(/[^A-Za-z]/g, ""));
    const roiTd = table.querySelector("tbody tr[data-index]").children[headers.indexOf("ROI")];
    const gainTd = table.querySelector("tbody tr[data-index]").children[headers.indexOf("Gain")];
    // The prior tinted badge wrapped ROI in a <span style="font-size:12px">; ROI is now plain text
    // in the cell — structurally identical to Gain (which has always been plain).
    expect(roiTd.querySelector("span")).toBeNull();
    expect(gainTd.querySelector("span")).toBeNull();
    expect(roiTd.style.textAlign).toBe("right"); // tdRight, same as the other numeric cells
  });
});
