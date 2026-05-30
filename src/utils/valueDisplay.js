import { money } from "./formatting";

// ─────────────────────────────────────────────────────────────────────────────
// Value-surfacing display helpers (V2c). Pure, no React, no localStorage writes.
//
// These turn the Value provenance type (src/utils/value.js) into what My
// Collection actually shows, per docs/valuation.md:
//   - rule 6: unknown ≠ $0 — an unknown value renders "—", never a phantom $0.00.
//   - rule 2: an at-retail figure IS the sticker price; it must be labeled as
//     retail (here: a tooltip) so a reader doesn't mistake it for market value,
//     and so the ROI beside it reads as discount-vs-retail, not appreciation.
//
// Nothing here persists or overrides a number — formatting + a caveat string only.
// The ROI computation in MyCollection is intentionally left untouched (V2c spec).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a set's value cell from its {@link import("./value").Value} struct.
 * Unknown (amount === null) → "—"; a known amount (incl. a genuine 0) → money().
 * Unknown is NEVER rendered as $0.00 (docs/valuation.md rule 6).
 *
 * @param {import("./value").Value} value
 * @returns {string}
 */
export function formatValueCell(value) {
  if (!value || value.amount === null) return "—";
  return money(value.amount);
}

/**
 * Note for how many sets carry no value data: "N of M sets have no value data".
 * Returns null when none are unknown (N === 0) so the caller omits the note
 * entirely rather than printing "0 of M".
 *
 * @param {number} knownCount  Sets with a known value (knownValueCount).
 * @param {number} totalCount  Total sets (sets.length).
 * @returns {string|null}
 */
export function unknownValueNote(knownCount, totalCount) {
  const unknown = totalCount - knownCount;
  if (unknown <= 0) return null;
  return `${unknown} of ${totalCount} sets have no value data`;
}

// The retail caveat covers BOTH halves of the at-retail trap: the figure is the
// sticker price (not a secondary-market valuation), AND any ROI beside it is the
// buyer's discount vs retail, not market appreciation. (docs/valuation.md rule 2)
const RETAIL_TOOLTIP =
  "Value shown is the current retail (sticker) price, not a secondary-market value. " +
  "Any ROI shown is your discount vs retail, not market appreciation.";

/**
 * Tooltip text for an at-retail value cell (basis === 'retail'), else null.
 * Acts as the predicate too: present for retail-basis, absent for market/unknown.
 *
 * @param {import("./value").Value} value
 * @returns {string|null}
 */
export function retailTooltip(value) {
  if (!value || value.basis !== "retail") return null;
  return RETAIL_TOOLTIP;
}
