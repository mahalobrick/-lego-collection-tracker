import { asNumber } from "./formatting";
import { toValue, valueAmount } from "./value";

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio rollup (V2a). Pure, no React, no localStorage.
//
// Extracted verbatim from MyCollection.jsx's `stats` useMemo so the combined
// "Collection Value" total has ONE definition that the characterization tests
// pin (value.characterization.test.js). Behavior-preserving: this is the same
// arithmetic the component ran inline.
//
// V2a step 2: each set's contribution is now routed through the Value provenance
// type (toValue) at READ time — basis derived from the set's existing `retired`
// flag, source from its existing `source` label. This is a read-time projection
// only: NOTHING is persisted, the backup shape / dedupHash are untouched, and the
// summed number is byte-identical to the bare formula (consumers still read
// `.amount`). The behavior flips (excluding unknowns, dropping retail-as-value)
// are V2b — not here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw per-set value figure: precomputed `totalValue` (already qty-adjusted) or,
 * failing that, `currentValue × qty`. Returns `null` when the set carries NO value
 * data at all — unknown ≠ $0 (V2b). The combined total still treats unknown as a
 * 0 contribution (it adds nothing), but count-based metrics can now exclude it
 * instead of dragging an average down with a phantom $0 (see {@link knownValueCount}).
 *
 * For VALUE, a stored 0 and an absent field are the SAME — both unknown. No set is
 * genuinely worth $0, so a 0 value always means "no data"; the coalescing is done by
 * the shared, value-only {@link valueAmount} helper (also used by SetDetailPanel's
 * per-copy path — the single source of this rule). Do NOT "fix" this to treat 0 as a
 * real value: value.zero-unknown.test.js guards it. (Cost is separate — a $0 cost can
 * be genuine GWP.)
 *
 * @param {Object} s
 * @returns {number|null}
 */
function rawSetValue(s) {
  const total = valueAmount(s.totalValue);
  if (total !== null) return total;
  const perUnit = valueAmount(s.currentValue);
  return perUnit === null ? null : perUnit * (asNumber(s.qty) || 1);
}

// ── BrickLink value overlay (app-read Step 2) ────────────────────────────────
// A read-time projection that PREFERS the BrickLink value cache (value:SET:{number}, fetched via
// src/utils/valueCache.js) over the stored BrickEconomy provenance, BE as fallback for cache-misses
// (e.g. deferred CMF) and basis:"unknown". NON-DESTRUCTIVE — nothing here is persisted; the BE
// fields stay in storage as the fallback (decision doc: demote-don't-delete). Per docs/value-source-
// decision.md §3 the cache is condition-matched: a new copy reads `.new`, a used copy `.used`.

const BL_SOURCE = "bricklink";
const blCondition = (c) => (String(c ?? "").startsWith("used") ? "used" : "new");

/**
 * The set's per-copy value groups: one entry per owned copy (BE sets carry `entries[]`, each a copy
 * with its own condition); a manual set (no entries) is a single group of `qty` same-condition units.
 * `be` is that copy's stored BE per-unit value (the fallback) — null when BE has none either.
 */
function valueGroups(s) {
  if (Array.isArray(s.entries) && s.entries.length) {
    return s.entries.map((e) => ({
      cond: blCondition(e.condition),
      units: 1,
      be: valueAmount(e.current_value ?? e.Value ?? e.value),
    }));
  }
  return [{ cond: blCondition(s.condition), units: asNumber(s.qty) || 1, be: valueAmount(s.currentValue) }];
}

// "estimated" value (decision doc / Step 3) = modeled OR asking — a figure NOT backed by a
// completed sale of that condition. sold_thin is real-but-thin sold data (flagged, not estimated).
const isEstimateBasis = (b) => b === "modeled" || b === "asking";

/**
 * Resolve a set into per-copy value contributions, condition-matched against the BL cache. Each
 * returned copy is `{ amount, basis, source, lots, asOf }` — `source:"bricklink"` with the BL basis
 * when the cache covers that copy's condition (amount != null), else `source:"be"` with the copy's
 * stored BE value (basis null). The single source of truth for both the set-level overlay and the
 * estimated-share aggregate, so they can't drift.
 *
 * @param {Object} s
 * @param {Object} [valueMap]
 * @returns {Array<{amount:number|null, basis:string|null, source:string, lots:number|null, asOf:string|null}>}
 */
