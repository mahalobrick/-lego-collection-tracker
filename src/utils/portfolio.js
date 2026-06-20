import { asNumber } from "./formatting";
import { toValue, valueAmount } from "./value";
import { conditionBucket } from "./condition";
import { materializeEntries } from "./percopy";
import { isFrozenValueSet, frozenValue } from "./frozenValue";

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
// One source of truth for the new/used split. Call-time delegation (not an eval-time
// `= conditionBucket` binding) so it's immune to module import order — it dereferences
// conditionBucket only when invoked, long after all modules have initialized. Behavior-
// identical, and stays correct even if condition.js ever gains an import that forms a cycle.
const blCondition = (raw) => conditionBucket(raw);

/**
 * The set's per-copy value groups — one per owned copy. Phase 5: the per-copy ENUMERATION (how many
 * copies, each copy's condition) is delegated to the ONE funnel — {@link materializeEntries} — so there
 * is no parallel per-copy logic. valueGroups only resolves each copy's `be` FALLBACK value.
 *
 * THE LANDMINE (preserved): a synthesized copy of a LINE-LEVEL manual set carries `current_value: null`
 * (invariant #1), so its overlay fallback is the SET-LEVEL value spread per copy (`s.currentValue`, which
 * is per-unit) — NEVER 0 from the null. That keeps a manual set's partial-/no-overlay value intact (the
 * no-overlay path itself goes through rawSetValue, untouched). An entries[]-backed copy uses its OWN
 * stored value. Output is byte-identical to the pre-delegation two-branch form across every fixture
 * (pinned: the §1 with-overlay net + the valueGroups↔materializeEntries invariant test).
 *
 * Runtime-safe cycle with percopy.js: materializeEntries and setCost are hoisted function declarations,
 * dereferenced only at call time — never during module init (same rationale as blCondition above).
 */
export function valueGroups(s) {
  const hasStoredEntries = Array.isArray(s.entries) && s.entries.length;
  const lineLevelFallback = hasStoredEntries ? null : valueAmount(s.currentValue);
  return materializeEntries(s).map((e) => ({
    cond: blCondition(e.condition),
    units: 1,
    be: e.current_value != null ? valueAmount(e.current_value) : lineLevelFallback,
  }));
}

// "estimated" value (decision doc / Step 3) = modeled, modeled_thin OR asking — a figure NOT backed
// by a completed sale of that condition. sold_thin is real-but-thin sold data (flagged, not estimated).
// modeled_thin (rung-gap close, deriveValue.mjs) is modeled off a THIN new sample — still an estimate.
const isEstimateBasis = (b) => b === "modeled" || b === "modeled_thin" || b === "asking";

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
      ? { amount: blAmt, basis: blc.basis ?? null, source: BL_SOURCE, lots: typeof blc.lots === "number" ? blc.lots : null, asOf: blc.asOf ?? null, cond: g.cond }
      : { amount: g.be, basis: null, source: "be", lots: null, asOf: null, cond: g.cond }; // basis:"unknown"/miss → BE fallback. cond: per-copy New/Used bucket (additive — for the copy-grain condition rollup; value/overlay consumers ignore it)
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
 * `modeled_thin`/`asking`), else `"mixed"`. `confidence` resolves the coarse mixed case for the row badge:
 * `"estimates"` if any BL copy is modeled/modeled_thin/asking, else `"thin"` if any is sold_thin, else `"clean"`.
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
  const raw = rawSetValue(s);
  // BE-removal D1: the 2 deferred promos are FROZEN — their stored last-BE number is static
  // provenance with no live source. Only the FALLBACK label changes (a real BL figure above
  // still wins); the amount is the same stored read, so removing the BE machinery can't blank
  // them. Frozen only when a real stored number exists — an empty promo stays unknown, not $0.
  if (raw !== null && isFrozenValueSet(s.setNumber)) {
    return frozenValue(raw, { condition: s.condition ?? null, setNumber: s.setNumber });
  }
  return toValue(raw, {
    source: s.source === "BrickEconomy" ? "brickeconomy" : null,
    condition: s.condition ?? null,
    retired: !!s.retired,
  });
}

