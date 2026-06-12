// ─────────────────────────────────────────────────────────────────────────────
// Frozen-value registry (BE-removal D1).
//
// Two promo sets — "By the Fireplace" (6490363-1) and "Gingerbread Lane" (6550806-1) —
// 404 on BrickLink's SET endpoint, so the value cron permanently DEFERS them
// (NUMERIC_PROMO_SKIP, scripts/lib/setList.mjs). They have no live market (BL) source and
// no retail MSRP (a GWP/promo was never sold at retail). Their displayed value is the LAST
// BrickEconomy number, now FROZEN as static provenance: the value-resolution reads it from
// the stored collection field with a 'frozen' basis (setValueProvenance, portfolio.js), the
// display marks it honestly (valueConfidence, valueDisplay.js), and the daily BE batch stops
// refreshing them (beSyncValues.js). This decouples them from the live BE value path so the
// later machinery teardown can NOT blank them (docs/be-removal-plan.md §3 D1(b): "freeze last
// BE value as provenance, stop refreshing").
//
// EXACT allowlist — never a prefix wildcard (the BACKUP_KEYS / cache-clear guardrail
// discipline). Keys are the canonical -1-suffixed form; membership normalizes the de-varianted
// form (beSyncValues strips '-1') the SAME way blSetId / the cron do, so "6490363" ≡ "6490363-1"
// resolves true while "6490363-2" / "64903631" / "649036" do not.
// ─────────────────────────────────────────────────────────────────────────────

/** Date these two promos were frozen — the honest "as-of" for their static-provenance value. */
export const FROZEN_VALUE_ASOF = "2026-06-12";

/** setNumber (canonical -1 form) → frozen-as-of date. EXACT keys, never prefix-matched. */
export const FROZEN_VALUE_SETS = new Map([
  ["6490363-1", FROZEN_VALUE_ASOF], // "By the Fireplace" — last BrickEconomy value $23.72
  ["6550806-1", FROZEN_VALUE_ASOF], // "Gingerbread Lane" — last BrickEconomy value $32.96
]);

/** Canonical -1-suffixed form (mirrors scripts/lib/setList.mjs blSetId): append -1 only when
 *  there is no -N variant suffix already. Keeps membership EXACT, not a prefix match. */
const canonical = (num) => {
  const s = String(num ?? "").trim();
  return /-\d+$/.test(s) ? s : `${s}-1`;
};

/**
 * Is this set one of the frozen-value promos? EXACT match on the canonical set number — the
 * de-varianted form ("6490363", as beSyncValues keys it after stripping -1) and the suffixed
 * form ("6490363-1", as the app / valueMap key it) both resolve, but a different variant
 * ("6490363-2") or a prefix/superstring does not. Null-safe.
 *
 * @param {string} setNumber
 * @returns {boolean}
 */
export function isFrozenValueSet(setNumber) {
  return FROZEN_VALUE_SETS.has(canonical(setNumber));
}

/**
 * The frozen "as-of" date for a frozen-value set, or null when it isn't one.
 *
 * @param {string} setNumber
 * @returns {string|null}
 */
export function frozenAsOf(setNumber) {
  return FROZEN_VALUE_SETS.get(canonical(setNumber)) ?? null;
}

/**
 * Build the {@link import("./value").Value} for a frozen-value set: a static last-known figure
 * with NO live source. `basis` and `source` are both "frozen" so the display layer
 * ({@link import("./valueDisplay").valueConfidence}) can mark it honestly ("frozen — no longer
 * updated") and nothing mistakes it for a live market/retail figure. The amount is the set's
 * stored number (the caller has already value-coalesced it and gated on amount != null).
 *
 * @param {number} amount               resolved stored value (a real number; never null here)
 * @param {Object} [opts]
 * @param {string|null} [opts.condition]
 * @param {string} [opts.setNumber]     stamps the per-set frozen as-of date
 * @returns {import("./value").Value}
 */
export function frozenValue(amount, { condition = null, setNumber } = {}) {
  return {
    amount,
    source: "frozen",
    condition: condition ?? null,
    basis: "frozen",
    asOf: frozenAsOf(setNumber),
    lots: null,
  };
}
