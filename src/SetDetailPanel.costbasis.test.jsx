import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";

// ─────────────────────────────────────────────────────────────────────────────
// G4 FOUND-DURING-WORK — panel Cost Basis reconcile (per-set fix-#4 principle).
//
// Phase 2 surfaced it: a manual set's panel showed Cost Basis $0.00 while its Net
// Gain / ROI implied a real cost (3×$120 Eiffel Tower → gain $540, ROI +150% ⇒ a $360
// basis). The Cost Basis StatBox read item.totalPaid directly (absent on manual sets),
// while Gain/ROI used setCost — so within ONE panel the numbers disagreed.
//
// FIX: Cost Basis = Σ of the per-copy paids the breakdown DISPLAYS (materializeEntries).
// LANDMINE finding: imported entries[] CAN carry divergent per-copy paids, but
// aggregateFromEntries (beCollection.js:32) computes totalPaid as the SUM of them — so
// for imported sets Σ-copies === item.totalPaid === setCost already. Imported sets
// (uniform AND divergent) do NOT move; only manual sets are corrected. Pinned below.
//
// These render the REAL panel and read the StatBox leaf text — the reconcile invariant
// is asserted on what the USER sees: Paid === Value − Net Gain.
// ─────────────────────────────────────────────────────────────────────────────

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
});

function renderPanel(item) {
  act(() => root.render(<SetDetailPanel item={item} onClose={() => {}} />));
}

// Leaf value of a StatBox by its label text (label div → next sibling value div).
function statValue(label) {
  const labelDiv = [...container.querySelectorAll("div")].find(
    (d) => d.firstChild && d.firstChild.nodeType === 3 && d.textContent.trim() === label,
  );
  return labelDiv?.nextElementSibling?.textContent.trim() ?? null;
}

const cents = (txt) => Math.round(Number(String(txt).replace(/[$,]/g, "")) * 100);

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Manual (line-level): no totalPaid → the bug. 3×$120 paid, $300/copy value.
const MANUAL = {
  setNumber: "10300-1", name: "Eiffel Tower", theme: "Icons",
  condition: "new", qty: 3, paidPrice: 120, currentValue: 300,
};
// Imported, UNIFORM paids: totalPaid present (== Σ copies). 2×$800 paid, $2,000 value.
const IMPORTED_UNIFORM = {
  setNumber: "75313-1", name: "AT-AT", theme: "Star Wars",
  quantity: 2, qty: 2, totalPaid: 1600, totalValue: 2000, currentValue: 2000, averagePaid: 800,
  entries: [
    { condition: "new", paid_price: 800, current_value: 1000 },
    { condition: "new", paid_price: 800, current_value: 1000 },
  ],
};
// Imported, DIVERGENT paids: $100 + $300 (Σ === totalPaid 400). $1,000 value.
const IMPORTED_DIVERGENT = {
  setNumber: "42100-1", name: "Liebherr", theme: "Technic",
  quantity: 2, qty: 2, totalPaid: 400, totalValue: 1000, currentValue: 1000, averagePaid: 200,
  entries: [
    { condition: "new", paid_price: 100, current_value: 500 },
    { condition: "new", paid_price: 300, current_value: 500 },
  ],
};

describe("panel Paid reconcile — Paid === Value − Net Gain", () => {
  it("MANUAL set: Paid is the real $360, reconciling with Gain/ROI (was $0.00)", () => {
    renderPanel(MANUAL);
    // PRE-FIX this StatBox read "$0.00" (item.totalPaid absent) while Gain implied $360.
    expect(statValue("Paid")).toBe("$360.00");
    expect(statValue("Value")).toBe("$900.00");
    expect(statValue("Net Gain")).toBe("$540.00");
    // The reconcile invariant, on displayed dollars:
    expect(cents(statValue("Paid"))).toBe(cents("$900.00") - cents("$540.00"));
    expect(statValue("ROI")).toBe("+150.0%");
    expect(statValue("Avg Paid / Copy")).toBe("$120.00"); // 360/3, was $0.00
  });

  it("IMPORTED uniform set: unchanged — Paid $1,600 reconciles", () => {
    renderPanel(IMPORTED_UNIFORM);
    expect(statValue("Paid")).toBe("$1,600.00");
    expect(cents(statValue("Paid")))
      .toBe(cents(statValue("Value")) - cents(statValue("Net Gain")));
  });

  it("IMPORTED divergent paids ($100+$300): Paid is the $400 SUM, reconciles", () => {
    renderPanel(IMPORTED_DIVERGENT);
    expect(statValue("Paid")).toBe("$400.00"); // Σ divergent copies, not avg×qty
    expect(cents(statValue("Paid")))
      .toBe(cents(statValue("Value")) - cents(statValue("Net Gain")));
  });
});
