import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import WatchDetailPanel from "./WatchDetailPanel";
import { money } from "./utils/formatting";

// ─────────────────────────────────────────────────────────────────────────────
// BE removal — panel metadata source-swap → Brickset. WatchDetailPanel reads
// pieces / release-year from the Brickset device cache (bricksetSetCache, keyed
// `brickset_<n>`: `pieces`/`year`), NOT BrickEconomy (`pieces_count`/`year`).
// CRITICAL: the BrickEconomy marketValue (`current_value_new`) + price-history
// chart are D3 — OUT OF SCOPE — and MUST keep reading the BE cache. These tests
// pin both: metadata follows Brickset; marketValue stays on BrickEconomy.
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

function seedBE(setNumber, { pieces, year, marketValue }) {
  const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
  cache[setNumber] = { fetchedAt: "2026-06-01T00:00:00.000Z", data: { pieces_count: pieces, year, current_value_new: marketValue } };
  localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
}
function seedBrickset(setNumber, { pieces, year }) {
  const cache = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}");
  cache[`brickset_${setNumber}`] = { fetchedAt: "2026-06-01T00:00:00.000Z", data: { pieces, year } };
  localStorage.setItem("bricksetSetCache", JSON.stringify(cache));
}

function panelText(extra = {}) {
  const item = { setNumber: "10300-1", name: "Test Watch", theme: "Icons", ...extra };
  act(() => root.render(<WatchDetailPanel item={item} onClose={() => {}} />));
  return container.textContent;
}

describe("WatchDetailPanel — pieces/year from Brickset, marketValue stays BrickEconomy (D3)", () => {
  it("Brickset present: chips show Brickset pieces/year; BE marketValue still renders", () => {
    seedBE("10300-1", { pieces: 1111, year: 1991, marketValue: 555 });
    seedBrickset("10300-1", { pieces: 2222, year: 2015 });
    const txt = panelText();
    expect(txt).toContain(`${(2222).toLocaleString()} pcs`);
    expect(txt).toContain("2015");
    expect(txt).not.toContain(`${(1111).toLocaleString()} pcs`);
    expect(txt).not.toContain("1991");
    expect(txt).toContain(money(555)); // D3: marketValue untouched
  });

  it("Brickset absent: BE metadata does NOT leak, but BE marketValue STILL renders (D3 intact)", () => {
    seedBE("10300-1", { pieces: 1111, year: 1991, marketValue: 555 });
    const txt = panelText();
    expect(txt).not.toContain(`${(1111).toLocaleString()} pcs`);
    expect(txt).not.toContain("1991");
    expect(txt).toContain(money(555)); // value path untouched — proves only metadata swapped
  });
});
