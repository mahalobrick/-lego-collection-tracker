import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Holding-level Edit panel — Paid / Value / MSRP commit contract (regression lock).
//
// The bug: these three side-panel inputs were controlled type=number fields that ran
// asNumber on EVERY keystroke. A partial decimal ("49.") sanitizes to "" in a number
// input → asNumber("") = 0 → the field re-renders empty → the "." is lost, so decimals
// were impossible. Separately, a BE-set Value (currentValue) edit fell into updateSet's
// in-memory-only else branch (no persist) AND was shadowed by totalValue in rawSetValue,
// so it neither showed nor survived reload.
//
// The fix mirrors SetDetailPanel's per-copy paid input: UNCONTROLLED (defaultValue +
// commit-on-blur). This pins the real component end-to-end: a decimal typed into Paid /
// Value / MSRP commits intact (not 0) AND persists to the BE blob across a remount
// (= reload). Mirrors the god-module harness of MyCollection.msrpCoverage.test.jsx.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C, LineChart: C, Line: C };
});
// SetDetailPanel: the side panel (selectedSetIndex) is opened ONLY via this panel's onEdit
// callback. Stub it to a single Edit button (rendered once an item is selected) that fires
// onEdit — giving the test the row→Edit→panel path without the real (network-bound) panel.
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
// Force the virtualized owned-table to render every row in jsdom (0-height viewport otherwise
// yields no measured rows, so the row click — which opens the detail panel — is unreachable).
// The factory is hoisted, so the mock impl must be defined INSIDE it (no top-level refs).
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

// One BE set in the normalized blob (the store ownedSetFromBlob loads + persistBESetEdit writes).
// quantity 1 → currentValue == totalValue (the BE load convention).
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
const blob = () => JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection"));

