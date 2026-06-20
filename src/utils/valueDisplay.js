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
 * "N of M priced", read against the FULL unique-set total. Returns null when ALL sets are
 * priced (nothing hidden) so the caller omits the note, matching {@link unknownValueNote}'s
 * omit-when-zero contract. The gap's composition (why the rest aren't priced) is disclosed
 * alongside by {@link retailGapNote}.
 *
 * @param {number} pricedCount  Sets with a resolved retail (portfolioRetail.known).
 * @param {number} totalCount   Total sets (sets.length) — the FULL denominator, so the gap itself
 *                              prompts "why aren't all priced?", answered by {@link retailGapNote}.
 * @returns {string|null}
 */
export function retailPricedNote(pricedCount, totalCount) {
  if (totalCount <= 0 || pricedCount >= totalCount) return null;
  return `${pricedCount} of ${totalCount} priced`;
}

/**
 * Companion to {@link retailPricedNote}: the gap's COMPOSITION — why some sets aren't priced.
 * "{promo} promo(s) (no MSRP) · {notListed} not listed", omitting a segment whose count is 0.
 * Returns null when the gap is empty (both 0) so the caller omits it. `promo` is the GWP/no-RRP
 * population (no RRP by nature); `notListed` is sets with a real RRP not yet sourced. Together
 * with the priced count these partition the collection (priced + promo + notListed = sets.length).
 *
 * @param {number} promoCount     GWP/no-RRP sets (portfolioRetail.promo).
 * @param {number} notListedCount Unsourced-but-real-RRP sets (portfolioRetail.notListed).
 * @returns {string|null}
 */
