import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";

// ─────────────────────────────────────────────────────────────────────────────
// BE removal — panel metadata source-swap (pieces / release-year) → Brickset.
// SetDetailPanel must read pieces/year from the Brickset device cache
// (bricksetSetCache, keyed `brickset_<n>`, field `pieces`/`year`), NOT from the
// BrickEconomy cache (brickEconomySetCache, field `pieces_count`/`year`). When
// Brickset is absent the chips hide ("—" / no chip), and a stale BE value must
// NEVER leak through. Sibling to SetDetailPanel.retail.test.jsx (the MSRP swap).
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

function seedBE(setNumber, pieces, year) {
  const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
  cache[setNumber] = { fetchedAt: "2026-06-01T00:00:00.000Z", data: { pieces_count: pieces, year } };
  localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
}
function seedBrickset(setNumber, pieces, year) {
  const cache = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}");
  cache[`brickset_${setNumber}`] = { fetchedAt: "2026-06-01T00:00:00.000Z", data: { pieces, year } };
  localStorage.setItem("bricksetSetCache", JSON.stringify(cache));
}

function panelText(setNumber, extra = {}) {
  const item = { setNumber, condition: "new", quantity: 1, entries: [], ...extra };
  act(() => root.render(<SetDetailPanel item={item} onClose={() => {}} />));
  return container.textContent;
}

describe("SetDetailPanel — pieces/year sourced from Brickset (BE source-swap)", () => {
  it("Brickset present: chips show the Brickset pieces/year, never the BrickEconomy ones", () => {
    seedBE("10300-1", 1111, 1991);       // BE-shaped, distinct values
    seedBrickset("10300-1", 2222, 2015); // Brickset-shaped — must win
    const txt = panelText("10300-1");
    expect(txt).toContain(`${(2222).toLocaleString()} pcs`);
    expect(txt).toContain("2015");
    expect(txt).not.toContain(`${(1111).toLocaleString()} pcs`);
    expect(txt).not.toContain("1991");
  });

  it("Brickset absent: no BE value leaks — pieces chip hidden, no crash", () => {
    seedBE("10300-1", 1111, 1991); // only BE seeded — must be ignored now
    const txt = panelText("10300-1");
    expect(txt).not.toContain(`${(1111).toLocaleString()} pcs`);
    expect(txt).not.toContain("1991");
    // panel still renders its header (set number) — no crash from the missing source
    expect(txt).toContain("10300-1");
  });
});
