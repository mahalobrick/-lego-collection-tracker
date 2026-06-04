import { describe, it, expect } from "vitest";
import { portfolioRetail, setRetailProvenance, isPromoNoRetail } from "./portfolio";
import { retailPricedNote } from "./valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// Retail Phase 3b — the Retail Value card sums the SHARED ladder (portfolioRetail
// over setRetailProvenance), NOT the old BE-import blob (totalRetailPrice ||
// (retailPrice || msrp) × qty). Promo (no-RRP) and unsourced sets contribute 0 and
// are excluded from the priced count, so the card is "total retail of priced sets"
// and reads "—" (via formatAggregateValue on known === 0) when nothing is priced.
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
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 204.99, known: 2 });
  });

  it("Brickset wins over a divergent raw retailPrice blob — ladder, not the stored field", () => {
    // The set carries a stale BE-blob retailPrice/totalRetailPrice the OLD card would have summed;
    // the ladder resolver ignores those and takes the Brickset figure. Proves card ≠ blob.
    const sets = [{ setNumber: "10300-1", bs: 100, retailPrice: 80, totalRetailPrice: 80, qty: 1 }];
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 100, known: 1 });
  });

  it("promo (no-RRP) and unsourced sets contribute 0 and are excluded from the priced count", () => {
    const sets = [
      { setNumber: "10300-1", bs: 100, qty: 1 },              // priced → 100
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 }, // promo → 0, not counted
      { setNumber: "99999-1", qty: 1 },                        // unsourced → 0, not counted
    ];
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 100, known: 1 });
  });

  it("nothing priced → total 0 with known 0 (card renders \"—\", never a phantom $0)", () => {
    const sets = [
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 },
      { setNumber: "99999-1", qty: 1 },
    ];
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 0, known: 0 });
  });

  it("a stored 0 retail is unknown (no $0 RRP) → contributes 0, not counted", () => {
    const sets = [{ setNumber: "12345-1", bs: 0, msrp: 0, be: 0, qty: 1 }];
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 0, known: 0 });
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
