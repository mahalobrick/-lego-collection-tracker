import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import RowHoverCard from "./RowHoverCard";
import { setRetailProvenance } from "./utils/portfolio";
import { money } from "./utils/formatting";

// ─────────────────────────────────────────────────────────────────────────────
// Row finalize — in COMPACT density the row shows Market only, so the full three-up
// (Retail / Paid / Market) must surface in the hover card instead. DOM-leaf smoke:
// the card renders all three figures, "—" when unknown, and Paid as money() (the
// card's prior behavior — it does not apply the cell's $0→"—" coalescing).
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

function render(props) {
  act(() => root.render(<RowHoverCard {...props} />));
  const leaf = id => container.querySelector(`[data-testid="${id}"]`);
  return { retail: leaf("hover-retail"), paid: leaf("hover-paid"), market: leaf("hover-market") };
}

describe("RowHoverCard — compact-density three-up (DOM-leaf)", () => {
  it("all three present: Retail / Paid / Market figures show in the card", () => {
    const set = { setNumber: "10300-1", name: "DeLorean", theme: "Icons", paidPrice: 150, qty: 1 };
    const retail = setRetailProvenance({ brickset: { amount: 169.99 } });
    const market = { amount: 220, source: "bricklink", basis: "sold" };
    const { retail: r, paid: p, market: m } = render({ set, retail, market, tipPos: { x: 10, y: 10 } });
    expect(r.textContent).toBe(money(169.99));
    expect(p.textContent).toBe(money(150));
    expect(m.textContent).toBe(money(220));
  });

  it("unknown retail/market → '—'; Paid stays money() ($0 when unrecorded)", () => {
    const set = { setNumber: "30654-1", paidPrice: 0, qty: 1 };
    const { retail: r, paid: p, market: m } = render({ set, retail: null, market: { amount: null }, tipPos: { x: 0, y: 0 } });
    expect(r.textContent).toBe("—");
    expect(m.textContent).toBe("—");
    expect(p.textContent).toBe(money(0));
  });

  it("former BE-only retail now renders \"—\" (BE removed from the retail ladder in 3c)", () => {
    const set = { setNumber: "30654-1", paidPrice: 3, qty: 1 };
    // No Brickset MSRP, no manual → null (a brickeconomy key is ignored by the ladder).
    const retail = setRetailProvenance({ brickset: { amount: null }, brickeconomy: { amount: 4.99 } });
    expect(retail).toBeNull();
    const { retail: r } = render({ set, retail, market: { amount: 6 }, tipPos: { x: 0, y: 0 } });
    expect(r.textContent).toBe("—");
  });
});
