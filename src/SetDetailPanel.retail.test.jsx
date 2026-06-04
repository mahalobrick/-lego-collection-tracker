import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";
import { money } from "./utils/formatting";

// ─────────────────────────────────────────────────────────────────────────────
// MSRP Step 1 — DOM-leaf smoke for the detail-panel MSRP chip after repointing it
// to setRetailProvenance (Brickset → BrickEconomy). Renders the REAL SetDetailPanel
// against seeded localStorage caches and reads the chip's leaf text:
//   1. Brickset ≠ BrickEconomy → chip shows the BRICKSET figure (canonical leads).
//   2. BrickEconomy only       → chip falls back to the BE figure (deprecated source).
//   3. No retail anywhere      → chip shows "—" (unknown, never $0 / never hidden).
// Also pins the cache-key fix: Brickset is keyed `brickset_${n}` — a bare-key lookup
// (the old bug) would never match, so scenario 1 would wrongly read BE.
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

describe("SetDetailPanel MSRP chip — browser-observable (DOM-leaf)", () => {
  it("scenario 1 — Brickset ≠ BrickEconomy: chip shows the Brickset figure", () => {
    seedBE("10300-1", 80);
    seedBrickset("10300-1", 100);
    expect(renderPanel("10300-1")).toBe(`MSRP ${money(100)}`);
  });

  it("scenario 2 — BrickEconomy only: chip falls back to the BE figure", () => {
    seedBE("75192-1", 60);
    // no Brickset entry seeded
    expect(renderPanel("75192-1")).toBe(`MSRP ${money(60)}`);
  });

  it("scenario 3 — no retail anywhere: chip shows \"—\"", () => {
    expect(renderPanel("11111-1")).toBe("MSRP —");
  });

  it("scenario 4 — manual msrp only (no caches): chip shows the figure, tagged 'manual' (Phase 3a)", () => {
    // item.msrp is the hand-entered rung; below Brickset, above BE.
    expect(renderPanel("33333-1", { msrp: 4.99 })).toBe(`MSRP ${money(4.99)}manual`);
  });

  it("scenario 5 — Brickset present + manual msrp: Brickset wins, no manual tag", () => {
    seedBrickset("10300-1", 199.99);
    expect(renderPanel("10300-1", { msrp: 4.99 })).toBe(`MSRP ${money(199.99)}`);
  });
});
