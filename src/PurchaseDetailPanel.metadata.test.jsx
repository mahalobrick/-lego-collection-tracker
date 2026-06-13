import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import PurchaseDetailPanel from "./PurchaseDetailPanel";
import { money } from "./utils/formatting";

// ─────────────────────────────────────────────────────────────────────────────
// BE removal — panel metadata source-swap → Brickset. PurchaseDetailPanel reads
// pieces / release-year AND msrp from the Brickset device cache (bricksetSetCache,
// keyed `brickset_<n>`: fields `pieces`/`year`/`retail_price_us`), NOT from the
// BrickEconomy cache (brickEconomySetCache: `pieces_count`/`year`/`retail_price_us`).
// The MSRP chip + vs.MSRP box feed off the swapped msrp. Brickset absent → "—",
// no BE value leaks, no crash (same coverage class BE had for purchase-only sets).
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

function seedBE(setNumber, { pieces, year, retail }) {
  const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
  cache[setNumber] = { fetchedAt: "2026-06-01T00:00:00.000Z", data: { pieces_count: pieces, year, retail_price_us: retail } };
  localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
}
function seedBrickset(setNumber, { pieces, year, retail }) {
  const cache = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}");
  cache[`brickset_${setNumber}`] = { fetchedAt: "2026-06-01T00:00:00.000Z", data: { pieces, year, retail_price_us: retail } };
  localStorage.setItem("bricksetSetCache", JSON.stringify(cache));
}

function panelText(extra = {}) {
  const item = { setNumber: "10300-1", name: "Test Purchase", theme: "Icons", faceValue: 50, qty: 1, ...extra };
  act(() => root.render(<PurchaseDetailPanel item={item} onClose={() => {}} />));
  return container.textContent;
}

describe("PurchaseDetailPanel — pieces/year/msrp sourced from Brickset (BE source-swap)", () => {
  it("Brickset present: chips show the Brickset pieces/year/msrp, never the BrickEconomy ones", () => {
    seedBE("10300-1", { pieces: 1111, year: 1991, retail: 11 });
    seedBrickset("10300-1", { pieces: 2222, year: 2015, retail: 99.99 });
    const txt = panelText();
    expect(txt).toContain(`${(2222).toLocaleString()} pcs`);
    expect(txt).toContain("2015");
    expect(txt).toContain(`MSRP ${money(99.99)}`);
    expect(txt).not.toContain(`${(1111).toLocaleString()} pcs`);
    expect(txt).not.toContain("1991");
    expect(txt).not.toContain(money(11)); // BE msrp must not leak
  });

  it("Brickset absent: no BE value leaks — chips hidden, no crash", () => {
    seedBE("10300-1", { pieces: 1111, year: 1991, retail: 11 });
    const txt = panelText();
    expect(txt).not.toContain(`${(1111).toLocaleString()} pcs`);
    expect(txt).not.toContain("1991");
    expect(txt).not.toContain(money(11));
    expect(txt).toContain("Test Purchase"); // still renders
  });
});
