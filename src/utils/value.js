// ─────────────────────────────────────────────────────────────────────────────
// Value provenance type (V1).
//
// The value layer's structural gap is that a set's worth is stored as a bare
// number, stripped of WHERE it came from, in WHAT condition, and on WHAT basis
// (real market vs. sticker price vs. nothing) — see docs/value-layer-plan.md §2.
// This module introduces the shape that carries that provenance. It does NOT yet
// change any displayed number; consumers keep reading `.amount`. Behavior fixes
// (excluding unknowns from totals, not laundering retail as value) are V2.
//
// Canonical rules (docs/valuation.md §"Value rules"):
//   - amount is `null` when unknown — NEVER 0. Unknown ≠ $0.
//   - basis tags how the figure should be read:
//       'retail'  — sticker/MSRP price (at-retail set, or Brickset's static MSRP)
//       'market'  — a real secondary-market figure (retired set on a market source)
//       'unknown' — no usable amount
//   - BrickLink is raw sold data — always 'market' when a real figure exists.
//   - BrickEconomy echoes the sticker price at-retail, so it flips retail →
//     market once a set is retired.
//   - Brickset is always 'retail' (it is original MSRP by definition).
// ─────────────────────────────────────────────────────────────────────────────

import { asNumber } from "./formatting";

/**
 * The VALUE-only "0 means unknown" coalescing — the SINGLE point where a stored 0
 * (or missing / blank / unparseable) value collapses to unknown (null). No real set
 * is genuinely worth $0, so for VALUE a 0 always means "no data". Both the set-level
 * funnel (`rawSetValue`, src/utils/portfolio.js) and the per-copy breakdown
 * (SetDetailPanel) feed their raw value field through here before {@link toValue},
 * so the 0→unknown rule lives in ONE place. Locked by value.zero-unknown.test.js.
 *
 * VALUE-ONLY — do NOT use this for cost: a $0 cost can be genuine (GWP). {@link toValue}
 * / {@link normalizeAmount} stay general (they keep a genuine 0); this wrapper is
 * applied only to the value amount on a value read.
 *
 * @param {*} raw
 * @returns {number|null}  null when 0 / missing / unparseable; the number otherwise.
 */
export function valueAmount(raw) {
  const n = asNumber(raw);
  return n ? n : null;
}

/**
 * @typedef {Object} Value
 * @property {number|null} amount    Numeric value, or null when unknown (never 0-for-unknown).
 * @property {string|null} source    Where it came from: 'brickeconomy' | 'bricklink' | 'brickset' |
 *                                   'frozen' (static last-known provenance, no live source — D1) | null.
 * @property {string|null} condition The set's tracked condition (e.g. 'new', 'used', 'used_good').
 * @property {string} basis          How to read the figure: 'retail'|'market'|'unknown' for stored
 *                                   provenance; 'frozen' for a static last-recorded value with no live
 *                                   source (BE-removal D1); a BrickLink basis ('sold'|'sold_thin'|
 *                                   'modeled'|'modeled_thin'|'asking'|'unknown') when overlaid from the BL value cache.
 * @property {string|null} asOf      ISO timestamp the figure is as-of, or null.
 * @property {number|null} lots      BL sample size behind the amount (overlay only), else null.
 * @property {string|null} [confidence] Set-level overlay flag for the row badge when basis is
 *                                   "mixed": 'estimates'|'thin'|'clean'. Absent/null otherwise.
 */

/**
 * Parse a raw value field into a number, or null when it carries no usable amount.
 * Distinguishes a genuine 0 (kept) from missing/blank/unparseable (→ null). This is
 * the falsy-zero fix at the type boundary: absence becomes null, not 0.
 *
 * @param {*} raw
 * @returns {number|null}
 */
function normalizeAmount(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const str = String(raw).trim();
  if (str === "") return null;
  const n = Number(str.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Derive the basis tag from amount + source + retirement.
 *  - no amount                → 'unknown'
 *  - Brickset (original MSRP)  → always 'retail'
 *  - BrickLink (raw sold data) → always 'market' (a real resale figure)
 *  - BrickEconomy + retired    → 'market' (real secondary market exists)
 *  - BrickEconomy at-retail    → 'retail' (the figure is the sticker price)
 *
 * @param {number|null} amount
 * @param {string|null} source
 * @param {boolean} retired
 * @returns {'retail'|'market'|'unknown'}
 */
function deriveBasis(amount, source, retired) {
  if (amount === null) return "unknown";
  if (source === "brickset") return "retail";
  if (source === "bricklink") return "market";
  return retired ? "market" : "retail";
}

/**
 * Normalize a raw value figure into a {@link Value} provenance struct.
 *
 * @param {*} raw  The raw amount (number or string from an API field).
 * @param {Object} [opts]
 * @param {string|null} [opts.source]     'brickeconomy' | 'bricklink' | 'brickset'.
 * @param {string|null} [opts.condition]  Tracked condition of the set.
 * @param {boolean}     [opts.retired]    Whether the set is retired (gates market basis).
 * @param {string|null} [opts.asOf]       ISO timestamp; defaults to now.
 * @returns {Value}
 */
export function toValue(raw, opts = {}) {
  const { source = null, condition = null, retired = false, asOf, lots = null } = opts;
  const amount = normalizeAmount(raw);
  return {
    amount,
    source: source ?? null,
    condition: condition ?? null,
    basis: deriveBasis(amount, source ?? null, !!retired),
    asOf: asOf ?? new Date().toISOString(),
    lots: lots ?? null,
  };
}
