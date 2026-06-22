import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";
import { money } from "./utils/formatting";

// ─────────────────────────────────────────────────────────────────────────────
// MSRP Step 1 / 3c — DOM-leaf smoke for the detail-panel MSRP chip, reading
// setRetailProvenance (Brickset → manual; BE removed from retail in 3c). Renders the
// REAL SetDetailPanel against seeded localStorage caches and reads the chip's leaf text:
//   1. Brickset present        → chip shows the BRICKSET figure (canonical leads).
//   2. BrickEconomy only       → chip shows "—" (BE is no longer a retail source — 3c).
//   3. No retail anywhere      → chip shows "—" (unknown, never $0 / never hidden).
// Also pins the cache-key fix: Brickset is keyed `brickset_${n}` — a bare-key lookup
// (the old bug) would never match, so scenario 1 would wrongly miss the Brickset figure.
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

function seedBE(setNumber, retail) {
  const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
  cache[setNumber] = { fetchedAt: "2026-06-01T00:00:00.000Z", data: { retail_price_us: retail } };
  localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
}
function seedBrickset(setNumber, retail) {
  const cache = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}");
  // The real key format (src/utils/brickset.js): `brickset_${setNumber}`.
  cache[`brickset_${setNumber}`] = { fetchedAt: "2026-06-01T00:00:00.000Z", data: { retail_price_us: retail } };
  localStorage.setItem("bricksetSetCache", JSON.stringify(cache));
}

function renderPanel(setNumber, extra = {}) {
  const item = { setNumber, condition: "new", quantity: 1, totalPaid: 0, entries: [], ...extra };
  act(() => root.render(<SetDetailPanel item={item} onClose={() => {}} />));
  const chip = container.querySelector('[data-testid="msrp-chip"]');
  return chip ? chip.textContent : null;
}

// Render and return the "vs. MSRP" StatBox text (label + value), or null if absent.
function renderVsRetail(setNumber, extra = {}) {
  const item = { setNumber, condition: "new", quantity: 1, entries: [], ...extra };
  act(() => root.render(<SetDetailPanel item={item} onClose={() => {}} />));
  const box = [...container.querySelectorAll("div")].find(d => d.firstChild?.textContent === "vs. MSRP");
  return box ? box.textContent : null;
}

describe("SetDetailPanel msrp tile — browser-observable (DOM-leaf)", () => {
  // MSRP relocated from the chips row to a StatBox tile under "Value & Returns" (testid still
  // msrp-chip). The box's textContent is label + value with NO separator → "MSRP" + figure
  // (was a single "MSRP <figure>" span). The figure logic is unchanged (setRetailProvenance ladder).
  it("scenario 1 — Brickset ≠ BrickEconomy: tile shows the Brickset figure", () => {
    seedBE("10300-1", 80);
    seedBrickset("10300-1", 100);
    expect(renderPanel("10300-1")).toBe(`MSRP${money(100)}`);
  });

  it("scenario 2 — BrickEconomy only: tile shows \"—\" (BE removed from retail in 3c)", () => {
    seedBE("75192-1", 60);
    // no Brickset entry seeded; the BE cache no longer feeds the retail ladder → unknown.
    expect(renderPanel("75192-1")).toBe("MSRP—");
  });

  it("scenario 3 — no retail anywhere: tile shows \"—\"", () => {
    expect(renderPanel("11111-1")).toBe("MSRP—");
  });

  it("scenario 4 — manual msrp only (no caches): tile shows the figure, tagged 'manual' (Phase 3a)", () => {
    // item.msrp is the hand-entered rung; below Brickset, above BE.
    expect(renderPanel("33333-1", { msrp: 4.99 })).toBe(`MSRP${money(4.99)}manual`);
  });

  it("scenario 5 — Brickset present + manual msrp: Brickset wins, no manual tag", () => {
    seedBrickset("10300-1", 199.99);
    expect(renderPanel("10300-1", { msrp: 4.99 })).toBe(`MSRP${money(199.99)}`);
  });
});

describe("SetDetailPanel vs. MSRP % — reads the resolved ladder, not a raw field (Phase 3b)", () => {
  // A Brickset-only set carries NO raw retailPrice field — the % must come from the ladder
  // (setRetailProvenance), the SAME source as the chip, so the two can never disagree. If a
  // regression repointed vs-MSRP at item.retailPrice, the guard `retailPrice && …` would be
  // falsy here and the StatBox would vanish — this test fails.
  it("Brickset-only set (no raw retailPrice) still gets a correct vs. MSRP %", () => {
    seedBrickset("10300-1", 100);
    // value known (totalValue) + cost > 0 → vs. MSRP renders. Market 150 vs retail 100 → +50.0%.
    const txt = renderVsRetail("10300-1", { totalValue: 150, totalPaid: 90 });
    expect(txt).toBe("vs. MSRP+50.0%");
  });
});

describe("SetDetailPanel — investment forecast removed (MC-Browse polish R2)", () => {
  // Seed the BE cache with the exact fields the old forecast read. The section must NOT render —
  // BE forecast projections are gone (BE retired from value + retail); no BL-grounded forecast yet.
  function seedBEForecast(setNumber, f2, f5) {
    const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
    cache[setNumber] = { fetchedAt: "2026-06-01T00:00:00.000Z", data: { forecast_value_new_2_years: f2, forecast_value_new_5_years: f5 } };
    localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
  }
  function panelText(setNumber, extra = {}) {
    const item = { setNumber, condition: "new", quantity: 1, entries: [], ...extra };
    act(() => root.render(<SetDetailPanel item={item} onClose={() => {}} />));
    return container.textContent;
  }

  it("does not render the Investment Forecast section even when BE forecast data is present", () => {
    seedBEForecast("10300-1", 250, 400);
    const txt = panelText("10300-1", { totalValue: 200, totalPaid: 120 });
    expect(txt).not.toMatch(/Investment Forecast/);
    expect(txt).not.toMatch(/Forecast/);
    expect(txt).not.toMatch(/yr vs\. (MSRP|Retail)/);
  });
});
