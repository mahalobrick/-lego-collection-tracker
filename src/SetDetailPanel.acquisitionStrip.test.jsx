import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Single-copy breakdown collapse (Pass A).
//
// For qty === 1 the per-copy money quad (Paid / Value / Gain / ROI) merely echoes the
// Value & Returns tiles above (set === copy when there's one copy), so the panel suppresses
// it and renders an "Acquisition" strip carrying ONLY the facts the tiles don't: condition ·
// acquired date · notes. The strip SELF-REMOVES entirely when the lone copy has none of the
// three — no section label, no empty box, no "Copy N" stub.
//
// qty > 1 is untouched: the full per-copy money grid still renders (additive there). That path
// is also pinned by copyPaid / acquiredDate / costbasis; here we add a lock that the multi-copy
// header + grid (and the now-LABELED corner ROI) survive the collapse branch.
//
// Real panel, no mocks (history / BrickLink self-guard in jsdom), mirroring the costbasis harness.
// NOTE: no default condition is injected — fixtures set (or omit) condition explicitly so the
// empty-state case truly has none.
// ─────────────────────────────────────────────────────────────────────────────

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const renderPanel = (item) => act(() => root.render(<SetDetailPanel item={item} onClose={() => {}} />));
// Section textContent scoped to its label's parent (so the Value & Returns tiles can't satisfy
// a per-copy assertion by accident).
const sectionText = (label) => {
  const el = [...container.querySelectorAll("div")].find(d => d.textContent === label);
  return el ? el.parentElement.textContent : null;
};

describe("SetDetailPanel — single-copy collapse → Acquisition strip", () => {
  it("qty===1 with full metadata: Acquisition strip shows condition·acquired·notes, NO money quad", () => {
    renderPanel({
      setNumber: "10300-1", name: "Eiffel Tower", theme: "Icons", quantity: 1,
      entries: [{ condition: "used", paid_price: 50, current_value: 80, acquired_date: "2024-03-01", notes: "sealed box" }],
    });
    const strip = sectionText("Acquisition");
    expect(strip, "Acquisition section renders").toBeTruthy();
    expect(strip).toContain("Used");      // condition pill
    expect(strip).toContain("Mar 2024");  // acquired date
    expect(strip).toContain("sealed box"); // notes
    // The echoed money quad is gone from the strip (those labels live only in Value & Returns now).
    expect(strip).not.toContain("Paid");
    expect(strip).not.toContain("Gain");
    // We took the single-copy branch — the multi-copy header is absent.
    expect(container.textContent).not.toContain("Per-Copy Breakdown");
  });

  it("qty===1 with NONE of {condition, acquired, notes}: self-removes — no label, no strip, no stub", () => {
    renderPanel({
      setNumber: "10300-1", name: "Eiffel Tower", theme: "Icons", quantity: 1,
      entries: [{ paid_price: 50, current_value: 80 }], // no condition, no date, no notes
    });
    expect(container.textContent).not.toContain("Acquisition");        // section label absent
    expect(container.textContent).not.toContain("Per-Copy Breakdown"); // multi-copy header absent
    expect(container.textContent).not.toContain("Copy 1");             // no "Copy N" fallback row
  });

  it("qty===1 partial (condition only): strip shows just the condition, still no money quad", () => {
    renderPanel({
      setNumber: "10300-1", name: "Eiffel Tower", theme: "Icons", quantity: 1,
      entries: [{ condition: "new", paid_price: 50, current_value: 80 }], // no date, no notes
    });
    const strip = sectionText("Acquisition");
    expect(strip, "Acquisition section renders for a lone condition").toBeTruthy();
    expect(strip).toContain("New");
    expect(strip).not.toContain("Paid");
    expect(strip).not.toContain("Gain");
    expect(container.textContent).not.toContain("Per-Copy Breakdown");
  });

  it("qty>1: full per-copy money grid still renders (Paid/Value/Gain) with a LABELED corner ROI", () => {
    renderPanel({
      setNumber: "75313-1", name: "AT-AT", theme: "Star Wars",
      quantity: 2, qty: 2, totalPaid: 1600, totalValue: 2000, currentValue: 2000, averagePaid: 800,
      entries: [
        { condition: "new", paid_price: 800, current_value: 1000 },
        { condition: "new", paid_price: 800, current_value: 1000 },
      ],
    });
    const grid = sectionText("Per-Copy Breakdown");
    expect(grid, "multi-copy breakdown renders").toBeTruthy();
    expect(grid).toContain("Paid");
    expect(grid).toContain("Value");
    expect(grid).toContain("Gain");
    expect(grid).toContain("ROI");           // corner ROI now carries the "ROI" label (Change 4b)
    expect(container.textContent).not.toContain("Acquisition"); // collapse branch not taken
  });
});
