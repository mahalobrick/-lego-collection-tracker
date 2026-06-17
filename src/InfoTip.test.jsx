import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import InfoTip from "./InfoTip";

// ─────────────────────────────────────────────────────────────────────────────
// InfoTip — TAP/CLICK-to-toggle behavior (mobile-ready) + a11y affordance.
// The "?" is a real focusable <button> (keyboard + screen readers); the popover
// portals to <body> so it escapes the stat-card's overflow:hidden + per-card
// backdrop-filter stacking context (clipping is verified in the preview, not here).
// This pins the OPEN/CLOSE state machine: tap opens, tap-again toggles closed,
// outside-click closes, Escape closes. The popover text only exists in the DOM
// while open. RED against the old hover-only span (no button, click is a no-op).
// ─────────────────────────────────────────────────────────────────────────────

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const TEXT = "Counted per copy — each copy is classed new or used.";

function render() {
  act(() => root.render(<InfoTip text={TEXT} />));
}
const trigger = () => container.querySelector("button");
const tooltip = () => document.querySelector('[role="tooltip"]');
const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("InfoTip — tap-to-toggle + a11y", () => {
  it("renders the '?' as a focusable button, collapsed by default", () => {
    render();
    const btn = trigger();
    expect(btn).not.toBeNull();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(tooltip()).toBeNull(); // text not in the DOM until opened
  });

  it("click OPENS the popover (text rendered, aria-expanded true)", () => {
    render();
    click(trigger());
    expect(tooltip()).not.toBeNull();
    expect(tooltip().textContent).toContain(TEXT);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("click again TOGGLES it closed", () => {
    render();
    click(trigger());
    expect(tooltip()).not.toBeNull();
    click(trigger());
    expect(tooltip()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("OUTSIDE-click closes an open popover", () => {
    render();
    click(trigger());
    expect(tooltip()).not.toBeNull();
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(tooltip()).toBeNull();
  });

  it("ESCAPE closes an open popover", () => {
    render();
    click(trigger());
    expect(tooltip()).not.toBeNull();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(tooltip()).toBeNull();
  });

  it("the open popover is portaled OUT of the trigger's wrapper (escapes card clipping)", () => {
    render();
    click(trigger());
    // The tooltip lives under <body>, not inside the InfoTip wrapper span that the
    // overflow:hidden card would clip.
    expect(container.contains(tooltip())).toBe(false);
    expect(document.body.contains(tooltip())).toBe(true);
  });
});
