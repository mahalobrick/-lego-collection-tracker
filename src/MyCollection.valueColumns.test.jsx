import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Value-column density split — the Compact/Full toggle now controls the value COLUMN SET:
//   • Compact (default): one "Value" column (single figure) + MSRP/Paid in the hover card.
//   • Full: three separate, individually-sortable columns — MSRP | Paid | Value — replacing the
//     old three-up stacked cell.
//
// Pins the wiring end-to-end on the REAL component + REAL TriValueCell / RowHoverCard:
//   1. Full renders MSRP=retailFor, Paid=setCost, Value=setValueProvenance as three columns.
//   2. The three column figures MATCH the Compact hover-card figures (same reads).
//   3. Sort by Paid and by MSRP is numeric + null-aware (unknown sorts as 0 → bottom on desc).
//   4. Compact shows a single Value column (no MSRP/Paid columns) + the hover card.
//   5. The Value cell equals setValueProvenance(set, valueMap) — identical to Performance's value.
//
// God-module harness mirrors MyCollection.individualCopies.test.jsx (recharts / panels / network
// leaves / the virtualizer neutralized) — but KEEPS TriValueCell + RowHoverCard real so the figures
// render. Brickset cache is seeded so MSRP is a clean Brickset-sourced RRP (no "manual" marker).
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C, LineChart: C, Line: C };
});
vi.mock("./SetDetailPanel", () => ({ default: () => null, openSetDetail: (n) => ({ setNumber: n }) }));
vi.mock("./WatchDetailPanel", () => ({ default: () => null }));
vi.mock("./ConditionPill", () => ({ default: () => null }));
vi.mock("./utils/valueCache", async (io) => ({ ...(await io()), fetchValues: vi.fn(async () => ({})), peekValueCache: vi.fn(() => ({})) }));
// Keep the REAL brickset utils (getBricksetCache / bricksetRetailEntry) — only stub network leaves,
// so the seeded bricksetSetCache below resolves the Brickset MSRP rung.
vi.mock("./utils/brickset", async (io) => ({ ...(await io()), fetchBricksetSet: vi.fn(async () => null), fetchLegoThemes: vi.fn(async () => []), searchBricksetCatalog: vi.fn(async () => []) }));
vi.mock("./utils/rebrickable", () => ({ loadRebrickable: vi.fn(), rbLookupSet: vi.fn(), rbReady: () => false }));
vi.mock("./utils/bricklink-client", () => ({ fetchBrickLinkPriceGuide: vi.fn(), hasBrickLinkAuth: () => false }));
// Render every owned row in jsdom (0-height viewport → no measured rows otherwise).
vi.mock("@tanstack/react-virtual", () => {
  const vmock = ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 40, end: (index + 1) * 40, size: 40 })),
    getTotalSize: () => count * 40,
    measureElement: () => {},
  });
  return { useVirtualizer: vmock, useWindowVirtualizer: vmock };
});

import MyCollection from "./MyCollection";
import { money } from "./utils/formatting";
import { ownedSetFromBlob } from "./utils/beCollection";
import { setValueProvenance, setCost } from "./utils/portfolio";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// BE-blob fixtures. Distinct MSRP / Paid / Value so sort order is unambiguous; the third set has
// NO MSRP and $0 paid → those cells read "—" and must sort as 0 (null-aware). Non-CMF / non-curated /
// non-promo 5-digit numbers so only the seeded Brickset rung supplies MSRP.
const SETS = [
  { setNumber: "90011-1", name: "Alpha Castle", theme: "Creator", quantity: 2, averagePaid: 800, totalPaid: 1600, totalValue: 2000, retailPrice: 850, totalRetailPrice: 1700, roiPct: 25,
    entries: [{ paid_price: 800, current_value: 1000, condition: "new" }, { paid_price: 800, current_value: 1000, condition: "new" }] },
  { setNumber: "90022-1", name: "Beta Explorer", theme: "Icons", quantity: 1, averagePaid: 100, totalPaid: 100, totalValue: 300, retailPrice: 120, totalRetailPrice: 120, roiPct: 200,
    entries: [{ paid_price: 100, current_value: 300, condition: "new" }] },
  { setNumber: "90033-1", name: "Gamma Station", theme: "City", quantity: 1, averagePaid: 0, totalPaid: 0, totalValue: 50, retailPrice: 0, totalRetailPrice: 0, roiPct: null,
    entries: [{ paid_price: 0, current_value: 50, condition: "new" }] },
];

// Clean Brickset-sourced MSRP for the first two; Gamma intentionally absent → MSRP "—".
const BRICKSET = {
  brickset_90011: { data: { retail_price_us: 850 }, fetchedAt: "2026-01-01T00:00:00.000Z" },
  brickset_90022: { data: { retail_price_us: 120 }, fetchedAt: "2026-01-01T00:00:00.000Z" },
};

let container, root;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(SETS));
  localStorage.setItem("bricksetSetCache", JSON.stringify(BRICKSET));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