export function retailGapNote(promoCount, notListedCount) {
  const parts = [];
  if (promoCount > 0) parts.push(`${promoCount} promo${promoCount === 1 ? "" : "s"} (no MSRP)`);
  if (notListedCount > 0) parts.push(`${notListedCount} not listed`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The MSRP Value card's coverage breakdown (Option C — 4 segments, zero-count segments omitted):
 *   "N sourced · M estimated (~$X) · P promo (ARV ~$Y) · Q not listed"
 * Supersedes the {@link retailPricedNote} + {@link retailGapNote} pair for the curated era. The HEADLINE
 * is the SOURCED sum only; this discloses the estimated ($X) and promo-ARV ($Y) totals SEPARATELY so
 * estimates/ARVs never inflate it (the `~` flags an estimate). A promo segment with no ARV ($0) reads
 * "P promo (no MSRP)" — the pre-curated label. Returns null when there is no gap (everything sourced),
 * matching {@link retailPricedNote}'s omit-when-nothing-hidden contract.
 *
 * NOTE (segment ≠ tier): a promo whose curated tier is "estimated" is counted in `promo`, not
 * `estimated` (Option C) — so the card's estimated count is the NON-promo estimates only, and can be
 * LESS than the curated CSV's estimated-row count.
 *
 * @param {{known?:number, estimated?:number, estimatedTotal?:number, promo?:number, promoTotal?:number,
 *          notListed?:number}} r  a {@link import("./portfolio").portfolioRetail} result.
 * @returns {string|null}
 */
export function retailCoverageNote({ known = 0, estimated = 0, estimatedTotal = 0, promo = 0, promoTotal = 0, notListed = 0 } = {}) {
  if (estimated + promo + notListed === 0) return null; // fully sourced — the headline says it all
  const parts = [];
  if (known > 0) parts.push(`${known} sourced`);
  if (estimated > 0) parts.push(`${estimated} estimated (~${money(estimatedTotal)})`);
  if (promo > 0) parts.push(promoTotal > 0 ? `${promo} promo (ARV ~${money(promoTotal)})` : `${promo} promo (no MSRP)`);
  if (notListed > 0) parts.push(`${notListed} not listed`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * COUNTS-ONLY twin of {@link retailCoverageNote} for the MSRP card's visible sub (Workstream #2): the
 * four segment COUNTS only — "N sourced · M est. · P promo · Q not listed" — with the dollar detail
 * RELOCATED to {@link retailCoverageTooltip}. SAME segment population + omit-zero + omit-when-fully-sourced
 * contract as retailCoverageNote, so the COUNTS are byte-identical to retailCoverageNote's; only the
 * estimated/promo `$` sums move off the sub. No recompute — it formats the same portfolioRetail result.
 *
 * @param {{known?:number, estimated?:number, promo?:number, notListed?:number}} r  a {@link import("./portfolio").portfolioRetail} result.
 * @returns {string|null}
 */
export function retailCoverageCounts({ known = 0, estimated = 0, promo = 0, notListed = 0 } = {}) {
  if (estimated + promo + notListed === 0) return null; // fully sourced — the headline says it all
  const parts = [];
  if (known > 0) parts.push(`${known} sourced`);
  if (estimated > 0) parts.push(`${estimated} est.`);
  if (promo > 0) parts.push(`${promo} promo`);
  if (notListed > 0) parts.push(`${notListed} not listed`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Tooltip glossary for the MSRP card — defines each segment shown by {@link retailCoverageCounts} and is
 * where the estimated / promo-ARV dollar sums RELOCATE to (off the cramped sub). The only numbers are the
 * EXISTING computed totals (estimatedTotal / promoTotal), relocated — never literals; the `~` flags an
 * estimate (matching {@link retailCoverageNote}'s convention). Mirrors the PRESENT segments so the glossary
 * tracks the counts, and shares their gate — returns null when fully sourced (no sub ⇒ no tooltip).
 *
 * @param {{known?:number, estimated?:number, estimatedTotal?:number, promo?:number, promoTotal?:number,
 *          notListed?:number}} r  the SAME portfolioRetail result fed to {@link retailCoverageCounts}.
 * @returns {string|null}
 */
export function retailCoverageTooltip({ known = 0, estimated = 0, estimatedTotal = 0, promo = 0, promoTotal = 0, notListed = 0 } = {}) {
  if (estimated + promo + notListed === 0) return null;
  const parts = [];
  if (known > 0) parts.push("Sourced = confirmed RRP.");
  if (estimated > 0) parts.push(`Estimated where none exists (~${money(estimatedTotal)}).`);
  if (promo > 0) parts.push(promoTotal > 0
    ? `Promo = LEGO's stated value / ARV (~${money(promoTotal)}), not an RRP.`
    : "Promo = LEGO's stated value / ARV, not an RRP.");
  if (notListed > 0) parts.push("Not listed = no value found.");
  return parts.length ? parts.join(" ") : null;
}

// ── Collection-stats card glossary (Workstream #2) ───────────────────────────
// Static, GENERIC explainer copy for the Overview stat cards — single-sourced here, consumed via Card's
// `subTip` (InfoTip). No per-collection numbers live in these literals; a card that needs a figure in its
// tooltip relocates an EXISTING computed value instead (see {@link retailCoverageTooltip}).

// Total Sets: total (every copy) vs unique (distinct sets), and why they diverge.
export const TOTAL_SETS_TOOLTIP =
  "Total = every copy you own. Unique = distinct sets. The gap is extra copies of multi-copy sets.";

// New / Used COUNT card — counted per COPY, so it differs from the per-SET value cards below.
export const NEW_USED_COUNT_TOOLTIP =
  "Counted per copy — each copy is classed new or used.";

// New / Used / Mixed Sets VALUE cards — counted per SET; the three values partition Collection Value.
export const CONDITION_VALUE_TOOLTIP =
  "Counted per set — New = all copies new, Used = all used, Mixed = you own both. " +
  "The three values sum to your collection value.";

// Retired Sets — explains the sub-line %: retired ÷ unique sets, each set counted once (not per copy).
export const RETIRED_TOOLTIP =
  "The % is your retired sets ÷ your unique sets — each set counts once, not per copy (extra copies of the same set don't count again).";

// Cost Basis — why ROI reads conservative when some costs are MSRP placeholders.
export const COST_BASIS_TOOLTIP =
  "Where you haven't logged what you paid, cost = MSRP — a gold-standard baseline, not a record that you paid full price. Keeps Cost Basis complete and ROI conservative.";

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
// A VALUED promo (basis:"promo" with an amount) — a GWP that carries a researched ARV (curated rung,
// Option C). Its figure is a stated value, NOT a sticker price, so it's labeled distinctly here.
const PROMO_ARV_TOOLTIP = "LEGO-stated value, not a sourced RRP.";

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
  if (isPromoNoRrp(value)) {
    // A valued promo (curated ARV) shows the figure with the Promo tag; a valueless GWP shows "no RRP".
    return value.amount != null ? `Promo · ${money(value.amount)}` : PROMO_NO_RRP_LABEL;
  }
  return formatValueCell(value);
}

/**
 * Tooltip for a retail cell: the promo explanation for a no-RRP set, else the at-retail sticker-price
 * caveat ({@link retailTooltip}), else null.
 * @param {import("./value").Value | null} value
 * @returns {string|null}
 */
export function retailCellTooltip(value) {
  if (isPromoNoRrp(value)) return value.amount != null ? PROMO_ARV_TOOLTIP : PROMO_NO_RRP_TOOLTIP;
  return retailTooltip(value);
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
 * QUALITY disclosure for the cost-basis headline: a numberless flag that part of the TOTAL cost is an
 * MSRP baseline (sets with no logged purchase) rather than recorded spend. No count/$ on the card — the
 * tooltip ({@link COST_BASIS_TOOLTIP}) carries the gold-standard framing. Returns null when none so the
 * caller omits it. Gated on msrpCount > 0.
 *
 * @param {number} msrpCount  sets whose cost is the MSRP baseline (no purchase record).
 * @returns {string|null}
 */
export function estimatedCostNote(msrpCount) {
  return msrpCount > 0 ? "incl. sets costed at MSRP" : null;
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

// ── ROI / Net Gain scope relabel (divergence disclosure) ─────────────────────
// ROI (portfolioROI) and Net Gain (portfolioGain) are BOTH dollar-weighted over the same cost
// denominator, but ROI's `cost > 0` gate excludes $0-cost sets that Net Gain counts at full value — so a
// positive Net Gain can sit beside a flat/negative ROI. These notes label each tile's SCOPE so the pair
// stops reading as a contradiction. LABELS ONLY — portfolioROI / portfolioGain math is untouched.

/**
 * Scope label for the TOTAL-cost ROI headline: the % covers cost-basis sets only (cost > 0); free
 * ($0-cost) sets are excluded (no % return on $0 invested). Numberless and constant — the MSRP-baseline
 * caveat lives in {@link roiScopeTooltip}, not the card. Replaces {@link totalRoiNote} at the ROI card.
 *
 * @returns {string}
 */
export function roiScopeNote() {
  return "cost-basis sets only";
}

/**
 * Tooltip for the ROI card — why the % is over paid (cost-basis) sets and excludes free $0-cost sets,
 * plus a non-numeric MSRP-baseline caveat when any cost is an MSRP default (gated on msrpCount > 0).
 *
 * @param {number} msrpCount
 * @returns {string}
 */
export function roiScopeTooltip(msrpCount) {
  const base = "Return on sets you have a cost for. Free sets ($0 cost) are excluded — no % return on $0 invested.";
  return msrpCount && msrpCount > 0 ? `${base} Where no purchase was recorded, cost = MSRP — a gold-standard baseline.` : base;
}

/**
 * Net Gain sub-line: how much of the gain comes from $0-cost sets ({@link import("./portfolio").freebieValue}).
 * They count in Net Gain at full value but are excluded from %ROI — so this is the line that explains a
 * positive Net Gain beside a flat/negative ROI. Returns null when there are none (rounds to $0), so the
 * caller falls back to its other sub (e.g. {@link netGainBasisNote}).
 *
 * @param {number} freebieValue  portfolio-level freebieValue ($0-cost, value-known dollars).
 * @returns {string|null}
 */
export function freebieNote(freebieValue) {
  return freebieValue && freebieValue >= 0.005 ? `incl. ~${money(freebieValue)} from free sets` : null;
}

// Static tooltip for the Net Gain card's freebie sub-line.
export const FREEBIE_TOOLTIP = "Includes $0-cost sets (GWPs/promos) at full value; ROI excludes them.";

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
 * VSD / ESD relabel of the Collection Value estimate disclosure — DISPLAY ONLY. ESD (Estimated Sales
 * Data) is the SAME {@link estimatedValueShare} fraction this rounds exactly like {@link estimatedValueNote}
 * (so the ESD number is byte-parity with the old "X% of value estimated"); VSD (Verified Sales Data) is the
 * complement, 100 − ESD, derived from the rounded ESD so the pair sums to 100. Returns null when share ≤ 0
 * (same gate as estimatedValueNote: no estimates / no value map → no note, frozen promos untouched).
 *
 * @param {number} share  fraction in [0, 1] (estimatedValueShare — NOT recomputed here).
 * @returns {string|null}  e.g. "98.6% VSD · 1.4% ESD", or null.
 */
export function vsdEsdNote(share) {
  if (!share || share <= 0) return null;
  const esdPct = share * 100;
  const esdShown = esdPct < 1 ? esdPct.toFixed(1) : Math.round(esdPct).toString();
  const vsdShown = (Math.round((100 - Number(esdShown)) * 10) / 10).toString();
  return `${vsdShown}% VSD · ${esdShown}% ESD`;
}

// Tooltip for the VSD/ESD split on the Collection Value card.
export const VSD_ESD_TOOLTIP =
  "VSD = Verified Sales Data (priced from real sold listings). ESD = Estimated Sales Data " +
  "(priced by estimate when recent sold data is thin or absent).";

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
export const SIGN_COLORS = { pos: "var(--bk-positive)", neg: "var(--bk-negative)", neutral: "var(--bk-text-muted)" };

/**
 * Color for a signed, null-aware figure (gain or ROI). `null`/`undefined` (unknown) → neutral —
 * so an unknown row reads "—" in neutral, never a phantom red/green. A known value keys strictly to
 * its sign. Pass the EXACT number being displayed (setGain(set)/setROI(set)) so color can't drift.
 *
 * @param {number|null|undefined} amount
 * @returns {string} CSS color string (a token var())
 */
export function signColor(amount) {
  if (amount == null) return SIGN_COLORS.neutral;
  return amount >= 0 ? SIGN_COLORS.pos : SIGN_COLORS.neg;
}
