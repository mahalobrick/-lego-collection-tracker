// BrickLink client utility
// Uses BrickStore-style session auth (unofficial BrickLink buyer API).
// Access token is stored in localStorage under "blBrickLinkAccessToken".
// Session token is cached under "blSessionToken" as { token, cachedAt }.
// Price guide cache is stored under "blPriceGuideCache" as { [setNumber]: { data, cachedAt } }.

const SESSION_TTL_MS = 50 * 60 * 1000;        // 50 minutes
const PRICE_GUIDE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const BULK_CACHE_TTL_MS  = 12 * 60 * 60 * 1000; // 12 hours — skip re-fetch in bulk sync
const BULK_BATCH_SIZE    = 3;                    // concurrent requests per batch
const BULK_BATCH_DELAY_MS = 600;                 // ms between batches

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
    const res = await fetch("/api/bricklink-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken })
    });

    if (!res.ok) {
      console.warn("[BrickLink] Auth failed:", res.status, await res.text().catch(() => ""));
      return null;
    }

    const data = await res.json();
    if (!data.sessionToken) {
      console.warn("[BrickLink] No sessionToken in auth response");
      return null;
    }

    localStorage.setItem("blSessionToken", JSON.stringify({
      token: data.sessionToken,
      cachedAt: Date.now()
    }));

    return data.sessionToken;
  } catch (err) {
    console.warn("[BrickLink] Auth error:", err.message);
    return null;
  }
}

// ── Price guide ──────────────────────────────────────────────

export async function fetchBrickLinkPriceGuide(setNumber) {
  if (!setNumber) return null;

  // Normalize to no-suffix form as the cache key (e.g. "75192" not "75192-1")
  const normalizedNumber = String(setNumber).replace(/-1$/, "");
  const cacheKey = "blPriceGuideCache";

  // Check cache (keyed by normalized no-suffix number)
  try {
    const cache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    const entry = cache[normalizedNumber];
    if (entry && entry.data && entry.cachedAt) {
      const age = Date.now() - entry.cachedAt;
      if (age < PRICE_GUIDE_TTL_MS) {
        return entry.data;
      }
    }
  } catch { /* ignore */ }

  // Get session token
  const sessionToken = await getBrickLinkSession();
  if (!sessionToken) return null;

  try {
    const res = await fetch(
      `/api/bricklink-priceguide?number=${encodeURIComponent(normalizedNumber)}`,
      {
        headers: { "x-bl-session-token": sessionToken }
      }
    );

    if (!res.ok) {
      console.warn("[BrickLink] Price guide fetch failed:", res.status);
      return null;
    }

    const data = await res.json();

    // Don't cache fallback HTML responses — they contain no price data
    if (data && data.format === "html") return null;

    // Cache the result under the normalized key
    try {
      const cache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
      cache[normalizedNumber] = { data, cachedAt: Date.now() };
      localStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch { /* ignore cache write errors */ }

    return data;
  } catch (err) {
    console.warn("[BrickLink] Price guide error:", err.message);
    return null;
  }
}

// ── Bulk price sync ──────────────────────────────────────────
// Fetches BL sold prices (US/North America) for every set in the collection.
// Skips sets whose cache entry is < BULK_CACHE_TTL_MS old.
// onProgress({ done, total, setNumber }) is called after each set.
// Returns { synced, skipped, failed }.

export async function bulkSyncPrices(setNumbers, onProgress) {
  if (!setNumbers || setNumbers.length === 0) return { synced: 0, skipped: 0, failed: 0 };

  // Normalize all set numbers to no-suffix form before cache checks and fetches
  const normalized = [...new Set(setNumbers.map(n => String(n).replace(/-1$/, "")).filter(Boolean))];

  const cacheKey = "blPriceGuideCache";
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(cacheKey) || "{}"); } catch {}

  const now = Date.now();
  const toFetch = normalized.filter(n => {
    const entry = cache[n];
    return !entry || !entry.cachedAt || (now - entry.cachedAt) >= BULK_CACHE_TTL_MS;
  });
  const skipped = normalized.length - toFetch.length;

  let synced = 0;
  let failed = 0;
  let done = skipped; // already-cached count toward progress

  for (let i = 0; i < toFetch.length; i += BULK_BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BULK_BATCH_SIZE);
    await Promise.all(batch.map(async setNumber => {
      const result = await fetchBrickLinkPriceGuide(setNumber);
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

  return { synced, skipped, failed };
}
