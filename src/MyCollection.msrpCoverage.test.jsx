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
// that MyCollection actually wires it at the render seam. Discriminating fixture:
//   71034-3 (CMF, no Brickset cache → era $4.99 → SOURCED; headline $4.99)
//   30001-1 (non-promo, unsourced → "not listed")
//   6490363-1 (7-digit promo/GWP, curated estimated ARV $19.99 → promo·ARV, Option C)
// → "$4.99" headline · "1 sourced · 1 promo (ARV ~$19.99) · 1 not listed". Deleting the
// cmf rung makes it "0 sourced"; folding the ARV into the headline makes it "$24.98";
// dropping the promo→promo rule makes the GWP count sourced/estimated. Any turns this RED.
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

describe("MyCollection — MSRP Value card coverage wiring (Option C 4-segment)", () => {
  it("headline = sourced-only ($4.99 via cmf); 4-segment note labels sourced / promo·ARV / not-listed", async () => {
    const txt = await render();
    // #1 headline = SOURCED sum only — 71034's cmf era $4.99; NOT inflated by the GWP's $19.99 ARV.
    expect(txt).toContain("$4.99");
    expect(txt).not.toContain("$24.98"); // 4.99 + 19.99 — the ARV must not fold into the headline
    // #2 cmf era rung still prices 71034 as SOURCED (delete the rung → "0 sourced").
    expect(txt).toContain("1 sourced");
    expect(txt).not.toContain("0 sourced");
    // #3 the gap is LABELED in place: the 6490363 GWP now carries its researched ARV (promo·ARV), and
    //    the unsourced 30001 is "not listed" — neither silently dropped.
    expect(txt).toContain("1 promo (ARV");
    expect(txt).toContain("1 not listed");
    // #4 the old "N of M priced" denominator framing is gone (segments now sum to the total implicitly).
    expect(txt).not.toContain("1 of 3");
  });
});