function resolveCopies(s, valueMap) {
  const rec = valueMap && valueMap[s.setNumber];
  const out = [];
  for (const g of valueGroups(s)) {
    const blc = rec && rec[g.cond];
    const blAmt = blc && typeof blc.amount === "number" ? blc.amount : null; // amount != null wins
    const copy = blAmt !== null
      ? { amount: blAmt, basis: blc.basis ?? null, source: BL_SOURCE, lots: typeof blc.lots === "number" ? blc.lots : null, asOf: blc.asOf ?? null }
      : { amount: g.be, basis: null, source: "be", lots: null, asOf: null }; // basis:"unknown"/miss → BE fallback
    for (let i = 0; i < g.units; i++) out.push(copy);
  }
  return out;
}

/**
 * BL-preferred {@link import("./value").Value} for a set, resolved per-copy against the cache, or
 * `null` when BL covers NONE of the set's value (→ caller falls back to the BE path, byte-identical
 * to pre-overlay). Because Σ entries.current_value === totalValue, an all-BE outcome equals the old
 * `rawSetValue` exactly — so only BL-covered sets change.
 *
 * Set-level `basis` is the exact BL basis when every copy shares one (`sold`/`sold_thin`/`modeled`/
 * `asking`), else `"mixed"`. `confidence` resolves the coarse mixed case for the row badge:
 * `"estimates"` if any BL copy is modeled/asking, else `"thin"` if any is sold_thin, else `"clean"`.
 * The per-copy panel keeps each copy's exact basis (copyValueProvenance).
 *
 * @param {Object} s
 * @param {Object<string, ({new?:Object, used?:Object}|null)>} valueMap  setNumber → cache record.
 * @returns {import("./value").Value | null}
 */
function blOverlayValue(s, valueMap) {
  if (!(valueMap && valueMap[s.setNumber])) return null; // cache miss (e.g. deferred CMF) → BE fallback
  const copies = resolveCopies(s, valueMap);
  const blCopies = copies.filter((c) => c.source === BL_SOURCE);
  if (!blCopies.length) return null; // BL covered nothing here → full BE fallback (identical numbers)

  const known = copies.filter((c) => c.amount !== null);
  const total = known.reduce((sum, c) => sum + c.amount, 0);
  const blBases = new Set(blCopies.map((c) => c.basis));
  const uniform = blBases.size === 1 && copies.every((c) => c.source === BL_SOURCE);
  const confidence = blCopies.some((c) => isEstimateBasis(c.basis)) ? "estimates"
    : blCopies.some((c) => c.basis === "sold_thin") ? "thin"
      : "clean";
  return {
    amount: known.length ? total : null,
    source: BL_SOURCE,
    condition: s.condition ?? null,
    basis: uniform ? [...blBases][0] : "mixed",
    asOf: blCopies[0].asOf ?? null,
    lots: uniform ? (blCopies[0].lots ?? null) : null,
    confidence,
  };
}

/**
 * Read-time {@link import("./value").Value} for a set's portfolio contribution.
 * Derived, never persisted. With a `valueMap` it PREFERS the BrickLink cache (condition-matched),
 * BE as fallback; without one it is byte-identical to today's BE-provenance behavior — `basis`
 * flips retail→market on retirement (toValue), `amount` is `null` for a set with no value data.
 *
 * @param {Object} s
 * @param {Object} [valueMap]  Optional BrickLink value cache (setNumber → record); omitted → BE only.
 * @returns {import("./value").Value}
 */
export function setValueProvenance(s, valueMap) {
  if (valueMap) {
    const bl = blOverlayValue(s, valueMap);
    if (bl) return bl;
  }
  return toValue(rawSetValue(s), {
    source: s.source === "BrickEconomy" ? "brickeconomy" : null,
    condition: s.condition ?? null,
    retired: !!s.retired,
  });
}

/**
 * Per-COPY BL-preferred {@link import("./value").Value} — the SetDetailPanel per-copy path. Prefers
 * the condition-matched BL cache amount (carrying basis/source/asOf/lots); on a cache-miss or
 * basis:"unknown" it falls back to the copy's stored BE value via {@link import("./value").valueAmount}
 * + {@link import("./value").toValue} — byte-identical to the pre-overlay per-copy behavior.
 *
 * @param {*} rawValue            The copy's stored value field (current_value/Value/value).
 * @param {Object} opts           { setNumber, condition, retired }.
 * @param {Object} [valueMap]     BrickLink value cache (setNumber → record); omitted → BE only.
 * @returns {import("./value").Value}
 */
