// Shared full-backup export — called by both AppSettings (manual) and App (auto).
//
// Manual calls (from a button click) get a native Save As dialog in Chrome/Edge
// via showSaveFilePicker. Safari/Firefox and auto-export fall back to the
// browser's default Downloads folder.
//
// Returns the date string (e.g. "2026-05-23") on success, or null if the user
// cancelled the save dialog.

import { DEFAULT_STORES } from "./storeDefaults";

const DEFAULT_ANNUAL_BUDGET = 10320;

// Fast non-crypto fingerprint — good enough for dirty-check equality (not security).
function quickHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (h * 33 ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ── Auth-based sync (Phase 3) ─────────────────────────────────────────────────
// Used when the user is signed in via Clerk.  No passphrase — the Clerk JWT is
// the security layer.  Data stored as plaintext JSON at /api/sync, keyed by userId.

/**
 * Push current data to /api/sync using a Clerk Bearer token.
 * getToken — async fn from useAuth() that returns the current session JWT.
 */
export async function pushToCloudAuth(getToken) {
  const ownedSets  = localStorage.getItem("blOwnedSets");
  const beNorm     = localStorage.getItem("brickEconomyNormalizedCollection");
  const wantedList = localStorage.getItem("blWantedList");
  const hasAnyData = (ownedSets && ownedSets !== "[]")
                  || (beNorm    && beNorm    !== "[]")
                  || (wantedList && wantedList !== "[]");
  if (!hasAnyData) return { skipped: "no_data" };

  const backup = buildBackup(new Date());
  delete backup.brickEconomySetCache; // large and fully regeneratable

  // Skip if nothing changed since last push
  const contentHash = dedupHash(backup);
  if (contentHash === localStorage.getItem("blLastPushHash")) return { skipped: "no_change" };

  const token = await getToken();
  if (!token) return null;

  const res = await fetch("/api/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(backup),
  });
  if (res.status === 503) return null;
  if (!res.ok) throw new Error(`Sync failed: HTTP ${res.status}`);
  const json = await res.json();
  localStorage.setItem("blLastCloudPush", json.savedAt || new Date().toISOString());
  localStorage.setItem("blLastPushHash", contentHash);
  return json;
}

// ── Sync reconciliation helpers (Phase 4) ────────────────────────────────────

// Canonical dedup fingerprint of a backup — excludes the timestamp (changes every
// build) and the regeneratable set cache (stripped before push, absent in cloud copy)
// so a freshly-built local backup and a pulled cloud backup hash identically when
// their actual data matches.
function dedupHash(backup) {
  const { exportedAt: _ts, brickEconomySetCache: _c, ...rest } = backup;
  return quickHash(JSON.stringify(rest));
}

/** Fingerprint of the CURRENT local data — compare against blLastPushHash to detect unsynced edits. */
export function localContentHash() {
  return dedupHash(buildBackup(new Date()));
}

/**
 * Mark local state as in-sync with a given backup: records its hash + timestamp + owning user
 * so the next auto-push correctly skips (no redundant re-push of just-pulled data).
 */
export function markSynced(backup, userId) {
  localStorage.setItem("blLastPushHash", dedupHash(backup));
  localStorage.setItem("blLastCloudPush", backup.exportedAt || new Date().toISOString());
  if (userId) localStorage.setItem("blSyncedUserId", userId);
}

function countList(raw) {
  try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.length : 0; } catch { return 0; }
}

/** Rough item counts of the CURRENT local data — for the conflict dialog. */
export function summarizeLocal() {
  return {
    sets:      countList(localStorage.getItem("blOwnedSets")) + countList(localStorage.getItem("brickEconomyNormalizedCollection")),
    wanted:    countList(localStorage.getItem("blWantedList")),
    purchases: countList(localStorage.getItem("blPurchases")),
  };
}

