import { describe, it, expect } from "vitest";
import { bricksetRetailEntry, cmfSeriesRetailTargets } from "./brickset";
import { setPaidProvenance, buildPurchaseMap, setRetailProvenance } from "./portfolio";

// ─────────────────────────────────────────────────────────────────────────────
// Retail Phase 1 (backlog #1) — CMF retail resolution + F2 non-effect.
//
// The CMF retail hole (G1): Brickset puts a series' per-bag retail on the -0 variant
// (71052-0 → $4.99 US, already PER-FIGURE, not a case total), while each figure's own
// -N entry carries none. retailFor's old /-1$/ strip never reached the series at all
// (71052-5 → brickset_71052-5-1, garbage). bricksetRetailEntry walks figure→base→
// series-0→-1 and takes the first candidate with a REAL retail, so a cached null-retail
// figure entry can't shadow the series price. These tests pin that resolution.
//
// F2: the strip fix is DISPLAY-only. paidEqualsRetail reads STORED totalRetailPrice/
// retailPrice (every CMF already carries $4.99 from BE import), never the Brickset cache —
// so CMF cost bucketing does not move. The last test pins that invariant.
// ─────────────────────────────────────────────────────────────────────────────

const AS_OF = "2026-06-02T00:00:00.000Z";
const entry = (retail) => ({ data: { retail_price_us: retail }, fetchedAt: AS_OF });

describe("bricksetRetailEntry — CMF series (-0) retail resolution", () => {
  it("resolves a CMF figure to its series -0 retail (the per-figure bag price)", () => {
    const cache = { "brickset_71052-0": entry(4.99) };
    const e = bricksetRetailEntry(cache, "71052-5");
    expect(e?.data?.retail_price_us).toBe(4.99);
  });

  it("a cached null-retail figure entry does NOT shadow the -0 series price", () => {
    const cache = {
      "brickset_71052-5": entry(null), // the figure's own Brickset entry — no retail
      "brickset_71052-0": entry(4.99), // the series box — carries the per-bag retail
    };
    const e = bricksetRetailEntry(cache, "71052-5");
    expect(e?.data?.retail_price_us).toBe(4.99);
  });

  it("the old /-1$/ strip key shape (71052-5-1) is irrelevant — base join reaches -0", () => {
    // Pin the regression: a cache holding ONLY the series -0 still resolves, where the old
    // retailFor (which looked up brickset_71052-5-1) returned nothing → "—".
    const cache = { "brickset_71052-0": entry(5.99) };
    expect(bricksetRetailEntry(cache, "71034-12")?.data?.retail_price_us).toBeUndefined(); // wrong series → miss
    expect(bricksetRetailEntry(cache, "71052-9")?.data?.retail_price_us).toBe(5.99);       // same series → hit
  });

  it("a regular set resolves its own figure entry unchanged (no -0 in play)", () => {
    const cache = { "brickset_10300-1": entry(199.99) };
    expect(bricksetRetailEntry(cache, "10300-1")?.data?.retail_price_us).toBe(199.99);
  });

  it("no retail anywhere → returns the bare figure entry (for asOf) or null", () => {
    expect(bricksetRetailEntry({ "brickset_71052-5": entry(null) }, "71052-5")?.fetchedAt).toBe(AS_OF);
    expect(bricksetRetailEntry({}, "71052-5")).toBeNull();
    expect(bricksetRetailEntry(undefined, "71052-5")).toBeNull();
  });
});

describe("cmfSeriesRetailTargets — the bounded -0 fetch list", () => {
  const cmf = (n) => ({ setNumber: n, theme: "Minifigure Series" });

  it("targets one -0 per owned CMF series, deduped across figures (not per-figure)", () => {
    const sets = [cmf("71052-1"), cmf("71052-5"), cmf("71052-12"), cmf("71045-3")];
    expect(cmfSeriesRetailTargets(sets, {})).toEqual(["71052-0", "71045-0"]);
  });

  it("ignores non-CMF sets (only theme 'Minifigure Series')", () => {
    const sets = [cmf("71052-5"), { setNumber: "10300-1", theme: "Icons" }];
    expect(cmfSeriesRetailTargets(sets, {})).toEqual(["71052-0"]);
  });

  it("skips a series whose -0 is already cached (so the pass stays bounded across loads)", () => {
    const sets = [cmf("71052-5"), cmf("71045-3")];
    const cache = { "brickset_71052-0": { data: { retail_price_us: 4.99 } } };
    expect(cmfSeriesRetailTargets(sets, cache)).toEqual(["71045-0"]);
  });

  it("empty when no CMFs owned", () => {
    expect(cmfSeriesRetailTargets([{ setNumber: "10300-1", theme: "Icons" }], {})).toEqual([]);
  });
});

describe("SetDetailPanel resolves CMF retail via the SAME shared resolver as the table", () => {
  // Mirror the panel's exact retail expression (SetDetailPanel.jsx): the Brickset amount comes from
  // bricksetRetailEntry(bsCache, item.setNumber). Pin that a CMF figure resolves the series -0 price.
  const panelRetail = (bsCache, setNumber) => {
    const e = bricksetRetailEntry(bsCache, setNumber) || {};
    return setRetailProvenance(
      { brickset: { amount: e.data?.retail_price_us }, brickeconomy: { amount: null } },
      { condition: "new" },
    );
  };

  it("a CMF figure resolves $4.99 from Brickset (series -0), not BE", () => {
    const cache = {
      "brickset_71052-5": { data: { retail_price_us: null } },
      "brickset_71052-0": { data: { retail_price_us: 4.99 } },
    };
    const prov = panelRetail(cache, "71052-5");
    expect(prov?.amount).toBe(4.99);
    expect(prov?.source).toBe("brickset");
  });

  it("a regular set is unchanged — resolves its own figure entry", () => {
    const cache = { "brickset_10300-1": { data: { retail_price_us: 199.99 } } };
    expect(panelRetail(cache, "10300-1")?.amount).toBe(199.99);
  });
});

describe("F2 — CMF cost bucketing is unaffected by the retail display fix", () => {
  // A CMF figure as imported from BE: paid == retail == $4.99 (137/137 in the real collection).
  const cmf = { setNumber: "71052-5", totalPaid: 4.99, totalRetailPrice: 4.99, retailPrice: 4.99, qty: 1 };

  it("non-ledger CMF (paid==stored retail) classifies 'msrp' — from STORED fields, not retailFor", () => {
    // No purchase record → falls to paidEqualsRetail, which reads s.totalRetailPrice (not the
    // Brickset cache the strip fix touches). So this is invariant to Retail Phase 1.
    expect(setPaidProvenance(cmf, buildPurchaseMap([])).source).toBe("msrp");
  });

  it("a CMF backed by its series purchase classifies 'ledger' — short-circuits before retail", () => {
    const purchases = [{ setNumber: "71052", paidPrice: 59.88 }]; // one series purchase, base join
    expect(setPaidProvenance(cmf, buildPurchaseMap(purchases)).source).toBe("ledger");
  });
});
