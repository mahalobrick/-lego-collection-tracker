import { describe, it, expect } from "vitest";
import { buildPurchaseMap, setPaidProvenance, costBasisBreakdown, realCostROI } from "./portfolio";
import { paidConfidence, estimatedCostNote, totalRoiNote, realRoiScopeNote } from "./valueDisplay";
import { money } from "./formatting";

// ─────────────────────────────────────────────────────────────────────────────
// Provenance Step 1 — setPaidProvenance / paidConfidence, the PAID analog of
// setValueProvenance / valueConfidence. Pure, read-time, null-aware.
//
// Buckets: 'ledger' (base number has a purchase) · 'manual' (no purchase, paid ≠ retail)
//          · 'msrp' (no purchase, paid == retail, the BE default) · 'none' (no paid).
// ─────────────────────────────────────────────────────────────────────────────

const purchases = [
  { setNumber: "75192", name: "Millennium Falcon", total: 753.42 },
  { setNumber: "71052", name: "CMF Series 29" }, // series purchase — joins every 71052-N figure
];
const map = buildPurchaseMap(purchases);

describe("setPaidProvenance — four buckets", () => {
  it("'ledger' — base number has a matching purchase", () => {
    const s = { setNumber: "75192-1", totalPaid: 753.42, retailPrice: 849.99, totalRetailPrice: 849.99 };
    expect(setPaidProvenance(s, map)).toEqual({ amount: 753.42, source: "ledger" });
  });

  it("'ledger' via CMF base-number join — purchase '71052' matches figure '71052-5'", () => {
    const s = { setNumber: "71052-5", totalPaid: 10.91, retailPrice: 4.99, totalRetailPrice: 9.98, quantity: 2 };
    expect(setPaidProvenance(s, map).source).toBe("ledger");
  });

  it("'manual' — no purchase, paid ≠ retail (real cost, no receipt)", () => {
    const s = { setNumber: "10698-1", totalPaid: 82.8, retailPrice: 59.99, totalRetailPrice: 299.95, quantity: 5 };
    expect(setPaidProvenance(s, map)).toEqual({ amount: 82.8, source: "manual" });
  });

  it("'msrp' — no purchase, paid == retail (BE default placeholder)", () => {
    const s = { setNumber: "7498-1", totalPaid: 99.99, retailPrice: 99.99, totalRetailPrice: 99.99, quantity: 1 };
    expect(setPaidProvenance(s, map)).toEqual({ amount: 99.99, source: "msrp" });
  });

  it("'none' — no paid at all (cost ≤ 0)", () => {
    const s = { setNumber: "30700-1", totalPaid: 0, retailPrice: 4.99, totalRetailPrice: 4.99 };
    expect(setPaidProvenance(s, map)).toEqual({ amount: 0, source: "none" });
  });
});

describe("setPaidProvenance — edge cases", () => {
  it("cents-compare absorbs retail float noise: paid 59.99 == retail 59.9899999… → 'msrp'", () => {
    const s = { setNumber: "10698x-1", totalPaid: 59.99, retailPrice: 59.989999999999995, totalRetailPrice: 59.989999999999995, quantity: 1 };
    expect(setPaidProvenance(s, map).source).toBe("msrp");
  });

  it("unit-level paid == unit retail (multi-copy) → 'msrp' even when totals differ", () => {
    // qty 3 @ unit 4.99: totalPaid 14.97, unit retail 4.99 — unit match wins.
    const s = { setNumber: "30543-1", totalPaid: 14.97, retailPrice: 4.99, totalRetailPrice: 0, quantity: 3, entries: [{ paid_price: 4.99 }, { paid_price: 4.99 }, { paid_price: 4.99 }] };
    expect(setPaidProvenance(s, map).source).toBe("msrp");
  });

  it("unknown retail (≤ 0) with paid, no purchase → 'manual' (no separate edge bucket)", () => {
    const s = { setNumber: "40885-1", totalPaid: 29.88, retailPrice: 0, totalRetailPrice: 0 };
    expect(setPaidProvenance(s, map).source).toBe("manual");
  });

  it("no purchaseMap → no set is 'ledger' (falls through to paid-vs-retail)", () => {
    const s = { setNumber: "75192-1", totalPaid: 753.42, retailPrice: 849.99, totalRetailPrice: 849.99 };
    expect(setPaidProvenance(s, undefined).source).toBe("manual"); // 753.42 ≠ 849.99
  });
});

describe("setPaidProvenance — buckets partition the collection", () => {
  // ledger, manual, msrp, none are mutually exclusive and exhaustive: every set lands in
  // exactly one, so the four counts sum to the total with no double-counting.
  const sets = [
    { setNumber: "75192-1", totalPaid: 753.42, retailPrice: 849.99, totalRetailPrice: 849.99 },     // ledger
    { setNumber: "71052-5", totalPaid: 10.91, retailPrice: 4.99, totalRetailPrice: 9.98, quantity: 2 }, // ledger (CMF join)
    { setNumber: "10698-1", totalPaid: 82.8, retailPrice: 59.99, totalRetailPrice: 299.95, quantity: 5 }, // manual
    { setNumber: "7498-1", totalPaid: 99.99, retailPrice: 99.99, totalRetailPrice: 99.99 },           // msrp
    { setNumber: "40272-1", totalPaid: 9.99, retailPrice: 9.99, totalRetailPrice: 9.99 },             // msrp
    { setNumber: "30700-1", totalPaid: 0, retailPrice: 4.99, totalRetailPrice: 4.99 },                // none
  ];

  it("each set is classified into exactly one bucket; counts sum to total", () => {
    const counts = { ledger: 0, manual: 0, msrp: 0, none: 0 };
    for (const s of sets) {
      const { source } = setPaidProvenance(s, map);
      expect(counts).toHaveProperty(source); // source is always one of the four
      counts[source]++;
    }
    expect(counts).toEqual({ ledger: 2, manual: 1, msrp: 2, none: 1 });
    expect(counts.ledger + counts.manual + counts.msrp + counts.none).toBe(sets.length);
  });
});

