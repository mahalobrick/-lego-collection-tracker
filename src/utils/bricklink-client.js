// BrickLink client utility
// Uses BrickStore-style session auth (unofficial BrickLink buyer API).
// Access token is stored in localStorage under "blBrickLinkAccessToken".
// Session token is cached under "blSessionToken" as { token, cachedAt }.
// Price guide cache is stored under "blPriceGuideCache" as { [setNumber]: { data, cachedAt } }.

const SESSION_TTL_MS = 50 * 60 * 1000;   // 50 minutes
const PRICE_GUIDE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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

  const cacheKey = "blPriceGuideCache";

  // Check cache
  try {
    const cache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    const entry = cache[setNumber];
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
      `/api/bricklink-priceguide?number=${encodeURIComponent(setNumber)}`,
      {
        headers: { "x-bl-session-token": sessionToken }
      }
    );

    if (!res.ok) {
      console.warn("[BrickLink] Price guide fetch failed:", res.status);
      return null;
    }

    const data = await res.json();

    // Cache the result
    try {
      const cache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
      cache[setNumber] = { data, cachedAt: Date.now() };
      localStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch { /* ignore cache write errors */ }

    return data;
  } catch (err) {
    console.warn("[BrickLink] Price guide error:", err.message);
    return null;
  }
}
