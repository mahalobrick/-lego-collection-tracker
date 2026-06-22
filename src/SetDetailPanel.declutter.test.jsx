import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";
import { money } from "./utils/formatting";

// ─────────────────────────────────────────────────────────────────────────────
// Declutter + reflow — locks the cumulative panel-top changes:
//   • no Year chip (Timeline "Released" carries it); theme renders as a pill;
//   • per-copy tiles (Avg Paid / Value per Copy) only when qty > 1;
//   • pieces + minifigs merged into ONE spec pill (absent parts omitted; singular "1 minifig");
//   • subtheme dropped and the whole "Set Details" section removed;
//   • MSRP relocated from the chips row into a "Value & Returns" StatBox (anchor-first tile).
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
const specPillText = () => container.querySelector('[data-testid="detail-spec-pill"]')?.textContent ?? "";

describe("SetDetailPanel declutter — year chip", () => {
  it("no Year chip in the chips row, but Timeline 'Released' still shows the year", () => {
    seedBrickset("12345-1", { year: 2015, pieces: 500 }); // no launch_date → Released falls back to year
    renderPanel({ setNumber: "12345-1", retired: false });
    expect(specPillText()).toContain("pcs");           // chips row is now the spec pill (pieces)
    expect(specPillText()).not.toContain("2015");       // …no year
    expect(sectionText("Timeline")).toContain("2015");  // Timeline still carries the release year
  });
});

describe("SetDetailPanel reflow — merged spec pill (pieces + minifigs)", () => {
  it("both present → one pill with pcs AND minifigs", () => {
    seedBrickset("12345-1", { pieces: 1200, minifigs: 4 });
    renderPanel({ setNumber: "12345-1" });
    expect(specPillText()).toContain("1,200 pcs");
    expect(specPillText()).toContain("4 minifigs");
  });
  it("pieces only → pcs, no minifig", () => {
    seedBrickset("12345-1", { pieces: 1200 });
    renderPanel({ setNumber: "12345-1" });
    expect(specPillText()).toContain("pcs");
    expect(specPillText()).not.toContain("minifig");
  });
  it("minifigs only → 'minifig', no pcs; singularizes 1", () => {
    seedBrickset("12345-1", { minifigs: 1 });
    renderPanel({ setNumber: "12345-1" });
    expect(specPillText()).toContain("1 minifig");
    expect(specPillText()).not.toContain("minifigs"); // singular, not "minifigs"
    expect(specPillText()).not.toContain("pcs");
  });
  it("neither present → no spec pill in the DOM", () => {
    seedBrickset("12345-1", {});
    renderPanel({ setNumber: "12345-1" });
    expect(container.querySelector('[data-testid="detail-spec-pill"]')).toBeNull();
  });
});

describe("SetDetailPanel reflow — subtheme + Set Details section dropped", () => {
  it("subtheme is shown nowhere, even when cached", () => {
    seedBrickset("12345-1", { subtheme: "Modular Buildings", minifigs: 3 });
    renderPanel({ setNumber: "12345-1" });
    expect(container.textContent).not.toContain("Modular Buildings");
    expect(container.textContent).not.toContain("Subtheme");
  });
  it("the 'Set Details' section never renders, regardless of metadata", () => {
    seedBrickset("12345-1", { subtheme: "Modular Buildings", minifigs: 3, pieces: 1200 });
    renderPanel({ setNumber: "12345-1" });
    expect(sectionText("Set Details")).toBeNull();
  });
});

describe("SetDetailPanel reflow — MSRP in the Value & Returns section", () => {
  it("renders the MSRP tile with the retail figure, under a 'Value & Returns' header", () => {
    seedBrickset("12345-1", { retail_price_us: 100 });
    renderPanel({ setNumber: "12345-1" });
    expect(sectionText("Value & Returns")).toBeTruthy();        // header renders above the grid
    const tile = container.querySelector('[data-testid="msrp-chip"]');
    expect(tile, "MSRP tile renders").toBeTruthy();
    expect(tile.textContent).toContain("MSRP");
    expect(tile.textContent).toContain(money(100));
  });
  it("no-MSRP set shows the '—' treatment in the tile", () => {
    seedBrickset("12345-1", {}); // no retail anywhere
    renderPanel({ setNumber: "12345-1" });
    expect(container.querySelector('[data-testid="msrp-chip"]').textContent).toContain("—");
  });
  it("MSRP is no longer in the chips row, and the MSRP tile precedes Cost Basis in the DOM", () => {
    seedBrickset("12345-1", { retail_price_us: 100, pieces: 500 });
    renderPanel({ setNumber: "12345-1" });
    expect(specPillText()).not.toContain("MSRP");              // chips row (spec pill) carries no MSRP
    const all = [...container.querySelectorAll("div")];
    const msrp = container.querySelector('[data-testid="msrp-chip"]');
    const cost = all.find(d => d.firstChild?.textContent === "Cost Basis");
    expect(all.indexOf(msrp)).toBeLessThan(all.indexOf(cost)); // anchor-first ordering
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
