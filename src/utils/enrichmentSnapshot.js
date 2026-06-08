/**
 * enrichmentSnapshot — the P4 cold-start warm-up: snapshot the two device-local enrichment caches
 * that drive the cold-start trickle (bricksetSetCache — the minifig/pieces climb; blValueCache — the
 * BL-primary value safety net) into a SEPARATE sibling field `backup.enrichmentSnapshot`, and restore
 * them on a fresh device so it starts warm. Design: docs/enrichment-p4-plan.md §3–§4.
 *
 * STATUS: INERT (P4.1). Nothing in the sync round-trip calls these yet — buildBackup /
 * applyCloudBackup are untouched. P4.2 attaches buildEnrichmentSnapshot() to the push body; P4.3
 * calls restoreEnrichmentSnapshot() in applyCloudBackup AFTER the atomic apply, OUTSIDE its block.
 *
 * WHOLE-ENTRY snapshot: entries are read/written verbatim (their `fetchedAt`/`cachedAt` round-trip
 * unchanged — no re-stamp, no value-only extraction), so restored entries respect TTL exactly as if
 * this device had fetched them (fresh → no refetch; stale → background refresh). This is why the
 * "fresh-forever / always-stale" trap the P4 gate flagged for BE re-inclusion does not apply here.
 *
 * EXACTLY two caches: bricksetSetCache + blValueCache. NOT brickEconomySetCache (regeneratable, still
 * push-stripped, BE slated for removal) and NOT blPriceGuideCache (on-demand, short TTL → stale on
 * restore). See docs/enrichment-p4-plan.md §2.
 *
 * LEAF DISCIPLINE: this is a CONSUMER of the cache modules (it imports their snapshot helpers), never
 * imported back into them — so it stays out of any cycle. All persistence goes through the cache
 * modules' getRaw/saveRaw (→ setItemSafe), so DATA-4 + the removeItem ban are respected here too.
 */

import { getBricksetCache, restoreBricksetSnapshot } from "./brickset";
import { getValueCacheRaw, restoreValueCache } from "./valueCache";

const SNAPSHOT_VERSION = 1;

/** Non-empty plain object? (a missing/empty sub-cache → nothing to restore). */
function hasEntries(m) {
  return !!m && typeof m === "object" && Object.keys(m).length > 0;
}

/**
 * Build the enrichment snapshot from the current device caches — whole entries, timestamps verbatim.
 * Empty/missing caches yield a well-defined empty shape ({}), never undefined. INERT (P4.2 wires it).
 *
 * @returns {{ v: number, bricksetSetCache: Object, blValueCache: Object }}
 */
export function buildEnrichmentSnapshot() {
  return {
    v: SNAPSHOT_VERSION,
    bricksetSetCache: getBricksetCache() || {},
    blValueCache: getValueCacheRaw() || {},
  };
}

/**
 * Restore an enrichment snapshot into the device caches — verbatim, reconciling each cache's memo so a
 * later peek/readThrough sees the restored entries. Writes only the non-empty sub-caches (an empty or
 * missing snapshot is a safe no-op — no write, no throw). INERT (P4.3 wires it).
 *
 * "Cold-but-correct" contract: a quota/write failure is SWALLOWED — the helper returns `false` rather
 * than throwing, so a full disk degrades to a cold (un-seeded) but otherwise-correct device. Returns
 * `true` when every attempted write landed (including the no-op case: nothing to write → success).
 *
 * @param {{ bricksetSetCache?: Object, blValueCache?: Object }|null|undefined} snapshot
 * @returns {boolean} true if all attempted seeds landed (or there was nothing to seed); false otherwise.
 */
export function restoreEnrichmentSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return true; // missing → safe no-op
  let ok = true;
  if (hasEntries(snapshot.bricksetSetCache)) ok = restoreBricksetSnapshot(snapshot.bricksetSetCache) !== false && ok;
  if (hasEntries(snapshot.blValueCache))     ok = restoreValueCache(snapshot.blValueCache) !== false && ok;
  return ok;
}
