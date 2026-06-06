import { apiFetch } from "./apiFetch";
import { setItemSafe } from "./safeStorage";
import { readSource, reportSourceFailure, classifyFailure } from "./readSource";
import { asNumber } from "./formatting";
import { createEntryCache, ISO_TS } from "./enrichmentCache";

const CACHE_KEY = "bricksetSetCache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const THEMES_CACHE_KEY = "bricksetThemesCache";
const THEMES_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Shared cache instance — reproduces bricksetSetCache byte-for-byte (P3.3):
//   key "bricksetSetCache", keyFn `brickset_<n>` (VERBATIM prefix, no de-variant — net PIN 3),
//   ISO_TS `fetchedAt`, 7d TTL, `data` value field, no value transform (validate = identity).
//   requireValue:true reproduces fetchBricksetSet's `cached.fetchedAt && cached.data` read guard.
// bricksetSetCache is in SYNC_SKIP_KEYS; the byte-identical key keeps it out of the auto-push.
const bricksetCache = createEntryCache({
  key: CACHE_KEY,
  ttlMs: CACHE_TTL_MS,
  valueField: "data",
  tsField: "fetchedAt",
  ts: ISO_TS,
  keyFn: (n) => `brickset_${n}`,
  requireValue: true,
});

/** Persist a Brickset set under `brickset_<n>` via the shared cache. The writer for the MyCollection
 *  mount-enrichment path (formerly an inline setItemSafe at MyCollection.jsx:412) — byte-identical key
 *  + `{ fetchedAt(ISO), data }` entry, routed through the one instance so both writers stay in sync. */
export function cacheBricksetSet(setNumber, data) {
  bricksetCache.put(setNumber, data);
}

/** The whole bricksetSetCache map (localStorage mirror), for the retail/CMF cache-walkers
 *  (bricksetRetailEntry / cmfSeriesRetailTargets). Byte-identical to the prior raw localStorage read. */
export function getBricksetCache() {
  return bricksetCache.getRaw();
}

/**
 * Resolve the Brickset cache entry that carries a set's RETAIL (MSRP), walking from the exact
 * figure number up to its series base — the retail twin of the paid base-join (`baseSetNumber`,
 * `/-\d+$/`). For a CMF figure (`71052-5`) this matters: Brickset puts the per-bag retail on the
 * **`-0` series variant** (`71052-0` → $4.99 US, already per-figure — NOT a case total), while the
 * figure's own `-N` entry carries none. So we pick the FIRST candidate that actually has a retail
 * (`figure → base → series-0 → -1`), not merely the first that exists — otherwise a cached
 * null-retail figure entry would shadow the series price. Returns the chosen `{data, fetchedAt}`
 * entry, or the bare figure entry (for `asOf`), or null.
 *
 * NOTE (Retail Phase 1, backlog #1): the `-0` series entries are NOT fetched anywhere yet — nothing
 * requests `71052-0`. This resolver is the read side; it reclaims CMF retail the moment a `-0` fetch
 * populates the cache. Coverage where it lands: 10 of 11 owned series carry a `-0` US retail (only
 * `71034-0` is null). Wiring the `-0` fetch (or a bag-price table / manual) is the held decision.
 *
 * @param {Object<string, {data?:Object, fetchedAt?:string}>} bsCache  the `bricksetSetCache` object.
 * @param {string} setNumber  owned set number, e.g. "71052-5" or "10300-1".
 * @returns {{data?:Object, fetchedAt?:string} | null}
 */
export function bricksetRetailEntry(bsCache, setNumber) {
  if (!bsCache) return null;
  const base = String(setNumber || "").replace(/-\d+$/, "");
  const hit = [`brickset_${setNumber}`, `brickset_${base}`, `brickset_${base}-0`, `brickset_${base}-1`]
    .map((k) => bsCache[k])
    .find((e) => asNumber(e?.data?.retail_price_us) > 0);
  return hit || bsCache[`brickset_${setNumber}`] || null;
}

/**
 * The bounded list of CMF series `-0` Brickset numbers to fetch so the series retail (RRP) lands in
 * cache for {@link bricksetRetailEntry} to read. CMF retail lives on the `-0` SERIES variant
 * (`71052-0` → US $4.99, per-bag = already per-figure), NOT on the per-figure `-N` entries — so this
 * yields ONE `-0` per owned series (theme "Minifigure Series"), deduped (~11 calls, not per-figure),
 * skipping any series whose `-0` is already cached. Pure — the fetch/throttle is the caller's.
 *
 * (Of the owned series, ~10/11 carry a real `-0` US retail; `71034-0` is null on Brickset and stays
 * "—" — reclaimed later via manual msrp. We still cache its `-0` so it isn't re-fetched every load.)
 *
 * @param {Array<{setNumber?:string, theme?:string}>} sets  owned sets.
 * @param {Object<string, *>} [bsCache]  the bricksetSetCache object (skip already-cached `-0`).
 * @returns {string[]}  series numbers to fetch, e.g. ["71052-0", "71045-0"].
 */
