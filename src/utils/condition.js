// ─────────────────────────────────────────────────────────────────────────────
// Condition normalizer — the SINGLE read-time coalescing point for a set's
// condition, the peer of value.js (`valueAmount`) and the paid layer
// (`setCost` / `reconcilePaidEdit`). The stored vocabulary is messy:
//   live (BrickEconomy):   new, usedasnew, usedcomplete, usedincomplete
//   aspirational (UI/map): sealed, used_as_new, used_good, used_acceptable, used, mixed
// Every consumer collapses to the binary New/Used split (and the derived Mixed)
// HERE — never with an ad-hoc `startsWith("used")` at the call site. That is what
// keeps the "raw token leaks to the UI" class (e.g. 353 copies rendering as the
// literal string "usedasnew") from ever recurring.
//
// Phase 1, Step 1: utils + guard test only. No column/filter/panel wiring yet.
// ─────────────────────────────────────────────────────────────────────────────

const NEW = "new";
const USED = "used";
const MIXED = "mixed";

/**
 * Collapse any raw condition token to its binary valuation bucket.
 *   new / sealed / null / undefined / unknown → 'new'   (matches the valuation fallback)
 *   anything starting "used" (usedasnew, used_as_new, usedcomplete, usedincomplete,
 *     used_good, used_acceptable, used) → 'used'
 *
 * Byte-identical to portfolio.js's former `blCondition`, which now delegates here,
 * so the BL/BE new-vs-used split has ONE source of truth. Valuation behavior is
 * unchanged.
 *
 * @param {string|null|undefined} raw
 * @returns {'new'|'used'}
 */
export function conditionBucket(raw) {
  return String(raw ?? "").startsWith("used") ? USED : NEW;
}

/**
 * A set's display condition: 'new' | 'used' | 'mixed'.
 *
 * Multi-copy BE sets carry `entries[]` (one per physical copy). Each copy's
 * condition is bucketed FIRST, then: all copies agree → that bucket; a genuine
 * mix of 'new' and 'used' copies → 'mixed'. Bucketing before comparing means
 * used-grade variance (e.g. usedasnew + usedcomplete) reads as uniform Used — NOT
 * a false Mixed.
 *
 * Manual sets (no `entries[]`) take `conditionBucket(set.condition)` and are never
 * 'mixed'. An empty `entries: []` also falls back to the set-level condition.
 *
 * @param {{ condition?: string|null, entries?: Array<{condition?: string|null}> }} set
 * @returns {'new'|'used'|'mixed'}
 */
export function setConditionDisplay(set) {
  const entries = set?.entries;
  if (Array.isArray(entries) && entries.length) {
    let hasNew = false;
    let hasUsed = false;
    for (const e of entries) {
      if (conditionBucket(e?.condition) === USED) hasUsed = true;
      else hasNew = true;
      if (hasNew && hasUsed) return MIXED;
    }
    return hasUsed ? USED : NEW;
  }
  return conditionBucket(set?.condition);
}

// Display domain → label / color. `mixed` gets its OWN swatch (indigo), never a
// reuse of New-green or Used-amber, so a multi-condition row is visually distinct.
const DISPLAY_LABELS = { [NEW]: "New", [USED]: "Used", [MIXED]: "Mixed" };
const DISPLAY_COLORS = { [NEW]: "#5aa832", [USED]: "#f59e0b", [MIXED]: "#6366f1" }; // green / amber / indigo

/**
 * Label for a display condition ('new'|'used'|'mixed') → 'New' | 'Used' | 'Mixed'.
 * Total over the input space: a stray raw token is bucketed as a fallback, so this
 * NEVER returns a raw passthrough — the guard that closes the raw-token class.
 *
 * NOTE: distinct from formatting.js's `conditionLabel(raw)`, which renders the
 * GRANULAR per-copy grade ("Used — Like New") for the SetDetailPanel. This one is
 * the binary+Mixed pill label.
 *
 * @param {string} display
 * @returns {'New'|'Used'|'Mixed'}
 */
export function conditionDisplayLabel(display) {
  return DISPLAY_LABELS[display] ?? DISPLAY_LABELS[conditionBucket(display)];
}

/**
 * Pill color for a display condition. Same total-over-input-space guarantee as
 * {@link conditionDisplayLabel}: 'mixed' → indigo, raw tokens fall back via the
 * bucket, so the result is always one of the three theme colors.
 *
 * @param {string} display
 * @returns {string} hex color
 */
export function conditionDisplayColor(display) {
  return DISPLAY_COLORS[display] ?? DISPLAY_COLORS[conditionBucket(display)];
}
