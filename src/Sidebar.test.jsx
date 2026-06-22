import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar nav reorder — the 4 main items reorder via dnd-kit drag-to-reorder (the
// hover ▲▼ arrows are gone); Settings stays pinned last, OUTSIDE the sortable set.
// Order persists device-local to blNavOrder. Routing is KEY-based, so reordering can
// never change which view a click opens. dnd-kit pointer-drag isn't practical to
// simulate in jsdom, so we test the LOGIC the gesture drives (reconcile + the
// arrayMove/persist reorder primitive) plus the render contract, not the gesture.
// Clerk is mocked away (the account/sync foot zone is irrelevant to the nav order).
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: null }),
  Show: () => null,
  SignInButton: () => null,
  SignUpButton: () => null,
  UserButton: () => null,
}));

import Sidebar, { reconcileNavOrder, reorderNavAndPersist } from "./Sidebar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DEFAULT_ORDER = ["performance", "acquisition", "budget", "collection"];

let container, root;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

const q = sel => container.querySelector(sel);
const qa = sel => [...container.querySelectorAll(sel)];

// pinned → expanded by default; pass { pinned: false } for the collapsed rail.
function render(props = {}) {
  const navCalls = [];
  const onNavigate = vi.fn(k => navCalls.push(k));
  act(() => root.render(
    <Sidebar view="collection" onNavigate={onNavigate} theme="dark" onToggleTheme={() => {}} pinned onTogglePin={() => {}} syncStatus="idle" {...props} />
  ));
  return { onNavigate, navCalls };
}

// Sortable rows in DOM order → their keys.
const orderKeys = () => qa('[data-testid^="navrow-"]').map(el => el.getAttribute("data-testid").slice("navrow-".length));

describe("Sidebar — dnd-kit drag-to-reorder nav (device-local blNavOrder)", () => {
  it("default order (no saved blNavOrder): Performance, Wanted, Budget, Collection", () => {
    expect(reconcileNavOrder(null)).toEqual(DEFAULT_ORDER);
    render();
    expect(orderKeys()).toEqual(DEFAULT_ORDER);
  });

  it("reorder + persist: arrayMove(active→over) updates the order and writes blNavOrder", () => {
    // Drag 'budget' (idx 2) onto the 'performance' slot (idx 0) → arrayMove(2, 0); others shift down.
    const next = reorderNavAndPersist(DEFAULT_ORDER, "budget", "performance");
    expect(next).toEqual(["budget", "performance", "acquisition", "collection"]);
    expect(JSON.parse(localStorage.getItem("blNavOrder"))).toEqual(["budget", "performance", "acquisition", "collection"]);
    // input is not mutated (arrayMove returns a fresh array)
    expect(DEFAULT_ORDER).toEqual(["performance", "acquisition", "budget", "collection"]);
  });

  it("reorder is a no-op (no state change, no write) when dropped in place or onto an absent key", () => {
    expect(reorderNavAndPersist(DEFAULT_ORDER, "budget", "budget")).toBe(DEFAULT_ORDER); // same slot → same ref
    expect(localStorage.getItem("blNavOrder")).toBeNull();
    expect(reorderNavAndPersist(DEFAULT_ORDER, "budget", "settings")).toBe(DEFAULT_ORDER); // 'settings' isn't sortable
    expect(localStorage.getItem("blNavOrder")).toBeNull();
  });

  it("reconcile on load: drops a stale key and appends missing canonical keys in canonical position", () => {
    // 'wanted' is a stale label-not-key (the canonical key is 'acquisition'); 'performance' +
    // 'acquisition' are missing entirely. Saved order is kept for surviving keys, missing appended.
    expect(reconcileNavOrder(["collection", "wanted", "budget"]))
      .toEqual(["collection", "budget", "performance", "acquisition"]);

    // …and through the component's real load path (localStorage → JSON.parse → reconcile).
    localStorage.setItem("blNavOrder", JSON.stringify(["collection", "wanted", "budget"]));
    render();
    expect(orderKeys()).toEqual(["collection", "budget", "performance", "acquisition"]);
  });

  it("Settings is rendered last, OUTSIDE the sortable set (no navrow; follows the last row)", () => {
    render();
    expect(q('[data-testid="navrow-settings"]')).toBeNull();   // not a sortable row
    const rows = qa('[data-testid^="navrow-"]');
    expect(rows.length).toBe(4);

    const settingsBtn = q('[data-testid="navbtn-settings"]');
    expect(settingsBtn).toBeTruthy();
    const lastRow = rows[rows.length - 1];
    // Settings button follows the last sortable row in document order.
    expect(lastRow.compareDocumentPosition(settingsBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("routing stays key-based: a plain click (mousedown+mouseup, no movement) calls onNavigate(key)", () => {
    const { onNavigate, navCalls } = render();
    const btn = q('[data-testid="navbtn-budget"]');
    // A plain tap with no pointer movement → the distance-constrained sensor never starts a drag,
    // so the button's native click fires and navigation proceeds.
    act(() => {
      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith("budget");
    expect(navCalls).toEqual(["budget"]);
  });

  it("sortable rows render (draggable) in the collapsed rail too — drag is not gated on expanded", () => {
    render({ pinned: false }); // collapsed: not pinned, not hovered
    expect(orderKeys()).toEqual(DEFAULT_ORDER);
    // each row still wraps its key-based nav button (the whole row is the drag target)
    expect(q('[data-testid="navbtn-performance"]')).toBeTruthy();
  });
});
