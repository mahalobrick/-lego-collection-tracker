// Brickset metadata enrichment — the pure fetch/cache loop, extracted from MyCollection's
// runBricksetEnrichment (panel-design SOP commit 2). No React state, no toasts: it fetches
// pieces/minifigs from Brickset for the gap sets, caches each, and reports progress via an
// onPatch callback so the caller can apply UI updates (MyCollection wires setSets; AppSettings
// will reuse this for the Data Sources "Brickset" row once the sync button moves there).
// Pinned by bricksetMetadata.test.js.

import { fetchBricksetSet, cacheBricksetSet } from "./brickset";

// Brickset cache keys are byte-identical on the canonical "<num>" form (strip the "-1" suffix).
export const cleanSetNumber = (n) => String(n || "").replace(/-1$/, "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The sets that need a Brickset fetch: have a set number, and (unless forced) are missing
// pieces or minifigs. Mirrors the legacy toFetch filter exactly.
export function metadataGaps(sets, force = false) {
  return sets.filter((s) => {
    if (!s.setNumber) return false;
    if (!force && s.minifigs != null && s.pieces != null) return false;
    return true;
  });
}

// Fetch + cache Brickset metadata for the gap sets, sequentially (with a polite delay between
// calls). onPatch(clean, { minifigs?, pieces? }) fires per successfully-fetched set carrying
// only the present fields, so the caller can patch progressively. `updated` counts every set
// that returned data (matching the legacy counter — a fetch with null fields still counts).
// Returns { attempted, updated }.
export async function syncBricksetMetadata(sets, { force = false, onPatch, delayMs = 400 } = {}) {
  const toFetch = metadataGaps(sets, force);
  let updated = 0;
  for (const item of toFetch) {
    const clean = cleanSetNumber(item.setNumber);
    try {
      const bsData = await fetchBricksetSet(clean);
      if (!bsData) { await sleep(delayMs); continue; }
      // Persist to Brickset cache so future loads don't need to re-fetch (shared instance;
      // key stays `brickset_${clean}` byte-identical — P3.3).
      cacheBricksetSet(clean, bsData);
      // Patch — minifigs + pieces only (BE owns value fields)
      const upd = {};
      if (bsData.minifigs != null) upd.minifigs = bsData.minifigs;
      if (bsData.pieces   != null) upd.pieces   = bsData.pieces;
      if (onPatch && Object.keys(upd).length) onPatch(clean, upd);
      updated++;
    } catch {}
    await sleep(delayMs);
  }
  return { attempted: toFetch.length, updated };
}
