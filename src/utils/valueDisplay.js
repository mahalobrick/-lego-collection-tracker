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

/**
 * Disclosure for the Retail Value card: the headline sums only sets with a sourced RRP
 * (promo/unsourced contribute 0), so when some are unpriced say how many counted —
 * "N of M sets priced". Returns null when ALL sets are priced (nothing hidden) so the
 * caller omits the note, matching {@link unknownValueNote}'s omit-when-zero contract.
 *
 * @param {number} pricedCount  Sets with a resolved retail (portfolioRetail.known).
 * @param {number} totalCount   Total sets (sets.length).
 * @returns {string|null}
 */
export function retailPricedNote(pricedCount, totalCount) {
  if (totalCount <= 0 || pricedCount >= totalCount) return null;
  return `${pricedCount} of ${totalCount} sets priced`;
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

// ── Promo / no-RRP retail state (Retail Phase 2) ──────────────────────────────
// A THIRD retail outcome beside "a sourced number" and unsourced "—": a GWP/promo set that was never
// sold, so NO RRP exists at any source. setRetailProvenance tags it basis:"promo" (amount null); these
// helpers render it as a DELIBERATE state ("no retail exists"), so it never reads as "not yet sourced".
// vs-Retail% suppresses itself for free — the amount is null, so the consumers' retail gate is falsy.

export const PROMO_NO_RRP_LABEL = "Promo · no RRP";
const PROMO_NO_RRP_TOOLTIP =
  "Gift-with-purchase / promo set — never sold at retail, so it has no RRP. " +
  "A known 'no retail' state, not a price we failed to source.";

/**
 * Is this a promo/no-RRP retail Value (basis:"promo")? The discriminator for the third retail state.
 * @param {import("./value").Value | null} value
 * @returns {boolean}
 */
export function isPromoNoRrp(value) {
  return value?.basis === "promo";
}

/**
 * Retail cell text across the three states: promo → the no-RRP tag (a real "no retail exists" state);
 * a sourced figure → money(); unsourced → "—". The retail twin of {@link formatValueCell} that keeps
 * promo DISTINCT from unknown.
 * @param {import("./value").Value | null} value
 * @returns {string}
 */
export function formatRetailCell(value) {
  return isPromoNoRrp(value) ? PROMO_NO_RRP_LABEL : formatValueCell(value);
}

/**
 * Tooltip for a retail cell: the promo explanation for a no-RRP set, else the at-retail sticker-price
 * caveat ({@link retailTooltip}), else null.
 * @param {import("./value").Value | null} value
 * @returns {string|null}
 */
export function retailCellTooltip(value) {
  return isPromoNoRrp(value) ? PROMO_NO_RRP_TOOLTIP : retailTooltip(value);
}

/**
 * Source marker for a retail cell — distinguishes a NON-canonical RRP from a clean Brickset-sourced
 * one (which gets no marker). Mirrors the value/paid confidence markers:
 *   - source 'manual'            → "manual"  (hand-entered MSRP, not a sourced retail — Phase 3a rung)
 *   - Brickset / promo / unknown → null (no marker)
 * Returns null when there's no amount (a "—" / promo cell carries no source chip).
 * (BrickEconomy was removed from the retail ladder in Phase 3c, so no retail can be BE-sourced — its
 * "be" marker branch was unreachable and is gone. BE remains a VALUE fallback only.)
 *
 * @param {import("./value").Value | null} value
 * @returns {{marker:string, tooltip:string}|null}
 */
export function retailSourceMarker(value) {
  if (!value || value.amount == null) return null;
  if (value.source === "manual") {
    return { marker: "manual", tooltip: "Hand-entered MSRP — not a sourced retail price" };
  }
  return null;
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
  // BE-removal D1: a frozen-value set (the 2 deferred promos) carries a static last-recorded
  // figure with no live source — mark it honestly so it never reads as a live market value.
  if (value && value.basis === "frozen" && value.amount != null) {
    const asOf = value.asOf ? ` (as of ${value.asOf})` : "";
    return { marker: "frozen", tooltip: `Last recorded value${asOf} — no live source, no longer updated` };
  }
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
    case "modeled_thin":
      // Distinct from "modeled" on purpose (the cron labels it separately): same estimate family,
      // but the model is derived from a THIN new sample — the tooltip says so honestly.
      return { marker: "est.", tooltip: "Estimated from thin new sold data (few sales)" };
    case "asking":
      return { marker: "ask", tooltip: "Based on current listings, not completed sales" };
    case "sold":
    default:
      return null; // clean sold figure → no marker
  }
}

