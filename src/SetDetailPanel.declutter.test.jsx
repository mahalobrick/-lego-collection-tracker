import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";
import { money } from "./utils/formatting";

// ─────────────────────────────────────────────────────────────────────────────
// Declutter + reflow — locks the cumulative panel-top state:
//   • no Year chip and no spec pill — the chips row is gone entirely;
//   • theme renders as a pill in the header; #setNumber stays plain text;
//   • per-copy tiles (Avg Paid / Value per Copy) only when qty > 1;
//   • MSRP lives in a "Value & Returns" StatBox (anchor-first); subtheme dropped;
//   • "Set Details" restored as Pieces + Minifigs StatBox tiles (unified look).
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

describe("SetDetailPanel — no chips row (year + spec pill removed)", () => {
  it("renders no spec pill regardless of cached pieces/minifigs; the year lives only in Timeline", () => {
    seedBrickset("12345-1", { year: 2015, pieces: 500, minifigs: 4 }); // no launch_date → Released = year
    renderPanel({ setNumber: "12345-1", retired: false });
    expect(container.querySelector('[data-testid="detail-spec-pill"]'), "spec pill removed").toBeNull();
    expect(sectionText("Timeline")).toContain("2015"); // Timeline still carries the release year
  });
});

describe("SetDetailPanel — Set Details restored (Pieces + Minifigs tiles)", () => {
  it("pieces + minifigs → section with both tiles (pieces formatted with a thousands separator)", () => {
    seedBrickset("12345-1", { pieces: 4514, minifigs: 6 });
    renderPanel({ setNumber: "12345-1" });
    const t = sectionText("Set Details");
    expect(t).toBeTruthy();
    expect(t).toContain("Pieces");
    expect(t).toContain("4,514");   // thousands separator
    expect(t).toContain("Minifigs");
    expect(t).toContain("6");
  });
  it("pieces only → Pieces tile present, Minifigs absent, section still renders", () => {
    seedBrickset("12345-1", { pieces: 1200 });
    renderPanel({ setNumber: "12345-1" });
    const t = sectionText("Set Details");
    expect(t).toBeTruthy();
    expect(t).toContain("Pieces");
    expect(t).toContain("1,200");
    expect(t).not.toContain("Minifigs");
  });
  it("minifigs only → Minifigs tile present, Pieces absent, section still renders", () => {
    seedBrickset("12345-1", { minifigs: 6 });
    renderPanel({ setNumber: "12345-1" });
    const t = sectionText("Set Details");
    expect(t).toBeTruthy();
    expect(t).toContain("Minifigs");
    expect(t).not.toContain("Pieces");
  });
  it("neither → 'Set Details' section is absent", () => {
    seedBrickset("12345-1", {});
    renderPanel({ setNumber: "12345-1" });
    expect(sectionText("Set Details")).toBeNull();
  });
});

describe("SetDetailPanel — subtheme stays dropped", () => {
  it("subtheme is shown nowhere, even when cached", () => {
    seedBrickset("12345-1", { subtheme: "Modular Buildings", minifigs: 3 });
    renderPanel({ setNumber: "12345-1" });
    expect(container.textContent).not.toContain("Modular Buildings");
    expect(container.textContent).not.toContain("Subtheme");
  });
});

describe("SetDetailPanel — MSRP in the Value & Returns section (unchanged)", () => {
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
  it("the MSRP tile precedes Paid in the DOM (anchor-first)", () => {
    seedBrickset("12345-1", { retail_price_us: 100 });
    renderPanel({ setNumber: "12345-1" });
    const all = [...container.querySelectorAll("div")];
    const msrp = container.querySelector('[data-testid="msrp-chip"]');
    const cost = all.find(d => d.firstChild?.textContent === "Paid");
    expect(all.indexOf(msrp)).toBeLessThan(all.indexOf(cost));
  });
});

describe("SetDetailPanel — header: name-first, theme as plain muted text (no pill)", () => {
  it("drops the theme pill; renders #setNumber + theme as a plain muted subtitle after the name", () => {
    renderPanel({ setNumber: "12345-1", name: "AT-AT", theme: "Star Wars" });
    expect(container.querySelector('[data-testid="detail-theme-pill"]'), "theme pill dropped").toBeNull();
    expect(container.textContent).toContain("#12345-1"); // set number still shown (mono)
    expect(container.textContent).toContain("Star Wars"); // theme still shown (plain muted text)
    // Set Name (h2) precedes the "#num · theme" subtitle in DOM order (mirrors the Identity cell).
    const h2 = container.querySelector("h2");
    const numSpan = [...container.querySelectorAll("span")].find(n => n.textContent.includes("#12345-1"));
    expect(h2, "set-name h2 renders").toBeTruthy();
    expect(numSpan, "subtitle #setNumber span renders").toBeTruthy();
    expect(h2.compareDocumentPosition(numSpan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("SetDetailPanel — per-copy tiles only when qty > 1", () => {
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
