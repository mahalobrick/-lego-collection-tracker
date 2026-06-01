import { apiFetch } from "./apiFetch";
import { setItemSafe } from "./safeStorage";
import { readSource, reportSourceFailure, classifyFailure } from "./readSource";

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
    const out = await readSource(res, "brickset");

    if (!out.ok) {
      // not_found (uncatalogued) + not_configured stay quiet; broke kinds surface
      reportSourceFailure(out);
      return null;
    }

    const data = out.data && out.data.data;
    if (!data) return null;

    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
      cache[`brickset_${setNumber}`] = { fetchedAt: new Date().toISOString(), data };
      setItemSafe(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore cache write errors
    }

    return data;
  } catch (err) {
    reportSourceFailure({ ok: false, kind: "upstream_error", source: "brickset", message: err?.message || "" });
    return null;
  }
}
