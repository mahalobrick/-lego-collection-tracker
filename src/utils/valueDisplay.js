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
 * THE value→display decision, single-sourced: a null/undefined amount → "—"
 * (unknown, docs/valuation.md rule 6), any number → money() (incl. a genuine 0).
 * Both the Value-struct path ({@link formatValueCell}) and any bare-number value
 * read funnel through here so there is ONE "—"-vs-money rule, never an inline
 * `amount == null ? … : money()` re-implemented at a call site.
 *
 * @param {number|null|undefined} amount
 * @returns {string}
 */
export function formatValue(amount) {
  return amount == null ? "—" : money(amount);
}

/**
 * THE aggregate value→display decision: a total over a set of which `knownCount`
 * carry a known value. When NOTHING is known (knownCount === 0) the total is a
 * phantom $0 (every contribution was unknown→0), so render "—", not "$0.00";
 * otherwise render the money() total. This is the aggregate twin of {@link formatValue}
 * for the headline/card figures (portfolioValue, gain, avg, …) where an all-unknown
 * collection would otherwise read as a real $0. (docs/valuation.md rule 6)
 *
 * @param {number} total       The summed value (unknowns already contribute 0).
 * @param {number} knownCount  How many contributors had a known value (knownValueCount).
 * @returns {string}
 */
export function formatAggregateValue(total, knownCount) {
  return knownCount > 0 ? money(total) : "—";
}

/**
 * Render a set's value cell from its {@link import("./value").Value} struct:
 * amount null → "—" (unknown), else money(). Unknown is NEVER rendered as $0.00
 * (docs/valuation.md rule 6).
 *
 * Thin adapter over {@link formatValue} — the struct and bare-number paths share
 * one "—"/money decision. It does NOT decide 0-vs-unknown: for VALUE the 0→unknown
 * coalescing is single-sourced upstream in {@link import("./value").valueAmount} (used
 * by rawSetValue and the per-copy path), so a 0 amount never reaches here on a value
 * read; there is no genuine-$0 value case to render.
 *
 * @param {import("./value").Value} value
 * @returns {string}
 */
export function formatValueCell(value) {
  return formatValue(value?.amount);
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

// ─────────────────────────────────────────────────────────────────────────────
// Confidence display (app-read Step 3). Surfaces a value's BrickLink basis so an
// ESTIMATE reads as an estimate, not a hard sold figure. Pure — marker text + tooltip
// only. Only BL-sourced values carry a marker; BE/retail/unknown get none (a clean
// "sold" figure also gets none — that's the default). docs/value-source-decision.md §3.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Confidence marker for a value cell, or `null` for the clean default (a hard `sold` figure,
 * or any non-BrickLink / unknown value). For a mixed-basis set the marker comes from the
 * set-level `confidence` flag; for a single basis it comes from the basis itself.
 *
 * @param {import("./value").Value} value
 * @returns {{marker:string, tooltip:string}|null}
 */
export function valueConfidence(value) {
  if (!value || value.source !== "bricklink" || value.amount == null) return null;
  if (value.basis === "mixed") {
    if (value.confidence === "estimates") return { marker: "est.", tooltip: "Contains estimated values" };
    if (value.confidence === "thin") return { marker: "thin", tooltip: "Contains thin sold data" };
    return null; // a mixed set of only clean sold copies needs no marker
  }
  switch (value.basis) {
    case "sold_thin":
      return { marker: "thin", tooltip: `Based on few recent sales${value.lots != null ? ` (${value.lots})` : ""}` };
    case "modeled":
      return { marker: "est.", tooltip: "Estimated from new sold price" };
    case "asking":
      return { marker: "ask", tooltip: "Based on current listings, not completed sales" };
    case "sold":
    default:
      return null; // clean sold figure → no marker
  }
}

/**
 * Confidence marker for a PAID (cost-basis) cell — the paid analog of {@link valueConfidence}.
 * Only an 'msrp' provenance (paid defaulted to retail, no purchase record) carries a quiet
 * marker so a placeholder cost reads as estimated, not entered. 'ledger' / 'manual' / 'none'
 * get none (a real or absent paid needs no caveat). Pure — marker text + tooltip only.
 *
 * @param {{source?: string}} prov  from {@link import("./portfolio").setPaidProvenance}.
 * @returns {{marker: string, tooltip: string}|null}
 */
export function paidConfidence(prov) {
  if (!prov || prov.source !== "msrp") return null;
  return { marker: "MSRP?", tooltip: "estimated at retail, no purchase record" };
}

/**
 * How a value's `lots` should be READ, per basis: sold/sold_thin are completed SALES; modeled is
 * derived from the new sold price (NOT a sales count, so no number is surfaced); asking is current
 * LISTINGS. Returns null when there's nothing meaningful to label.
 *
 * @param {import("./value").Value} value
 * @returns {string|null}
 */
export function lotsLabel(value) {
  if (!value || value.source !== "bricklink") return null;
  switch (value.basis) {
    case "sold":
    case "sold_thin":
      return value.lots != null ? `${value.lots} sales` : null;
    case "modeled":
      return "from new price"; // lots is the NEW sample size — never shown as this copy's sales
    case "asking":
      return value.lots != null ? `${value.lots} listings` : null;
    default:
      return null;
  }
}

/**
 * Quiet aggregate disclosure: "X% of value estimated" (modeled + asking dollars). Returns null
 * when the share rounds to 0% so the caller omits it. (sold_thin is flagged per-row, not here.)
 *
 * @param {number} share  fraction in [0, 1] (estimatedValueShare).
 * @returns {string|null}
 */
export function estimatedValueNote(share) {
  if (!share || share <= 0) return null;
  const pct = share * 100;
  const shown = pct < 1 ? pct.toFixed(1) : Math.round(pct).toString();
  return `${shown}% of value estimated`;
}

/**
 * Note for how many sets are excluded from % ROI — unknown value OR no cost
 * (cost ≤ 0). A % return isn't meaningful without both a known value and a
 * positive cost, so those sets read "—"; this note tells the reader how many.
 * Returns null when none are excluded so the caller omits the note entirely.
 *
 * @param {number} excludedCount  Sets excluded from %ROI (roiExcludedCount).
 * @returns {string|null}
 */
export function roiExclusionNote(excludedCount) {
  if (!excludedCount || excludedCount <= 0) return null;
  return `${excludedCount} set${excludedCount === 1 ? "" : "s"} excluded from ROI (no value or no cost)`;
}
