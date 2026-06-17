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
import { readFileSync } from "node:fs";
import { portfolioRetail, retailSegment, setRetailProvenance, isPromoNoRetail } from "./portfolio";
import { retailPricedNote, retailGapNote, retailCoverageNote } from "./valueDisplay";
import { curatedRetail } from "./curatedMsrp.js";
import { CSV_PATH } from "../../scripts/gen-curated-msrp.mjs";

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
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 204.99, known: 2, estimated: 0, estimatedTotal: 0, promo: 0, promoTotal: 0, notListed: 1 });
  });

  it("Brickset wins over a divergent raw retailPrice blob — ladder, not the stored field", () => {
    // The set carries a stale BE-blob retailPrice/totalRetailPrice the OLD card would have summed;
    // the ladder resolver ignores those and takes the Brickset figure. Proves card ≠ blob.
    const sets = [{ setNumber: "10300-1", bs: 100, retailPrice: 80, totalRetailPrice: 80, qty: 1 }];
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 100, known: 1, estimated: 0, estimatedTotal: 0, promo: 0, promoTotal: 0, notListed: 0 });
  });

  it("promo (no-RRP) and unsourced sets contribute 0 and are excluded from the priced count", () => {
    const sets = [
      { setNumber: "10300-1", bs: 100, qty: 1 },              // priced → 100
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 }, // promo → 0, not counted
      { setNumber: "99999-1", qty: 1 },                        // unsourced → 0, not counted
    ];
    // total/known unchanged; promo 1 (the GWP, no value) + notListed 1 (the unsourced) label the gap.
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 100, known: 1, estimated: 0, estimatedTotal: 0, promo: 1, promoTotal: 0, notListed: 1 });
  });

  it("nothing priced → total 0 with known 0 (card renders \"—\", never a phantom $0)", () => {
    const sets = [
      { setNumber: "6490363-1", theme: "Promotional", qty: 1 },
      { setNumber: "99999-1", qty: 1 },
    ];
    // promo 1 + notListed 1 — nothing priced, so the card renders "—".
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 0, known: 0, estimated: 0, estimatedTotal: 0, promo: 1, promoTotal: 0, notListed: 1 });
  });

  it("a stored 0 retail is unknown (no $0 RRP) → contributes 0, not counted", () => {
    const sets = [{ setNumber: "12345-1", bs: 0, msrp: 0, be: 0, qty: 1 }];
    expect(portfolioRetail(sets, retailOf)).toEqual({ total: 0, known: 0, estimated: 0, estimatedTotal: 0, promo: 0, promoTotal: 0, notListed: 1 });
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

// ─────────────────────────────────────────────────────────────────────────────
// Option C (docs/curated-msrp-plan.md §3): the curated rungs extend the 3-way partition to 4-way —
// sourced (basis "retail") + estimated (basis "estimated") + promo + notListed === total. A promo's
// curated ARV STAYS in promo (never sourced/estimated), regardless of tier.
// ─────────────────────────────────────────────────────────────────────────────
describe("portfolioRetail — 4-way partition with curated rungs (Option C)", () => {
  // Synthetic resolver feeding the curated rungs from per-set fields (cs = curated_sourced amount,
  // ce = curated_estimated amount), mirroring how MyCollection.retailFor wires curatedRetail().
  const synth = (s) =>
    setRetailProvenance(
      {
        brickset: { amount: s.bs }, manual: { amount: s.msrp },
        curated_sourced: { amount: s.cs }, cmf: { amount: s.cmf }, curated_estimated: { amount: s.ce },
      },
      { promo: s.promo ?? isPromoNoRetail(s) }
    );

  it("sourced→sourced, estimated→estimated (separate total), promo ARV→promo (separate total), else notListed", () => {
    const sets = [
      { setNumber: "30303-1", cs: 3.99, qty: 1 },                 // curated_sourced → sourced
      { setNumber: "30370-1", ce: 4.99, qty: 2 },                 // curated_estimated → estimated (×2)
      { setNumber: "40452-1", cs: 29.99, promo: true, qty: 1 },   // promo + sourced-tier ARV → promo
      { setNumber: "40453-1", ce: 19.99, promo: true, qty: 1 },   // promo + estimated-tier ARV → promo
      { setNumber: "99999-1", qty: 1 },                           // unsourced → notListed
    ];
    expect(portfolioRetail(sets, synth)).toEqual({
      total: 3.99, known: 1,                       // sourced sum + count (headline) — estimates/ARVs excluded
      estimated: 1, estimatedTotal: 9.98,          // 4.99 × 2
      promo: 2, promoTotal: 49.98,                 // 29.99 + 19.99 — disclosed separately, NOT in total
      notListed: 1,
    });
  });

  it("the 4 buckets partition the collection: sourced + estimated + promo + notListed === total", () => {
    const sets = [
      { setNumber: "30303-1", cs: 3.99 }, { setNumber: "30370-1", ce: 4.99 },
      { setNumber: "40452-1", cs: 29.99, promo: true }, { setNumber: "99999-1" },
      { setNumber: "10300-1", bs: 100 }, // brickset sourced
    ];
    const r = portfolioRetail(sets, synth);
    expect(r.known + r.estimated + r.promo + r.notListed).toBe(sets.length);
  });

  it("EXACT over the real curated 129: 20 sourced · 67 estimated · 41 promo·ARV · 1 not-listed (= +20 → 491 overall)", () => {
    // The curated CSV (in-repo source of truth) → 129 sets; promo-ness from the `bucket` column (the verified
    // isPromoNoRetail classification for these sets). qty 1, so counts are exact; $ sums are per-unit.
    const rows = readFileSync(CSV_PATH, "utf8").split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split(","));
    const sets = rows.map(([setNumber, , , bucket]) => ({ setNumber, promo: bucket === "promo", qty: 1 }));
    expect(sets.length).toBe(129);
    const r = portfolioRetail(sets, (s) => {
      const cur = curatedRetail(s.setNumber);
      return setRetailProvenance(
        {
          curated_sourced: cur?.tier === "sourced" ? { amount: cur.msrp } : undefined,
          curated_estimated: cur?.tier === "estimated" ? { amount: cur.msrp } : undefined,
        },
        { promo: s.promo }
      );
    });
    expect(r.known).toBe(20);      // curated sourced, non-promo (+471 existing priced = 491 sourced overall)
    expect(r.estimated).toBe(67);  // curated estimated, non-promo — NOTE: CSV has 94 estimated rows; 27 are promos
    expect(r.promo).toBe(41);      // ALL promos stay in promo, now carrying ARVs (14 sourced-tier + 27 estimated-tier)
    expect(r.notListed).toBe(1);   // 30625 (tier=none) stays not-listed
    expect(r.known + r.estimated + r.promo + r.notListed).toBe(129);
    expect(r.total).toBeCloseTo(243.49, 2);          // sourced $ (non-promo) — the headline delta
    expect(r.estimatedTotal).toBeCloseTo(637.89, 2); // estimated $ (non-promo)
    expect(r.promoTotal).toBeCloseTo(855.59, 2);     // promo·ARV $ (all 41) — disclosed separately
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

describe("retailCoverageNote — the 4-segment MSRP card breakdown (Option C)", () => {
  it("renders sourced + estimated(~$) + promo·ARV(~$) + not-listed, omitting zero-count segments", () => {
    expect(retailCoverageNote({ known: 491, estimated: 67, estimatedTotal: 637.89, promo: 41, promoTotal: 855.59, notListed: 1 }))
      .toBe("491 sourced · 67 estimated (~$637.89) · 41 promo (ARV ~$855.59) · 1 not listed");
  });
  it("a promo segment with no ARV ($0) reads 'promo (no MSRP)' (pre-curated label)", () => {
    expect(retailCoverageNote({ known: 5, promo: 2, promoTotal: 0, notListed: 1 }))
      .toBe("5 sourced · 2 promo (no MSRP) · 1 not listed");
  });
  it("omits the note entirely when there is no gap (everything sourced)", () => {
    expect(retailCoverageNote({ known: 10 })).toBeNull();
  });
  it("shows only the non-zero segments", () => {
    expect(retailCoverageNote({ known: 10, notListed: 3 })).toBe("10 sourced · 3 not listed");
    expect(retailCoverageNote({ estimated: 4, estimatedTotal: 19.96 })).toBe("4 estimated (~$19.96)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retailSegment — the per-set classifier extracted FROM portfolioRetail's bucketing, so the
// CSV export can label a row's MSRP with the EXACT segment the card's partition counts (parity by
// construction). portfolioRetail folds {promo-arv, promo-no-msrp} → its single `promo` count, so
// the 4-way partition stays byte-identical (pinned by the 129-set invariant above).
// ─────────────────────────────────────────────────────────────────────────────
describe("retailSegment — per-set segment classifier (one of sourced|estimated|promo-arv|promo-no-msrp|not-listed)", () => {
  it("a sourced RRP (basis 'retail', amount present) → 'sourced'", () => {
    expect(retailSegment({ basis: "retail", amount: 100 })).toBe("sourced");
  });
  it("a curated estimate (basis 'estimated', amount present) → 'estimated'", () => {
    expect(retailSegment({ basis: "estimated", amount: 4.99 })).toBe("estimated");
  });
  it("a VALUED promo / GWP ARV (basis 'promo', amount present) → 'promo-arv'", () => {
    expect(retailSegment({ basis: "promo", amount: 19.99 })).toBe("promo-arv");
  });
  it("a no-RRP promo / GWP (basis 'promo', amount null) → 'promo-no-msrp'", () => {
    expect(retailSegment({ basis: "promo", amount: null })).toBe("promo-no-msrp");
  });
  it("an unsourced set (null Value) → 'not-listed'", () => {
    expect(retailSegment(null)).toBe("not-listed");
  });
  it("an unknown-basis null amount → 'not-listed'", () => {
    expect(retailSegment({ basis: "unknown", amount: null })).toBe("not-listed");
  });
  it("basis 'estimated' but a null amount → 'not-listed' (estimated needs a figure, mirrors portfolioRetail)", () => {
    expect(retailSegment({ basis: "estimated", amount: null })).toBe("not-listed");
  });

  it("matches portfolioRetail's buckets one-for-one (promo folds both promo tokens)", () => {
    const synth = (s) =>
      setRetailProvenance(
        { brickset: { amount: s.bs }, manual: { amount: s.msrp }, curated_estimated: { amount: s.ce } },
        { promo: s.promo ?? isPromoNoRetail(s) }
      );
    const sets = [
      { setNumber: "10300-1", bs: 100 },                       // sourced
      { setNumber: "30370-1", ce: 4.99 },                      // estimated
      { setNumber: "6490363-1", ce: 19.99, promo: true },      // promo-arv
      { setNumber: "40178-1", name: "VIP gift with purchase", promo: true }, // promo-no-msrp
      { setNumber: "99999-1" },                                // not-listed
    ];
    const tokens = sets.map((s) => retailSegment(synth(s)));
    expect(tokens).toEqual(["sourced", "estimated", "promo-arv", "promo-no-msrp", "not-listed"]);
    const r = portfolioRetail(sets, synth);
    expect(r.known).toBe(tokens.filter((t) => t === "sourced").length);
    expect(r.estimated).toBe(tokens.filter((t) => t === "estimated").length);
    expect(r.promo).toBe(tokens.filter((t) => t === "promo-arv" || t === "promo-no-msrp").length);
    expect(r.notListed).toBe(tokens.filter((t) => t === "not-listed").length);
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