export function cmfSeriesRetailTargets(sets, bsCache = {}) {
  const seen = new Set();
  const out = [];
  for (const s of sets || []) {
    if (!/minifigure series/i.test(s?.theme || "")) continue;
    const base = String(s?.setNumber || "").replace(/-\d+$/, "");
    if (!base || seen.has(base)) continue;
    seen.add(base);
    if (bsCache && bsCache[`brickset_${base}-0`]) continue; // already have the series entry
    out.push(`${base}-0`);
  }
  return out;
}

/**
 * Fetch all LEGO themes from Brickset, cached in localStorage for 30 days.
 * Returns a sorted string array, or [] if the API key isn't configured.
 */
export async function fetchLegoThemes() {
  try {
    const cached = JSON.parse(localStorage.getItem(THEMES_CACHE_KEY) || "null");
    if (cached?.themes && cached?.fetchedAt) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < THEMES_TTL_MS) return cached.themes;
    }
  } catch { /* ignore */ }

  try {
    const res = await apiFetch("/api/brickset-themes");
    const json = await res.json();
    if (!res.ok) return [];  // includes the not_configured (no API key) envelope
    const themes = json.themes || [];
    try {
      setItemSafe(THEMES_CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), themes }));
    } catch { /* ignore */ }
    return themes;
  } catch {
    return [];
  }
}

/**
 * Search Brickset catalog by name query or theme.
 * Returns { sets, total, noKey, error } — results are transient, not cached.
 */
export async function searchBricksetCatalog(query, theme = "") {
  try {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (theme) params.set("theme", theme);
    const res = await apiFetch(`/api/brickset-search?${params}`);
    const out = await readSource(res, "brickset");

    if (out.ok) {
      const data = out.data || {};
      return { sets: data.sets || [], total: data.total };
    }
    // Failure — single-sourced with the toast path via classifyFailure.
    if (out.kind === "not_configured") return { sets: [], noKey: true };
    const { surface, message } = classifyFailure(out.kind, out.source);
    // broke kinds → inline message; quiet kinds (e.g. not_found) → empty "no results" state.
    return surface ? { sets: [], error: message } : { sets: [] };
  } catch {
    // pre-response throw (offline/reject) — a broke signal, rendered inline.
    return { sets: [], error: classifyFailure("upstream_error", "brickset").message };
  }
}

/**
 * Fetch set data from Brickset, checking localStorage cache first.
 * Cache key format: brickset_{setNumber} inside a single "bricksetSetCache" object.
 * Returns the normalized data object, or null on error / no API key.
 */
export async function fetchBricksetSet(setNumber) {
  if (!setNumber) return null;

  // Skip identifiers Brickset can't serve, BEFORE spending the request. This mirrors the proxy's
  // accept-set exactly (api/brickset-set.js: strip whitespace, append "-1" if no dash, require
  // /^\d{3,8}-\d+$/) — so we only skip what it would 400 on (e.g. the L-prefixed IDs L0002221), never
  // a number it would serve. A malformed-input skip is NOT a fetch failure → return null silently
  // (no signal); the caller gets null → "no data", same as today minus the wasted 400 + console noise.
  const cleanNum = String(setNumber).trim().replace(/\s+/g, "");
  if (!/^\d{3,8}(-\d+)?$/.test(cleanNum)) return null;

  // Cache read via the shared instance (requireValue + 7d TTL reproduce the prior
  // `cached.fetchedAt && cached.data && age < TTL` guard exactly; key stays `brickset_<setNumber>`).
  const cacheKey = bricksetCache.keyOf(setNumber);
  const hit = bricksetCache.peek([setNumber]);
  if (cacheKey in hit) return hit[cacheKey];

  try {
    const res = await apiFetch(`/api/brickset-set?number=${encodeURIComponent(setNumber)}`);
    const out = await readSource(res, "brickset");

    if (!out.ok) {
      // not_found (uncatalogued) + not_configured stay quiet; broke kinds surface
      reportSourceFailure(out);
      return null;
    }

    const data = out.data && out.data.data;
    if (!data) return null;

    cacheBricksetSet(setNumber, data); // write via the shared instance (setItemSafe inside)

    return data;
  } catch (err) {
    reportSourceFailure({ ok: false, kind: "upstream_error", source: "brickset", message: err?.message || "" });
    return null;
  }
}
