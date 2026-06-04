import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import TriValueCell from "./TriValueCell";
import { setRetailProvenance, setValueProvenance } from "./utils/portfolio";
import { money } from "./utils/formatting";

// ─────────────────────────────────────────────────────────────────────────────
// MSRP Step 2 — the reusable three-up value display: Retail / Paid / Market.
//
// NET-FIRST: the "Market line pins prior cell behavior" block reproduces the value
// cell as it rendered BEFORE this change — `formatValueCell(prov)` + a confidence
// marker (est./thin/ask) + the retail/confidence tooltip. Those assertions are the
// characterization: the Market figure, its badge, and its tooltip must be byte-for-byte
// what MyCollection's inline value cell produced for the same provenance.
//
// SMOKE (DOM-leaf): three rows — all three present; a row missing Paid → "—"; a
// former-BE-only retail row now renders "—" (BE removed from the retail ladder in 3c).
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
  act(() => root.render(<TriValueCell {...props} />));
  const leaf = id => container.querySelector(`[data-testid="${id}"]`);
  return {
    retail: leaf("tri-retail"),
    paid: leaf("tri-paid"),
    market: leaf("tri-market"),
  };
}

// A BrickLink "modeled" value — the prior cell rendered this with an "est." badge.
const MODELED_MARKET = { amount: 120, source: "bricklink", basis: "modeled", condition: "new", asOf: null, lots: 4 };

describe("TriValueCell — Market line pins prior value-cell behavior (characterization)", () => {
  it("modeled BL value → figure + 'est.' marker (same as old inline cell)", () => {
    const { market } = render({ retail: null, paid: null, market: MODELED_MARKET });
    expect(market.textContent).toBe(`${money(120)}est.`);
    // tooltip lives on the Market row wrapper (old: title on the figure span)
    expect(market.closest("[title]").getAttribute("title")).toBe("Estimated from new sold price");
  });

  it("at-retail market value → retail caveat tooltip, no marker", () => {
    // setValueProvenance on a non-retired BE set yields basis:'retail' (the at-retail trap).
    const market = setValueProvenance({ source: "BrickEconomy", currentValue: 60, condition: "new", retired: false });
    const leaves = render({ retail: null, paid: null, market });
    expect(leaves.market.textContent).toBe(money(60)); // no confidence marker
    expect(leaves.market.closest("[title]").getAttribute("title")).toMatch(/sticker.*price/i);
  });

  it("unknown market value → '—', no tooltip", () => {
    const { market } = render({ retail: null, paid: null, market: { amount: null, source: null, basis: "unknown" } });
    expect(market.textContent).toBe("—");
    expect(market.closest("[title]")).toBeNull();
  });
});

describe("TriValueCell — three-up smoke (DOM-leaf)", () => {
  it("all three present: Retail / Paid / Market each show their figure", () => {
    const retail = setRetailProvenance({ brickset: { amount: 99.99 } });
    const { retail: r, paid: p, market: m } = render({ retail, paid: 80, market: MODELED_MARKET });
    expect(r.textContent).toBe(money(99.99));
    expect(p.textContent).toBe(money(80));
    expect(m.textContent).toBe(`${money(120)}est.`);
  });

  it("missing Paid (paid=null) → Paid line shows '—'", () => {
    const retail = setRetailProvenance({ brickset: { amount: 99.99 } });
    const { retail: r, paid: p, market: m } = render({ retail, paid: null, market: MODELED_MARKET });
    expect(r.textContent).toBe(money(99.99));
    expect(p.textContent).toBe("—");
    expect(m.textContent).toBe(`${money(120)}est.`);
  });

  it("former BE-only retail (polybag): now renders \"—\" (BE removed from the ladder in 3c)", () => {
    // No Brickset MSRP, no manual → setRetailProvenance returns null (a brickeconomy key is ignored).
    const retail = setRetailProvenance({ brickset: { amount: null }, brickeconomy: { amount: 4.99 } });
    expect(retail).toBeNull();
    const { retail: r } = render({ retail, paid: null, market: { amount: null, basis: "unknown" } });
    expect(r.textContent).toBe("—");
  });
});

describe("TriValueCell — compact density (Market only; pins pre-Step-2 cell)", () => {
  it("renders Market only — no Retail / Paid leaves", () => {
    const retail = setRetailProvenance({ brickset: { amount: 99.99 } });
    const { retail: r, paid: p, market: m } = render({ retail, paid: 80, market: MODELED_MARKET, density: "compact" });
    expect(r).toBeNull();
    expect(p).toBeNull();
    // Market figure + confidence badge + tooltip — byte-identical to the old inline cell (title on the span).
    expect(m.textContent).toBe(`${money(120)}est.`);
    expect(m.getAttribute("title")).toBe("Estimated from new sold price");
  });

  it("unknown market → '—'", () => {
    const { market: m } = render({ retail: null, paid: null, market: { amount: null, basis: "unknown" }, density: "compact" });
    expect(m.textContent).toBe("—");
    expect(m.getAttribute("title")).toBeNull();
  });
});

describe("TriValueCell — PAID line shows NO provenance marker (row markers removed)", () => {
  const noMarket = { amount: null, basis: "unknown" };

  it("MSRP-placeholder paid → figure only, NO marker, no tooltip", () => {
    // Even with an msrp paidProv (the placeholder source that used to draw "MSRP?"),
    // the PAID row now shows the bare figure — markers live only in the Overview disclosure.
    const { paid } = render({ retail: null, paid: 99.99, paidProv: { amount: 99.99, source: "msrp" }, market: noMarket });
    expect(paid.textContent).toBe(money(99.99));
    expect(paid.querySelector("span")).toBeNull(); // no badge span
    expect(paid.closest("[title]")).toBeNull();    // no MSRP tooltip on the row
  });

  it("real paid (ledger / manual) → figure only, NO marker", () => {
    for (const source of ["ledger", "manual"]) {
      const { paid } = render({ retail: null, paid: 50, paidProv: { amount: 50, source }, market: noMarket });
      expect(paid.textContent).toBe(money(50));
      expect(paid.querySelector("span")).toBeNull(); // no badge span
    }
  });

  it("no paidProv passed → figure only", () => {
    const { paid } = render({ retail: null, paid: 50, market: noMarket });
    expect(paid.textContent).toBe(money(50));
    expect(paid.querySelector("span")).toBeNull();
  });
});
