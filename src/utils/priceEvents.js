import { valueAmount } from "./value";

/**
 * BrickEconomy price_events read adapter (price_events Phase 2 — pure, dark).
 *
 * Maps the BrickEconomy `/set` `data` blob's real dated price history into the
 * oldest→newest series the charts expect. This is the substrate that replaces the
 * app's home-grown 60-day rolling `blPriceHistory` (see docs/value-layer-plan.md §5).
 *
 * Pure: no I/O, no storage reads — the caller passes the cached `data` object
 * (`brickEconomySetCache[key].data`). NO consumer wiring lives here (that is Phase 3).
 *
 * BrickEconomy shape (pinned from real fixtures — test-data/be-fixtures/README.md):
 *   data.price_events_new / data.price_events_used = [{ date: "YYYY-MM-DD", value: number }, …]
 *   • newest-first (DESC); a fixed ~12-point, retired-only window.
 *   • BOTH keys are entirely ABSENT (not [] / null) for non-retired sets.
 *   • price_events_used can be absent while price_events_new is present (used ⊆ new).
 *
 * Adapter contract:
 *   • Returns TWO separate series { new, used }, each [{ date, value }] — NOT merged
 *     by date (new/used observation dates differ). D1: the UI renders only `new` now;
 *     `used` is mapped anyway so V4 adds the used line with zero rework.
 *   • Each input array is read defensively (?? []) — absent → empty series.
 *   • Re-sorted ASC by date (BE returns DESC; the chart expects oldest→newest).
 *   • 0 = unknown discipline (single-sourced via value.js `valueAmount`): a point whose
 *     value is missing or 0 is unknown → OMITTED, never emitted as a $0 point. (No zeros
 *     in the real fixtures; defensive, and consistent with every other value read.)
 *
 * @param {object} data  the cached BrickEconomy `/set` data object (may be null/partial)
 * @returns {{ new: Array<{date:string, value:number}>, used: Array<{date:string, value:number}> }}
 */
export function priceEventsFromBE(data) {
  return {
    new: mapSeries(data?.price_events_new),
    used: mapSeries(data?.price_events_used),
  };
}

/** Map one raw BE event array → clean ASC [{date, value}], dropping unknown (0/absent) values. */
function mapSeries(rawEvents) {
  const events = rawEvents ?? []; // absent (non-retired) → empty series
  if (!Array.isArray(events)) return [];
  return events
    .map((e) => {
      const value = valueAmount(e?.value); // 0 / missing / unparseable → null (unknown)
      if (value == null) return null; // omit unknown points — never a $0 plot
      const date = typeof e?.date === "string" ? e.date : null;
      if (!date) return null; // a point with no date can't be placed on the axis
      return { date, value };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date)); // DESC → ASC (oldest → newest)
}
