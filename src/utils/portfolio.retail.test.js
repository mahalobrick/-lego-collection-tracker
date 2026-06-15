// @vitest-environment node
//
// Pure data-layer unit test — no DOM, no localStorage. Pinned to the `node`
// environment (not the suite-default jsdom) so it skips the heavy jsdom setup and
// stays out of the jsdom worker pool: under full parallel load that setup can take
// ~60s and starve workers, which intermittently corrupted this file's results
// (intermittent wrong promo/gap counts under worker starvation). node setup is instant and
// isolated. The whole portfolio→formatting/value/… import chain is node-safe
// (the only localStorage read, formatting.js currency, is try/catch-guarded).
import { describe, it, expect } from "vitest";
import { portfolioRetail, setRetailProvenance, isPromoNoRetail } from "./portfolio";
import { retailPricedNote, retailGapNote } from "./valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// Retail Phase 3b — the Retail Value card sums the SHARED ladder (portfolioRetail
// over setRetailProvenance), NOT the old BE-import blob (totalRetailPrice ||
// (retailPrice || msrp) × qty). Promo (no-RRP) and unsourced sets contribute 0 and
// are excluded from the priced count, so the card is "total retail of priced sets"
// and reads "—" (via formatAggregateValue on known === 0) when nothing is priced.
//
// Gap composition: `portfolioRetail` returns the partition known + promo + notListed =
// sets.length. The card reads the priced share against the FULL set count and LABELS the
// gap (promo = GWP/no-RRP; notListed = real RRP, unsourced) instead of shrinking the
// denominator — so the gap itself prompts "why aren't all priced?", answered in place.
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
    // notListed 1 — the unsourced 75192 (a real RRP exists, just unobtained); no promos.
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 204.99, known: 2, promo: 0, notListed: 1 });
  });

  it("Brickset wins over a divergent raw retailPrice blob — ladder, not the stored field", () => {
    // The set carries a stale BE-blob retailPrice/totalRetailPrice the OLD card would have summed;
    // the ladder resolver ignores those and takes the Brickset figure. Proves card ≠ blob.
    const sets = [{ setNumber: "10300-1", bs: 100, retailPrice: 80, totalRetailPrice: 80, qty: 1 }];
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 100, known: 1, promo: 0, notListed: 0 });
  });

  it("promo (no-RRP) and unsourced sets contribute 0 and are excluded from the priced count", () => {
    const sets = [
      { setNumber: "10300-1", bs: 100, qty: 1 },              // priced → 100
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 }, // promo → 0, not counted
      { setNumber: "99999-1", qty: 1 },                        // unsourced → 0, not counted
    ];
    // total/known unchanged; promo 1 (the GWP) + notListed 1 (the unsourced) label the gap.
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 100, known: 1, promo: 1, notListed: 1 });
  });

  it("nothing priced → total 0 with known 0 (card renders \"—\", never a phantom $0)", () => {
    const sets = [
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 },
      { setNumber: "99999-1", qty: 1 },
    ];
    // promo 1 + notListed 1 — nothing priced, so the card renders "—".
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 0, known: 0, promo: 1, notListed: 1 });
  });

  it("a stored 0 retail is unknown (no $0 RRP) → contributes 0, not counted", () => {
    const sets = [{ setNumber: "12345-1", bs: 0, msrp: 0, be: 0, qty: 1 }];
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 0, known: 0, promo: 0, notListed: 1 });
  });
});

describe("portfolioRetail — gap composition (priced + promo + notListed = all sets)", () => {
  it("labels the unpriced gap: promo (GWP/no-RRP) vs notListed (real RRP, unsourced)", () => {
    const sets = [
      { setNumber: "10300-1", bs: 100, qty: 1 },                 // priced → known
      { setNumber: "30001-1", qty: 1 },                          // unsourced (real RRP exists) → notListed
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 },  // promo (7-digit ID) → promo
      { setNumber: "40178-1", name: "VIP gift with purchase", qty: 1 }, // GWP wording → promo
    ];
    const { known, promo, notListed } = portfolioRetail(sets, retailOf);
    expect(known).toBe(1);        // numerator unchanged
    expect(promo).toBe(2);        // 2 promo/GWP — LABELED, not removed from the denominator
    expect(notListed).toBe(1);    // the unsourced-but-real set
    expect(known + promo + notListed).toBe(sets.length); // the three buckets partition the collection
  });

  it("the priced-coverage note uses the FULL set count; the gap note labels the rest", () => {
    // 1 priced of 3 sets (1 promo + 1 unsourced) → "1 of 3 priced", never the promo-excluded "1 of 2".
    const sets = [
      { setNumber: "10300-1", bs: 100, qty: 1 },
      { setNumber: "99999-1", qty: 1 },
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 },
    ];
    const { known, promo, notListed } = portfolioRetail(sets, retailOf);
    expect(retailPricedNote(known, sets.length)).toBe("1 of 3 priced");
    expect(retailGapNote(promo, notListed)).toBe("1 promo (no MSRP) · 1 not listed");
  });
});

describe("retailPricedNote — disclosure for the unpriced population", () => {
  it("omits the note when ALL sets are priced", () => {
    expect(retailPricedNote(5, 5)).toBeNull();
  });
  it("reports the priced share when some are unpriced", () => {
    expect(retailPricedNote(3, 5)).toBe("3 of 5 priced");
  });
  it("omits the note for an empty collection", () => {
    expect(retailPricedNote(0, 0)).toBeNull();
  });
});

describe("retailGapNote — gap composition breakdown", () => {
  it("joins promo and not-listed counts, pluralizing promo and omitting zero segments", () => {
    expect(retailGapNote(2, 3)).toBe("2 promos (no MSRP) · 3 not listed");
    expect(retailGapNote(1, 1)).toBe("1 promo (no MSRP) · 1 not listed"); // singular promo
    expect(retailGapNote(0, 4)).toBe("4 not listed");        // promo segment omitted
    expect(retailGapNote(2, 0)).toBe("2 promos (no MSRP)");  // not-listed segment omitted
    expect(retailGapNote(0, 0)).toBeNull();                  // empty gap → null
  });
});
