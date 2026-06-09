import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Staleness indicator — WIRING test. The freshness math is unit-tested in
// freshness.test.js; this only pins that MyCollection's Overview header renders the
// "Values updated …" pill when valueMap carries an asOf, and hides it when there is
// no asOf (all BE-fallback / not loaded). Mirrors MyCollection.enrichmentSignal's
// god-module harness: mock the jsdom-hostile leaves + network data-sources.
// valueCache is mocked with controllable fns so we can drive valueMap's asOf.
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
vi.mock("./utils/valueCache", async (io) => ({ ...(await io()), fetchValues: vi.fn(), peekValueCache: vi.fn() }));
vi.mock("./utils/brickset", async (io) => ({ ...(await io()), fetchBricksetSet: vi.fn(async () => null), fetchLegoThemes: vi.fn(async () => []), searchBricksetCatalog: vi.fn(async () => []) }));
vi.mock("./utils/rebrickable", () => ({ loadRebrickable: vi.fn(), rbLookupSet: vi.fn(), rbReady: () => false }));
vi.mock("./utils/bricklink-client", () => ({ fetchBrickLinkPriceGuide: vi.fn(), hasBrickLinkAuth: () => false }));

import MyCollection from "./MyCollection";
import { fetchValues, peekValueCache } from "./utils/valueCache";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SET = { setNumber: "10497-1", qty: 1, condition: "new" };
const DAY = 24 * 60 * 60 * 1000;

let container, root;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("blOwnedSets", JSON.stringify([SET]));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

async function render() {
  await act(async () => { root.render(<MyCollection onBuyNow={() => {}} onSwitchTab={() => {}} />); });
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
}

describe("staleness pill — Overview header", () => {
  it("shows 'Values updated …' when valueMap carries an asOf", async () => {
    const recent = new Date(Date.now() - 2 * DAY).toISOString();
    const recordMap = { "10497-1": { new: { amount: 100, basis: "sold", lots: 5, asOf: recent }, used: null } };
    peekValueCache.mockReturnValue(recordMap);
    fetchValues.mockResolvedValue(recordMap);

    await render();
    expect(container.textContent).toContain("Values updated");
  });

  it("hides the pill when no asOf is present (all BE-fallback / empty map)", async () => {
    peekValueCache.mockReturnValue({});
    fetchValues.mockResolvedValue({}); // valueMap resolves to {} → valuesReady true, but asOf null

    await render();
    expect(container.textContent).not.toContain("Values updated");
  });
});
