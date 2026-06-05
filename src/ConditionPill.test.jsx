import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ConditionPill from "./ConditionPill";

// ─────────────────────────────────────────────────────────────────────────────
// Sets-table condition cell is DISPLAY-ONLY (inline bulk-edit footgun removed).
// A collection row is the LINE, not a copy; the old double-click → New/Used <select>
// bulk-rewrote every copy of a multi-copy line silently. This pins that the pill
// renders the New/Used/Mixed state and exposes NO edit affordance — not before and
// not after a double-click. Condition editing now lives only in the Edit form and
// the detail panel's per-copy control (neither touched here).
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

function render(set) {
  act(() => root.render(<ConditionPill set={set} />));
  return container;
}

describe("ConditionPill — display-only Sets-table condition cell", () => {
  it("renders the New / Used label from the set's condition", () => {
    expect(render({ condition: "new" }).textContent).toBe("New");
    expect(render({ condition: "usedcomplete" }).textContent).toBe("Used");
  });

  it("a multi-copy line with disagreeing copies shows Mixed", () => {
    expect(render({ entries: [{ condition: "new" }, { condition: "used" }] }).textContent).toBe("Mixed");
  });

  it("exposes NO inline edit affordance — no select / button / input", () => {
    const c = render({ condition: "new" });
    expect(c.querySelector("select")).toBeNull();
    expect(c.querySelector("button")).toBeNull();
    expect(c.querySelector("input")).toBeNull();
  });

  it("double-clicking the pill does NOT spawn an editor (no handler to mutate condition)", () => {
    const c = render({ entries: [{ condition: "new" }, { condition: "used" }] });
    const pill = c.querySelector("span");
    act(() => pill.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(c.querySelector("select")).toBeNull();
    expect(c.textContent).toBe("Mixed"); // unchanged
  });
});
