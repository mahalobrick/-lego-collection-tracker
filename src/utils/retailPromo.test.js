// @vitest-environment node
// Pure promo/no-RRP unit test (no DOM/localStorage) — pinned to node so it skips
// jsdom setup and the parallel-load starvation that flaked the retail tests. See
// portfolio.retail.test.js for the full rationale.
import { describe, it, expect } from "vitest";
import { isPromoNoRetail, setRetailProvenance } from "./portfolio";
import { isPromoNoRrp, formatRetailCell, retailCellTooltip, PROMO_NO_RRP_LABEL } from "./valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// Retail Phase 2 — GWP "no-RRP / promo" as a FIRST-CLASS state. Three retail
// outcomes must stay distinct:
//   sourced number   — a real RRP was obtained
//   promo / no-RRP   — none exists anywhere (GWP/promo, never sold)  → tag, not "—"
//   unsourced "—"    — an RRP exists somewhere, just wasn't obtained
// The promo state is decided in the resolution (setRetailProvenance basis:"promo"),
// not the display layer; the display just renders what the resolution produced.
// ─────────────────────────────────────────────────────────────────────────────

describe("isPromoNoRetail — the GWP/promo predicate (Phase-0 heuristic, formalized)", () => {
  it("theme 'Promotional' → promo", () => {
    expect(isPromoNoRetail({ setNumber: "40609-1", theme: "Promotional" })).toBe(true);
  });
  it("long-numeric promo IDs (≥7-digit base) → promo", () => {
    expect(isPromoNoRetail({ setNumber: "6490363-1", theme: "Star Wars" })).toBe(true);
    expect(isPromoNoRetail({ setNumber: "5007428-1" })).toBe(true);
  });
  it("gift/promo wording in name or subtheme → promo", () => {
    expect(isPromoNoRetail({ setNumber: "40000-1", name: "Holiday Gift with Purchase" })).toBe(true);
  });
  it("subtheme 'Promotional' under a parent theme → promo (the 23-of-41 under-catch class)", () => {
    // These GWPs file under a parent theme with a 5-digit 40xxx number — caught ONLY via subtheme.
    expect(isPromoNoRetail({ setNumber: "40452-1", theme: "Harry Potter", subtheme: "Promotional" })).toBe(true);
    expect(isPromoNoRetail({ setNumber: "40591-1", theme: "Star Wars",    subtheme: "Promotional" })).toBe(true);
    // Guard the boundary: the same set with subtheme dropped is NOT promo (why plumbing it mattered).
    expect(isPromoNoRetail({ setNumber: "40452-1", theme: "Harry Potter" })).toBe(false);
  });
  it("a normal set is NOT promo (incl. a 5-digit CMF figure)", () => {
    expect(isPromoNoRetail({ setNumber: "10300-1", theme: "Icons", name: "DeLorean" })).toBe(false);
    expect(isPromoNoRetail({ setNumber: "71052-5", theme: "Minifigure Series", name: "Robot T. rex" })).toBe(false);
  });
  it("missing/empty set → false", () => {
    expect(isPromoNoRetail(null)).toBe(false);
    expect(isPromoNoRetail({})).toBe(false);
  });
});

describe("setRetailProvenance — promo is a third state, distinct from null", () => {
  const noSources = { brickset: { amount: null }, brickeconomy: { amount: null } };

  it("promo + no RRP anywhere → basis 'promo', amount null (NOT plain null)", () => {
    const v = setRetailProvenance(noSources, { promo: true });
    expect(v).not.toBeNull();
    expect(v.amount).toBeNull();   // amount null → vs-Retail% gate (retailPrice) is falsy → suppressed
    expect(v.basis).toBe("promo");
  });

  it("non-promo + no RRP → null (genuinely unsourced)", () => {
    expect(setRetailProvenance(noSources, { promo: false })).toBeNull();
    expect(setRetailProvenance(noSources)).toBeNull(); // default opts
  });

  it("a sourced figure WINS even when promo is flagged (real data beats the tag)", () => {
    const v = setRetailProvenance({ brickset: { amount: 4.99 } }, { promo: true });
    expect(v.amount).toBe(4.99);
    expect(v.basis).toBe("retail");
  });
});

describe("display — the three states render distinctly", () => {
  const promo = setRetailProvenance({}, { promo: true });
  const sourced = setRetailProvenance({ brickset: { amount: 12.99 } }, {});
  const unsourced = setRetailProvenance({}, {}); // null

  it("promo → the no-RRP tag (not '—'), with a promo tooltip", () => {
    expect(formatRetailCell(promo)).toBe(PROMO_NO_RRP_LABEL);
    expect(formatRetailCell(promo)).not.toBe("—");
    expect(isPromoNoRrp(promo)).toBe(true);
    expect(retailCellTooltip(promo)).toMatch(/no RRP|never sold/i);
  });

  it("genuinely unsourced → '—' (unchanged)", () => {
    expect(formatRetailCell(unsourced)).toBe("—");
    expect(isPromoNoRrp(unsourced)).toBe(false);
  });

  it("sourced → money, unaffected by the promo path", () => {
    expect(formatRetailCell(sourced)).toBe("$12.99");
    expect(isPromoNoRrp(sourced)).toBe(false);
    // a sourced sticker price keeps its at-retail caveat — NOT the promo tooltip
    expect(retailCellTooltip(sourced)).toMatch(/sticker|retail/i);
    expect(retailCellTooltip(sourced)).not.toMatch(/no RRP/i);
  });

  // A VALUED promo (curated ARV, Option C) — basis:"promo" WITH an amount: a fourth display nuance.
  const promoArv = setRetailProvenance({ curated_estimated: { amount: 19.99, confidence: "C", source: "value proxy" } }, { promo: true });
  it("valued promo (ARV) → shows the figure tagged 'Promo', with the 'stated value, not a sourced RRP' tooltip", () => {
    expect(isPromoNoRrp(promoArv)).toBe(true);      // still a promo
    expect(promoArv.amount).toBe(19.99);
    expect(formatRetailCell(promoArv)).toBe("Promo · $19.99"); // the ARV, not "no RRP"
    expect(retailCellTooltip(promoArv)).toBe("LEGO-stated value, not a sourced RRP.");
    expect(retailCellTooltip(promoArv)).not.toMatch(/no RRP/i); // distinct from the valueless-promo tooltip
  });
});