// ── Canonical backup key registry (the ONE shared list) ──────────────────────
// The single source of truth for "the user's data keys": the census, overwrite (apply),
// build, push-guard and dedup-hash all DERIVE from this list so they can never drift
// apart again (SYNC-CRIT-1 / A4 / A11). Per entry:
//   key      — the localStorage key
//   field    — its property name in the backup object (under `settings` when settings:true)
//   kind     — "array" | "object" | "scalar"; drives the build default + apply guard
//   census   — counted by hasAnyLocalData() to decide if a device is genuinely "fresh"
//              (safe to silently pull cloud) vs holds unsynced data a pull would destroy
//   default  — value that does NOT count as user data (defaults-aware census)
//   settings — true when the field lives under backup.settings.*
// The 6 census:false keys are default-written on mount from component-inline view config;
// completing their census is deferred to Step 5 (see docs/audit-action-plan.md).
//
// Intentionally EXCLUDED from the sync registry (touched by the round-trip but not synced):
//   • brickEconomySetCache — regeneratable BrickEconomy cache; deleted before push, restored
//     only via file-import. Correctly outside the sync round-trip.
//   • blAutoExportDays — device-local preference (which browser auto-downloads); not restored
//     by apply, survives sign-out (SIGNOUT_KEEP_KEYS), excluded from the dedup hash.
export const BACKUP_KEYS = [
  { key: "blOwnedSets",                      field: "ownedSets",              kind: "array",  census: true },
  { key: "brickEconomyNormalizedCollection", field: "brickEconomyNormalized", kind: "array",  census: true },
  { key: "brickEconomyCollectionSyncInfo",   field: "brickEconomySyncInfo",   kind: "object", census: true },
  { key: "blSoldSets",                       field: "soldSets",               kind: "array",  census: true },
  { key: "blPortfolioHistory",               field: "portfolioHistory",       kind: "array",  census: true },
  { key: "blWantedList",                     field: "wantedList",             kind: "array",  census: true },
  { key: "blPurchases",                      field: "budgetPurchases",        kind: "array",  census: true },
  { key: "blStores",                         field: "stores",                 kind: "array",  census: true,  default: DEFAULT_STORES },
  { key: "blStoreBudgets",                   field: "storeBudgets",           kind: "object", census: true },
  { key: "blAnnualBudget",    field: "annualBudget", kind: "scalar", census: true,  default: String(DEFAULT_ANNUAL_BUDGET) },
  { key: "blDisplayCurrency", field: "currency",     kind: "scalar", census: true,  default: "USD", settings: true },
  // Deferred to Step 5 (default-on-mount; defaults are component-inline view config):
  { key: "blOwnedColumns",            field: "ownedColumns",       kind: "array",  census: false, settings: true },
  { key: "blAcquisitionColumns",      field: "acquisitionColumns", kind: "array",  census: false, settings: true },
  { key: "blPurchaseColumns",         field: "purchaseColumns",    kind: "array",  census: false, settings: true },
  { key: "blDashboardWidgetSettings", field: "dashboardWidgets",   kind: "object", census: false, settings: true },
  { key: "blCollectionItems",         field: "collectionItems",    kind: "array",  census: false, settings: true },
  { key: "blOwnedColWidths",          field: "ownedColWidths",     kind: "object", census: false, settings: true },
];

/**
 * True if this device holds any unsynced USER DATA — drives the fresh-device guard in
 * reconcileOnSignIn (SYNC-CRIT-1). Defaults-aware: empty arrays/objects and default-valued
 * scalars/lists do NOT count, so a genuinely fresh device still reads as empty and the
 * legitimate silent cloud pull still happens.
 */
export function hasAnyLocalData() {
  for (const k of BACKUP_KEYS) {
    if (!k.census) continue;
    const raw = localStorage.getItem(k.key);
    if (raw == null) continue;
    if (k.kind === "array") {
      try {
        const v = JSON.parse(raw);
        if (Array.isArray(v) && v.length &&
            (k.default == null || JSON.stringify(v) !== JSON.stringify(k.default))) return true;
      } catch { /* malformed → ignore */ }
      continue;
    }
    if (k.kind === "object") {
      try { if (Object.keys(JSON.parse(raw) || {}).length) return true; } catch { /* ignore */ }
      continue;
    }
    // scalar
    if (k.default != null && raw === k.default) continue;
    if (raw !== "") return true;
  }
  return false;
}

// Device-local preferences that should survive a sign-out (not user content).
const SIGNOUT_KEEP_KEYS = new Set(["blAutoExportDays", "blLastAutoExport"]);

/**
 * Wipe all BrickLedger user data + caches + sync metadata from this device.
 * Called on sign-out / session end so the next person can't see the prior user's
 * collection. Leaves device-local prefs (SIGNOUT_KEEP_KEYS) and — critically —
 * any non-bl/brickEconomy keys (e.g. Clerk's own session keys) untouched.
 */
export function clearLocalUserData() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || SIGNOUT_KEEP_KEYS.has(k)) continue;
    if (k.startsWith("bl") || k.startsWith("brickEconomy") || k.startsWith("brickset")) {
      toRemove.push(k);
    }
  }
  toRemove.forEach(k => localStorage.removeItem(k));
}

/** Rough item counts of a backup object — for the conflict dialog. */
export function summarizeBackup(d) {
  const len = v => (Array.isArray(v) ? v.length : 0);
  return {
    sets:      len(d?.ownedSets) + len(d?.brickEconomyNormalized),
    wanted:    len(d?.wantedList),
    purchases: len(d?.budgetPurchases),
  };
}

/**
 * Fetch this user's backup from /api/sync.
 * Returns the raw backup object (plaintext), or null if nothing stored.
 */
