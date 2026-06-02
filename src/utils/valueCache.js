/**
 * valueCache — client read of the BrickLink value cache (/api/values).
 *
 * Step 1 of the app-read (docs/integration-standard.md): fetch basis-tagged value records for
 * a batch of owned set numbers and return them as a map. NOTHING in the funnel/display consumes
 * this yet — Step 2 wires the records into setValueProvenance / formatValueCell.
 *
 * Contract (per the proxy): { [setNumber]: { new: {amount,basis,lots,asOf}|null, used: {…}|null } | null }
 * — null for a set with no cached value (e.g. a deferred CMF). `source` is implied "BrickLink".
 *
 * Caching (§3): device-local only. The in-memory memo de-dupes within a session; a short-TTL
 * localStorage mirror survives reloads. This key is REGENERATABLE and MUST stay out of
 * BACKUP_KEYS (it is never synced). The batch refresh runs ~weekly, so a 24h client TTL is safe.
 *
 * Failures route through the readSource funnel (a deduped "couldn't reach BrickLink" signal for
 * broke kinds; quiet for not_found/not_configured) — never a silent throw. On failure we return
 * whatever is already cached rather than nothing.
 */

import { apiFetch } from "./apiFetch";
import { setItemSafe } from "./safeStorage";
import { readSource, reportSourceFailure } from "./readSource";

const CACHE_KEY = "blValueCache"; // device-local, NOT in BACKUP_KEYS
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h client cache; server refreshes ~weekly
const SOURCE = "bricklink";

// number -> { record, fetchedAt } — session memo, mirrored to localStorage.
const memo = new Map();

function loadStore() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {}; } catch { return {}; }
}
function saveStore(store) {
  try { setItemSafe(CACHE_KEY, JSON.stringify(store)); } catch { /* quota — non-fatal */ }
}
function isFresh(entry) {
  return !!entry && typeof entry.fetchedAt === "number" && (Date.now() - entry.fetchedAt) < CACHE_TTL_MS;
}

// ── Shape validation — a malformed response must not poison the cache ─────────
function isCondition(c) {
  if (c === null) return true;
  if (!c || typeof c !== "object") return false;
  const amountOk = c.amount === null || typeof c.amount === "number";
  const basisOk = c.basis === null || typeof c.basis === "string";
  return amountOk && basisOk;
}
function isRecord(r) {
  if (r === null) return true;
  if (!r || typeof r !== "object") return false;
  return isCondition(r.new) && isCondition(r.used);
}

/**
 * Fetch value records for the given owned set numbers.
 * @param {string[]} setNumbers
 * @param {{force?: boolean}} [opts]  force=true bypasses the client cache for a fresh read.
 * @returns {Promise<Object<string, ({new, used}|null)>>}  map keyed by the requested set number.
 */
export async function fetchValues(setNumbers, { force = false } = {}) {
  const want = [...new Set((setNumbers || []).map((n) => String(n).trim()).filter(Boolean))];
  if (want.length === 0) return {};

  const store = loadStore();
  const result = {};
  const need = [];
  for (const num of want) {
    const entry = memo.get(num) || store[num];
    if (!force && isFresh(entry)) result[num] = entry.record;
    else need.push(num);
  }
  if (need.length === 0) return result;

  let map = null;
  try {
    const res = await apiFetch("/api/values", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setNumbers: need }),
    });
    const out = await readSource(res, SOURCE);
    if (!out.ok) {
      reportSourceFailure(out); // surfaces broke kinds; quiet for not_found/not_configured
      return result;            // serve whatever was already cached
    }
    map = out.data;
  } catch {
    // Pre-response throw (offline / reject) — a "broke" signal, deduped by the funnel.
    reportSourceFailure({ ok: false, kind: "upstream_error", source: SOURCE });
    return result;
  }

  if (!map || typeof map !== "object") return result;

  const now = Date.now();
  for (const num of need) {
    const raw = Object.prototype.hasOwnProperty.call(map, num) ? map[num] : null;
    const record = isRecord(raw) ? raw : null;
    const entry = { record, fetchedAt: now };
    memo.set(num, entry);
    store[num] = entry;
    result[num] = record;
  }
  saveStore(store);
  return result;
}

/** Drop the in-memory + localStorage value cache (used by tests / a manual refresh). */
export function clearValueCache() {
  memo.clear();
  try { setItemSafe(CACHE_KEY, "{}"); } catch { /* ignore */ }
}
