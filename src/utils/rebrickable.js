/**
 * Rebrickable local dataset utility
 * Lazy-loads /public/sets.csv and /public/themes.csv (shipped with the app).
 * Parses once per session, cached in module-level maps.
 * Source: rebrickable.com/downloads — updated periodically.
 */
import Papa from "papaparse";

let setsMap = null;    // { "75192" → { name, year, themeId, numParts, imgUrl } }
let themesMap = null;  // { "18" → "Star Wars" }
let loading = null;    // in-flight promise — prevents duplicate fetches

/**
 * Load both CSVs. Safe to call multiple times — resolves immediately if already loaded.
 */
export function loadRebrickable() {
  if (setsMap && themesMap) return Promise.resolve();
  if (loading) return loading;

  loading = Promise.all([
    fetchCSV("/sets.csv"),
    fetchCSV("/themes.csv"),
  ]).then(([setsRows, themesRows]) => {
    // Build themes map: id → resolved display name (follows parent chain once)
    const rawThemes = {};
    for (const row of themesRows) {
      rawThemes[row.id] = row;
    }
    themesMap = {};
    for (const [id, row] of Object.entries(rawThemes)) {
      if (row.parent_id && rawThemes[row.parent_id]) {
        themesMap[id] = `${rawThemes[row.parent_id].name} › ${row.name}`;
      } else {
        themesMap[id] = row.name;
      }
    }

    // Build sets map: normalized set_num (no trailing -1) → metadata
    setsMap = {};
    for (const row of setsRows) {
      const key = normalizeSetNum(row.set_num);
      setsMap[key] = {
        name:     row.name,
        year:     Number(row.year) || null,
        themeId:  row.theme_id,
        theme:    themesMap[row.theme_id] || "",
        numParts: Number(row.num_parts) || null,
        imgUrl:   row.img_url || "",
      };
    }
    loading = null;
  });

  return loading;
}

/**
 * Look up a set by number. Returns null if not found or data not loaded.
 * Accepts "75192", "75192-1", or "075192".
 */
export function rbLookupSet(setNum) {
  if (!setsMap) return null;
  return setsMap[normalizeSetNum(setNum)] ?? null;
}

/**
 * Resolve a theme_id to a display name.
 */
export function rbThemeName(themeId) {
  return themesMap?.[themeId] ?? "";
}

/**
 * True if the Rebrickable data is ready to query.
 */
export function rbReady() {
  return setsMap !== null && themesMap !== null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeSetNum(raw) {
  return String(raw || "")
    .trim()
    .replace(/-1$/, "")    // strip trailing -1
    .replace(/^0+(\d)/, "$1"); // strip leading zeros
}

function fetchCSV(path) {
  return new Promise((resolve, reject) => {
    Papa.parse(path, {
      download: true,
      header: true,
      skipEmptyLines: true,
      worker: false,
      complete: ({ data }) => resolve(data),
      error: reject,
    });
  });
}
