// Shared full-backup export — called by both AppSettings (manual) and App (auto).
//
// Manual calls (from a button click) get a native Save As dialog in Chrome/Edge
// via showSaveFilePicker. Safari/Firefox and auto-export fall back to the
// browser's default Downloads folder.
//
// Returns the date string (e.g. "2026-05-23") on success, or null if the user
// cancelled the save dialog.

const DEFAULT_ANNUAL_BUDGET = 10320;

// ── Cloud backup helpers ──────────────────────────────────────────────────────
// Encryption: AES-256-GCM with a PBKDF2-derived key.
// The passphrase never leaves the browser — the server stores only ciphertext.
// Salt and IV are random per-push and stored alongside the ciphertext (non-secret).

const JSON_HEADERS = { "Content-Type": "application/json" };

// Fast non-crypto fingerprint — good enough for dirty-check equality (not security).
function quickHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (h * 33 ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Safely base64-encode an ArrayBuffer without hitting the spread-operator stack limit
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Encrypt a backup object. Returns { version, exportedAt, salt, iv, ciphertext } — all JSON-safe. */
async function encryptPayload(backupObj, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(passphrase, salt);
  const enc  = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(backupObj))
  );
  return {
    version:    2,
    exportedAt: backupObj.exportedAt, // kept unencrypted so the sync banner can show the timestamp
    salt:       toBase64(salt),
    iv:         toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

/**
 * Decrypt a payload returned by fetchFromCloud().
 * Throws "Wrong passphrase or corrupted backup" if the passphrase is incorrect
 * (AES-GCM's auth tag verification fails on a bad key — no oracle needed).
 */
export async function decryptCloudBackup(payload, passphrase) {
  const salt       = fromBase64(payload.salt);
  const iv         = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const key        = await deriveKey(passphrase, salt);
  const dec        = new TextDecoder();
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(dec.decode(plaintext));
  } catch {
    throw new Error("Wrong passphrase or corrupted backup");
  }
}

/**
 * Push current localStorage state to cloud.
 * Requires a passphrase — skips silently if none is provided or there is no data.
 * Returns { ok, savedAt } on success, null if skipped/not-configured, throws on error.
 */
export async function pushToCloud(passphrase) {
  if (!passphrase) return null; // passphrase not set this session — skip

  // Don't push if this browser has nothing — would overwrite a real backup with empty data
  const ownedSets  = localStorage.getItem("blOwnedSets");
  const beNorm     = localStorage.getItem("brickEconomyNormalizedCollection");
  const wantedList = localStorage.getItem("blWantedList");
  const hasAnyData = (ownedSets && ownedSets !== "[]")
                  || (beNorm && beNorm !== "[]")
                  || (wantedList && wantedList !== "[]");
  if (!hasAnyData) return { skipped: "no_data" };

  const backup = buildBackup(new Date());
  delete backup.brickEconomySetCache; // large and fully regeneratable

  // Skip push if data hasn't changed since last push (saves bandwidth + Upstash writes).
  // Compare a lightweight hash of the backup content (exportedAt excluded — it changes every call).
  const { exportedAt: _ts, ...backupWithoutTs } = backup;
  const contentHash = quickHash(JSON.stringify(backupWithoutTs));
  if (contentHash === localStorage.getItem("blLastPushHash")) return { skipped: "no_change" };

  const encrypted = await encryptPayload(backup, passphrase);

  const res = await fetch("/api/cloud-backup", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(encrypted),
  });
  if (res.status === 503) return null; // not configured — silent
  if (!res.ok) throw new Error(`Cloud backup failed: HTTP ${res.status}`);
  const json = await res.json();
  localStorage.setItem("blLastCloudPush", json.savedAt || new Date().toISOString());
  localStorage.setItem("blLastPushHash", contentHash);
  return json;
}

/**
 * Fetch the stored cloud payload (encrypted). Does NOT decrypt — call decryptCloudBackup() next.
 * Returns the raw payload object, null if nothing stored or not configured, throws on error.
 */
export async function fetchFromCloud() {
  const res = await fetch("/api/cloud-backup", { headers: JSON_HEADERS });
  if (res.status === 404 || res.status === 503) return null;
  if (!res.ok) throw new Error(`Cloud fetch failed: HTTP ${res.status}`);
  return await res.json();
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

// Device-local preferences that should survive a sign-out (not user content).
const SIGNOUT_KEEP_KEYS = new Set(["blAutoExportDays", "blAuthDevice"]);

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
  if (Array.isArray(data.ownedSets))              localStorage.setItem("blOwnedSets",                      JSON.stringify(data.ownedSets));
  if (Array.isArray(data.brickEconomyNormalized)) localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(data.brickEconomyNormalized));
  if (data.brickEconomySyncInfo  && typeof data.brickEconomySyncInfo  === "object") localStorage.setItem("brickEconomyCollectionSyncInfo", JSON.stringify(data.brickEconomySyncInfo));
  if (Array.isArray(data.soldSets))               localStorage.setItem("blSoldSets",        JSON.stringify(data.soldSets));
  if (Array.isArray(data.portfolioHistory))        localStorage.setItem("blPortfolioHistory", JSON.stringify(data.portfolioHistory));
  if (Array.isArray(data.wantedList))              localStorage.setItem("blWantedList",       JSON.stringify(data.wantedList));
  if (Array.isArray(data.budgetPurchases))         localStorage.setItem("blPurchases",        JSON.stringify(data.budgetPurchases));
  if (Array.isArray(data.stores))                  localStorage.setItem("blStores",           JSON.stringify(data.stores));
  if (data.storeBudgets && typeof data.storeBudgets === "object") localStorage.setItem("blStoreBudgets", JSON.stringify(data.storeBudgets));
  if (data.annualBudget != null)                   localStorage.setItem("blAnnualBudget",     data.annualBudget);
  if (data.settings) {
    if (data.settings.currency)            localStorage.setItem("blDisplayCurrency",         data.settings.currency);
    if (data.settings.ownedColumns)        localStorage.setItem("blOwnedColumns",            JSON.stringify(data.settings.ownedColumns));
    if (data.settings.acquisitionColumns)  localStorage.setItem("blAcquisitionColumns",      JSON.stringify(data.settings.acquisitionColumns));
    if (data.settings.purchaseColumns)     localStorage.setItem("blPurchaseColumns",         JSON.stringify(data.settings.purchaseColumns));
    if (data.settings.dashboardWidgets)    localStorage.setItem("blDashboardWidgetSettings", JSON.stringify(data.settings.dashboardWidgets));
    if (data.settings.collectionItems)     localStorage.setItem("blCollectionItems",         JSON.stringify(data.settings.collectionItems));
    if (data.settings.ownedColWidths)      localStorage.setItem("blOwnedColWidths",          JSON.stringify(data.settings.ownedColWidths));
    // autoExportDays intentionally NOT restored — it's a device-local preference
    // (which browser should auto-download); cloud/backup restore should not override it.
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
