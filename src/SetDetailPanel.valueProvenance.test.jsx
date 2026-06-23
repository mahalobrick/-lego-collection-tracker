import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";
import { money } from "./utils/formatting";

// ─────────────────────────────────────────────────────────────────────────────
// Value-tile provenance sub-line (Pass B, surface-only). The Value StatBox
// ([data-testid="value-tile"]) now carries a muted source line UNDER the figure:
//   • source "bricklink" → "BrickLink" + BL-only recency (freshness(prov.asOf)).
//   • anything else      → "Estimated", NO recency (a BE-fallback asOf is new Date(), fake).
//   • frozen promos      → NO sub-line (carve-out — the existing "frozen" badge/tooltip stays).
// The existing valueConfidence(prov) marker badge (est./thin/ask/frozen) is UNCHANGED + additive.
// Renders the REAL SetDetailPanel; provenance is driven via the valueMap prop (the BL value cache),
// mirroring the SetDetailPanel.retail.test.jsx harness (no network — hasBrickLinkAuth() is false).
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

// 3 days ago → fresh (≤ STALE_DAYS 8). Relative to now so the day-count text stays valid; the tests
// assert /Values updated/ (presence), never an exact N.
const ASOF_3D = new Date(Date.now() - 3 * 864e5).toISOString();

// Render the real panel with an optional BL value cache; return the Value tile's textContent.
function renderValueTile(item, valueMap) {
  act(() => root.render(<SetDetailPanel item={item} valueMap={valueMap} onClose={() => {}} />));
  const tile = container.querySelector('[data-testid="value-tile"]');
  return tile ? tile.textContent : null;
}
// A BL value-cache record for one set on one condition (the /api/values shape: { new, used }).
const blMap = (setNumber, cond, rec) => ({ [setNumber]: { new: cond === "new" ? rec : null, used: cond === "used" ? rec : null } });

describe("SetDetailPanel — Value-tile provenance sub-line (surface-only)", () => {
  it("1) BL clean sold → 'BrickLink' + recency, no est./thin badge", () => {
    const item = { setNumber: "10300-1", condition: "new", quantity: 1, totalPaid: 0, entries: [] };
    const txt = renderValueTile(item, blMap("10300-1", "new", { amount: 100, basis: "sold", lots: 14, asOf: ASOF_3D }));
    expect(txt).toContain("BrickLink");
    expect(txt).toMatch(/Values updated/);
    expect(txt).toContain(money(100));
    expect(txt).not.toContain("est.");
    expect(txt).not.toContain("thin");
    expect(txt).not.toContain("Estimated");
  });

  it("2) BL modeled → 'BrickLink' + recency AND the est. marker still renders (additive)", () => {
    const item = { setNumber: "10300-1", condition: "new", quantity: 1, totalPaid: 0, entries: [] };
    const txt = renderValueTile(item, blMap("10300-1", "new", { amount: 75, basis: "modeled", lots: 20, asOf: ASOF_3D }));
    expect(txt).toContain("BrickLink");
    expect(txt).toMatch(/Values updated/);
    expect(txt).toContain("est."); // valueConfidence(modeled) marker — unchanged, coexists with the source line
  });

  it("3) BE-fallback (source null) → 'Estimated', NO recency", () => {
    const item = { setNumber: "75192-1", condition: "new", quantity: 1, totalPaid: 0, totalValue: 50, entries: [] };
    const txt = renderValueTile(item, {}); // no record for this set → BL overlay returns null → BE path
    expect(txt).toContain("Estimated");
    expect(txt).not.toMatch(/Values updated|ago/);
    expect(txt).not.toContain("BrickLink");
  });

  it("4) BE-fallback with source 'BrickEconomy' → 'Estimated', NO recency (null AND brickeconomy both → Estimated)", () => {
    const item = { setNumber: "75192-1", source: "BrickEconomy", condition: "new", quantity: 1, totalPaid: 0, totalValue: 50, entries: [] };
    const txt = renderValueTile(item, {});
    expect(txt).toContain("Estimated");
    expect(txt).not.toMatch(/Values updated|ago/);
  });

  it("5) frozen promo → frozen marker stays, NO 'Estimated' sub-line, NO recency (not regressed)", () => {
    const item = { setNumber: "6490363-1", condition: "new", quantity: 1, totalPaid: 0, totalValue: 23.72, entries: [] };
    const txt = renderValueTile(item, {});
    expect(txt).toContain("frozen");        // existing valueConfidence marker, unchanged
    expect(txt).toContain(money(23.72));
    expect(txt).not.toContain("Estimated");  // carve-out: no source sub-line for frozen
    expect(txt).not.toMatch(/Values updated/);
  });

  it("6) unknown value → '—', no source sub-line", () => {
    const item = { setNumber: "99999-1", condition: "new", quantity: 1, totalPaid: 0, entries: [] }; // no value fields
    const txt = renderValueTile(item, {});
    expect(txt).toContain("—");
    expect(txt).not.toContain("BrickLink");
    expect(txt).not.toContain("Estimated");
    expect(txt).not.toMatch(/Values updated/);
  });
});
