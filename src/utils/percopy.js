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

import { asNumber, toISODate } from "./formatting";
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
    acquired_date: toISODate(e.acquired_date ?? e.aquired_date), // normalize M/D/YYYY → ISO on read
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
  // Distribute cost to the CENT so Σ per-copy paid === setCost EXACTLY (watch-item A): each copy
  // gets the floor-cents share and the LAST copy absorbs the remainder. Avoids the float drift of a
  // bare setCost/qty (e.g. $100 ÷ 3 → 33.33 / 33.33 / 33.34, summing to exactly $100.00).
  const totalCents = Math.round(setCost(set) * 100);
  const baseCents = Math.floor(totalCents / copies);
  const remainderCents = totalCents - baseCents * copies;
  return Array.from({ length: copies }, (_, i) => ({
    id:            copyId(set, i),
    condition:     set.condition ?? null,
    paid_price:    (baseCents + (i === copies - 1 ? remainderCents : 0)) / 100,
    current_value: null,                 // invariant #1 — value is overlay-driven, never frozen here
    retail_price:  asNumber(set.retailPrice ?? set.msrp) || null,
    acquired_date: toISODate(set.acquiredDate ?? set.acquired_date), // ISO-normalized (idempotent)
    notes:         set.notes ?? "",
    origin:        "manual",
  }));
}

/**
 * Apply a per-copy condition edit and return the FULL N-copy array (G4 Phase 3 write helper).
 *
 * Materializes the whole set first (freezing the positional ${setNumber}#i ids), then flips ONE
 * copy's condition. Returning the FULL array — not just the edited copy — is the watch-item: the
 * caller persists all N copies so their ids become stored/stable, and a later qty change can't
 * re-synthesize and drift them. Idempotent on ids: a set that already carries entries[] passes
 * through (ids preserved), so a second edit references the SAME ids as the first.
 *
 * Pure: a freshly-synthesized copy keeps `current_value: null` (invariant #1 — value stays
 * overlay-driven, never frozen); a real imported copy keeps its own stored value.
 *
 * @param {Object} set        owned set (manual line-level OR entries[]-backed)
 * @param {number} copyIndex  position of the copy to change (matches the panel's render order)
 * @param {'new'|'used'} bucket
 * @returns {Array<Object>} the full per-copy array with `copyIndex`'s condition replaced
 */
export function applyCopyConditionEdit(set, copyIndex, bucket) {
  return materializeEntries(set).map((e, i) => (i === copyIndex ? { ...e, condition: bucket } : e));
}

/**
 * Resize a set's per-copy array to `newQty` (G4 Phase 4 — qty unification). Returns the full next
 * array; the caller persists it so entries.length tracks qty on BOTH stores (closing backlog #2).
 *
 * ID STABILITY (extends watch-item B):
 *   - GROW   → APPEND copies with ids continuing past the highest existing `#N` suffix
 *     (`max(suffix)+1` — deterministic and reload-stable; a slot freed by an earlier shrink is
 *     reused, which is safe because survivors are never reindexed). New copies inherit the per-unit
 *     paid (`set.paidPrice`; for BE that's averagePaid) and a template copy's condition, with
 *     `current_value: null` (invariant #1 — value stays overlay-driven).
 *   - SHRINK → DROP from the END (the most-recently-added copies). Survivors keep their exact
 *     stored ids — the kept copy objects are sliced, never re-minted/reindexed — so a later
 *     positional edit still maps to the right copy. (The qty control has no per-copy selector, so
 *     it removes the last; a future per-copy delete would filter by id and preserve ids the same way.)
 *
 * @param {Object} set     owned set (manual line-level OR entries[]-backed)
 * @param {number} newQty  target copy count (≥ 1)
 * @returns {Array<Object>} the full per-copy array sized to newQty
 */
export function applyQtyEdit(set, newQty) {
  const target = Math.max(1, Math.floor(asNumber(newQty) || 1));
  const current = materializeEntries(set); // materialize a still-line-level set first; stable ids
  if (target === current.length) return current;
  if (target < current.length) return current.slice(0, target); // drop the last; survivors keep ids

  const setNum = String(set?.setNumber ?? "set");
  const usedIdx = current.map((c) => {
    const m = /#(\d+)$/.exec(String(c.id ?? ""));
    return m ? Number(m[1]) : -1;
  });
  let nextIdx = Math.max(-1, ...usedIdx) + 1; // continue past the highest suffix — no reuse
  const template = current[current.length - 1] || {};
  const perUnitPaid = asNumber(set?.paidPrice) || asNumber(template.paid_price) || 0;
  const additions = Array.from({ length: target - current.length }, () => ({
    ...template,
    id: `${setNum}#${nextIdx++}`,
    paid_price: perUnitPaid,
    current_value: null, // invariant #1 — a new copy is unvalued, never frozen
  }));
  return [...current, ...additions];
}
