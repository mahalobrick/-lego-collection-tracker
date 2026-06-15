import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// MSRP coverage — WIRING test for the two fixes that meet in the "MSRP Value" card:
//   (1) retailFor passes the CMF era-table rung (cmf: cmfEraRetail(n)), so a CMF set
//       whose Brickset series-bag (-0) retail is null still resolves to its era price
//       ($4.99 for Series 23 / 71034) and COUNTS as priced.
//   (2) the card's "N of M sets priced" note uses the PRICEABLE denominator
//       (portfolioRetail.priceable = total minus promo/GWP), not sets.length.
// The unit math is covered in cmfRetail.test.js / portfolio.retail.test.js; this pins
// that MyCollection actually wires both at the render seam. Discriminating fixture:
//   71034-3 (CMF, no Brickset cache → era $4.99 → PRICED)
//   30001-1 (non-promo, unsourced → priceable but unpriced)
//   6490363-1 (7-digit promo/GWP → excluded from the denominator)
// → known 1, priceable 2 → "1 of 2 sets priced". Deleting the cmf rung makes it
// "0 of 2"; reverting the denominator to sets.length makes it "1 of 3". Either RED.
// Mirrors the god-module harness of MyCollection.staleness.test.jsx.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C, LineChart: C, Line: C };
});
vi.mock("./SetDetailPanel", () => ({ default: () => null, openSetDetail: () => {} }));
vi.mock("./WatchDetailPanel", () => ({ default: () => null }));
vi.mock("./TriValueCell", () => ({ default: () => null }));
vi.mock("./RowHoverCard", () => ({ default: () => null }));
vi.mock("./ConditionPill", () => ({ default: () => null }));
vi.mock("./utils/valueCache", async (io) => ({ ...(await io()), fetchValues: vi.fn(async () => ({})), peekValueCache: vi.fn(() => ({})) }));
// Keep the REAL brickset utils (getBricksetCache, bricksetRetailEntry, cmfSeriesRetailTargets) — only
// stub the network leaves, so the Brickset cache stays empty and 71034 has NO -0 retail (era fallback fires).
vi.mock("./utils/brickset", async (io) => ({ ...(await io()), fetchBricksetSet: vi.fn(async () => null), fetchLegoThemes: vi.fn(async () => []), searchBricksetCatalog: vi.fn(async () => []) }));
vi.mock("./utils/rebrickable", () => ({ loadRebrickable: vi.fn(), rbLookupSet: vi.fn(), rbReady: () => false }));
vi.mock("./utils/bricklink-client", () => ({ fetchBrickLinkPriceGuide: vi.fn(), hasBrickLinkAuth: () => false }));

import MyCollection from "./MyCollection";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SETS = [
  { setNumber: "71034-3", theme: "Minifigure Series", qty: 1 }, // CMF S23: no -0 retail → era $4.99 → PRICED
  { setNumber: "30001-1", theme: "City", qty: 1 },              // unsourced, non-promo → priceable, unpriced
  { setNumber: "6490363-1", theme: "Promotional", qty: 1 },     // 7-digit promo/GWP → out of the denominator
];

let container, root;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("blOwnedSets", JSON.stringify(SETS));
  // Make the (default-hidden) "MSRP Value" card visible; the merge re-adds the other defaults.
  localStorage.setItem("blCollectionItems", JSON.stringify([{ key: "retailValue", type: "card", visible: true }]));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

async function render() {
  await act(async () => { root.render(<MyCollection onBuyNow={() => {}} onSwitchTab={() => {}} />); });
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
  return container.textContent;
}

describe("MyCollection — MSRP Value card coverage wiring", () => {
  it("CMF era fallback prices 71034 AND the note uses the promo-excluded denominator (1 of 2)", async () => {
    const txt = await render();
    // #1: 71034 priced via the cmf rung → counts as 1 priced (would be 0 if the cmf wiring were dropped).
    // #2: promo/GWP excluded from the denominator → "of 2", never "of 3".
    expect(txt).toContain("1 of 2 sets priced");
    expect(txt).not.toContain("1 of 3"); // would appear if the denominator were sets.length
    expect(txt).not.toContain("0 of 2"); // would appear if the cmf rung were not wired
  });
});
