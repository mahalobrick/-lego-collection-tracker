/**
 * Client-side utility for LEGO "Last Chance to Buy" data.
 *
 * Fetches /api/lego-last-chance (CDN-cached 24hr) and caches in
 * localStorage for 23 hours so repeat page loads skip the network call.
 *
 * Usage:
 *   const codes = await getLastChanceCodes();
 *   const isLC  = isLastChanceSet("75192", codes);
 */

import { apiFetch } from "./apiFetch";
import { setItemSafe } from "./safeStorage";
import { readSource, reportSourceFailure } from "./readSource";

const LS_KEY   = "legoLastChanceCache";
const TTL_MS   = 23 * 60 * 60 * 1000; // 23 hours (just under CDN's 24hr)

/**
 * Returns Set of productCodes currently on LEGO's Last Chance page.
 * Reads localStorage first; fetches fresh if stale or missing.
 */
export async function getLastChanceCodes() {
  // Check cache
  try {
    const cached = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (cached && cached.fetchedAt && cached.setCodes) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < TTL_MS) {
        return new Set(cached.setCodes);
      }
    }
  } catch { /* ignore */ }

  // Fetch fresh
  try {
    const res  = await apiFetch("/api/lego-last-chance");
    const out  = await readSource(res, "lego");
    if (!out.ok) {
      reportSourceFailure(out);
      return new Set();
    }
    const json = out.data;
    if (!json || !json.setCodes) return new Set();

    // Persist to localStorage
    try {
      setItemSafe(
        LS_KEY,
        JSON.stringify({ fetchedAt: json.fetchedAt, setCodes: json.setCodes })
      );
    } catch { /* storage full — skip */ }

    return new Set(json.setCodes);
  } catch (err) {
    reportSourceFailure({ ok: false, kind: "upstream_error", source: "lego", message: err?.message || "" });
    return new Set();
  }
}

/**
 * Returns true if the given set number appears on the Last Chance list.
 * Handles both "75192" and "75192-1" formats.
 */
export function isLastChanceSet(setNumber, codes) {
  if (!setNumber || !codes || codes.size === 0) return false;
  const clean = String(setNumber).replace(/-1$/, "").trim();
  return codes.has(clean) || codes.has(`${clean}-1`);
}

/**
 * Returns the cached Last Chance codes synchronously (or empty set if not cached).
 * Useful for rendering without waiting for async.
 */
export function getCachedLastChanceCodes() {
  try {
    const cached = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (cached && cached.setCodes) return new Set(cached.setCodes);
  } catch { /* ignore */ }
  return new Set();
}
