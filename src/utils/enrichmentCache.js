/**
 * enrichmentCache — a generalization of valueCache.js into ONE reusable per-entry cache factory.
 *
 * STATUS: INERT (P3.1). Nothing in the app routes through this yet — only its own unit tests
 * import it. The migrations that point blValueCache / bricksetSetCache / brickEconomySetCache /
 * blPriceGuideCache at this module are P3.2–P3.5, each behind the P3.0 characterization net.
 *
 * It replicates valueCache.js exactly — a session memo `Map` + a localStorage mirror + a TTL
 * freshness check + a synchronous `peek` warm-seed + a `readSource`-funnelled batch read-through +
 * write-side shape validation — and generalizes it over the 6 catalogued divergences (docs/
 * enrichment-p3-plan.md §2) so all four per-entry caches map onto one shape:
 *
 *   • timestamp FORMAT — ms-epoch (blValueCache, blPriceGuideCache) vs ISO string (brickset, BE)
 *       → `ts.parse(raw)→ms` / `ts.write(ms)→raw`; presets {@link MS_TS} / {@link ISO_TS}.
 *   • timestamp FIELD  — `fetchedAt` everywhere except blPriceGuideCache (`cachedAt`)  → `tsField`.
 *   • value FIELD      — `record` (value) vs `data` (the rest)                          → `valueField`.
 *   • KEY namespacing  — brickset's `brickset_<n>`, the BE/priceguide `-1` de-variant, and
 *                        blValueCache's trim-only                                        → `keyFn`.
 *   • per-call TTL      — blPriceGuideCache's 6h single / 12h bulk against one stored ts → `{ttlMs}`.
 *   • value VALIDATION — a malformed response must coerce to a safe value, not poison    → `validate`.
 *
 * MEMO/STORE COHERENCE (matched to valueCache EXACTLY — the net's blind spot):
 *   - lookup is `memo.get(k) || store[k]` — the memo shadows the localStorage mirror.
 *   - a write updates BOTH memo and store, then mirrors via `setItemSafe`.
 *   - `clear()` wipes BOTH the memo and the mirror.
 *   - freshness is TIMESTAMP-only (a cached `null`/falsy value is still a valid fresh entry, exactly
 *     as valueCache treats a cached `null` record). Per-cache value-PRESENCE guards (e.g. brickset's
 *     `cached.data &&`) layer on at their own migration; this factory does not bake one in.
 *
 * STRICT LEAF: imports ONLY safeStorage + readSource. It must NEVER import value/portfolio/percopy/
 * valueDisplay or any surface, and nothing imports it back — keeping it out of the G4 percopy↔
 * portfolio cycle class. All writes go through `setItemSafe` (DATA-4); no raw localStorage.setItem.
 *
 * NOTE: createBlobCache (the single-blob caches — bricksetThemesCache / legoLastChanceCache /
 * blBFRetirementCache) is a documented extension point, NOT built here (deferred past P3, and
 * "no unused code now"). A blob cache would be one stored `{…, <tsField>}` object with one TTL —
 * the same `ts`/`tsField` machinery, minus the per-entry keyFn/map.
 */

import { setItemSafe } from "./safeStorage";
import { readSource, reportSourceFailure } from "./readSource";

// ── Timestamp presets ─────────────────────────────────────────────────────────
// parse: stored value → ms-epoch (NaN if the wrong type, so isFresh treats it as not-fresh —
// this mirrors valueCache's `typeof entry.fetchedAt === "number"` guard). write: ms-epoch → stored.
export const MS_TS = {
  parse: (v) => (typeof v === "number" ? v : NaN),
  write: (ms) => ms,
};
export const ISO_TS = {
  parse: (v) => (typeof v === "string" ? new Date(v).getTime() : NaN),
  write: (ms) => new Date(ms).toISOString(),
};

const uniq = (arr) => [...new Set(arr)];
const identity = (x) => x;
const trimKey = (n) => String(n).trim();