// Open the holding-level Edit side panel: click the row → click the (stubbed) Edit button.
function openEditPanel() {
  act(() => root.render(React.createElement(MyCollection)));
  // Phase 3: detail-open is the eye icon (a plain row click now selects). The mock SetDetailPanel
  // renders its Edit button once the eye sets detailSet.
  const eye = q('[data-testid="row-action-view"]');
  expect(eye, "row view (eye) action should render").toBeTruthy();
  act(() => eye.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const edit = q('[data-testid="mock-edit"]');
  expect(edit, "Edit button should appear after opening detail").toBeTruthy();
  act(() => edit.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

// Type into an uncontrolled input and commit via blur (React delegates onBlur via focusout).
function commit(testid, value) {
  const input = q(`[data-testid="${testid}"]`);
  expect(input, `${testid} should render in the panel`).toBeTruthy();
  act(() => {
    input.value = value;
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("MyCollection holding-level edit — decimal commit + BE persistence", () => {
  it("the three inputs are UNCONTROLLED (defaultValue) — the decimal-safe pattern", () => {
    openEditPanel();
    for (const id of ["holding-paid-edit", "holding-value-edit", "holding-msrp-edit"]) {
      const input = q(`[data-testid="${id}"]`);
      expect(input, `${id} renders`).toBeTruthy();
      expect(input.type).toBe("number");
    }
    // Seeded figures show via defaultValue (Paid 800, Value 1000).
    expect(q('[data-testid="holding-paid-edit"]').value).toBe("800");
    expect(q('[data-testid="holding-value-edit"]').value).toBe("1000");
  });

  it("Paid: a decimal commits intact (49.50 → 49.5, not 0) and persists to the BE blob", () => {
    openEditPanel();
    commit("holding-paid-edit", "49.50");
    expect(blob()[0].averagePaid).toBe(49.5); // not 0 — the decimal survived
    expect(blob()[0].paidPrice).toBe(49.5);
    expect(blob()[0].totalPaid).toBe(49.5); // qty 1 → reconciled cost basis
  });

  it("Value: a decimal commits + persists totalValue (the branch that used to revert)", () => {
    openEditPanel();
    commit("holding-value-edit", "1234.56");
    expect(blob()[0].totalValue).toBe(1234.56);
    expect(blob()[0].currentValue).toBe(1234.56);
    // roiPct (hover snapshot) recomputed off the new value: (1234.56 − 800)/800 × 100.
    expect(blob()[0].roiPct).toBeCloseTo(54.32, 2);
  });

  it("MSRP: an Edit commits to msrpOverride (the override rung); add-baked msrp + cost-axis retailPrice untouched", () => {
    openEditPanel();
    // The field now writes msrpOverride (beats Brickset), NOT the add-baked s.msrp. This blob set has no
    // Brickset cache + msrp:null, so the resolved base is null → 59.99 ≠ base → an override IS written.
    commit("holding-msrp-edit", "59.99");
    expect(blob()[0].msrpOverride).toBe(59.99); // the explicit-override rung
    expect(blob()[0].msrp).toBeNull();          // add-baked manual rung untouched
    expect(blob()[0].retailPrice).toBe(850);    // cost-axis retailPrice (paidEqualsRetail) untouched
  });

  it("all three survive a RELOAD (remount reads the persisted decimals back)", () => {
    openEditPanel();
    commit("holding-paid-edit", "49.50");
    commit("holding-value-edit", "1234.56");
    commit("holding-msrp-edit", "59.99");
    // Reload: tear down + remount from localStorage, then reopen the panel.
    act(() => root.unmount());
    root = createRoot(container);
    openEditPanel();
    expect(q('[data-testid="holding-paid-edit"]').value).toBe("49.5");
    expect(q('[data-testid="holding-value-edit"]').value).toBe("1234.56");
    expect(q('[data-testid="holding-msrp-edit"]').value).toBe("59.99");
  });
});

describe("MyCollection — MSRP override is dirty-safe (Brickset-backed set)", () => {
  // Give the blob set a Brickset retail so the field PREFILLS with the resolved MSRP (850) and the
  // "typed == Brickset → no override" branch is exercised. getBricksetCache() reads this at mount.
  const seedBrickset = (retail) => localStorage.setItem("bricksetSetCache", JSON.stringify({
    "brickset_75313-1": { fetchedAt: "2026-06-01T00:00:00.000Z", data: { retail_price_us: retail } },
  }));

  it("prefills the field from the RESOLVED MSRP (Brickset 850), not the blank add-baked msrp", () => {
    seedBrickset(850);
    openEditPanel();
    expect(q('[data-testid="holding-msrp-edit"]').value).toBe("850"); // was blank pre-fix (read s.msrp=null)
  });

  it("open + blur with NO change writes NO override (never freezes a redundant Brickset override)", () => {
    seedBrickset(850);
    openEditPanel();
    commit("holding-msrp-edit", "850"); // == the Brickset-resolved base → must not create an override
    expect(blob()[0].msrpOverride ?? null).toBeNull();
  });

  it("a real change writes the override; clearing reverts to the Brickset-resolved value", () => {
    seedBrickset(850);
    openEditPanel();
    commit("holding-msrp-edit", "250");                               // ≠ 850 → override written
    expect(blob()[0].msrpOverride).toBe(250);
    expect(q('[data-testid="holding-msrp-edit"]').value).toBe("250"); // field reflects the override
    commit("holding-msrp-edit", "");                                  // cleared → 0 coalesces to "none"
    expect(q('[data-testid="holding-msrp-edit"]').value).toBe("850"); // resolves back to Brickset, not frozen 250
  });

  it("typing the Brickset value while an override exists CLEARS it (revert, not freeze)", () => {
    seedBrickset(850);
    openEditPanel();
    commit("holding-msrp-edit", "250");
    expect(blob()[0].msrpOverride).toBe(250);
    commit("holding-msrp-edit", "850"); // == Brickset base → clears the override
    expect(q('[data-testid="holding-msrp-edit"]').value).toBe("850");
  });
});

describe("MyCollection holding-level edit — bulk Acquired/Notes persist to the BE blob (revert-on-reload fix)", () => {
  // These two used to fall into updateSet's in-memory-only else branch for a BE set → they never
  // reached the blob and reverted on reload. They now write the copy entry (+ holding scalar) + persist.
  function commitDate(value) { // controlled date input → commits on change ('input' event)
    const input = q('[data-testid="holding-date-edit"]');
    expect(input, "holding-date-edit renders").toBeTruthy();
    // Native prototype setter — bypass React's value tracker so the 'input' event fires onChange.
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("Acquired date persists to entries + the holding scalar, and survives reload", () => {
    openEditPanel();
    commitDate("2025-06-01");
    expect(blob()[0].entries[0].acquired_date).toBe("2025-06-01");
    expect(blob()[0].acquiredDate).toBe("2025-06-01");
    // Pure metadata — value/cost untouched.
    expect(blob()[0].totalValue).toBe(1000);
    expect(blob()[0].totalPaid).toBe(800);

    act(() => root.unmount()); root = createRoot(container);
    openEditPanel();
    expect(q('[data-testid="holding-date-edit"]').value).toBe("2025-06-01");
  });

  it("Notes persist to the entry + survive reload (uncontrolled commit-on-blur)", () => {
    openEditPanel();
    commit("holding-notes-edit", "bought at the LEGO store");
    expect(blob()[0].entries[0].notes).toBe("bought at the LEGO store");
    expect(blob()[0].notes).toBe("bought at the LEGO store");

    act(() => root.unmount()); root = createRoot(container);
    openEditPanel();
    expect(q('[data-testid="holding-notes-edit"]').value).toBe("bought at the LEGO store");
  });
});
