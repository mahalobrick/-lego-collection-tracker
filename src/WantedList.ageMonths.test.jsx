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

// Make the (default-hidden) Set Age + pieces columns visible; the merge logic
// re-appends the other defaults, so these minimal entries are enough to surface them.
function showColumns(...keys) {
  localStorage.setItem("blAcquisitionColumns", JSON.stringify(
    keys.map(key => ({ key, label: key, visible: true, group: "details" }))
  ));
}
function seedWanted(item) {
  localStorage.setItem("blWantedList", JSON.stringify([{ id: "wl_test_1", ...item }]));
}
function seedBEYear(setNumber, year) {
  localStorage.setItem("brickEconomySetCache", JSON.stringify({
    [setNumber]: { fetchedAt: "2026-06-01T00:00:00.000Z", data: { year } },
  }));
}
// A WARM Brickset cache entry (recent fetchedAt → within the 7d TTL) so the mount
// enrichment loop's fetchBricksetSet() peek-hits synchronously, no network needed.
function seedBricksetWarm(setNumber, data) {
  localStorage.setItem("bricksetSetCache", JSON.stringify({
    [`brickset_${setNumber}`]: { fetchedAt: new Date().toISOString(), data },
  }));
}

function clickTracking() {
  const trackingBtn = [...container.querySelectorAll("button")].find(b => b.textContent.trim() === "Tracking");
  act(() => trackingBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function render() {
  act(() => root.render(<WantedList onBuyNow={() => {}} />));
  // The row table lives under the "Tracking" sub-tab (default is "overview").
  clickTracking();
  return container.textContent;
}

// Render, then flush the async mount enrichment loop (fetchBricksetSet resolves on a
// microtask from the warm peek; the row-patch setWanted lands before the loop's 400ms
// throttle), then surface the table. Returns the table text AFTER the row is enriched.
async function renderEnriched() {
  await act(async () => { root.render(<WantedList onBuyNow={() => {}} />); });
  // Flush several microtask turns so the warm fetchBricksetSet → setWanted applies.
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
  clickTracking();
  return container.textContent;
}

describe("WantedList Set Age — derived from the row's releaseYear, never BrickEconomy", () => {
  it("row releaseYear present: shows an age; the BE-cache year (1991) is ignored", () => {
    showColumns("ageMonths");
    seedWanted({ setNumber: "10300-1", name: "Test", releaseYear: "2015" });
    seedBEYear("10300-1", 1991); // must NOT override the row's 2015
    const txt = render();
    expect(txt).toMatch(/\d+yr/);       // an age rendered…
    expect(txt).not.toContain("34yr");  // …from 2015 (~10yr), not BE's 1991 (~34yr)
    expect(txt).not.toContain("35yr");
  });

  it("row releaseYear absent: cell is \"—\" even though the BE cache holds a year (no fallback)", () => {
    showColumns("ageMonths");
    seedWanted({ setNumber: "10300-1", name: "Test" }); // no releaseYear
    seedBEYear("10300-1", 1991);
    const txt = render();
    expect(txt).not.toContain("34yr"); // BE fallback gone → no 1991-derived age
    expect(txt).not.toContain("35yr");
  });

  // The actual new site-4 production code: the mount enrichment loop backfills
  // releaseYear (String) + pieces (Number) from the warm Brickset cache onto a bare
  // row, so the Set Age + pieces cells then render Brickset-sourced values. Without
  // this, deleting the two loop lines would leave both cells silently "—".
  it("enrichment loop backfills releaseYear + pieces from Brickset onto a bare row", async () => {
    showColumns("ageMonths", "pieces");
    seedWanted({ setNumber: "10300-1", name: "Test" }); // no releaseYear, no pieces, no exit_date → "stale"
    seedBricksetWarm("10300-1", { year: 2015, pieces: 2222 });
    const txt = await renderEnriched();
    // Set Age now derives from the backfilled releaseYear (String "2015" → Number()'d → age).
    expect(txt).toMatch(/\d+yr/);
    expect(txt).not.toContain("—34yr"); // sanity: not a stale-BE age
    // pieces backfilled as a Number → .toLocaleString() groups it (a String would not).
    expect(txt).toContain((2222).toLocaleString());
  });
});
