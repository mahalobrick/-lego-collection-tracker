import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// MSRP coverage — WIRING test for the two seams that meet in the "MSRP Value" card:
//   (1) retailFor passes the CMF era-table rung (cmf: cmfEraRetail(n)), so a CMF set
//       whose Brickset series-bag (-0) retail is null still resolves to its era price
//       ($4.99 for Series 23 / 71034) and COUNTS as priced.
//   (2) the card's priced-coverage note reads against the FULL unique-set total
//       (sets.length), and the gap is LABELED in place — promo/GWP and unsourced
//       sets are disclosed (retailGapNote), not quietly dropped from the denominator.
// The unit math is covered in cmfRetail.test.js / portfolio.retail.test.js; this pins
// that MyCollection actually wires both at the render seam. Discriminating fixture:
//   71034-3 (CMF, no Brickset cache → era $4.99 → PRICED)
//   30001-1 (non-promo, unsourced → "not listed")
//   6490363-1 (7-digit promo/GWP → "promo (no MSRP)")
// → known 1, promo 1, notListed 1 of 3 → "1 of 3 priced · 1 promo (no MSRP) · 1 not
// listed". Deleting the cmf rung makes it "0 of 3"; using the promo-excluded
// denominator makes it "1 of 2". Either turns this RED.
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
  { setNumber: "30001-1", theme: "City", qty: 1 },              // unsourced, non-promo → "not listed"
  { setNumber: "6490363-1", theme: "Promotional", qty: 1 },     // 7-digit promo/GWP → "promo (no MSRP)"
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
  it("CMF era fallback prices 71034 · note uses the FULL set count (1 of 3) · gap is labeled", async () => {
    const txt = await render();
    // #1: denominator is the FULL unique-set total (3) — reverts the promo-excluded "1 of 2".
    expect(txt).toContain("1 of 3 priced");
    expect(txt).not.toContain("1 of 2"); // the promo-excluded denominator decision is gone
    // #2: the gap is LABELED in place, not silently dropped — the GWP and the unsourced set.
    expect(txt).toContain("1 promo (no MSRP)");
    expect(txt).toContain("1 not listed");
    // #3: 71034 still prices via the cmf era rung — else known would be 0 → "0 of 3".
    expect(txt).not.toContain("0 of 3");
  });
});
