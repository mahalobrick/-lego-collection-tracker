const CACHE_KEY = "bricksetSetCache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Fetch set data from Brickset, checking localStorage cache first.
 * Cache key format: brickset_{setNumber} inside a single "bricksetSetCache" object.
 * Returns the normalized data object, or null on error / no API key.
 */
export async function fetchBricksetSet(setNumber) {
  if (!setNumber) return null;

  const cacheKey = `brickset_${setNumber}`;

  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    const cached = cache[cacheKey];

    if (cached && cached.fetchedAt && cached.data) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < CACHE_TTL_MS) {
        return cached.data;
      }
    }
  } catch {
    // ignore cache read errors
  }

  try {
    const res = await fetch(`/api/brickset-set?number=${encodeURIComponent(setNumber)}`);
    const json = await res.json();

    if (json.error === "no_key") {
      // API key not configured — silently return null
      return null;
    }

    if (!res.ok || json.error) {
      return null;
    }

    const data = json.data;
    if (!data) return null;

    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
      cache[`brickset_${setNumber}`] = { fetchedAt: new Date().toISOString(), data };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore cache write errors
    }

    return data;
  } catch {
    return null;
  }
}
