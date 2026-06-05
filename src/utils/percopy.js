// ─────────────────────────────────────────────────────────────────────────────
// Per-copy read funnel — the `entries[]` analog of portfolio.js's `valueGroups`.
// ONE place that turns ANY owned set (whichever of the three creation paths produced
// it — BE import, manual line-level, or Wanted/Budget promotion) into a normalized
// array of per-copy records.
//
// G4 PHASE 1: this module is INERT — imported by NOTHING in production. It exists so
// later phases can read per-copy data uniformly:
//   • Phase 2 renders the SetDetailPanel per-copy breakdown from it (manual sets too).
//   • Phase 3 persists the materialized entries[] on the first per-copy edit.
//   • Phase 5 makes `valueGroups` DELEGATE to it (one materializer), then the lint ban
//     forces all per-copy reads through here.
//
// PURE. No persistence, no input mutation. Phase 3 owns the first write; this writes
// nothing.
//
// INVARIANT #1 (docs/g4-per-copy-plan.md): a SYNTHESIZED copy never carries a frozen
// value — `current_value: null`, exactly like the promote path (beCollection.js
// buildCopyEntries). Value stays overlay-driven (BL cache → BE fallback → set-level
// scalar). We do NOT copy a manual line's currentValue/totalValue onto its copies.
// (A REAL imported entry keeps its own stored current_value — that is its data, not a
// fabrication; only synthesis withholds value.)
//
// MONEY-NEUTRALITY: the funnel is ADDITIVE. It returns the per-copy array; it does not
// strip a manual line's set-level value/cost scalars. So attaching the result as
// `entries[]` leaves every headline aggregate unchanged — no-overlay value still reads
// `totalValue/currentValue` (rawSetValue), and the with-overlay path resolves each copy
// against the BL cache identically. Pinned in percopy.test.js §1.
//
// SHAPE ALIGNMENT (design-for-Phase-5): each record matches what `valueGroups` /
// `resolveCopies` (portfolio.js) already read off an entry — `condition` and
// `current_value` (with the `?? Value ?? value` legacy spellings folded in here) — so
// Phase 5 can point `valueGroups` at this output with no rework.
// ─────────────────────────────────────────────────────────────────────────────

import { asNumber } from "./formatting";
import { setCost } from "./portfolio";

/**
 * Deterministic per-copy id — stable across re-materialization so Phase 3 can map an
 * edited copy back to a real persisted entry. Real `entries[]` carry NO id today
 * (neither the BE-CSV import rows nor buildCopyEntries set one), so we mint a synthetic
 * `${setNumber}#${index}` and PRESERVE any pre-existing `id` on pass-through (once
 * Phase 3 persists, the id rides along and stays fixed).
 *
 * @param {Object} set
 * @param {number} i
 * @returns {string}
 */
function copyId(set, i) {
  return `${set?.setNumber ?? "set"}#${i}`;
}

/**
 * Normalize one EXISTING entry (BE import or promoted copy) to the canonical per-copy
 * shape — faithful pass-through. A real entry KEEPS its stored value (legacy spellings
 * folded to `current_value`); only synthesis (below) withholds value per invariant #1.
 *
 * @param {Object} e   raw entries[] element
 * @param {Object} set owning set (for the id fallback)
 * @param {number} i   copy index
 * @returns {Object}   canonical per-copy record
 */
function normalizeEntry(e, set, i) {
  return {
    id:            e.id ?? copyId(set, i),
    condition:     e.condition ?? set?.condition ?? null,
    paid_price:    asNumber(e.paid_price ?? e.Paid ?? e.paid ?? 0),
    current_value: e.current_value ?? e.Value ?? e.value ?? null, // REAL value preserved
    retail_price:  e.retail_price ?? e.Retail ?? null,
    acquired_date: e.acquired_date ?? e.aquired_date ?? "",
    notes:         e.notes ?? "",
    origin:        e.origin ?? "import",
  };
}

/**
 * Per-copy records for ANY owned set — the canonical read funnel.
 *
 *   • entries[]-backed set (BE import / promotion) → its existing copies, normalized
 *     (faithful, value-preserving). IDEMPOTENT: re-materializing an already-materialized
 *     set returns an equivalent array (ids preserved).
 *   • line-level set (manual)                      → `qty` synthesized copies, each with
 *     the line's condition, per-copy paid = setCost(line) / qty (so the copies SUM to the
 *     line's existing cost — money-neutral BY CONSTRUCTION), `current_value: null`
 *     (invariant #1), and a deterministic id.
 *
 * Empty/absent `entries[]` is treated as line-level (matches setConditionDisplay's
 * empty-entries fallback). `null`/`undefined` set → `[]`.
 *
 * @param {Object|null|undefined} set
 * @param {Object} [opts]  reserved for later phases (e.g. id-scheme overrides); unused now.
 * @returns {Array<{id:string, condition:string|null, paid_price:number,
 *   current_value:number|null, retail_price:number|null, acquired_date:string,
 *   notes:string, origin:string}>}
 */
export function materializeEntries(set, opts) {
  void opts; // reserved — Phase 1 takes no options
  if (!set) return [];

  // Pass-through: a set that already carries per-copy entries.
  if (Array.isArray(set.entries) && set.entries.length) {
    return set.entries.map((e, i) => normalizeEntry(e, set, i));
  }

  // Synthesize: a line-level (manual) set → `qty` identical copies (≥ 1).
  const copies = Math.max(1, Math.floor(asNumber(set.qty) || 1));
  const perCopyPaid = setCost(set) / copies; // Σ over copies === setCost(set) — money-neutral
  return Array.from({ length: copies }, (_, i) => ({
    id:            copyId(set, i),
    condition:     set.condition ?? null,
    paid_price:    perCopyPaid,
    current_value: null,                 // invariant #1 — value is overlay-driven, never frozen here
    retail_price:  asNumber(set.retailPrice ?? set.msrp) || null,
    acquired_date: set.acquiredDate ?? set.acquired_date ?? "",
    notes:         set.notes ?? "",
    origin:        "manual",
  }));
}