// ── Retail (MSRP) provenance — parallel to the value path, NOT part of the market waterfall ──
// Source order settled EMPIRICALLY (MSRP Step 1, scripts/bl-catalog-probe): BrickLink's catalog item
// endpoint exposes NO retail/MSRP field (no/name/type/category_id/year_released/… — it is market-price
// only), so it cannot lead. Brickset is the canonical MSRP (the LEGO.com sticker price it publishes).
// 'manual' is the user-entered msrp rung (Phase 3a): below Brickset (a real sourced RRP still wins) —
// the reclaim path for the genuine residual Brickset has no RRP for (the 71034 CMF series, ~50 polybags).
// BrickEconomy was REMOVED from retail in Phase 3c: it overvalues polybags ~2.6× (value-source-decision
// §4), and retail is now Brickset → manual only. The residual (the Brickset-API gap) resolves to "—"
// until hand-filled via the manual rung (or a future Brickset site-scrape source). BE stays a VALUE
// fallback only — it has no role here. First source carrying a real figure wins.
// 'cmf' is the CMF series-bag era-table fallback ({@link import("./cmfRetail").cmfEraRetail}) — gated
// below Brickset/manual so a real sourced figure always wins; it only fills a CMF series whose Brickset
// `-0` bag has no retail (e.g. 71034 / Series 23). Non-CMF sets pass no `cmf` amount.
// 'curated_sourced' / 'curated_estimated' are the curated-MSRP rungs ({@link import("./curatedMsrp").curatedRetail},
// docs/curated-msrp-plan.md). curated_sourced is a researched real RRP / LEGO-stated value → basis "retail",
// ranked ABOVE cmf (a documented figure beats the era guess) but below brickset/manual. curated_estimated is a
// proxy/ARV → new basis "estimated" (NOT folded into sourced) and ranked LAST, filling only when nothing real
// exists. Both are STATIC + research-derived (no network, never source:"brickeconomy" — Phase 3c intact).
export const RETAIL_SOURCE_ORDER = ["brickset", "manual", "curated_sourced", "cmf", "curated_estimated"];

// The rungs whose resolved value is an ESTIMATE (basis "estimated"), parallel to the VALUE-axis estimate
// concept (isEstimateBasis / estimatedValueShare) — NOT the cost-axis "estimated at MSRP". Single-sourced.
const ESTIMATED_RETAIL_SOURCES = new Set(["curated_estimated"]);
// The curated rungs. For a promo set, ONLY a curated value is demoted to a promo ARV (Option C) — a real
// Brickset/manual RRP still beats the promo tag (the pre-curated invariant, preserved).
const CURATED_RETAIL_SOURCES = new Set(["curated_sourced", "curated_estimated"]);

/**
 * Read-time retail (MSRP) {@link import("./value").Value} for a set — the sticker price, never a
 * market value. Walks {@link RETAIL_SOURCE_ORDER} and returns the first source carrying a real figure,
 * tagged with `source` = the winning rung and a `basis`: a sourced RRP (brickset / manual /
 * curated_sourced / cmf) → `'retail'`; the curated_estimated proxy → `'estimated'` (a non-sourced
 * estimate, disclosed separately and never folded into the sourced count). A stored 0 / blank / missing
 * is "unknown" (no set has a $0 MSRP — VALUE-style {@link import("./value").valueAmount} coalescing), so
 * it is skipped. When NO source carries a figure: a `promo` set returns the first-class basis:"promo"
 * no-RRP state, else `null` → "—". OPTION C: for a `promo` set a resolved curated figure STAYS
 * basis:"promo" (a valued GWP ARV) — never sourced/estimated. A curated win also carries
 * `curatedConfidence` + `curatedSource` (for the detail/tooltip, NOT the card). Research-derived +
 * static: no network, never source:"brickeconomy" (Phase 3c intact). Parallel to {@link setValueProvenance}.
 *
 * @param {{brickset?:{amount?:*, asOf?:string|null}, manual?:{amount?:*},
 *          curated_sourced?:{amount?:*, confidence?:string, source?:string},
 *          curated_estimated?:{amount?:*, confidence?:string, source?:string}, cmf?:{amount?:*}}} sources
 *        Raw retail candidates by source (amount may be a number / string / blank).
 * @param {Object} [opts]
 * @param {string|null} [opts.condition]
 * @param {boolean} [opts.promo]  set is a GWP/no-RRP promo (see {@link isPromoNoRetail}).
 * @returns {import("./value").Value | null}
 */
