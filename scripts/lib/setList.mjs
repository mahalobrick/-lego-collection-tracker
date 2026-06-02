// Pure set-list derivation for the BrickLink value-refresh batch (scripts/refresh-values.mjs).
//
// NO I/O — given the owned-collection entries (from ANY source: the live Upstash per-user blobs,
// or a backup file), it produces the work list the batch values. Source-agnostic by design, so the
// backup→Upstash source swap changes ONLY where the entries come from, not how they're selected.
// The CMF/promo skip + condition mapping are byte-identical to the prior inline logic; unit-tested in
// setList.test.mjs.

// ── CMF / Phase-2 skip rule (docs/value-source-decision.md §4–§5) ────────────
// The whole minifigure namespace is deferred to Phase 2 (valued via the BrickLink MINIFIG endpoint,
// not SET). The data-driven signal is theme === "Minifigure Series" (generalises — no fragile
// per-series suffix ranges). The 2 long-numeric promo IDs error on the SET endpoint but are themed
// "Seasonal", so they're skipped by explicit id. Even CMF entries that DO resolve on the SET endpoint
// are skipped: §4 says that price is the wrong full-box figure for a minifig, never a set value.
export const CMF_THEME = "Minifigure Series";
export const NUMERIC_PROMO_SKIP = new Set(["6490363-1", "6550806-1"]);
export const isCmfOrPromo = (s) => s.theme === CMF_THEME || NUMERIC_PROMO_SKIP.has(String(s.setNumber));

// BrickLink wants the variant suffix: append -1 only if there's no -N already.
export const blSetId = (num) => (/-\d+$/.test(String(num)) ? String(num) : `${num}-1`);
// Collection conditions → the two value conditions we track.
export const condOf = (c) => (String(c || "").startsWith("used") ? "used" : "new");

/**
 * The normalized owned-collection array out of a synced backup blob (per-user Upstash value, or a
 * local backup file — same shape). `brickEconomyNormalized` is the canonical key; the app's
 * in-memory localStorage variant is `brickEconomyNormalizedCollection` (kept as a fallback).
 *
 * @param {Object|null} blob
 * @returns {Array<Object>}  normalized set entries (possibly empty).
 */
export function collectionFromBlob(blob) {
  if (!blob || typeof blob !== "object") return [];
  return blob.brickEconomyNormalized || blob.brickEconomyNormalizedCollection || [];
}

/**
 * Build the batch work list from a flat array of normalized entries (already unioned across users).
 * Dedupes by set number (first occurrence wins), skips CMF/promo (deferred to Phase 2), and captures
 * each set's owned conditions. The valuing/keyspace/provenance downstream are untouched.
 *
 * @param {Array<Object>} entries
 * @returns {{work: Array<{number:string, setId:string, name:string, ownedConditions:string[]}>, cmfSkipped:number, uniqueCount:number}}
 */
export function buildWorkList(entries) {
  const seen = new Set();
  const work = [];
  let cmfSkipped = 0;
  for (const s of entries || []) {
    const number = String(s.setNumber || "");
    if (!number || seen.has(number)) continue;
    seen.add(number);
    if (isCmfOrPromo(s)) { cmfSkipped++; continue; }
    const ownedConditions = [...new Set((s.entries || []).map((e) => condOf(e.condition)))];
    work.push({ number, setId: blSetId(number), name: s.name || "", ownedConditions });
  }
  return { work, cmfSkipped, uniqueCount: seen.size };
}
