import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 selection — click-to-highlight, re-keyed off rowKey() = source::setNumber.
// Locks: plain click selects (+ shift anchor), Cmd/Ctrl-click toggles, shift-click ranges
// in visible order; Ctrl/Cmd+A selects all visible (suppressed while typing); Delete deletes
// selected (confirm); Esc clears; the eye icon opens detail and does NOT select; a BE set and
// a manual set sharing a setNumber select independently (composite key); and the index-shift
// bug is fixed — a single-delete during a multi-select no longer mis-targets neighbours.
// Renders the REAL owned table; SetDetailPanel stubbed to a presence marker.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C, LineChart: C, Line: C };
});
// SetDetailPanel → a presence marker so detail-open is observable (item set ⇒ detailSet set).
vi.mock("./SetDetailPanel", () => ({
  default: ({ item }) => (item ? React.createElement("div", { "data-testid": "detail-open" }) : null),
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
// Render every row in jsdom (0-height viewport otherwise measures no rows).
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

// Four BE sets, distinct numbers; default sort is setNumber asc so data-index 0..3 = 10001..10004.
const beSet = (n, name) => ({
  setNumber: n, name, theme: "Icons", source: "BrickEconomy",
  quantity: 1, averagePaid: 100, totalPaid: 100, totalValue: 150, roiPct: 50, msrp: null,
  entries: [{ paid_price: 100, current_value: 150, condition: "new" }],
});
const BE_BLOB = [beSet("10001-1", "Alpha"), beSet("10002-1", "Bravo"), beSet("10003-1", "Charlie"), beSet("10004-1", "Delta")];

let container, root;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(BE_BLOB));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const q = (sel) => container.querySelector(sel);
const qa = (sel) => [...container.querySelectorAll(sel)];
const render = () => act(() => root.render(React.createElement(MyCollection)));
const row = (i) => q(`tr[data-index="${i}"]`);
const clickRow = (i, opts = {}) => act(() => row(i).dispatchEvent(new MouseEvent("click", { bubbles: true, ...opts })));
const clickIn = (i, sel) => act(() => row(i).querySelector(sel).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const selectedIdx = () => qa('tbody tr[data-selected="1"]').map(tr => tr.getAttribute("data-index"));
const bodyText = () => qa("tbody tr[data-index]").map(tr => tr.textContent).join("|");
const bodyCount = () => qa("tbody tr[data-index]").length;
const press = (key, opts = {}) => act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts })));
const clickBand = () => act(() => [...container.querySelectorAll("button")]
  .find(b => b.textContent.includes("Delete Selected"))
  .dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("Phase 3 selection — click-to-highlight", () => {
  it("plain click selects only that row + shows the band; a second plain click collapses to the new row", () => {
    render();
    clickRow(0);
    expect(selectedIdx()).toEqual(["0"]);
    expect(container.textContent).toContain("Delete Selected (1)");
    clickRow(2);
    expect(selectedIdx()).toEqual(["2"]); // plain click replaces, not adds
  });

  it("Cmd/Ctrl-click adds to (and toggles within) the selection", () => {
    render();
    clickRow(0);
    clickRow(2, { metaKey: true });
    expect(new Set(selectedIdx())).toEqual(new Set(["0", "2"]));
    clickRow(2, { metaKey: true }); // toggle off
    expect(selectedIdx()).toEqual(["0"]);
  });

  it("shift-click selects the inclusive range in visible order from the anchor", () => {
    render();
    clickRow(1); // anchor
    clickRow(3, { shiftKey: true });
    expect(new Set(selectedIdx())).toEqual(new Set(["1", "2", "3"]));
    expect(container.textContent).toContain("Delete Selected (3)");
  });

  it("the eye icon opens detail and does NOT select the row", () => {
    render();
    clickIn(0, '[data-testid="row-action-view"]');
    expect(q('[data-testid="detail-open"]'), "detail opened via eye").toBeTruthy();
    expect(selectedIdx(), "eye did not select the row").toEqual([]);
  });

  it("the edit icon opens the Edit drawer (single click) and does NOT select the row", () => {
    render();
    clickIn(0, '[data-testid="row-action-edit"]');
    expect(q('[data-testid="edit-drawer"]'), "edit drawer opened").toBeTruthy();
    expect(selectedIdx(), "edit did not select the row").toEqual([]);
  });

  it("clicking the Actions cell's EMPTY area is a no-op — it does NOT select the row (kills the dead-zone)", () => {
    // The icons are short islands in a ~68px row; the Actions <td> now stops propagation so a
    // near-miss click in its empty space no longer bubbles to the row's handleRowSelect.
    render();
    const actionsTd = row(0).querySelector('[data-testid="row-action-view"]').closest("td");
    expect(actionsTd, "Actions cell found").toBeTruthy();
    act(() => actionsTd.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(selectedIdx(), "empty Actions-cell click did not select").toEqual([]);
    expect(q('[data-testid="detail-open"]'), "empty Actions-cell click did not open detail").toBeFalsy();
    // Contrast: a NON-Actions data cell still selects — the guard is scoped to the Actions cell only.
    act(() => row(1).children[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(selectedIdx(), "a data cell still selects").toEqual(["1"]);
  });

  it("Actions hit-area spans the full row: cell is positioned, container is absolute+stretch, buttons stretch", () => {
    // Geometry wiring for the enlarged hit target (the real coordinate behaviour is live-only —
    // jsdom has no layout — but the style props that drive it are a deterministic regression guard).
    // A %-height child of a table-cell doesn't resolve, so the container is absolute inset:0 against
    // a position:relative <td>, with align-items:stretch + each button align-self:stretch.
    render();
    const innerDiv = row(0).querySelector('[data-testid="row-action-view"]').parentElement;
    const actionsTd = innerDiv.parentElement;
    expect(actionsTd.style.position, "Actions <td> is the positioned containing block").toBe("relative");
    expect(innerDiv.style.position, "actions container fills the cell").toBe("absolute");
    expect(innerDiv.style.alignItems, "actions container stretches its children").toBe("stretch");
    for (const id of ["row-action-view", "row-action-edit", "row-action-delete"]) {
      const btn = row(0).querySelector(`[data-testid="${id}"]`);
      expect(btn.style.alignSelf, `${id} stretches to the full row height`).toBe("stretch");
    }
  });

  it("clicking the Qty cell SELECTS the row — no inline editor steals the click (Qty edits in the drawer)", () => {
    render();
    // Qty is now plain text (route a): clicking it must bubble to the row and select, like any cell.
    const qi = [...container.querySelectorAll("thead th")].findIndex(th => th.textContent.replace(/[↑↓\s]/g, "") === "Qty");
    expect(qi, "Qty column present").toBeGreaterThan(-1);
    const qtyCell = row(0).children[qi];
    expect(qtyCell.querySelector("input"), "Qty cell is plain text, not an inline input").toBeNull();
    act(() => qtyCell.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(selectedIdx(), "clicking Qty selected the row").toEqual(["0"]);
  });

  it("action icons carry the bk-row-action class (hover/focus highlight is CSS-driven, no stuck JS color)", () => {
    render();
    for (const id of ["row-action-view", "row-action-edit", "row-action-delete"]) {
      const btn = row(0).querySelector(`[data-testid="${id}"]`);
      expect(btn, `${id} renders`).toBeTruthy();
      expect(btn.className, `${id} uses the bk-row-action class`).toContain("bk-row-action");
    }
  });

  it("no per-row checkboxes remain in the table body (column removed)", () => {
    render();
    expect(qa('tbody input[type="checkbox"]').length).toBe(0);
  });

  it("the selection band has NO 'Check All' checkbox — only Delete Selected (Ctrl/Cmd+A selects all)", () => {
    render();
    clickRow(0);
    expect(container.textContent).toContain("Delete Selected (1)"); // band is present
    expect(container.textContent).not.toContain("Check All");       // checkbox + label removed
    const band = qa("button").find(b => b.textContent.includes("Delete Selected")).parentElement;
    expect(band.querySelector('input[type="checkbox"]'), "no checkbox left in the band").toBeNull();
  });
});

describe("Phase 3 selection — delete + index-shift stability", () => {
  it("Delete Selected removes exactly the selected rows", () => {
    render();
    clickRow(0);                    // 10001
    clickRow(2, { metaKey: true }); // 10003
    clickBand();
    expect(bodyCount()).toBe(2);
    expect(bodyText()).toContain("10002");
    expect(bodyText()).toContain("10004");
    expect(bodyText()).not.toContain("10001");
    expect(bodyText()).not.toContain("10003");
  });

  it("STABILITY: select A+C, single-delete B (earlier index) via its row action, then Delete Selected → A and C go (not shifted neighbours)", () => {
    render();
    clickRow(0);                    // A = 10001
    clickRow(2, { metaKey: true }); // C = 10003
    clickIn(1, '[data-testid="row-action-delete"]'); // open the in-app confirm modal for B = 10002
    act(() => q('[data-testid="delete-confirm-delete"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))); // confirm → B removed, indices shift
    clickBand();                    // rowKey-stable: still removes A + C, NOT the shifted neighbour
    expect(bodyCount()).toBe(1);
    expect(bodyText()).toContain("10004");     // D survives
    expect(bodyText()).not.toContain("10001"); // A (selected) removed
    expect(bodyText()).not.toContain("10003"); // C (selected) removed
  });
});

describe("Phase 3 selection — keyboard", () => {
  it("Ctrl/Cmd+A selects all visible rows", () => {
    render();
    press("a", { ctrlKey: true });
    expect(selectedIdx().length).toBe(4);
    expect(container.textContent).toContain("Delete Selected (4)");
  });

  it("Ctrl/Cmd+A with a text field focused does NOT change selection (browser keeps select-text)", () => {
    render();
    const inp = document.createElement("input");
    document.body.appendChild(inp);
    act(() => inp.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true })));
    expect(selectedIdx()).toEqual([]);
    inp.remove();
  });

  it("Delete key removes the selected rows (confirm true)", () => {
    render();
    clickRow(0);
    press("Delete");
    expect(bodyCount()).toBe(3);
    expect(bodyText()).not.toContain("10001");
  });

  it("Escape clears the selection when no detail is open", () => {
    render();
    clickRow(0);
    expect(selectedIdx()).toEqual(["0"]);
    press("Escape");
    expect(selectedIdx()).toEqual([]);
    expect(container.textContent).not.toContain("Delete Selected");
  });

  it("when detail is OPEN, Escape closes detail (the detail-nav effect still owns Esc; the selection effect stays out)", () => {
    render();
    clickIn(0, '[data-testid="row-action-view"]');
    expect(q('[data-testid="detail-open"]')).toBeTruthy();
    press("Escape");
    expect(q('[data-testid="detail-open"]'), "Esc closed the detail panel").toBeNull();
  });
});

describe("Phase 3 selection — composite key (source::setNumber)", () => {
  it("a BE set and a manual set sharing a setNumber select INDEPENDENTLY (bare setNumber would conflate)", () => {
    // A manual 10001-1 (source != BrickEconomy) alongside the BE 10001-1. Sorted asc, beItems first:
    // data-index 0 = BE 10001, 1 = manual 10001.
    localStorage.setItem("blOwnedSets", JSON.stringify([
      { setNumber: "10001-1", name: "Alpha (manual)", theme: "Icons", qty: 1, paidPrice: 50, condition: "new" },
    ]));
    render();
    clickRow(0);
    expect(selectedIdx(), "only the BE row — a bare-setNumber key would also light the manual row").toEqual(["0"]);
    clickRow(1, { metaKey: true }); // distinct rowKey → both select
    expect(new Set(selectedIdx())).toEqual(new Set(["0", "1"]));
    expect(container.textContent).toContain("Delete Selected (2)");
  });
});