/**
 * Create a per-entry enrichment cache instance.
 *
 * @param {Object} cfg
 * @param {string}   cfg.key                     localStorage key (the whole map lives under it).
 * @param {number}   cfg.ttlMs                   default freshness window (ms).
 * @param {string}   [cfg.valueField="data"]     entry field holding the cached value ("record"/"data").
 * @param {string}   [cfg.tsField="fetchedAt"]   entry field holding the timestamp ("fetchedAt"/"cachedAt").
 * @param {{parse:(v:any)=>number, write:(ms:number)=>any}} [cfg.ts=ISO_TS]  timestamp codec (MS_TS/ISO_TS).
 * @param {(id:any)=>string} [cfg.keyFn]         requested id → storage key (namespacing/de-variant; default trim).
 * @param {(raw:any)=>any}   [cfg.validate]      write-side value guard (default identity).
 * @param {boolean} [cfg.requireValue=false]     when true, freshness ALSO requires a truthy value field —
 *        reproduces a cache whose own read guard is `entry.<ts> && entry.<value>` (e.g. bricksetSetCache's
 *        `cached.fetchedAt && cached.data`). Default false = valueCache semantics (a cached null/falsy
 *        value is still a valid fresh entry).
 * @returns {{peek, staleKeys, getRaw, saveRaw, put, putMany, readThrough, clear, keyOf}}
 *
 * All read/write methods operate in STORAGE-KEY space (keyFn-applied); `peek`/`staleKeys`/
 * `readThrough` accept raw ids and apply keyFn internally, returning STORAGE-KEY-keyed maps — which,
 * for the trim-only keyFn, is byte-for-byte what valueCache returns today.
 */
