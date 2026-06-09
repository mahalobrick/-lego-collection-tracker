import { valueAmount } from "./value";

/**
 * BrickLink per-set value-history read adapter (trend BE→BL swap, Phase 1 — pure, INERT).
 *
 * The BL counterpart to priceEventsFromBE (src/utils/priceEvents.js). It maps a `history:SET:{n}`
 * series (served verbatim by /api/history → blHistoryCache) into the SAME oldest→newest series the
 * charts expect, so Phase 2's chart swap is a drop-in: identical OUTPUT contract, byte-for-byte.
 *
 * Pure: no I/O, no storage reads — the caller passes the cached series array. NO consumer wiring
 * lives here (that is Phase 2). priceEventsFromBE is NOT modified; this is a sibling adapter.
 *
 * BL history shape (history:SET:{n} list elements, as stored — newest-first, LPUSH + LTRIM ~520):
 *   [{ asOf: ISO-8601 string, new: number|null, used: number|null }, …]
 *
 * Adapter contract (mirrors priceEventsFromBE EXACTLY):
 *   • Returns TWO separate series { new, used }, each [{ date, value }] — NOT merged by date.
 *   • Re-sorted ASC by date (input is newest-first; the chart expects oldest→newest).
 *   • date = asOf.slice(0,10) → "YYYY-MM-DD" (the format the X-axis tickFormatter expects).
 *   • 0 = unknown discipline (single-sourced via value.js `valueAmount`): a point whose value is
 *     missing or 0 is unknown → OMITTED, never emitted as a $0 point.
 *   • A point with no string asOf can't be placed on the axis → dropped.
 *
 * @param {Array<{asOf:string, new:number|null, used:number|null}>} series  cached BL history (may be null/partial)
 * @returns {{ new: Array<{date:string, value:number}>, used: Array<{date:string, value:number}> }}
 */
export function historyFromBL(series) {
  return {
    new: mapSeries(series, "new"),
    used: mapSeries(series, "used"),
  };
}

/** Map one condition out of the BL history list → clean ASC [{date, value}], dropping unknowns. */
function mapSeries(series, cond) {
  const events = Array.isArray(series) ? series : []; // absent / malformed → empty series
  return events
    .map((e) => {
      const value = valueAmount(e?.[cond]); // 0 / missing / unparseable → null (unknown)
      if (value == null) return null; // omit unknown points — never a $0 plot
      const asOf = typeof e?.asOf === "string" ? e.asOf : null;
      if (!asOf) return null; // a point with no date can't be placed on the axis
      return { date: asOf.slice(0, 10), value };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date)); // newest-first → ASC (oldest → newest)
}