export function setRetailProvenance(sources, { condition = null, promo = false } = {}) {
  for (const source of RETAIL_SOURCE_ORDER) {
    const cand = sources && sources[source];
    const amount = valueAmount(cand && cand.amount); // 0 / blank / missing → null → skip this source
    if (amount === null) continue;
    const asOf = (cand && cand.asOf) ?? null;
    // Option C (docs/curated-msrp-plan.md §3): for a GWP/promo set, a CURATED figure is a stated ARV, NOT a
    // sticker MSRP — it STAYS basis:"promo" (a VALUED GWP), carrying the amount + provenance, so it lands in
    // the promo bucket regardless of curated tier and never inflates sourced/estimated. (A real Brickset/
    // manual RRP still beats the promo tag — falls through below — preserving the pre-curated invariant.)
    if (promo && CURATED_RETAIL_SOURCES.has(source)) {
      return withCurated({ amount, source, condition, basis: "promo", asOf, lots: null }, cand);
    }
    // curated_estimated → basis "estimated": a non-sourced estimate, disclosed separately and NEVER folded
    // into the sourced count (the VALUE-axis estimate idiom, not the cost-axis "estimated at MSRP").
    if (ESTIMATED_RETAIL_SOURCES.has(source)) {
      return withCurated({ amount, source, condition, basis: "estimated", asOf, lots: null }, cand);
    }
    // Every other rung (brickset / manual / curated_sourced / cmf) is a sourced RRP → basis "retail" via
    // deriveBasis (retired:false → never flips to 'market': the MSRP field IS the sticker price).
    return withCurated(toValue(amount, { source, condition, retired: false, asOf }), cand);
  }
  // No sourced RRP. A GWP/promo set has none at ANY source (it was never sold) — return a FIRST-CLASS
  // "no retail exists" Value (basis:"promo", amount null), DISTINCT from an unsourced null ("retail
  // exists somewhere, just not obtained"). A real sourced figure above always wins over the promo tag.
  if (promo) return { amount: null, source: null, condition, basis: "promo", asOf: null, lots: null };
  return null;
}

// Attach the curated CSV's confidence (A/B/C/D) + source string to a retail Value when the winning rung is
// a curated one (its cand carries them) — for the detail panel / tooltip, NOT the card. A no-op for the
// brickset/manual/cmf rungs (their cand has no confidence/source), so those Values stay byte-identical.
function withCurated(v, cand) {
  if (cand && cand.confidence != null) v.curatedConfidence = cand.confidence;
  if (cand && cand.source != null) v.curatedSource = cand.source;
  return v;
}

/**
 * Is this set a gift-with-purchase / promo with NO retail price (RRP) at any source? GWP/promo sets
 * were never sold, so no source carries an RRP — confirmed: of 41 owned promo sets, zero carried a
 * Brickset or BE retail (Phase-0 blast-radius measurement). Identified by theme "Promotional", the
 * long-numeric promo-ID pattern (≥7-digit base, e.g. 6490363-1 / 5007428-1), or gift/promo wording in
 * theme/subtheme/name. Drives the first-class "no RRP" retail state ({@link setRetailProvenance}
 * basis:"promo") so a GWP reads "no retail exists" instead of collapsing into the same "—" as an
 * unsourced set. Membership matches the Phase-0 heuristic exactly.
 *
 * @param {{setNumber?:string, theme?:string, subtheme?:string, name?:string}} s
 * @returns {boolean}
 */
export function isPromoNoRetail(s) {
  if (!s) return false;
  const base = String(s.setNumber ?? "").replace(/-\d+$/, "");
  if (/^\d{7,}$/.test(base)) return true;
  return /gift with purchase|\bGWP\b|promotion(al)?\b/i.test(`${s.theme || ""} ${s.subtheme || ""} ${s.name || ""}`);
}

