import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Declutter pass — locks the four removals/changes:
//   1. the duplicate Year chip is gone from the chips row (Timeline "Released" still carries it);
//   2. Rating + Min Age tiles are gone; the "Set Details" section no longer renders when ONLY
//      rating/ageMin would have populated it (gate is now subtheme || minifigs != null);
//   3. theme renders as a pill (neutral primitive) next to the plain #setNumber;
//   4. "Avg Paid / Copy" + "Value / Copy" tiles render only when qty > 1.
// Mirrors the Timeline test harness: real panel, Brickset device cache seeded, no mocks.
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

function seedBrickset(setNumber, data) {
  const cache = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}");
  cache[`brickset_${setNumber}`] = { fetchedAt: "2026-06-01T00:00:00.000Z", data };
  localStorage.setItem("bricksetSetCache", JSON.stringify(cache));
}
function renderPanel(item) {
  act(() => root.render(
    <SetDetailPanel item={{ condition: "new", quantity: 1, entries: [], ...item }} onClose={() => {}} />,
  ));
}
// Section textContent scoped to its sectionLabel's parent (so chips/header can't satisfy by accident).
const sectionText = (label) => {
  const el = [...container.querySelectorAll("div")].find(d => d.textContent === label);
  return el ? el.parentElement.textContent : null;
};
const chipsRowText = () => container.querySelector('[data-testid="msrp-chip"]')?.parentElement.textContent ?? "";

describe("SetDetailPanel declutter — year chip", () => {
  it("drops the Year chip from the chips row, but Timeline 'Released' still shows the year", () => {
    seedBrickset("12345-1", { year: 2015, pieces: 500 }); // no launch_date → Released falls back to year
    renderPanel({ setNumber: "12345-1", retired: false });
    expect(chipsRowText()).toContain("pcs");          // chips row still has Pieces + MSRP
    expect(chipsRowText()).not.toContain("2015");      // …but NOT a year chip
    expect(sectionText("Timeline")).toContain("2015"); // Timeline still carries the release year
  });
});

describe("SetDetailPanel declutter — Rating + Min Age cut", () => {
  it("renders neither Rating nor Min Age, even when both are cached (section shown via subtheme)", () => {
    seedBrickset("12345-1", { subtheme: "Modular Buildings", minifigs: 3, rating: 4.5, age_min: 18 });
    renderPanel({ setNumber: "12345-1" });
    const t = sectionText("Set Details");
    expect(t).toBeTruthy();
    expect(t).toContain("Subtheme");
    expect(t).toContain("Modular Buildings");
    expect(t).toContain("Minifigs");
    expect(t).not.toContain("Rating");
    expect(t).not.toContain("★");
    expect(t).not.toContain("Min Age");
  });
  it("does NOT render the 'Set Details' section when only rating/ageMin would populate it", () => {
    seedBrickset("12345-1", { rating: 4.5, age_min: 18 }); // no subtheme, no minifigs
    renderPanel({ setNumber: "12345-1" });
    expect(sectionText("Set Details"), "section gated out when only rating/ageMin present").toBeNull();
  });
  it("still renders the section when minifigs alone is present", () => {
    seedBrickset("12345-1", { minifigs: 4 });
    renderPanel({ setNumber: "12345-1" });
    const t = sectionText("Set Details");
    expect(t).toBeTruthy();
    expect(t).toContain("Minifigs");
  });
});

describe("SetDetailPanel declutter — theme pill", () => {
  it("renders the theme inside a pill, with #setNumber as plain text", () => {
    renderPanel({ setNumber: "12345-1", theme: "Star Wars" });
    const pill = container.querySelector('[data-testid="detail-theme-pill"]');
    expect(pill, "theme renders as a pill element").toBeTruthy();
    expect(pill.textContent).toBe("Star Wars");
    expect(container.textContent).toContain("#12345-1"); // set number still shown
  });
});

describe("SetDetailPanel declutter — per-copy tiles only when qty > 1", () => {
  it("qty === 1: 'Avg Paid / Copy' and 'Value / Copy' are absent", () => {
    renderPanel({ setNumber: "12345-1", quantity: 1, totalPaid: 100, totalValue: 150,
      entries: [{ paid_price: 100, current_value: 150, condition: "new" }] });
    expect(container.textContent).not.toContain("Avg Paid / Copy");
    expect(container.textContent).not.toContain("Value / Copy");
  });
  it("qty > 1: both per-copy tiles render", () => {
    renderPanel({ setNumber: "12345-1", quantity: 2, totalPaid: 200, totalValue: 300,
      entries: [
        { paid_price: 100, current_value: 150, condition: "new" },
        { paid_price: 100, current_value: 150, condition: "new" },
      ] });
    expect(container.textContent).toContain("Avg Paid / Copy");
    expect(container.textContent).toContain("Value / Copy");
  });
});
