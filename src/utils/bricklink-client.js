// BrickLink client utility
// Uses BrickStore-style session auth (unofficial BrickLink buyer API).
// Access token is stored in localStorage under "blBrickLinkAccessToken".
// Session token is cached under "blSessionToken" as { token, cachedAt }.
// Price guide cache is stored under "blPriceGuideCache" as { [setNumber]: { data, cachedAt } }.

import { apiFetch } from "./apiFetch";
import { setItemSafe } from "./safeStorage";
import { readSource, reportSourceFailure, classifyFailure } from "./readSource";
import { createEntryCache, MS_TS } from "./enrichmentCache";

const SESSION_TTL_MS = 50 * 60 * 1000;        // 50 minutes
const PRICE_GUIDE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const BULK_CACHE_TTL_MS  = 12 * 60 * 60 * 1000; // 12 hours — skip re-fetch in bulk sync
const BULK_BATCH_SIZE    = 3;                    // concurrent requests per batch
const BULK_BATCH_DELAY_MS = 600;                 // ms between batches

// Shared cache instance for blPriceGuideCache (P3.5) — reproduces it byte-for-byte: ms-epoch `cachedAt`
// (MS_TS), `-1` de-variant keyFn (both paths normalize identically), `data` value field. DUAL TTL: the
// instance default is the 6h single-fetch window; the bulk path passes 12h per-call against the SAME
// stored cachedAt. requireValue stays FALSE (default) to match the bulk filter, which checks only
// cachedAt age; the single-fetch path re-adds its `&& entry.data` presence guard at the call site.
// blPriceGuideCache is in SYNC_SKIP_KEYS — the byte-identical key preserves that (no auto-push).
const priceGuideCache = createEntryCache({
  key: "blPriceGuideCache",
  ttlMs: PRICE_GUIDE_TTL_MS,
  valueField: "data",
  tsField: "cachedAt",
  ts: MS_TS,
  keyFn: (n) => String(n).replace(/-1$/, ""),
});

/** Drop the in-memory + localStorage price-guide cache. Used by disconnectBrickLink so a disconnect
 *  clears the cache AND the shared instance's memo (else the memo would survive the removeItem and a
 *  later lookup could hit a stale entry). clear() writes "{}" — read-equivalent to a removeItem. */
export function clearPriceGuideCache() {
  priceGuideCache.clear();
}

// ── Storage helpers ──────────────────────────────────────────

export function getBrickLinkAccessToken() {
  try {
    return localStorage.getItem("blBrickLinkAccessToken") || null;
  } catch {
    return null;
  }
}

export function hasBrickLinkAuth() {
  const token = getBrickLinkAccessToken();
  return !!token && token.trim().length > 0;
}

// ── Session token ────────────────────────────────────────────

export async function getBrickLinkSession() {
  const accessToken = getBrickLinkAccessToken();
  if (!accessToken) return null;

  // Check cache
  try {
    const cached = JSON.parse(localStorage.getItem("blSessionToken") || "null");
    if (cached && cached.token && cached.cachedAt) {
      const age = Date.now() - cached.cachedAt;
      if (age < SESSION_TTL_MS) {
        return cached.token;
      }
    }
  } catch { /* ignore parse errors */ }

  // Exchange access token for session token
  try {
    const res = await apiFetch("/api/bricklink-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken })
    });

    const out = await readSource(res, "bricklink");
    if (!out.ok) {
      reportSourceFailure(out);
      return null;
    }

    const data = out.data;
    if (!data || !data.sessionToken) {
      console.warn("[BrickLink] No sessionToken in auth response");
      return null;
    }

    setItemSafe("blSessionToken", JSON.stringify({
      token: data.sessionToken,
      cachedAt: Date.now()
    }));

    return data.sessionToken;
  } catch (err) {
    reportSourceFailure({ ok: false, kind: "upstream_error", source: "bricklink", message: err?.message || "" });
    return null;
  }
}

// ── Price guide ──────────────────────────────────────────────