/**
 * QUALITY disclosure for the cost-basis headline: "N estimated at MSRP (~$Y)". The headline is the
 * TOTAL cost (real + estimated); this note flags how much of it is an MSRP placeholder rather than
 * recorded spend — the cost-side twin of {@link estimatedValueNote}'s "% estimated". The `~` signals
 * the figure is an estimate, not real money. Returns null when none (count 0) so the caller omits it.
 *
 * @param {number} msrpCount  sets whose paid is an MSRP default (no purchase record).
 * @param {number} msrpCost   summed placeholder dollars.
 * @returns {string|null}
 */
export function estimatedCostNote(msrpCount, msrpCost) {
  if (!msrpCount || msrpCount <= 0) return null;
  return `${msrpCount} estimated at MSRP (~${money(msrpCost)})`;
}

/**
 * Disclosure for the TOTAL-cost ROI: notes that the cost denominator INCLUDES the MSRP-estimated
 * portion (so the ROI is approximate where cost is a placeholder). Returns null when none are
 * estimated (the ROI is then fully real and needs no caveat).
 *
 * @param {number} msrpCount  sets whose cost is an MSRP placeholder.
 * @returns {string|null}
 */
export function totalRoiNote(msrpCount) {
  return !msrpCount || msrpCount <= 0 ? null : `incl. ${msrpCount} estimated at MSRP`;
}

/**
 * Scope label for the REAL-cost ROI (kept for {@link import("./portfolio").realCostROI}, not the
 * headline): real-market-vs-real-cost, noting how many sets are excluded for MSRP-placeholder cost.
 * Always returns a string.
 *
 * @param {number} msrpCount  sets excluded from the real-cost ROI for being MSRP-estimated.
 * @returns {string}
 */
export function realRoiScopeNote(msrpCount) {
  return !msrpCount || msrpCount <= 0 ? "vs real cost" : `vs real cost · excludes ${msrpCount} estimated at MSRP`;
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
 * How a value's `lots` should be READ, per basis: sold/sold_thin are completed SALES; modeled /
 * modeled_thin are derived from the new sold price (NOT a sales count, so no number is surfaced;
 * modeled_thin notes the thin sample); asking is current LISTINGS. Returns null when there's
 * nothing meaningful to label.
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
    case "modeled_thin":
      return "from new price (few sales)"; // same NEW-sample convention, thin sample disclosed
    case "asking":
      return value.lots != null ? `${value.lots} listings` : null;
    default:
      return null;
  }
}

/**
 * Quiet aggregate disclosure: "X% of value estimated" (modeled + modeled_thin + asking dollars). Returns null
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
 * Breakdown sub-line for the Net Gain tile under PARTIAL value coverage:
 * "$value − $valuedCost · N valued sets". Net Gain is computed over the value-known subset, so it
 * equals `value − the valued-subset cost` — NOT `value − the Cost Basis tile's inclusive total`.
 * This line shows that subset arithmetic in place so the headline reconciles; the "valued sets"
 * qualifier scopes BOTH figures to the subset, marking this cost as distinct from total spend.
 *
 * Returns null when `valuedCost === costBasis` — i.e. no unvalued set carries any cost, so the
 * Value/Cost/Gain tiles already reconcile on their own (`value − costBasis === gain`) and the
 * steady-state tile stays clean. Also null when nothing is valued (valuedSets ≤ 0 → tile reads "—").
 * (backlog #4 / B1)
 *
 * @param {number} value       portfolioValue — value-known total.
 * @param {number} valuedCost  portfolioValuedCost — cost over the value-known subset.
 * @param {number} valuedSets  knownValueCount — sets in the subset.
 * @param {number} costBasis   totalSpent — inclusive cost (the Cost Basis tile's figure).
 * @returns {string|null}
 */
export function netGainBasisNote(value, valuedCost, valuedSets, costBasis) {
  if (valuedSets <= 0 || valuedCost === costBasis) return null;
  return `${money(value)} − ${money(valuedCost)} · ${valuedSets} valued set${valuedSets === 1 ? "" : "s"}`;
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

// Sign-keyed cell colors for gain / ROI. Green ≥ 0, red < 0, NEUTRAL for unknown (null) —
// matching the "—" the value funnel renders. The single rule, so a cell's color always derives
// from the SAME number it displays (setGain / setROI), never a parallel raw `value − paid` calc.
export const SIGN_COLORS = { pos: "#5aa832", neg: "#ff8b8b", neutral: "#5d6f80" };

/**
 * Color for a signed, null-aware figure (gain or ROI). `null`/`undefined` (unknown) → neutral —
 * so an unknown row reads "—" in neutral, never a phantom red/green. A known value keys strictly to
 * its sign. Pass the EXACT number being displayed (setGain(set)/setROI(set)) so color can't drift.
 *
 * @param {number|null|undefined} amount
 * @returns {string} hex color
 */
export function signColor(amount) {
  if (amount == null) return SIGN_COLORS.neutral;
  return amount >= 0 ? SIGN_COLORS.pos : SIGN_COLORS.neg;
}
