import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Edit-drawer DRAFT model — fold-and-persist-once (the clobber-safety the refactor buys).
//
// The old commit-on-blur model replayed a wrapper per field; two edits that both rebuild entries[]
// from the SAME stale base would erase each other, and a value edit couldn't see a paid edit's new
// cost. The draft model buffers every edit and SAVE folds the changed fields over ONE working copy
// via the pure reconcilers (threading `work`), persisting once. This pins:
//   • paid + condition in one session → BOTH land (no entries[] clobber);
//   • paid + value together → value's ROI is computed off the NEW paid (cross-field dep);
//   • MSRP dirty-safe is exercised in holdingEdit.test;
//   • Cancel / X with a dirty draft → confirm("Discard…"); discard leaves the set byte-unchanged;
//   • a nothing-changed Save is a no-op (no write at all).
// Same god-module harness as holdingEdit/individualCopies: SetDetailPanel stubbed to the Edit button.
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

// Single-copy BE set with a BE value cache so a condition flip re-values (revalueFromCache). The cache
// is keyed by the stripped number; new/used figures let a New→Used flip move the value measurably.
const BLOB = [{
  setNumber: "10300-1", name: "Eiffel Tower", theme: "Icons",
  quantity: 1, averagePaid: 100, totalPaid: 100, paidPrice: 100,
  currentValue: 300, totalValue: 300, retailPrice: 120, roiPct: 200, msrp: null,
  condition: "new",
  entries: [{ paid_price: 100, current_value: 300, condition: "new" }],
}];
const BE_CACHE = { "10300": { data: { current_value_new: 300, current_value_used: 200, retail_price_us: 120 } } };

let container, root, confirmSpy;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(BLOB));
  localStorage.setItem("brickEconomySetCache", JSON.stringify(BE_CACHE));
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const q = (sel) => container.querySelector(sel);
const blob = () => JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection"));

function openEditPanel() {
  act(() => root.render(React.createElement(MyCollection)));
  const eye = q('[data-testid="row-action-view"]');
  expect(eye, "row view (eye) action").toBeTruthy();
  act(() => eye.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const edit = q('[data-testid="mock-edit"]');
  expect(edit, "Edit button after opening detail").toBeTruthy();
  act(() => edit.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
function commit(testid, value) {
  const input = q(`[data-testid="${testid}"]`);
  expect(input, `${testid} renders`).toBeTruthy();
  act(() => { input.value = value; input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
}
function clickBulkCondition(label) {
  const toggle = [...container.querySelectorAll("label")].find(l => l.textContent.includes("Condition"));
  const btn = [...toggle.querySelectorAll("button")].find(b => b.textContent.trim() === label);
  expect(btn, `bulk ${label} button`).toBeTruthy();
  act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
function clickButton(text) {
  const btn = [...container.querySelectorAll("button")].find(b => b.textContent.trim() === text);
  expect(btn, `button "${text}"`).toBeTruthy();
  act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
const pressEsc = () => act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

describe("Edit draft — fold-and-persist-once (clobber safety)", () => {
  it("edits BOTH paid AND condition in one session → Save → BOTH persist (no entries[] clobber)", () => {
    openEditPanel();
    commit("holding-paid-edit", "150");   // paid: 100 → 150
    clickBulkCondition("Used");           // condition: new → used (touches entries[] too)
    clickButton("Save");
    const b = blob()[0];
    // A naive replay would let one entries[] rebuild erase the other; the fold keeps BOTH.
    expect(b.totalPaid).toBe(150);                 // paid edit landed
    expect(b.paidPrice).toBe(150);
    expect(b.entries[0].paid_price).toBe(150);     // …on the copy
    expect(b.entries[0].condition).toBe("used");   // condition edit landed on the SAME copy
    expect(b.totalValue).toBe(200);                // Used re-value from the BE cache (200, not the New 300)
  });

  it("edits paid AND value together → Save → value's ROI reflects the NEW paid (cross-field dep)", () => {
    openEditPanel();
    commit("holding-paid-edit", "50");    // new cost basis 50
    commit("holding-value-edit", "200");  // new value 200
    clickButton("Save");
    const b = blob()[0];
    expect(b.totalPaid).toBe(50);
    expect(b.totalValue).toBe(200);
    // roiPct must be off the NEW paid (50), not the stale 100: (200 − 50)/50 × 100 = 300.
    expect(b.roiPct).toBeCloseTo(300, 5);
  });

  it("nothing-changed Save is a no-op — the blob is byte-identical (no write)", () => {
    openEditPanel();
    const before = JSON.stringify(blob());
    clickButton("Save"); // opened + saved with zero edits
    expect(JSON.stringify(blob())).toBe(before);
    expect(q('[data-testid="edit-drawer"]'), "drawer closed by Save").toBeNull();
  });

  it("Cancel with a DIRTY draft → confirm('Discard…'); on discard the set is byte-unchanged", () => {
    openEditPanel();
    const before = JSON.stringify(blob());
    commit("holding-paid-edit", "999"); // make it dirty
    clickButton("Cancel");
    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?");
    expect(q('[data-testid="edit-drawer"]'), "drawer closed on discard").toBeNull();
    expect(JSON.stringify(blob()), "discarded edit never persisted").toBe(before);
  });

  it("drawer Esc with a DIRTY draft → confirm + discard (no persist)", () => {
    openEditPanel();
    const before = JSON.stringify(blob());
    commit("holding-value-edit", "777");
    pressEsc();
    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved changes?");
    expect(q('[data-testid="edit-drawer"]'), "Esc closed the drawer").toBeNull();
    expect(JSON.stringify(blob())).toBe(before);
  });

  it("a CLEAN Cancel does not prompt (no confirm) and just closes", () => {
    openEditPanel();
    clickButton("Cancel");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(q('[data-testid="edit-drawer"]')).toBeNull();
  });

  it("Mark as Sold is disabled while the draft is dirty (a buffered edit can't be dropped by a sale)", () => {
    openEditPanel();
    const sell = () => q('[data-testid="edit-sell"]');
    expect(sell().disabled, "enabled with a clean draft").toBe(false);
    commit("holding-paid-edit", "123");
    expect(sell().disabled, "disabled once dirty").toBe(true);
  });
});