/**
 * The patch a hand-entered MSRP writes — the SHARED Add-Set / edit-form contract, so both store a
 * manual sticker price identically. Per-unit, mirrored to `retailPrice`: the ladder's manual rung
 * reads `msrp`, while the headline card (`retailPrice || msrp`) and `paidEqualsRetail` read
 * `retailPrice` — mirroring keeps them in lockstep, exactly how Add-Set has always stored a
 * manually-added set's MSRP. A blank / 0 → `{msrp:0, retailPrice:0}`, which the value-only
 * coalescing reads as "no MSRP" (so clearing the field removes the manual rung).
 *
 * @param {*} raw  entered MSRP (string from the form, or a number).
 * @returns {{ msrp: number, retailPrice: number }}
 */
export function manualMsrpPatch(raw) {
  const msrp = asNumber(raw);
  return { msrp, retailPrice: msrp };
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
  const amount = valueAmount(rawValue);
  // BE-removal D1: a frozen promo's per-copy figure is its stored value, labeled frozen (parity
  // with setValueProvenance). BL coverage above still wins; falls through to the BE/unknown path
  // for every other copy, byte-identical to before.
  if (amount !== null && isFrozenValueSet(setNumber)) {
    return frozenValue(amount, { condition, setNumber });
  }
  return toValue(amount, { condition, retired });
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
 * The value-known membership test — is a set's value KNOWN (amount !== null)? This is
 * THE definition of the "value-known subset" the headline value/gain/valued-cost all
 * iterate. Single-sourced here so {@link portfolioGain}, {@link knownValueCount}, and
 * {@link portfolioValuedCost} can't drift apart: because all three filter on this exact
 * predicate, `portfolioValue − portfolioValuedCost === portfolioGain` holds BY
 * CONSTRUCTION (Σ amount − Σ cost = Σ(amount − cost) over the same membership).
 *
 * @param {Object} s
 * @param {Object} [valueMap]
 * @returns {boolean}
 */
export function valueKnown(s, valueMap) {
  return setValueProvenance(s, valueMap).amount !== null;
}

/**
 * Share of portfolio value that is ESTIMATED (modeled + modeled_thin + asking BL copies) ÷ total known value —
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
  return sets.reduce((n, s) => n + (valueKnown(s, valueMap) ? 1 : 0), 0);
}

/**
 * Classify ONE resolved retail {@link import("./value").Value} into its coverage segment — the
 * per-set token behind {@link portfolioRetail}'s partition, extracted so a row/CSV consumer can
 * LABEL a set with the EXACT segment the card counts (parity by construction). Pure.
 *
 *   - basis "promo" + amount         → "promo-arv"      (a VALUED GWP / stated ARV — never sourced)
 *   - basis "promo" + no amount      → "promo-no-msrp"  (a GWP that never carried an RRP)
 *   - basis "estimated" + amount     → "estimated"      (curated proxy — disclosed apart from sourced)
 *   - any other amount-bearing Value → "sourced"        (a real RRP: brickset/manual/curated_sourced/cmf)
 *   - null, or amount null non-promo → "not-listed"     (a real RRP exists, just not obtained)
 *
 * @param {import("./value").Value | null} value  a {@link setRetailProvenance} result.
 * @returns {"sourced"|"estimated"|"promo-arv"|"promo-no-msrp"|"not-listed"}
 */
export function retailSegment(value) {
  if (value && value.basis === "promo") return value.amount != null ? "promo-arv" : "promo-no-msrp";
  if (value && value.basis === "estimated" && value.amount != null) return "estimated";
  if (value && value.amount != null) return "sourced";
  return "not-listed";
}

/**
 * Headline retail (MSRP) total + priced-set count over the SHARED retail ladder — the same
 * source the per-set Retail column and detail-panel chip read (so the card can't drift from
 * the row). Sums resolved per-unit retail × qty for every set whose ladder resolves to a real
 * figure; a promo (no-RRP) or unsourced set resolves to amount null and contributes 0 — so the
 * total is the retail of PRICED sets only, and `known` (the priced count) drives
 * {@link import("./valueDisplay").formatAggregateValue} ("—" when 0, never a phantom $0).
 *
 * Twin of {@link portfolioValue}, but retail's sources live in component-held caches, so the
 * per-set ladder read is INJECTED as `retailOf` (MyCollection's `retailFor` closure;
 * {@link setRetailProvenance} underneath) rather than read from a map here. (Retail Phase 3b —
 * replaces the BE-import blob `totalRetailPrice || (retailPrice || msrp) × qty`.)
 *
 * Option C (docs/curated-msrp-plan.md §3): the partition is 4-way — `known` (sourced, basis "retail")
 * + `estimated` (basis "estimated", curated proxy/ARV) + `promo` (GWP no/valued-RRP) + `notListed`
 * (unsourced) === sets.length. The HEADLINE is `total`/`known` (sourced only); `estimatedTotal` and
 * `promoTotal` are disclosed SEPARATELY (never folded into the headline) — estimates/ARVs must not
 * inflate the sourced MSRP figure. (NOTE the segment ≠ tier reconciliation: a promo whose curated tier
 * is "estimated" still counts in `promo`, not `estimated` — so the card's estimated count is the
 * NON-promo estimates only.)
 *
 * @param {Array<Object>} sets
 * @param {(set:Object) => (import("./value").Value | null)} retailOf  per-set ladder resolver
 * @returns {{ total:number, known:number, estimated:number, estimatedTotal:number, promo:number,
 *          promoTotal:number, notListed:number }}  known + estimated + promo + notListed === sets.length.
 */
export function portfolioRetail(sets, retailOf) {
  let total = 0, known = 0, estimated = 0, estimatedTotal = 0, promo = 0, promoTotal = 0, notListed = 0;
  for (const s of sets) {
    const r = retailOf(s);
    const qty = asNumber(s.qty) || 1;
    // Each set lands in EXACTLY one bucket via retailSegment → known + estimated + promo + notListed
    // === sets.length. The two promo tokens FOLD into one `promo` count; promoTotal sums any ARV but a
    // GWP value NEVER counts as sourced/estimated (Option C). estimated is disclosed apart from the
    // sourced headline; "not-listed" is an unsourced set whose real RRP just isn't obtained.
    switch (retailSegment(r)) {
      case "promo-arv":     promo += 1; promoTotal += r.amount * qty; break;
      case "promo-no-msrp": promo += 1; break;
      case "estimated":     estimated += 1; estimatedTotal += r.amount * qty; break;
      case "sourced":       total += r.amount * qty; known += 1; break;
      default:              notListed += 1; // "not-listed"
    }
  }
  return { total, known, estimated, estimatedTotal, promo, promoTotal, notListed };
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
 * Canonical-cost patch for a per-unit paid (or qty) edit. `paidPrice` is per-unit,
 * but setCost() reads the precomputed `totalPaid` FIRST — so editing paidPrice alone
 * is a silent no-op on cost/gain/ROI for any set that carries totalPaid (every BE
 * import). This re-derives the canonical from the (already-updated) per-unit fields:
 *   - totalPaid = perUnit × qty  → setCost now reflects the edit
 *   - entries[].paid_price = perUnit (when present) → keeps setPaidProvenance's
 *     msrp↔manual classification and the SetDetailPanel per-copy rows in sync.
 * Returns a patch to merge onto the set; `entries` is omitted when the set has none.
 *
 * @param {Object} s  set with its NEW paidPrice/qty already applied
 * @returns {{ totalPaid: number, entries?: Array }}
 */
export function reconcilePaidEdit(s) {
  const perUnit = asNumber(s.paidPrice);
  const qty = asNumber(s.qty) || 1;
  const patch = { totalPaid: perUnit * qty };
  if (Array.isArray(s.entries) && s.entries.length) {
    patch.entries = s.entries.map((e) => ({ ...e, paid_price: perUnit }));
  }
  return patch;
}

/**
 * Patch for a condition edit — the condition twin of {@link reconcilePaidEdit}. `bucket`
 * is a binary 'new'|'used'. Multi-copy sets carry `entries[]` (one per copy):
 *   - bulk (no copyIndex): every copy's condition := bucket;
 *   - per-copy (copyIndex given): only that copy's condition changes — letting a set become
 *     Mixed when copies disagree.
 * A manual set (no entries[]) has no per-copy data → patch the set-level `condition`.
 *
 * "mixed" is NEVER stored — it falls out of setConditionDisplay() from disagreeing entries.
 * Returns a patch to merge onto the set (and, for entries-bearing sets, to persist into the
 * BE blob via persistBESetEdit — `entries[].condition` shares its name across both shapes).
 *
 * @param {Object} set                       owned set (may carry entries[])
 * @param {'new'|'used'} bucket              target bucket
 * @param {number} [copyIndex]               which copy to change; omit for a bulk edit
 * @returns {{ entries: Array } | { condition: string }}
 */
export function reconcileConditionEdit(set, bucket, copyIndex) {
  const entries = set?.entries;
  if (!Array.isArray(entries) || !entries.length) {
    return { condition: bucket }; // manual set — no per-copy data to reconcile
  }
  if (copyIndex == null) {
    return { entries: entries.map((e) => ({ ...e, condition: bucket })) };
  }
  return { entries: entries.map((e, i) => (i === copyIndex ? { ...e, condition: bucket } : e)) };
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

// ─────────────────────────────────────────────────────────────────────────────
// Paid provenance (Provenance Step 1). The PAID analog of setValueProvenance:
// a read-time, null-aware projection that says WHERE a set's cost basis comes
// from. Derived, never persisted — same discipline as the value layer.
//
//   amount = setCost(s)  — wraps the bare per-set paid reader (the rawSetValue analog).
//   source one of:
//     'ledger' — the set's BASE number has a matching budget/BL purchase (real, receipt-backed).
//                Joined on the base number (strip the -N variant) so every CMF figure (71052-5)
//                matches its series purchase (71052).
//     'manual' — no purchase, and paid ≠ retail → a real cost entered without a receipt.
//     'msrp'   — no purchase, and paid == retail → a BrickEconomy import default, NOT real money.
//     'none'   — no paid at all (cost ≤ 0).
//
// paid-vs-retail is compared in CENTS because the stored retail carries float noise
// (e.g. retailPrice 59.9899999…). Unknown retail (≤ 0) can't equal a positive paid, so
// it falls to 'manual' — there is no separate unknown-retail bucket (mirrors the 4-bucket
// model in docs/density-conditions-overview-discovery.md §2). No display wiring here.
// ─────────────────────────────────────────────────────────────────────────────

/** Base (variant-stripped) set number for the ledger join: "71052-5" → "71052". */
const baseSetNumber = (n) => String(n ?? "").replace(/-\d+$/, "");

/**
 * Index purchases by base set number for the ledger join — first occurrence wins.
 * The base strip lets a single CMF series purchase (e.g. "71052") match every owned
 * figure of that series ("71052-1" … "71052-12").
 *
 * @param {Array<Object>} purchases  budget/BL purchase records (blPurchases / budgetPurchases).
 * @returns {Map<string, Object>}    base number → purchase.
 */
export function buildPurchaseMap(purchases) {
  const map = new Map();
  for (const p of purchases || []) {
    const base = baseSetNumber(p.setNumber);
    if (base && !map.has(base)) map.set(base, p);
  }
  return map;
}

// Cents rounding — the float-noise-proof comparison unit for paid vs retail.
const paidCents = (n) => Math.round(asNumber(n) * 100);

/**
 * Does this set's paid equal its retail (the BrickEconomy MSRP-default signature)?
 * True when total paid == total retail OR per-unit paid == unit retail, compared in
 * cents. A set with unknown retail (≤ 0) returns false (→ classified 'manual').
 *
 * @param {Object} s
 * @returns {boolean}
 */
function paidEqualsRetail(s) {
  const paidTotal = setCost(s);
  const retailTotal = asNumber(s.totalRetailPrice);
  if (retailTotal > 0 && paidCents(paidTotal) === paidCents(retailTotal)) return true;
  const retailUnit = asNumber(s.retailPrice);
  if (retailUnit > 0) {
    const ents = (s.entries || []).map((e) => asNumber(e.paid_price)).filter((x) => x > 0);
    const qty = asNumber(s.qty) || asNumber(s.quantity) || (s.entries || []).length || 1;
    const unitPaid = ents.length ? ents[0] : paidTotal / qty;
    if (paidCents(unitPaid) === paidCents(retailUnit)) return true;
  }
  return false;
}

/**
 * Read-time paid (cost-basis) provenance for a set — the PAID analog of
 * {@link setValueProvenance}. Single coalescing point: every consumer reads `.source`
 * from here rather than re-deriving the ledger join or the paid==retail test. Pure,
 * null-aware (cost ≤ 0 → 'none'), nothing persisted.
 *
 * @param {Object} s
 * @param {Map<string, Object>} [purchaseMap]  from {@link buildPurchaseMap}; omitted → no set is 'ledger'.
 * @returns {{ amount: number, source: 'ledger'|'manual'|'msrp'|'none' }}
 */
export function setPaidProvenance(s, purchaseMap) {
  const amount = setCost(s);
  if (!(amount > 0)) return { amount, source: "none" };
  if (purchaseMap && purchaseMap.has(baseSetNumber(s.setNumber))) return { amount, source: "ledger" };
  return { amount, source: paidEqualsRetail(s) ? "msrp" : "manual" };
}

/**
 * Cost-basis split by paid provenance — the PAID analog of {@link portfolioValue} +
 * {@link knownValueCount}. `realCost` (ledger + manual) is money actually spent — the
 * figure to headline; `msrpCost` is the BrickEconomy MSRP-default placeholder portion to
 * DISCLOSE, not headline (it isn't real spend). `noneCount` = sets with no paid. One pass,
 * read-time, nothing persisted.
 *
 * @param {Array<Object>} sets
 * @param {Map<string, Object>} [purchaseMap]  from {@link buildPurchaseMap}.
 * @returns {{ realCost:number, realCount:number, msrpCost:number, msrpCount:number, noneCount:number, totalCost:number }}
 */
export function costBasisBreakdown(sets, purchaseMap) {
  let realCost = 0, realCount = 0, msrpCost = 0, msrpCount = 0, noneCount = 0;
  for (const s of sets) {
    const { amount, source } = setPaidProvenance(s, purchaseMap);
    if (source === "ledger" || source === "manual") { realCost += amount; realCount++; }
    else if (source === "msrp") { msrpCost += amount; msrpCount++; }
    else noneCount++; // 'none' — no paid
  }
  return { realCost, realCount, msrpCost, msrpCount, noneCount, totalCost: realCost + msrpCost };
}

/**
 * Portfolio % ROI over the KNOWN-REAL subset only — real market value vs real cost:
 * sets whose paid is 'ledger'/'manual' (real spend, cost > 0) AND whose value is known.
 * MSRP-placeholder cost is EXCLUDED — an ROI against a retail-default basis is meaningless.
 * Returns `null` when none qualify (UI reads "—"). The paid analog scoping of
 * {@link portfolioROI}.
 *
 * @param {Array<Object>} sets
 * @param {Object} [valueMap]
 * @param {Map<string, Object>} [purchaseMap]
 * @returns {number|null}
 */
export function realCostROI(sets, valueMap, purchaseMap) {
  let value = 0, cost = 0, n = 0;
  for (const s of sets) {
    const prov = setPaidProvenance(s, purchaseMap);
    if ((prov.source !== "ledger" && prov.source !== "manual") || prov.amount <= 0) continue;
    const amount = setValueProvenance(s, valueMap).amount;
    if (amount === null) continue; // value must be known — real market vs real cost
    value += amount; cost += prov.amount; n++;
  }
  return n === 0 || cost <= 0 ? null : ((value - cost) / cost) * 100;
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
    if (!valueKnown(s, valueMap)) return sum;
    return sum + (setValueProvenance(s, valueMap).amount - setCost(s));
  }, 0);
}

/**
 * Cost basis over the VALUE-KNOWN subset — the denominator the headline Net Gain is
 * actually computed against ({@link portfolioGain} sums value − cost over exactly these
 * sets). Distinct from {@link totalSpent}'s INCLUSIVE figure (every set's cost): this
 * EXCLUDES sets whose value is unknown, so by construction
 *   {@link portfolioValue} − portfolioValuedCost === {@link portfolioGain}
 * (same {@link valueKnown} predicate). Lets the Net Gain tile show its own subset cost so
 * the Value / Net Gain tiles reconcile in place under partial value coverage (backlog #4).
 *
 * @param {Array<Object>} sets
 * @param {Object} [valueMap]
 * @returns {number}
 */
export function portfolioValuedCost(sets, valueMap) {
  return sets.reduce((sum, s) => (valueKnown(s, valueMap) ? sum + setCost(s) : sum), 0);
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

/**
 * Value of the "free" sets — Σ market value over sets whose value is KNOWN but whose cost is ≤ 0
 * (GWPs / promos / no recorded cost). This is EXACTLY the slice {@link portfolioGain} counts as pure
 * gain but {@link portfolioROI} cannot (no positive cost → no % return), so it is the dollar bridge
 * between a positive Net Gain and a flat/negative ROI:
 *   portfolioGain === (the cost>0 core's gain) + freebieValue.
 * Read-time, null-aware, nothing persisted — NOT a new cost/value rule, just the existing
 * {@link setValueProvenance} / {@link setCost} funnel summed over the cost≤0 value-known subset.
 *
 * @param {Array<Object>} sets
 * @param {Object} [valueMap]
 * @returns {number}
 */
export function freebieValue(sets, valueMap) {
  return sets.reduce((sum, s) => {
    const amount = setValueProvenance(s, valueMap).amount;
    return amount !== null && setCost(s) <= 0 ? sum + amount : sum;
  }, 0);
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

/**
 * Collection value + copy counts split by the binary New / Used valuation bucket — COPY-GRAIN.
 * Supersedes the prior SET-grain New/Used/**Mixed** partition: every owned COPY lands in exactly one
 * bucket via its OWN condition ({@link resolveCopies} → {@link import("./condition").conditionBucket}),
 * so a multi-condition ("mixed") set is no longer a third bucket — its new copies score New and its used
 * copies score Used. "Mixed" still renders on the row + per-copy detail (setConditionDisplay, untouched);
 * it just stops being a value/donut bucket.
 *
 * VALUE is anchored to each set's authoritative {@link setValueProvenance} amount — the EXACT figure
 * {@link portfolioValue} sums — and distributed across the buckets in proportion to the per-copy
 * condition-matched values, so by construction
 *     new.value + used.value === portfolioValue(sets, valueMap)   (the headline Collection Value)
 * — no value falls between buckets. This replaces the set-grain new+used+mixed===portfolioValue invariant
 * with the SAME "no dropped value" guarantee, two buckets not three (no return of the old ~$3.4k gap).
 * For a BL-covered set the proportion is EXACT (Σ per-copy === the set total), so each copy contributes
 * its own condition-matched value; the ratio only re-scales the degenerate case where the row total and
 * the per-copy values disagree (lazy/stale `entries[].current_value` vs a synced row `totalValue`). A set
 * whose total is known but has NO per-copy value signal splits evenly across its copies — nothing dropped.
 * Unknown set value contributes 0 and leaves `known` at 0 → the card reads "—", never a phantom $0.
 *
 * `copies` is COPY-grain and reconciles to the all-copies "Total Sets" figure: Σ(new.copies + used.copies)
 * === Σ qty, because resolveCopies yields exactly `qty` copies per set (entries.length for BE — quantity
 * === entries by aggregateFromEntries — or `qty` synthesized for manual). The Condition Breakdown donut
 * reads these, so the donut total can't diverge from Total Sets.
 *
 * @param {Array<Object>} sets
 * @param {Object} [valueMap]
 * @returns {{ new:{value:number,known:number,copies:number}, used:{value:number,known:number,copies:number} }}
 */
export function conditionValueBuckets(sets, valueMap) {
  const acc = {
    new:  { value: 0, known: 0, copies: 0 },
    used: { value: 0, known: 0, copies: 0 },
  };
  for (const s of sets) {
    const copies = resolveCopies(s, valueMap); // one entry per owned copy, each carrying { amount, cond }
    for (const c of copies) acc[c.cond].copies += 1;

    // Anchor the value split to the set's authoritative amount so the buckets sum to portfolioValue exactly.
    const total = setValueProvenance(s, valueMap).amount;
    if (total === null) continue; // unknown value — copies counted, nothing to distribute

    const known = copies.filter((c) => c.amount !== null);
    const copySum = known.reduce((sum, c) => sum + c.amount, 0);
    if (copySum > 0) {
      for (const c of known) {
        acc[c.cond].value += total * (c.amount / copySum); // exact when copySum === total (BL-covered)
        acc[c.cond].known += 1;
      }
    } else {
      // Known total, no per-copy value signal (e.g. lazy entries pre-overlay) → spread evenly so it lands.
      const per = total / copies.length;
      for (const c of copies) {
        acc[c.cond].value += per;
        acc[c.cond].known += 1;
      }
    }
  }
  return acc;
}
