import { describe, it, expect } from "vitest";
import { portfolioRetail, setRetailProvenance, isPromoNoRetail } from "./portfolio";
import { retailPricedNote } from "./valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// Retail Phase 3b — the Retail Value card sums the SHARED ladder (portfolioRetail
// over setRetailProvenance), NOT the old BE-import blob (totalRetailPrice ||
// (retailPrice || msrp) × qty). Promo (no-RRP) and unsourced sets contribute 0 and
// are excluded from the priced count, so the card is "total retail of priced sets"
// and reads "—" (via formatAggregateValue on known === 0) when nothing is priced.
//
// Coverage honesty: `priceable` is the count of sets that COULD carry an RRP — total
// minus promo/GWP (basis:"promo"), which have no RRP by nature. It is the honest
// denominator for the "N of M sets priced" note (an unsourced-but-real-RRP set still
// counts; a GWP does not).
// ─────────────────────────────────────────────────────────────────────────────

// A realistic resolver mirroring MyCollection's retailFor: build the ladder sources from
// per-set fields, walk Brickset → manual, tag promo. (A `brickeconomy` field is passed to
// prove the ladder IGNORES it after 3c — BE is no longer a retail source.)
const retailOf = (s) =>
  setRetailProvenance(
    { brickset: { amount: s.bs }, manual: { amount: s.msrp }, brickeconomy: { amount: s.be } },
    { condition: s.condition, promo: isPromoNoRetail(s) }
  );

describe("portfolioRetail — sums the ladder, not the BE blob", () => {
  it("sums resolved per-unit retail × qty over priced sets; a former-BE-only set is now unpriced", () => {
    const sets = [
      { setNumber: "10300-1", bs: 100, qty: 2 },    // 200 (Brickset × 2)
      { setNumber: "33333-1", msrp: 4.99, qty: 1 }, // 4.99 (manual rung)
      { setNumber: "75192-1", be: 60, qty: 1 },     // former BE-only → "—" after 3c, not counted
    ];
    // priceable 3 — none are promo (the unsourced 75192 still COULD carry an RRP).
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 204.99, known: 2, priceable: 3 });
  });

  it("Brickset wins over a divergent raw retailPrice blob — ladder, not the stored field", () => {
    // The set carries a stale BE-blob retailPrice/totalRetailPrice the OLD card would have summed;
    // the ladder resolver ignores those and takes the Brickset figure. Proves card ≠ blob.
    const sets = [{ setNumber: "10300-1", bs: 100, retailPrice: 80, totalRetailPrice: 80, qty: 1 }];
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 100, known: 1, priceable: 1 });
  });

  it("promo (no-RRP) and unsourced sets contribute 0 and are excluded from the priced count", () => {
    const sets = [
      { setNumber: "10300-1", bs: 100, qty: 1 },              // priced → 100
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 }, // promo → 0, not counted
      { setNumber: "99999-1", qty: 1 },                        // unsourced → 0, not counted
    ];
    // total/known unchanged; priceable 2 — the promo is excluded, the unsourced is NOT.
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 100, known: 1, priceable: 2 });
  });

  it("nothing priced → total 0 with known 0 (card renders \"—\", never a phantom $0)", () => {
    const sets = [
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 },
      { setNumber: "99999-1", qty: 1 },
    ];
    // priceable 1 — only the (unsourced, non-promo) 99999 could carry an RRP.
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 0, known: 0, priceable: 1 });
  });

  it("a stored 0 retail is unknown (no $0 RRP) → contributes 0, not counted", () => {
    const sets = [{ setNumber: "12345-1", bs: 0, msrp: 0, be: 0, qty: 1 }];
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 0, known: 0, priceable: 1 });
  });
});

describe("portfolioRetail — priceable denominator excludes promo/GWP (coverage honesty)", () => {
  it("promo/GWP (basis:'promo') sets drop out of `priceable`; unsourced-but-real sets stay in", () => {
    const sets = [
      { setNumber: "10300-1", bs: 100, qty: 1 },                 // priced
      { setNumber: "30001-1", qty: 1 },                          // unsourced (real RRP exists) → priceable
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 },  // promo (7-digit ID) → NOT priceable
      { setNumber: "40178-1", name: "VIP gift with purchase", qty: 1 }, // GWP wording → NOT priceable
    ];
    const { known, priceable } = portfolioRetail(sets, retailOf);
    expect(known).toBe(1);       // numerator unchanged by the denominator fix
    expect(priceable).toBe(2);   // 4 sets − 2 promo/GWP
  });

  it("the priced-coverage note uses the priceable denominator, not the raw set count", () => {
    // 1 priced of 2 priceable (the 3rd is a promo) → "1 of 2", never "1 of 3".
    const sets = [
      { setNumber: "10300-1", bs: 100, qty: 1 },
      { setNumber: "99999-1", qty: 1 },
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 },
    ];
    const { known, priceable } = portfolioRetail(sets, retailOf);
    expect(retailPricedNote(known, priceable)).toBe("1 of 2 sets priced");
  });
});

describe("retailPricedNote — disclosure for the unpriced population", () => {
  it("omits the note when ALL sets are priced", () => {
    expect(retailPricedNote(5, 5)).toBeNull();
  });
  it("reports the priced share when some are unpriced", () => {
    expect(retailPricedNote(3, 5)).toBe("3 of 5 sets priced");
  });
  it("omits the note for an empty collection", () => {
    expect(retailPricedNote(0, 0)).toBeNull();
  });
});