export function copyValueProvenance(rawValue, { setNumber, condition, retired } = {}, valueMap) {
  const blc = valueMap && valueMap[setNumber] && valueMap[setNumber][blCondition(condition)];
  if (blc && typeof blc.amount === "number") {
    return {
      amount: blc.amount,
      source: BL_SOURCE,
      condition: condition ?? null,
      basis: blc.basis ?? null,
      asOf: blc.asOf ?? null,
      lots: typeof blc.lots === "number" ? blc.lots : null,
    };
  }
  return toValue(valueAmount(rawValue), { condition, retired });
}

/**
 * Combined portfolio value — the headline "Collection Value" total.
 *
 * Each set contributes its provenance-tagged amount, summed into one mixed
 * new+used total. An unknown set (amount `null`) contributes 0 — the sum is
 * unchanged from before; only its EXCLUSION from count metrics is new.
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function portfolioValue(sets, valueMap) {
  return sets.reduce((sum, s) => sum + (setValueProvenance(s, valueMap).amount ?? 0), 0);
}

/**
 * Share of portfolio value that is ESTIMATED (modeled + asking BL copies) ÷ total known value —
 * for the quiet "X% of value estimated" disclosure beside the headline. Resolved per-copy (the same
 * resolveCopies the overlay uses), so a mixed set counts only its estimated copies' dollars.
 * sold_thin is real-but-thin sold data — flagged at the row, NOT counted as estimated. Returns 0
 * when nothing is known or no map is loaded.
 *
 * @param {Array<Object>} sets
 * @param {Object} [valueMap]
 * @returns {number}  fraction in [0, 1].
 */
export function estimatedValueShare(sets, valueMap) {
  if (!valueMap) return 0;
  let total = 0, estimated = 0;
  for (const s of sets) {
    for (const c of resolveCopies(s, valueMap)) {
      if (c.amount === null) continue;
      total += c.amount;
      if (c.source === BL_SOURCE && isEstimateBasis(c.basis)) estimated += c.amount;
    }
  }
  return total > 0 ? estimated / total : 0;
}

/**
 * How many sets have a KNOWN value (amount !== null). Sets with no value data are
 * excluded, so a value average divides by this — not by the raw set count — instead
 * of being dragged down by phantom $0s. Math only; the "N unknown" surfacing is V2c.
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function knownValueCount(sets, valueMap) {
  return sets.reduce((n, s) => n + (setValueProvenance(s, valueMap).amount === null ? 0 : 1), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost basis & ROI (V2 cleanup). Pure, read-time/derived — nothing persisted.
//
// THE RULE: a PERCENTAGE ROI is only meaningful when value AND cost are BOTH known
// and cost > 0. % ROI is computed over exactly that subset; the absolute dollar
// totals (spent / gain) stay inclusive and honest. Two mirror-image exclusions:
//   - unknown value (known cost)      → no computable return → out of %ROI
//   - $0/GWP cost (known value)       → return is ÷0 → out of %ROI, but its full
//                                        value still counts as absolute gain
// Cost model note: a genuine free $0 is indistinguishable from an unrecorded cost
// (no GWP marker exists), so cost ≤ 0 is treated uniformly here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-set cost (qty-adjusted paid): precomputed `totalPaid`, else `paidPrice × qty`.
 * Returns 0 when nothing was paid OR nothing was recorded — the two are not
 * distinguishable in the stored shape. Mirrors MyCollection's inline formula.
 *
 * @param {Object} s
 * @returns {number}
 */
export function setCost(s) {
  return asNumber(s.totalPaid) || asNumber(s.paidPrice) * (asNumber(s.qty) || 1);
}

/**
 * Is a set eligible for the PERCENTAGE ROI? Only when its value is known AND it
 * has a positive cost. Unknown-value and cost ≤ 0 (incl. $0/GWP) are excluded.
 *
 * @param {Object} s
 * @returns {boolean}
 */
function roiEligible(s, valueMap) {
  return setValueProvenance(s, valueMap).amount !== null && setCost(s) > 0;
}

/**
 * Per-set % ROI, or `null` when the set is excluded from %ROI (unknown value OR
 * cost ≤ 0). NEVER returns Infinity/NaN — the cost > 0 guard is the ÷0 fix.
 *
 * @param {Object} s
 * @returns {number|null}
 */
export function setROI(s, valueMap) {
  if (!roiEligible(s, valueMap)) return null;
  const amount = setValueProvenance(s, valueMap).amount;
  const cost = setCost(s);
  return ((amount - cost) / cost) * 100;
}

