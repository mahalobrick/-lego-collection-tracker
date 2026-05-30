import { apiFetch } from "./apiFetch";
import { setItemSafe } from "./safeStorage";

const CACHE_KEY = "bricksetSetCache";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const THEMES_CACHE_KEY = "bricksetThemesCache";
const THEMES_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
    if (json.error === "no_key" || !res.ok) return [];
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
    const json = await res.json();
    if (json.error === "no_key") return { sets: [], noKey: true };
    if (!res.ok || json.error) return { sets: [], error: json.message || json.error };
    return { sets: json.sets || [], total: json.total };
  } catch (err) {
    return { sets: [], error: err.message };
  }
}

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
    const res = await apiFetch(`/api/brickset-set?number=${encodeURIComponent(setNumber)}`);
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
      setItemSafe(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore cache write errors
    }

    return data;
  } catch {
    return null;
  }
}
