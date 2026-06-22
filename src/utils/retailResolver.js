// Shared retail-ladder resolver. ONE factory builds the per-set MSRP resolver that BOTH the
// MyCollection MSRP card (retailFor) and the collection CSV export call, so the card and the
// export can never drift — parity by construction. Extracted verbatim from the MyCollection
// `retailFor` closure (a dropped rung can no longer hide in a component).
//
// Static + research-derived under the hood (curated/cmf tables, the Brickset cache); no network,
// never source:"brickeconomy" (Phase 3c intact). The Brickset cache is INJECTED (the caller reads
// it once via getBricksetCache) so this stays a pure function of (cache, set).
import { setRetailProvenance, isPromoNoRetail } from "./portfolio";
import { bricksetRetailEntry } from "./brickset";
import { cmfEraRetail } from "./cmfRetail";
import { curatedRetail } from "./curatedMsrp";

/**
 * Build a per-set retail (MSRP) resolver bound to a Brickset cache snapshot. The returned
 * function walks {@link import("./portfolio").RETAIL_SOURCE_ORDER} via {@link setRetailProvenance}
 * and returns the resolved {@link import("./value").Value} (or null when nothing is sourced and the
 * set is not a promo). Reads the set's FULL (unstripped) setNumber — curated/Brickset rungs key on
 * the full number (e.g. "30303-1"), so a stripped "30303" would silently miss them.
 *
 * @param {Object<string, {data?:Object, fetchedAt?:string}>} bricksetCache  the `bricksetSetCache` map.
 * @returns {(set:{setNumber?:string, msrp?:*, msrpOverride?:*, condition?:string|null}) => (import("./value").Value | null)}
 */
export function makeRetailResolver(bricksetCache) {
  return function retailFor(set) {
    const n = set.setNumber;
    // The Brickset rung walks figure→base→series-0→-1 and takes the first with a real retail
    // (CMF series retail lives on the -0 variant; the figure's own entry has none) — see
    // bricksetRetailEntry.
    const bsEntry = bricksetRetailEntry(bricksetCache, n) || {};
    // Curated rung (static, research-derived — no network, never BE): tier routes which rung carries the
    // amount. sourced → curated_sourced (basis "retail", above cmf); estimated → curated_estimated (basis
    // "estimated", last). A promo's curated value stays a promo ARV (Option C) via setRetailProvenance.
    const cur = curatedRetail(n); // { msrp, tier, confidence, source } | null
    return setRetailProvenance(
      {
        // override = explicit Edit-drawer MSRP correction (set.msrpOverride). First in RETAIL_SOURCE_ORDER
        // → beats Brickset. The add-baked `manual` (set.msrp) stays below Brickset (gate Option B).
        override: { amount: set.msrpOverride },
        brickset: { amount: bsEntry.data?.retail_price_us, asOf: bsEntry.fetchedAt },
        manual:   { amount: set.msrp }, // hand-entered MSRP (Phase 3a rung); 0/absent → skipped
        curated_sourced:   cur?.tier === "sourced"   ? { amount: cur.msrp, confidence: cur.confidence, source: cur.source } : undefined,
        cmf:      { amount: cmfEraRetail(n) }, // CMF series-bag era-table fallback; gated below curated_sourced
        curated_estimated: cur?.tier === "estimated" ? { amount: cur.msrp, confidence: cur.confidence, source: cur.source } : undefined,
      },
      { condition: set.condition, promo: isPromoNoRetail(set) }
    );
  };
}
