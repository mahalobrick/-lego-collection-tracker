// ─────────────────────────────────────────────────────────────────────────────
// CMF (Collectible Minifigures) series-bag MSRP — era-table fallback.
//
// Brickset's series-bag (`-0`) retail is the canonical source and ALWAYS wins when
// present; this table is a GATED fallback, consulted only when the `-0` retail is
// null. Confirmed via a read-only Brickset probe: of the owned numeric series, only
// 71034 (Series 23) has a `-0` entry with no retailPrice — Brickset catalogues the
// bag but never priced it; the other owned series return $4.99. Older numeric series
// (pre-2023) are at the same risk, so the table covers all of Series 1–29.
//
// Bag MSRP = per-figure MSRP (a blind bag is one figure). US era tiers:
//   Series 1–11 → $2.99 · Series 12–17 → $3.99 · Series 18–29 → $4.99
//
// THEMED CMF series (Disney 100, Marvel, D&D, F1, …) have no numeric series ordinal
// and their Brickset `-0` retail works, so they are intentionally ABSENT here → no
// fallback. The table membership IS the "is this a numeric CMF series" test.
// ─────────────────────────────────────────────────────────────────────────────

// LEGO set base number → numeric CMF series ordinal (1–29). Spot-checked against
// Brickset `-0` set names (read-only probe): 8833→S8, 71000→S9, 71002→S11, 71007→S12,
// 71013→S16, 71018→S17, 71021→S18, 71032→S22, 71034→S23, … 71052→S29.
// Exported so the image-URL builder (formatting.js → setImageUrl) shares this ONE membership table
// for "is this a numeric CMF series" — no hardcoded duplicate list. cmfRetail.js imports nothing, so
// formatting.js → cmfRetail.js is a one-way edge (no cycle).
export const CMF_SERIES_BY_BASE = {
  "8683": 1, "8684": 2, "8803": 3, "8804": 4, "8805": 5, "8827": 6, "8831": 7, "8833": 8,
  "71000": 9, "71001": 10, "71002": 11, "71007": 12, "71008": 13, "71010": 14, "71011": 15,
  "71013": 16, "71018": 17, "71021": 18, "71025": 19, "71027": 20, "71029": 21, "71032": 22,
  "71034": 23, "71037": 24, "71045": 25, "71046": 26, "71048": 27, "71051": 28, "71052": 29,
};

/**
 * Bag (per-figure) MSRP for a numeric CMF series ordinal, by US era tier. Returns null
 * for a non-integer or out-of-range ordinal (no fabricated price).
 *
 * @param {number} series  CMF series ordinal (1–29).
 * @returns {number|null}  2.99 | 3.99 | 4.99, or null.
 */
export function cmfEraPriceForSeries(series) {
  if (!Number.isInteger(series) || series < 1 || series > 29) return null;
  if (series <= 11) return 2.99;
  if (series <= 17) return 3.99;
  return 4.99; // Series 18–29
}

/**
 * Era-table MSRP fallback for a CMF figure/series set, derived from its LEGO base number
 * (variant stripped: "71034-3" → "71034" → Series 23 → $4.99). Returns null for any set
 * that is NOT a numeric CMF series (themed series, non-CMF sets, junk input) — those need
 * no fallback. GATED USE ONLY: feed this as the LOWEST retail rung so a present Brickset
 * `-0` price (or a hand-entered manual MSRP) always wins.
 *
 * @param {string} setNumber  e.g. "71034-3" / "71034".
 * @returns {number|null}  the era bag MSRP, or null.
 */
export function cmfEraRetail(setNumber) {
  const base = String(setNumber ?? "").replace(/-\d+$/, "").trim();
  const series = CMF_SERIES_BY_BASE[base];
  return series ? cmfEraPriceForSeries(series) : null;
}
