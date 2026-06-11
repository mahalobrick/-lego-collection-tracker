// Pure set-list derivation for the BrickLink value-refresh batch (scripts/refresh-values.mjs).
//
// NO I/O — given the owned-collection entries (from ANY source: the live Upstash per-user blobs,
// or a backup file), it produces the work list the batch values. Source-agnostic by design, so the
// backup→Upstash source swap changes ONLY where the entries come from, not how they're selected.
// Unit-tested in setList.test.mjs.

// ── CMF Phase-2 mapping (docs/cmf-mapping-spike.md; VPS-confirmed by scripts/diagnostics/cmf-probe.mjs) ──
// BL catalogs every CMF figure twice; the priceable one is the parallel *SET* "colNN-N (Complete Set
// with Stand and Accessories)". Our raw "71xxx-N" must NEVER be queried: BL's own 71048-2 is a
// whole-series packaging variant (≈12× one figure) — the trap the original Phase-1 skip rule existed
// for. So CMFs are valued by TRANSLATING the number at fetch time via this curated per-series prefix
// table (curated, not derived — colf1rc is irregular). The figure rides on POSITION (-N preserved);
// names are never matched (BL generic vs marketing names diverge by design). Fail-safe: a CMF series
// missing from the table stays deferred (BE keeps valuing it), and the 2 long-numeric promo IDs stay
// deferred — the VPS probe confirmed they 404 on the SET endpoint.
export const CMF_THEME = "Minifigure Series";
export const NUMERIC_PROMO_SKIP = new Set(["6490363-1", "6550806-1"]);
export const isCmfOrPromo = (s) => s.theme === CMF_THEME || NUMERIC_PROMO_SKIP.has(String(s.setNumber));
export const CMF_PREFIX_TABLE = Object.freeze({
  71034: "col23",     // CMF Series 23
  71037: "col24",     // CMF Series 24
  71038: "coldis100", // Disney 100
  71039: "colmar2",   // Marvel Studios Series 2
  71045: "col25",     // CMF Series 25
  71046: "col26",     // CMF Series 26 (Space)
  71047: "coldnd",    // Dungeons & Dragons
  71048: "col27",     // CMF Series 27
  71049: "colf1rc",   // F1 Race Cars (irregular prefix — why this table is curated)
  71051: "col28",     // CMF Series 28 (Animals)
  71052: "col29",     // CMF Series 29
});

// Our CMF "BASE-N" → BL col SET id "<prefix>-N" (position preserved). null = not mappable, and the
// caller must keep that set deferred — this translation is the ONLY path by which a CMF-base number
// may reach the fetch list.
export const cmfBlId = (num) => {
  const m = /^(\d+)-(\d+)$/.exec(String(num));
  const prefix = m ? CMF_PREFIX_TABLE[m[1]] : undefined;
  return prefix ? `${prefix}-${m[2]}` : null;
};

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
 * Dedupes by set number (first occurrence wins) and captures each set's owned conditions. CMFs are
 * translated to their BL col SET id at this point (number stays OURS — value:SET:{number} is what the
 * app reads); promos and table-missing CMF series stay deferred (`cmfSkipped`). The valuing/keyspace/
 * provenance downstream are untouched.
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
    // Normalize FIRST: the wanted-list path strips '-1' suffixes, so the promo skip and the CMF
    // translation must both see the suffixed form ('6490363' must not dodge the skip; '71048'
    // must not dodge the translation and reach BL raw).
    const suffixed = blSetId(number);
    if (NUMERIC_PROMO_SKIP.has(suffixed)) { cmfSkipped++; continue; }
    // CMF route. `translated` is checked for ANY entry (not just CMF_THEME) so a theme-drifted
    // record on a curated base still translates — a raw CMF-base "71xxx-N" can never reach the
    // fetch list (BL's raw 7104x-N are whole-series packaging variants, the ≈12× overvalue trap).
    const translated = cmfBlId(suffixed);
    if (s.theme === CMF_THEME && !translated) { cmfSkipped++; continue; } // unmapped series → stays deferred
    const ownedConditions = [...new Set((s.entries || []).map((e) => condOf(e.condition)))];
    work.push({ number, setId: translated || suffixed, name: s.name || "", ownedConditions });
  }
  return { work, cmfSkipped, uniqueCount: seen.size };
}
