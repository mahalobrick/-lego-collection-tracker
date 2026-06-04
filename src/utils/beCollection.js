// ─────────────────────────────────────────────────────────────────────────────
// BrickEconomy collection shape — the canonical per-set roll-up used by BOTH the
// BrickEconomy CSV importer (AppSettings) and the purchase-promotion path
// (Budget / Wanted → My Collection). Keeping one aggregation here means a promoted
// purchase produces a byte-identical normalized row to an imported one — no second,
// drifting writer of the blob (brickEconomyNormalizedCollection).
//
// Phase 0: extraction only. normalizeBrickEconomyCollection is moved here verbatim
// in behavior (now expressed via the shared aggregateFromEntries); promotion helpers
// land in Phase 1.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-set aggregation over a group of per-copy entries — the roll-up shared by the
 * importer and the promotion path. Pure. Sums paid / value / retail across copies;
 * a 0 / absent figure contributes 0, so an unknown-valued copy never inflates the
 * total (it just doesn't add to it). Base fields (setNumber/name/theme/…) come from
 * the caller (the importer takes them from the group's first copy).
 *
 * @param {Object} base    { setNumber, name, theme, subtheme, year, pieces, retired }.
 * @param {Array}  entries per-copy items; paid_price / current_value / retail_price read
 *                         in snake- or Title-case (same readers as the CSV importer).
 * @returns {Object} normalized blob row: { ...base, quantity, totalPaid, totalValue,
 *                   totalRetailPrice, averagePaid, retailPrice, unrealizedGain, roiPct, entries }.
 */
export function aggregateFromEntries(base, entries) {
  let quantity = 0, totalPaid = 0, totalValue = 0, totalRetailPrice = 0;
  for (const item of entries) {
    quantity         += 1;
    totalPaid        += Number(item.paid_price    ?? item.Paid   ?? item.paid   ?? 0) || 0;
    totalValue       += Number(item.current_value ?? item.Value  ?? item.value  ?? 0) || 0;
    totalRetailPrice += Number(item.retail_price  ?? item.Retail ?? 0) || 0;
  }
  return {
    ...base,
    quantity,
    totalPaid,
    totalValue,
    totalRetailPrice,
    averagePaid:    quantity ? totalPaid / quantity : 0,
    retailPrice:    quantity ? totalRetailPrice / quantity : 0,
    unrealizedGain: totalValue - totalPaid,
    roiPct:         totalPaid ? ((totalValue - totalPaid) / totalPaid) * 100 : null,
    entries,
  };
}

/**
 * Group a flat list of per-copy items by set number into normalized blob rows.
 * Behavior-identical to the former inline AppSettings function: base attributes are
 * taken from each group's FIRST copy, sums via {@link aggregateFromEntries}.
 *
 * @param {Array} collection per-copy items (BrickEconomy CSV rows).
 * @returns {Array<Object>} normalized rows for brickEconomyNormalizedCollection.
 */
export function normalizeBrickEconomyCollection(collection) {
  const bySet = {};
  for (const item of collection) {
    const setNumber = item.set_number || item.Number || item.number;
    if (!setNumber) continue;
    if (!bySet[setNumber]) {
      bySet[setNumber] = {
        base: {
          setNumber,
          name:     item.name     || item.Name     || "",
          theme:    item.theme    || item.Theme    || "",
          subtheme: item.subtheme || item.Subtheme || "",
          year:     Number(item.year || item.Year || 0) || 0,
          pieces:   Number(item.pieces_count || item.Pieces || 0) || 0,
          retired:  !!item.retired,
        },
        entries: [],
      };
    }
    bySet[setNumber].entries.push(item);
  }
  return Object.values(bySet).map(({ base, entries }) => aggregateFromEntries(base, entries));
}
