import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar nav reorder — the 4 main items reorder via hover ▲▼ (expanded-only);
// Settings stays pinned last; order persists device-local to blNavOrder. Routing
// is KEY-based, so reordering can never change which view a click opens. Clerk is
// mocked away (the account/sync foot zone is irrelevant to the nav order).
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: null }),
  Show: () => null,
  SignInButton: () => null,
  SignUpButton: () => null,
  UserButton: () => null,
}));

import Sidebar from "./Sidebar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

// pinned → expanded, so the reorder ▲▼ can surface on hover.
function render(props = {}) {
  const navCalls = [];
  const onNavigate = vi.fn(k => navCalls.push(k));
  act(() => root.render(
    <Sidebar view="collection" onNavigate={onNavigate} theme="dark" onToggleTheme={() => {}} pinned onTogglePin={() => {}} syncStatus="idle" {...props} />
  ));
  return { onNavigate, navCalls };
}

// Reorderable rows in DOM order → their keys.
const orderKeys = () => qa('[data-testid^="navrow-"]').map(el => el.getAttribute("data-testid").slice("navrow-".length));
// Reveal a row's arrows (hover-gated): a bubbling mouseover maps to React onMouseEnter.
const hover = key => act(() => q(`[data-testid="navrow-${key}"]`).dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
const click = el => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("Sidebar — hover ▲▼ nav reorder (device-local blNavOrder)", () => {
  it("moving 'budget' up places it before the item previously above it; persists to blNavOrder", () => {
    render();
    expect(orderKeys()).toEqual(["collection", "acquisition", "budget", "performance"]);

    hover("budget");
    click(q('[data-testid="navup-budget"]')); // budget swaps past 'acquisition' (the item previously above it)

    expect(orderKeys()).toEqual(["collection", "budget", "acquisition", "performance"]);
    expect(JSON.parse(localStorage.getItem("blNavOrder"))).toEqual(["collection", "budget", "acquisition", "performance"]);
  });

  it("reconcile on load: drops a stale key and appends a missing canonical key in canonical position", () => {
    // 'wanted' is a stale label-not-key (the canonical key is 'acquisition'); 'budget' is omitted entirely.
    localStorage.setItem("blNavOrder", JSON.stringify(["performance", "wanted", "collection"]));
    render();
    // stale 'wanted' dropped; saved order kept (performance, collection); missing 'acquisition' + 'budget'
    // appended after, in canonical order.
    expect(orderKeys()).toEqual(["performance", "collection", "acquisition", "budget"]);
  });

  it("ends are disabled: first item's ▲ and last item's ▼ are non-clickable", () => {
    render();
    const order = orderKeys(); // ["collection","acquisition","budget","performance"]
    const first = order[0], last = order[order.length - 1];

    hover(first);
    expect(q(`[data-testid="navup-${first}"]`).disabled).toBe(true);
    expect(q(`[data-testid="navdown-${first}"]`).disabled).toBe(false);

    hover(last);
    expect(q(`[data-testid="navdown-${last}"]`).disabled).toBe(true);
    expect(q(`[data-testid="navup-${last}"]`).disabled).toBe(false);
  });

  it("Settings is rendered last and exposes no reorder controls", () => {
    render();
    expect(q('[data-testid="navrow-settings"]')).toBeNull();   // not a reorderable row
    expect(q('[data-testid="navup-settings"]')).toBeNull();
    expect(q('[data-testid="navdown-settings"]')).toBeNull();

    const settingsBtn = q('[data-testid="navbtn-settings"]');
    expect(settingsBtn).toBeTruthy();
    const rows = qa('[data-testid^="navrow-"]');
    const lastRow = rows[rows.length - 1];
    // Settings button follows the last reorderable row in document order.
    expect(lastRow.compareDocumentPosition(settingsBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("routing stays key-based: a nav click calls onNavigate(key) after a reorder; the ▲ never navigates", () => {
    const { onNavigate, navCalls } = render();

    hover("budget");
    click(q('[data-testid="navup-budget"]'));
    expect(navCalls).toEqual([]); // arrow is a SIBLING of the button — its click can't trigger navigation

    click(q('[data-testid="navbtn-budget"]'));
    expect(onNavigate).toHaveBeenCalledWith("budget");
    expect(navCalls).toEqual(["budget"]);
  });
});