export function createEntryCache({
  key,
  ttlMs,
  valueField = "data",
  tsField = "fetchedAt",
  ts = ISO_TS,
  keyFn = trimKey,
  validate = identity,
  requireValue = false,
}) {
  if (!key) throw new Error("createEntryCache: `key` is required");
  if (!(ttlMs > 0)) throw new Error("createEntryCache: `ttlMs` must be a positive number");

  // storageKey -> { [valueField], [tsField] } — session memo, mirrored to localStorage.
  const memo = new Map();

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; }
  }
  function saveStore(store) {
    try { setItemSafe(key, JSON.stringify(store)); } catch { /* quota — non-fatal, mirrors valueCache */ }
  }
  function isFresh(entry, ttl) {
    if (!entry) return false;
    if (requireValue && !entry[valueField]) return false; // value-presence guard (e.g. brickset's `&& data`)
    const ms = ts.parse(entry[tsField]);
    return Number.isFinite(ms) && (Date.now() - ms) < ttl;
  }
  // Build an entry stamped now, with the value run through validate (a poison-resistant write).
  function makeEntry(value, nowMs) {
    return { [valueField]: validate(value), [tsField]: ts.write(nowMs) };
  }

  /** The storage key for a requested id (keyFn-applied). */
  function keyOf(id) { return keyFn(id); }

  /** De-duped storage keys for a set of requested ids (empty keys dropped, mirroring valueCache). */
  function wantKeys(ids) {
    return uniq((ids || []).map(keyFn).filter(Boolean));
  }

  /**
   * SYNCHRONOUS warm-seed: fresh (non-expired) entries only, no I/O. Returns a storage-key→value map
   * of just the requested ids that are present AND fresh. Generalizes peekValueCache.
   */
  function peek(ids, { ttlMs: ttlOverride = ttlMs } = {}) {
    const store = loadStore();
    const out = {};
    for (const k of wantKeys(ids)) {
      const entry = memo.get(k) || store[k];
      if (isFresh(entry, ttlOverride)) out[k] = entry[valueField];
    }
    return out;
  }

  /** Storage keys that need a refresh: not fresh under the (optional) ttl, or all of them if `force`. */
  function staleKeys(ids, { ttlMs: ttlOverride = ttlMs, force = false } = {}) {
    const store = loadStore();
    const need = [];
    for (const k of wantKeys(ids)) {
      const entry = memo.get(k) || store[k];
      if (force || !isFresh(entry, ttlOverride)) need.push(k);
    }
    return need;
  }

  /** The raw localStorage map under `key` (for callers that walk the whole cache, e.g. retail resolvers). */
  function getRaw() { return loadStore(); }

  /**
   * Write a whole entry-map verbatim (the load-whole / mutate-many / save-once pattern — e.g.
   * brickEconomySetCache's batch sync, which stamps each entry's own `fetchedAt` in its fetch loop and
   * persists once at the end). Byte-identical to `setItemSafe(key, JSON.stringify(map))`; entries are
   * NOT re-stamped or re-validated (the caller owns the entry shape). Reconciles the memo to match the
   * written map so a later peek/getFresh stays coherent. Pairs with {@link getRaw}.
   */
  function saveRaw(map) {
    const obj = map || {};
    saveStore(obj);
    memo.clear();
    for (const k of Object.keys(obj)) memo.set(k, obj[k]);
  }

  /** Write one value for a requested id; stamps `tsField` now. Returns the stored (validated) value. */
  function put(id, value, { now = Date.now() } = {}) {
    const k = keyFn(id);
    const store = loadStore();
    const entry = makeEntry(value, now);
    memo.set(k, entry);
    store[k] = entry;
    saveStore(store);
    return entry[valueField];
  }

  /**
   * Batch write. `entries` is a requested-id→value map (or storage-key→value — keyFn is applied
   * either way). One saveStore at the end, like valueCache's single saveStore per fetch.
   */
  function putMany(entries, { now = Date.now() } = {}) {
    const store = loadStore();
    for (const id of Object.keys(entries || {})) {
      const k = keyFn(id);
      const entry = makeEntry(entries[id], now);
      memo.set(k, entry);
      store[k] = entry;
    }
    saveStore(store);
  }

  /**
   * The valueCache batch-funnel, generalized. Seeds from fresh cache; fetches the stale keys via the
   * caller-supplied `fetch(needKeys) → Promise<Response>`; routes the Response through `readSource`
   * (never a silent throw — `reportSourceFailure` on a broke/pre-response failure, then serves
   * whatever was cached); validates + writes back; returns a storage-key→value map for the requested
   * ids. The fetch RESPONSE must be a `{ [storageKey]: rawValue }` batch map (the /api/values shape).
   *
   * @param {any[]} ids
   * @param {Object} o
   * @param {(needKeys:string[]) => Promise<Response>} o.fetch  builds + sends the batch request.
   * @param {string} o.source   readSource enum token (e.g. "bricklink").
   * @param {boolean} [o.force]  bypass freshness.
   * @param {number}  [o.ttlMs]  per-call freshness window override.
   */
  async function readThrough(ids, { fetch, source, force = false, ttlMs: ttlOverride = ttlMs }) {
    const keys = wantKeys(ids);
    if (keys.length === 0) return {};

    const store = loadStore();
    const result = {};
    const need = [];
    for (const k of keys) {
      const entry = memo.get(k) || store[k];
      if (!force && isFresh(entry, ttlOverride)) result[k] = entry[valueField];
      else need.push(k);
    }
    if (need.length === 0) return result;

    let map = null;
    try {
      const res = await fetch(need);
      const out = await readSource(res, source);
      if (!out.ok) {
        reportSourceFailure(out);  // surfaces broke kinds; quiet for not_found/not_configured
        return result;             // serve whatever was already cached
      }
      map = out.data;
    } catch {
      reportSourceFailure({ ok: false, kind: "upstream_error", source });
      return result;
    }
    if (!map || typeof map !== "object") return result;

    const now = Date.now();
    for (const k of need) {
      const raw = Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
      const entry = makeEntry(raw, now);  // validate runs inside makeEntry
      memo.set(k, entry);
      store[k] = entry;
      result[k] = entry[valueField];
    }
    saveStore(store);
    return result;
  }

  /** Drop the in-memory memo + the localStorage mirror (tests / manual refresh). Mirrors clearValueCache. */
  function clear() {
    memo.clear();
    try { setItemSafe(key, "{}"); } catch { /* ignore */ }
  }

  return { peek, staleKeys, getRaw, saveRaw, put, putMany, readThrough, clear, keyOf };
}