export async function fetchBrickLinkPriceGuide(setNumber, { report = true, onFailure } = {}) {
  if (!setNumber) return null;

  // Normalize to no-suffix form as the cache key (e.g. "75192" not "75192-1")
  const normalizedNumber = String(setNumber).replace(/-1$/, "");

  // Cache read via the shared instance — 6h single-fetch TTL against ms-epoch `cachedAt`. The
  // `&& hit[key]` reproduces the prior `&& entry.data` presence guard (instance requireValue:false
  // keeps the bulk path's no-data-check semantics; the single path layers the data guard here).
  const cacheKey = priceGuideCache.keyOf(setNumber);
  const hit = priceGuideCache.peek([setNumber], { ttlMs: PRICE_GUIDE_TTL_MS });
  if (cacheKey in hit && hit[cacheKey]) return hit[cacheKey];

  // Get session token
  const sessionToken = await getBrickLinkSession();
  if (!sessionToken) return null;

  try {
    const res = await apiFetch(
      `/api/bricklink-priceguide?number=${encodeURIComponent(normalizedNumber)}`,
      {
        headers: { "x-bl-session-token": sessionToken }
      }
    );

    const out = await readSource(res, "bricklink");
    if (!out.ok) {
      if (report) reportSourceFailure(out);
      onFailure?.(out);
      return null;
    }

    const data = out.data;

    // Cache the result under the normalized key via the shared instance ({ data, cachedAt: now }).
    priceGuideCache.put(setNumber, data);

    return data;
  } catch (err) {
    const failure = { ok: false, kind: "upstream_error", source: "bricklink", message: err?.message || "" };
    if (report) reportSourceFailure(failure);
    onFailure?.(failure);
    return null;
  }
}

// ── Bulk price sync ──────────────────────────────────────────
// Fetches BL sold prices (US/North America) for every set in the collection.
// Skips sets whose cache entry is < BULK_CACHE_TTL_MS old.
// onProgress({ done, total, setNumber }) is called after each set.
// Returns { synced, skipped, failed }.

export async function bulkSyncPrices(setNumbers, onProgress) {
  if (!setNumbers || setNumbers.length === 0) return { synced: 0, skipped: 0, failed: 0, unreachable: 0 };

  // Normalize all set numbers to no-suffix form before cache checks and fetches
  const normalized = [...new Set(setNumbers.map(n => String(n).replace(/-1$/, "")).filter(Boolean))];

  // Bulk freshness via the shared instance — 12h TTL against the SAME ms-epoch `cachedAt` (the
  // dual-TTL twin of the single-fetch 6h path). requireValue:false matches the prior bulk filter,
  // which checks only cachedAt age (no data-presence guard). `normalized` is already de-varianted.
  const toFetch = priceGuideCache.staleKeys(normalized, { ttlMs: BULK_CACHE_TTL_MS });
  const skipped = normalized.length - toFetch.length;

  let synced = 0;
  let failed = 0;
  let unreachable = 0; // subset of `failed` that was a "broke" signal (timeout/upstream), not "absent"
  let done = skipped; // already-cached count toward progress

  for (let i = 0; i < toFetch.length; i += BULK_BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BULK_BATCH_SIZE);
    await Promise.all(batch.map(async setNumber => {
      // bulk: per-item toasts suppressed (report:false); tally "unreachable" for the aggregate toast.
      const result = await fetchBrickLinkPriceGuide(setNumber, {
        report: false,
        onFailure: (f) => { if (classifyFailure(f.kind, f.source).surface) unreachable++; },
      });
      if (result !== null) {
        synced++;
      } else {
        failed++;
      }
      done++;
      onProgress?.({ done, total: normalized.length, setNumber });
    }));
    if (i + BULK_BATCH_SIZE < toFetch.length) {
      await new Promise(r => setTimeout(r, BULK_BATCH_DELAY_MS));
    }
  }

  return { synced, skipped, failed, unreachable };
}