describe("paidConfidence — mirrors valueConfidence", () => {
  it("'msrp' → quiet marker + tooltip", () => {
    expect(paidConfidence({ source: "msrp" })).toEqual({ marker: "MSRP?", tooltip: "estimated at retail, no purchase record" });
  });
  it("ledger / manual / none / null → no marker", () => {
    for (const source of ["ledger", "manual", "none"]) expect(paidConfidence({ source })).toBeNull();
    expect(paidConfidence(null)).toBeNull();
  });
});

describe("costBasisBreakdown — Overview split (real vs MSRP-estimated)", () => {
  const map = buildPurchaseMap([{ setNumber: "75192" }]);
  const sets = [
    { setNumber: "75192-1", totalPaid: 753.42, retailPrice: 849.99, totalRetailPrice: 849.99 }, // ledger (real)
    { setNumber: "10698-1", totalPaid: 82.8, retailPrice: 59.99, totalRetailPrice: 299.95, quantity: 5 }, // manual (real)
    { setNumber: "7498-1", totalPaid: 99.99, retailPrice: 99.99, totalRetailPrice: 99.99 }, // msrp
    { setNumber: "40272-1", totalPaid: 9.99, retailPrice: 9.99, totalRetailPrice: 9.99 }, // msrp
    { setNumber: "30700-1", totalPaid: 0, retailPrice: 4.99, totalRetailPrice: 4.99 }, // none
  ];

  it("headline real cost = ledger+manual; msrp + none disclosed separately; counts partition", () => {
    const b = costBasisBreakdown(sets, map);
    expect(b.realCount).toBe(2);
    expect(b.msrpCount).toBe(2);
    expect(b.noneCount).toBe(1);
    expect(b.realCost).toBeCloseTo(753.42 + 82.8, 2);
    expect(b.msrpCost).toBeCloseTo(99.99 + 9.99, 2);
    expect(b.totalCost).toBeCloseTo(b.realCost + b.msrpCost, 2);
    expect(b.realCount + b.msrpCount + b.noneCount).toBe(sets.length); // partition
  });
});

describe("realCostROI — real market vs real cost only", () => {
  const map = buildPurchaseMap([{ setNumber: "75192" }]);

  it("computes on the real-cost subset; MSRP-placeholder cost is excluded", () => {
    const sets = [
      { setNumber: "75192-1", totalPaid: 100, retailPrice: 849.99, totalRetailPrice: 849.99, totalValue: 150 }, // ledger: (150-100)/100 = 50%
      { setNumber: "7498-1", totalPaid: 99.99, retailPrice: 99.99, totalRetailPrice: 99.99, totalValue: 9999 }, // msrp → excluded (would skew ROI)
    ];
    expect(realCostROI(sets, undefined, map)).toBeCloseTo(50, 5);
  });

  it("null when no real-cost set qualifies (all MSRP / no value)", () => {
    const sets = [{ setNumber: "7498-1", totalPaid: 99.99, retailPrice: 99.99, totalRetailPrice: 99.99, totalValue: 200 }];
    expect(realCostROI(sets, undefined, map)).toBeNull();
  });
});

describe("Overview disclosure notes (revised — total headline, provenance as disclosure)", () => {
  it("estimatedCostNote: quality disclosure 'N estimated at MSRP (~$Y)'; null when none", () => {
    expect(estimatedCostNote(431, 12345.6)).toBe(`431 estimated at MSRP (~${money(12345.6)})`);
    expect(estimatedCostNote(1, 9.99)).toBe(`1 estimated at MSRP (~${money(9.99)})`);
    expect(estimatedCostNote(0, 0)).toBeNull();
  });
  it("totalRoiNote: flags the total-cost ROI includes the MSRP-estimated portion; null when none", () => {
    expect(totalRoiNote(431)).toBe("incl. 431 estimated at MSRP");
    expect(totalRoiNote(0)).toBeNull();
  });
  it("realRoiScopeNote: kept for realCostROI (not headlined)", () => {
    expect(realRoiScopeNote(431)).toBe("vs real cost · excludes 431 estimated at MSRP");
    expect(realRoiScopeNote(0)).toBe("vs real cost");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHARACTERIZATION — live split snapshot (documentation, NOT a hard invariant).
//
// As of 2026-06-02, the live Upstash collection (600 sets, post paid-migration) split:
//   ledger 40 · manual-real 45 · msrp-placeholder 431 · none 84   (Σ = 600)
// derived by this exact classifier over the read-only diagnosis. EXPECTED TO DRIFT as
// purchases are logged (msrp → ledger) and sets are added. The private collection is not
// committed (outputs/ is gitignored), so the numbers are recorded here as a reference
// point rather than asserted against in-repo data.
// ─────────────────────────────────────────────────────────────────────────────
describe("characterization — live split snapshot (documentation)", () => {
  it("records the 2026-06-02 split as a drift reference, not an invariant", () => {
    const SNAPSHOT_2026_06_02 = { ledger: 40, manual: 45, msrp: 431, none: 84 };
    expect(SNAPSHOT_2026_06_02.ledger + SNAPSHOT_2026_06_02.manual + SNAPSHOT_2026_06_02.msrp + SNAPSHOT_2026_06_02.none).toBe(600);
  });
});
