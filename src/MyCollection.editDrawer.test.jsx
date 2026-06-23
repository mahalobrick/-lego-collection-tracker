import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 layout rework — Edit panel is a fixed right-edge DRAWER, not a
// width-stealing grid column. Locks:
//   • the Edit panel renders position:fixed (drawer), the table grid stays single-column "1fr"
//   • one-slot flow: row → Detail → Edit closes Detail + shows the Edit drawer; Done returns to
//     the table (not back to Detail)
//   • chrome cleanup: subtitle + "Owned Sets" h3 gone; bulk-action band only on selection
//   • the Edit form (bulk fields) still renders + commits inside the drawer
// Reuses the god-module harness of MyCollection.holdingEdit.test.jsx (SetDetailPanel stubbed to a
// single Edit button so the row→Edit path is reachable without the network-bound real panel).
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C, LineChart: C, Line: C };
});
// SetDetailPanel: the Edit drawer (selectedSetIndex) opens ONLY via this panel's onEdit callback.
// Stub it to a single Edit button (rendered once an item is selected) → gives the row→Detail→Edit
// path. When detailSet is cleared (onEdit fires setDetailSet(null)), item is null → button gone,
// which is exactly how we assert "opening Edit closes Detail".
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
// yields no measured rows → the row click is unreachable). Mock impl defined INSIDE the hoisted factory.
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
const blob = () => JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection"));
const render = () => act(() => root.render(React.createElement(MyCollection)));
const clickRow = () => {
  // Phase 3: a plain row click SELECTS; detail-open moved to the eye icon. The mock SetDetailPanel
  // renders its Edit button once detailSet is set, which the eye click does.
  const eye = q('[data-testid="row-action-view"]');
  expect(eye, "row view (eye) action should render").toBeTruthy();
  act(() => eye.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const clickEdit = () => {
  const edit = q('[data-testid="mock-edit"]');
  expect(edit, "Detail's Edit button should appear after selecting a row").toBeTruthy();
  act(() => edit.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const openEditDrawer = () => { render(); clickRow(); clickEdit(); };
const clickButtonByText = (text) => {
  const btn = [...container.querySelectorAll("button")].find(b => b.textContent.trim() === text);
  expect(btn, `button "${text}" should render`).toBeTruthy();
  act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

describe("MyCollection — Edit panel is a fixed right-edge drawer (Phase 1)", () => {
  it("renders the Edit panel as position:fixed (drawer), not a sticky grid column", () => {
    openEditDrawer();
    const drawer = q('[data-testid="edit-drawer"]');
    expect(drawer, "edit drawer renders when selectedSetIndex is set").toBeTruthy();
    expect(drawer.style.position).toBe("fixed");      // was position:sticky in the grid column
    expect(drawer.style.width).toBe("420px");
    expect(drawer.style.zIndex).toBe("1000");
    // backdrop present (mirrors SetDetailPanel)
    const backdrop = q('[data-testid="edit-backdrop"]');
    expect(backdrop, "dimming backdrop renders").toBeTruthy();
    expect(backdrop.style.position).toBe("fixed");
  });

  it("the table section has no backdrop-filter trap, so the fixed drawer is viewport-anchored (full height)", () => {
    // BUG: a non-none backdrop-filter (like transform/filter) on an ancestor makes a position:fixed child
    // anchor to THAT ancestor, not the viewport. The Edit drawer (top:0/bottom:0) lives inside
    // #bl-sec-table, whose shared `panel` style carried backdrop-filter:blur — so a filtered-short table
    // shrank the section and the drawer collapsed with it. Fix: #bl-sec-table sets backdrop-filter:none
    // (visually inert — opaque surface bg), removing the trap. (SetDetailPanel never had this — page root.)
    openEditDrawer();
    const section = q("#bl-sec-table");
    expect(section, "table section renders").toBeTruthy();
    expect(section.style.backdropFilter, "no containing-block trap on the drawer's fixed ancestor").toBe("none");
    const drawer = q('[data-testid="edit-drawer"]');
    expect(drawer.style.position).toBe("fixed");
    expect(drawer.style.top, "top set → viewport-anchored span").toBeTruthy();    // 0 (full-height via top+bottom)
    expect(drawer.style.bottom, "bottom set → viewport-anchored span").toBeTruthy();
  });

  it("keeps the table grid single-column (no 1fr 380px split that stole table width)", () => {
    openEditDrawer();
    const grid = q('[data-testid="owned-table-grid"]');
    expect(grid, "owned table grid renders").toBeTruthy();
    expect(grid.style.gridTemplateColumns).toBe("1fr"); // full width even while editing
  });
});

describe("MyCollection — one-slot drawer flow", () => {
  it("opening Edit from the Detail drawer closes Detail and shows the Edit drawer", () => {
    render();
    expect(q('[data-testid="edit-drawer"]'), "no Edit drawer before selecting").toBeNull();
    clickRow();
    // Detail open (mock Edit button present), Edit not yet open.
    expect(q('[data-testid="mock-edit"]'), "Detail open after row click").toBeTruthy();
    expect(q('[data-testid="edit-drawer"]'), "Edit not open yet").toBeNull();
    clickEdit();
    // Edit open, Detail closed → exactly one drawer.
    expect(q('[data-testid="edit-drawer"]'), "Edit drawer open").toBeTruthy();
    expect(q('[data-testid="mock-edit"]'), "Detail closed when Edit opens").toBeNull();
  });

  it("Cancel returns to the full-width table — not back to Detail (no edits → closes silently)", () => {
    openEditDrawer();
    clickButtonByText("Cancel"); // Done → Save/Cancel: an unedited Cancel discards with no confirm
    expect(q('[data-testid="edit-drawer"]'), "Edit drawer closed by Cancel").toBeNull();
    expect(q('[data-testid="mock-edit"]'), "does NOT reopen Detail").toBeNull();
    expect(q('tr[data-index="0"]'), "table still rendered").toBeTruthy();
  });
});

describe("MyCollection — chrome cleanup", () => {
  it("the subtitle and the 'Owned Sets' h3 are gone in collection mode", () => {
    render();
    expect(container.textContent).not.toContain("Owned Sets");
    expect(container.textContent).not.toContain("Browse, search, and manage");
  });

  it("the bulk-action band is hidden with no selection and appears once a row is selected (click-to-select)", () => {
    render();
    expect(container.textContent).not.toContain("Delete Selected"); // band reclaimed when nothing selected
    // Phase 3: no per-row checkbox — a plain row click selects → the band (Delete Selected) shows.
    const row = q('tr[data-index="0"]');
    expect(row, "owned row renders").toBeTruthy();
    act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).not.toContain("Check All"); // Check All checkbox removed (Ctrl/Cmd+A selects all)
    expect(container.textContent).toContain("Delete Selected (1)");
  });
});

describe("MyCollection — Edit form still works inside the drawer", () => {
  it("bulk fields render in the drawer and a Paid edit commits to the BE blob on Save", () => {
    openEditDrawer();
    const drawer = q('[data-testid="edit-drawer"]');
    // The form moved containers only — its fields still live inside the drawer.
    expect(drawer.querySelector('[data-testid="holding-paid-edit"]'), "Paid field in drawer").toBeTruthy();
    expect(drawer.querySelector('[data-testid="holding-value-edit"]'), "Value field in drawer").toBeTruthy();
    const paid = q('[data-testid="holding-paid-edit"]');
    act(() => {
      paid.value = "49.50";
      paid.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); // → draft
    });
    clickButtonByText("Save"); // draft model: Save folds + persists once
    expect(blob()[0].averagePaid).toBe(49.5);
  });
});
