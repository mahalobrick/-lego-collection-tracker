import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Per-row action icons on the DESKTOP collection table. Each row carries a fixed trailing
// actions cell with three icon buttons:
//   • view   → opens the detail panel (same call as the row click)
//   • edit   → opens the edit drawer (setSelectedSetIndex)
//   • delete → opens an in-app confirm modal (with a full-screen backdrop); confirming deletes the
//              set by rowKey identity (not a stale array index). Backdrop click / Cancel / Esc cancel.
// Locks: 3 buttons per row; view opens detail; edit/delete stopPropagation so they do NOT
// bubble to the row's open-detail handler (view does, intentionally). Mirrors the
// MyCollection.editDrawer.test.jsx god-module harness (same mocks + forced virtualizer).
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C, LineChart: C, Line: C };
});
// SetDetailPanel stub renders a marker carrying detailSet's set number whenever `item` is set,
// so "detail is open" is observable in the DOM. (Real panel is network-bound; not needed here.)
vi.mock("./SetDetailPanel", () => ({
  default: ({ item }) => (item
    ? React.createElement("div", { "data-testid": "detail-open" }, item.setNumber || "")
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
// yields no measured rows → the action buttons are unreachable). Same mock as editDrawer test.
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

// Two distinct sets, used across the view / edit / delete cases.
const BLOB = [
  { setNumber: "31120-1", name: "Medieval Castle", theme: "Creator",
    quantity: 1, averagePaid: 100, totalPaid: 100, totalValue: 150,
    entries: [{ paid_price: 100, current_value: 150, condition: "new" }] },
  { setNumber: "75313-1", name: "AT-AT", theme: "Star Wars",
    quantity: 1, averagePaid: 800, totalPaid: 800, totalValue: 1000,
    entries: [{ paid_price: 800, current_value: 1000, condition: "new" }] },
];

let container, root;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(BLOB));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const render = () => act(() => root.render(React.createElement(MyCollection)));
const q = (sel) => container.querySelector(sel);
const rows = () => [...container.querySelectorAll("tr[data-index]")];
const rowByText = (txt) => rows().find(r => r.textContent.includes(txt));
const clickIn = (el, sel) => {
  const btn = el.querySelector(sel);
  expect(btn, `${sel} should render`).toBeTruthy();
  act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return btn;
};

describe("MyCollection — per-row action icons (desktop table, Phase 2)", () => {
  it("renders exactly 3 action buttons (view/edit/delete) on every desktop row — no copy", () => {
    render();
    const r = rows();
    expect(r.length, "both seeded sets render as rows").toBe(2);
    for (const row of r) {
      expect(row.querySelectorAll('[data-testid^="row-action-"]').length).toBe(3);
      expect(row.querySelector('[data-testid="row-action-view"]')).toBeTruthy();
      expect(row.querySelector('[data-testid="row-action-edit"]')).toBeTruthy();
      expect(row.querySelector('[data-testid="row-action-delete"]')).toBeTruthy();
      expect(row.querySelector('[data-testid="row-action-copy"]'), "copy action removed").toBeNull();
    }
    // The fixed trailing header cell exists (rendered directly, not via the toggleable columns).
    const actionsTh = [...container.querySelectorAll("th")].find(th => th.textContent.trim() === "Actions");
    expect(actionsTh, "trailing 'Actions' header cell renders").toBeTruthy();
  });

  it("view → opens the detail panel (sets detailSet)", () => {
    render();
    expect(q('[data-testid="detail-open"]'), "detail closed before clicking view").toBeNull();
    clickIn(rowByText("31120"), '[data-testid="row-action-view"]');
    const detail = q('[data-testid="detail-open"]');
    expect(detail, "view opens the detail panel").toBeTruthy();
    expect(detail.textContent).toBe("31120-1"); // detailSet = openSetDetail("31120-1")
  });

  it("edit → opens the edit drawer (sets selectedSetIndex), without opening detail", () => {
    render();
    expect(q('[data-testid="edit-drawer"]'), "edit drawer closed before clicking edit").toBeNull();
    clickIn(rowByText("31120"), '[data-testid="row-action-edit"]');
    expect(q('[data-testid="edit-drawer"]'), "edit opens the edit drawer").toBeTruthy();
    expect(q('[data-testid="detail-open"]'), "edit stopPropagation → detail must NOT open").toBeNull();
  });

  // dispatch a real bubbling click on an arbitrary element (modal buttons live outside a row).
  const clickEl = (el) => { expect(el).toBeTruthy(); act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true }))); };

  it("delete → opens the in-app confirm modal (names the set), gated until confirm; no native confirm", () => {
    const confirm = vi.spyOn(window, "confirm");                    // must NOT be called anymore
    render();
    expect(rows().length).toBe(2);
    expect(q('[data-testid="delete-confirm-backdrop"]'), "no modal before clicking delete").toBeNull();
    clickIn(rowByText("31120"), '[data-testid="row-action-delete"]');
    const backdrop = q('[data-testid="delete-confirm-backdrop"]');
    expect(backdrop, "delete opens the in-app confirm modal").toBeTruthy();
    expect(backdrop.style.position, "backdrop is a fixed full-screen overlay").toBe("fixed");
    expect(backdrop.style.inset, "backdrop covers the viewport (inset:0)").toBe("0px");
    expect(backdrop.style.zIndex, "backdrop on the modal tier").toBe("1000");
    const dialog = q('[data-testid="delete-confirm-dialog"]');
    expect(dialog.textContent, "modal names the set being deleted").toContain("Medieval Castle");
    expect(dialog.textContent).toContain("31120");
    expect(confirm, "native window.confirm is NOT used").not.toHaveBeenCalled();
    expect(rows().length, "nothing deleted until the user confirms").toBe(2);
    expect(rowByText("31120"), "the row is still present while the modal is open").toBeTruthy();
    expect(q('[data-testid="detail-open"]'), "delete stopPropagation → detail must NOT open").toBeNull();
  });

  it("delete → confirming removes exactly that row (and not the others); modal closes", () => {
    render();
    clickIn(rowByText("31120"), '[data-testid="row-action-delete"]');
    clickEl(q('[data-testid="delete-confirm-delete"]'));            // confirm
    expect(rowByText("31120"), "the confirmed set's row is gone").toBeFalsy();
    expect(rowByText("75313"), "the other set's row remains").toBeTruthy();
    expect(rows().length).toBe(1);
    expect(q('[data-testid="delete-confirm-backdrop"]'), "modal closes after confirming").toBeNull();
  });

  it("delete → resolves by identity, not a stale index: confirming the 2nd row deletes THAT set", () => {
    render();
    // open the confirm for the SECOND set; an index-0 assumption would wrongly delete 31120.
    clickIn(rowByText("75313"), '[data-testid="row-action-delete"]');
    expect(q('[data-testid="delete-confirm-dialog"]').textContent).toContain("75313");
    clickEl(q('[data-testid="delete-confirm-delete"]'));
    expect(rowByText("75313"), "the set the user confirmed is deleted").toBeFalsy();
    expect(rowByText("31120"), "the unrelated first set is untouched").toBeTruthy();
    expect(rows().length).toBe(1);
  });

  it("delete → Cancel closes the modal and deletes nothing", () => {
    render();
    clickIn(rowByText("31120"), '[data-testid="row-action-delete"]');
    clickEl(q('[data-testid="delete-confirm-cancel"]'));
    expect(q('[data-testid="delete-confirm-backdrop"]'), "Cancel closes the modal").toBeNull();
    expect(rowByText("31120"), "cancelled delete leaves the row").toBeTruthy();
    expect(rows().length).toBe(2);
  });

  it("delete → a click on the backdrop itself cancels (stray-second-click safety); deletes nothing", () => {
    render();
    clickIn(rowByText("31120"), '[data-testid="row-action-delete"]');
    const backdrop = q('[data-testid="delete-confirm-backdrop"]');
    clickEl(backdrop);                                              // target === currentTarget → cancels
    expect(q('[data-testid="delete-confirm-backdrop"]'), "backdrop click closes the modal").toBeNull();
    expect(rows().length, "backdrop click deletes nothing").toBe(2);
    expect(rowByText("31120")).toBeTruthy();
  });
});
