import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import WantedList from "./WantedList";

// ─────────────────────────────────────────────────────────────────────────────
// BE removal — panel metadata source-swap → Brickset. The WantedList "Set Age"
// (ageMonths) cell must derive age from the ROW's `releaseYear` (Brickset-sourced
// via the mount enrichment loop), NEVER from the BrickEconomy device cache
// (brickEconomySetCache `.year`/`.released_date`). The BE fallback at the cell is
// deleted by this arc. So: a row WITH releaseYear shows its age; a row WITHOUT it
// shows "—" even when the BE cache holds a year (no leak, no crash).
// ─────────────────────────────────────────────────────────────────────────────

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;

beforeEach(() => {
  localStorage.clear();
  // jsdom has no matchMedia — WantedList reads it on mount; polyfill a no-op.
  if (!window.matchMedia) {
    window.matchMedia = (q) => ({
      matches: false, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent() { return false; },
    });
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Make the (default-hidden) ageMonths column visible; the merge logic re-appends
// the other defaults, so this one minimal entry is enough to surface "Set Age".
function showAgeColumn() {
  localStorage.setItem("blAcquisitionColumns", JSON.stringify([
    { key: "ageMonths", label: "Set Age", visible: true, group: "details" },
  ]));
}
function seedWanted(item) {
  localStorage.setItem("blWantedList", JSON.stringify([{ id: "wl_test_1", ...item }]));
}
function seedBEYear(setNumber, year) {
  localStorage.setItem("brickEconomySetCache", JSON.stringify({
    [setNumber]: { fetchedAt: "2026-06-01T00:00:00.000Z", data: { year } },
  }));
}

function render() {
  act(() => root.render(<WantedList onBuyNow={() => {}} />));
  // The row table lives under the "Tracking" sub-tab (default is "overview").
  const trackingBtn = [...container.querySelectorAll("button")].find(b => b.textContent.trim() === "Tracking");
  act(() => trackingBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return container.textContent;
}

describe("WantedList Set Age — derived from the row's releaseYear, never BrickEconomy", () => {
  it("row releaseYear present: shows an age; the BE-cache year (1991) is ignored", () => {
    showAgeColumn();
    seedWanted({ setNumber: "10300-1", name: "Test", releaseYear: "2015" });
    seedBEYear("10300-1", 1991); // must NOT override the row's 2015
    const txt = render();
    expect(txt).toMatch(/\d+yr/);       // an age rendered…
    expect(txt).not.toContain("34yr");  // …from 2015 (~10yr), not BE's 1991 (~34yr)
    expect(txt).not.toContain("35yr");
  });

  it("row releaseYear absent: cell is \"—\" even though the BE cache holds a year (no fallback)", () => {
    showAgeColumn();
    seedWanted({ setNumber: "10300-1", name: "Test" }); // no releaseYear
    seedBEYear("10300-1", 1991);
    const txt = render();
    expect(txt).not.toContain("34yr"); // BE fallback gone → no 1991-derived age
    expect(txt).not.toContain("35yr");
  });
});