async function render(density) {
  if (density) localStorage.setItem("blOwnedRowDensity", density);
  await act(async () => { root.render(<MyCollection mode="collection" onBuyNow={() => {}} onSwitchTab={() => {}} />); });
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

const headerLabels = () => [...container.querySelectorAll("thead th")].map(th => th.textContent.replace(/[⠿\s↑↓]/g, ""));
const bodyRows = () => [...container.querySelectorAll("tbody tr[data-index]")];
const rowByName = (name) => bodyRows().find(r => r.textContent.includes(name));
const rowOrder = () => bodyRows().map(r => {
  for (const s of SETS) if (r.textContent.includes(s.name)) return s.name;
  return "?";
});
const cell = (row, testid) => row.querySelector(`[data-testid="${testid}"]`);
function clickHeader(label) {
  const th = [...container.querySelectorAll("thead th")].find(t => t.textContent.includes(label));
  return act(() => { th.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

describe("MyCollection — Full density: MSRP | Paid | Value as three columns", () => {
  it("renders three columns with retailFor / setCost / setValueProvenance figures", async () => {
    await render("full");
    const labels = headerLabels();
    expect(labels).toContain("MSRP");
    expect(labels).toContain("Paid");
    expect(labels).toContain("Value");

    const alpha = rowByName("Alpha Castle");
    expect(cell(alpha, "owned-msrp").textContent).toBe(money(850));   // retailFor (Brickset rung)
    expect(cell(alpha, "owned-paid").textContent).toBe(money(1600));  // setCost (totalPaid)
    expect(cell(alpha, "tri-market").textContent).toBe(money(2000));  // setValueProvenance

    // setCost / setValueProvenance parity with the cells (no parallel math at the cell).
    const set = ownedSetFromBlob(SETS[0]);
    expect(setCost(set)).toBe(1600);
    expect(setValueProvenance(set, {}).amount).toBe(2000);
  });

  it("unknown MSRP / $0 paid render '—' (null-aware, never a phantom $0)", async () => {
    await render("full");
    const gamma = rowByName("Gamma Station");
    expect(cell(gamma, "owned-msrp").textContent).toBe("—"); // no MSRP sourced
    expect(cell(gamma, "owned-paid").textContent).toBe("—"); // $0 / unrecorded paid
    expect(cell(gamma, "tri-market").textContent).toBe(money(50)); // value still known
  });
});

describe("MyCollection — Compact density: single Value column + hover card", () => {
  it("shows only the Value column (no MSRP/Paid columns)", async () => {
    await render("compact");
    const labels = headerLabels();
    expect(labels).toContain("Value");
    expect(labels).not.toContain("MSRP");
    expect(labels).not.toContain("Paid");
    // No split cells in the body.
    expect(container.querySelector('[data-testid="owned-msrp"]')).toBeNull();
    expect(container.querySelector('[data-testid="owned-paid"]')).toBeNull();
    // The Value figure is still present (TriValueCell compact).
    expect(cell(rowByName("Alpha Castle"), "tri-market").textContent).toBe(money(2000));
  });

  it("hover card carries MSRP / Paid / Value matching the Full columns", async () => {
    await render("compact");
    await act(async () => { rowByName("Alpha Castle").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    const hoverRetail = container.querySelector('[data-testid="hover-retail"]');
    const hoverPaid = container.querySelector('[data-testid="hover-paid"]');
    const hoverMarket = container.querySelector('[data-testid="hover-market"]');
    expect(hoverRetail).not.toBeNull(); // hover fired
    // Same figures the Full columns show (money(850) / money(1600) / money(2000)).
    expect(hoverRetail.textContent).toBe(money(850));
    expect(hoverPaid.textContent).toBe(money(1600));
    expect(hoverMarket.textContent).toBe(money(2000));
  });
});

describe("MyCollection — Full density: numeric, null-aware sort for the new columns", () => {
  it("sort by Paid orders numerically (desc then asc); $0 paid sorts as 0", async () => {
    await render("full");
    await clickHeader("Paid");                                   // first click → desc
    expect(rowOrder()).toEqual(["Alpha Castle", "Beta Explorer", "Gamma Station"]); // 1600, 100, 0
    await clickHeader("Paid");                                   // toggle → asc
    expect(rowOrder()).toEqual(["Gamma Station", "Beta Explorer", "Alpha Castle"]); // 0, 100, 1600
  });

  it("sort by MSRP orders numerically; unknown MSRP sorts as 0", async () => {
    await render("full");
    await clickHeader("MSRP");                                   // desc
    expect(rowOrder()).toEqual(["Alpha Castle", "Beta Explorer", "Gamma Station"]); // 850, 120, —(0)
    await clickHeader("MSRP");                                   // asc
    expect(rowOrder()).toEqual(["Gamma Station", "Beta Explorer", "Alpha Castle"]); // —(0), 120, 850
  });
});