export async function fetchFromCloudAuth(getToken) {
  const token = await getToken();
  if (!token) return null;
  const res = await fetch("/api/sync", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404 || res.status === 503 || res.status === 401) return null;
  if (!res.ok) throw new Error(`Sync fetch failed: HTTP ${res.status}`);
  return await res.json();
}

const BACKUP_VERSION = 2; // increment here whenever the backup schema changes

/** Apply a backup object to localStorage (same logic as the Settings restore). */
export function applyBackupToLocalStorage(data) {
  if (data.version && data.version > BACKUP_VERSION) {
    throw new Error(
      `Backup version ${data.version} is newer than this app supports (v${BACKUP_VERSION}). ` +
      `Update BrickLedger and try again.`
    );
  }
  // Registry-driven so the overwrite set can never drift from the census/build/push-guard.
  // Guards preserved exactly: top-level array → Array.isArray; top-level object → typeof object;
  // nested settings.* → plain truthy (empty []/{} are truthy, so kept); scalar → !=null for the
  // budget (a legit 0 survives) / truthy for currency. Build-only keys (brickEconomySetCache,
  // autoExportDays) aren't in the registry, so they're never restored.
  for (const k of BACKUP_KEYS) {
    const src = k.settings ? data.settings : data;
    if (!src) continue; // backup has no `settings` object → skip the nested keys
    const val = src[k.field];
    if (k.kind === "scalar") {
      if (k.settings ? !!val : val != null) localStorage.setItem(k.key, val);
    } else if (k.settings) {
      if (val) localStorage.setItem(k.key, JSON.stringify(val));
    } else if (k.kind === "array") {
      if (Array.isArray(val)) localStorage.setItem(k.key, JSON.stringify(val));
    } else {
      if (val && typeof val === "object") localStorage.setItem(k.key, JSON.stringify(val));
    }
  }
}

function buildBackup(now) {
  return {
    version: 2,
    app: "BrickLedger",
    exportedAt: now.toISOString(),
    // ── Collection ───────────────────────────────────────────────
    ownedSets:              JSON.parse(localStorage.getItem("blOwnedSets")                      || "[]"),
    brickEconomyNormalized: JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]"),
    brickEconomySetCache:   JSON.parse(localStorage.getItem("brickEconomySetCache")             || "{}"),
    brickEconomySyncInfo:   JSON.parse(localStorage.getItem("brickEconomyCollectionSyncInfo")   || "{}"),
    soldSets:               JSON.parse(localStorage.getItem("blSoldSets")                       || "[]"),  // ← was missing
    portfolioHistory:       JSON.parse(localStorage.getItem("blPortfolioHistory")               || "[]"),  // ← was missing
    // ── Wanted List ──────────────────────────────────────────────
    wantedList: JSON.parse(localStorage.getItem("blWantedList") || "[]"),
    // ── Budget ───────────────────────────────────────────────────
    budgetPurchases: JSON.parse(localStorage.getItem("blPurchases")    || "[]"),
    stores:          JSON.parse(localStorage.getItem("blStores")        || "[]"),
    storeBudgets:    JSON.parse(localStorage.getItem("blStoreBudgets")  || "{}"),
    annualBudget:    (() => { const s = localStorage.getItem("blAnnualBudget"); return s !== null ? Number(s) : DEFAULT_ANNUAL_BUDGET; })(),
    // ── Settings & preferences ───────────────────────────────────
    settings: {
      currency:          localStorage.getItem("blDisplayCurrency") || "USD",
      ownedColumns:      JSON.parse(localStorage.getItem("blOwnedColumns")            || "null"),
      acquisitionColumns:JSON.parse(localStorage.getItem("blAcquisitionColumns")      || "null"),
      purchaseColumns:   JSON.parse(localStorage.getItem("blPurchaseColumns")         || "null"),
      dashboardWidgets:  JSON.parse(localStorage.getItem("blDashboardWidgetSettings") || "null"),
      collectionItems:   JSON.parse(localStorage.getItem("blCollectionItems")         || "null"),
      ownedColWidths:    JSON.parse(localStorage.getItem("blOwnedColWidths")          || "null"),
      autoExportDays:    Number(localStorage.getItem("blAutoExportDays")) || 0,
    }
  };
}

export async function exportFullBackup() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const filename = `brickledger-backup-${date}.json`;
  const content = JSON.stringify(buildBackup(now), null, 2);

  // Native Save As dialog — Chrome/Edge only, requires a direct user gesture
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "BrickLedger Backup", accept: { "application/json": [".json"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      localStorage.setItem("blLastAutoExport", now.toISOString());
      return date;
    } catch (err) {
      if (err.name === "AbortError") return null; // user hit Cancel — don't fall through
      // SecurityError (no user gesture, e.g. auto-export) or anything else → fall back
    }
  }

  // Fallback: save to browser Downloads folder
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem("blLastAutoExport", now.toISOString());
  return date;
}