/**
 * Total spent — sum of every set's cost, inclusive ($0 adds $0). The honest
 * absolute; unlike %ROI it excludes nothing.
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function totalSpent(sets) {
  return sets.reduce((sum, s) => sum + setCost(s), 0);
}

/**
 * Combined net gain — Σ(value − cost) over sets whose value is KNOWN. A $0-cost
 * set with a known value contributes its full value as gain. Unknown-value sets
 * are excluded (no value → no computable gain), so their recorded cost no longer
 * drags the total into a phantom loss.
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function portfolioGain(sets, valueMap) {
  return sets.reduce((sum, s) => {
    const amount = setValueProvenance(s, valueMap).amount;
    return amount === null ? sum : sum + (amount - setCost(s));
  }, 0);
}

/**
 * Portfolio % ROI over the eligible subset only {value known, cost > 0}:
 * aggregate (Σvalue − Σcost) / Σcost × 100. Returns `null` when NO set is
 * eligible (UI reads "—" rather than 0% or NaN). The predicate guarantees
 * Σcost > 0 whenever the subset is non-empty, so this never divides by zero.
 *
 * @param {Array<Object>} sets
 * @returns {number|null}
 */
export function portfolioROI(sets, valueMap) {
  let value = 0, cost = 0, n = 0;
  for (const s of sets) {
    if (!roiEligible(s, valueMap)) continue;
    value += setValueProvenance(s, valueMap).amount;
    cost += setCost(s);
    n++;
  }
  if (n === 0 || cost <= 0) return null;
  return ((value - cost) / cost) * 100;
}

/**
 * How many sets are EXCLUDED from %ROI — unknown value OR cost ≤ 0. Drives the
 * "N sets excluded from ROI (no value or no cost)" surfacing note (V2 cleanup).
 *
 * @param {Array<Object>} sets
 * @returns {number}
 */
export function roiExcludedCount(sets, valueMap) {
  return sets.reduce((n, s) => n + (roiEligible(s, valueMap) ? 0 : 1), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Unknown ≠ 0 sweep. Per-set gain + a group rollup, both null-aware by construction
// so NO consumer has to do its own `asNumber(value) || 0`. A set with unknown value
// has no computable gain → null (→ "—"), never a phantom −cost loss; a group's
// figures are the same null-aware portfolio funcs applied to that group's sets.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-set net gain (value − cost), or `null` when the set's value is UNKNOWN — no
 * value means no computable gain (render "—"), never a phantom −cost loss. A
 * $0-cost set with a known value gains its full value (cost 0). Mirrors the
 * value-known rule of {@link portfolioGain} at the single-set grain, so the
 * per-row gains sum to the headline Net Gain.
 *
 * @param {Object} s
 * @returns {number|null}
 */
export function setGain(s, valueMap) {
  const amount = setValueProvenance(s, valueMap).amount;
  return amount === null ? null : amount - setCost(s);
}

/**
 * Group sets by `keyFn` and roll each group up through the SAME null-aware portfolio
 * functions — so a per-theme / per-status / per-year breakdown excludes unknown-value
 * sets exactly like the headline does, and surfaces how many were excluded.
 *
 * Each group: `{ key, count, qty, value, spent, gain, roi, knownValueCount,
 * unknownValueCount }`. `value`/`gain`/`roi` are value-known-aware (`roi` is null
 * when no set in the group qualifies); `spent` stays inclusive ($0 adds $0).
 *
 * @param {Array<Object>} sets
 * @param {(s: Object) => (string|null|undefined)} keyFn  Group key; falsy → "Other".
 * @returns {Array<{key:string,count:number,qty:number,value:number,spent:number,gain:number,roi:number|null,knownValueCount:number,unknownValueCount:number}>}
 */
export function groupRollup(sets, keyFn, valueMap) {
  const groups = new Map();
  for (const s of sets) {
    const key = keyFn(s) || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return [...groups.entries()].map(([key, gsets]) => {
    const known = knownValueCount(gsets, valueMap);
    return {
      key,
      count: gsets.length,
      qty: gsets.reduce((n, s) => n + (asNumber(s.qty) || 1), 0),
      value: portfolioValue(gsets, valueMap),
      spent: totalSpent(gsets),
      gain: portfolioGain(gsets, valueMap),
      roi: portfolioROI(gsets, valueMap),
      knownValueCount: known,
      unknownValueCount: gsets.length - known,
    };
  });
}
