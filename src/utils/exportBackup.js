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

function cloudHeaders(extra = {}) {
  const secret = import.meta.env.VITE_BACKUP_SECRET || "";
  return {
    "Content-Type": "application/json",
    ...(secret ? { "x-backup-secret": secret } : {}),
    ...extra,
  };
}

/** Push current localStorage state to cloud. Returns { ok, savedAt } or null if not configured. */
export async function pushToCloud() {
  const backup = buildBackup(new Date());
  // Exclude the set-lookup cache — it's large and fully regeneratable
  delete backup.brickEconomySetCache;

  const res = await fetch("/api/cloud-backup", {
    method: "POST",
    headers: cloudHeaders(),
    body: JSON.stringify(backup),
  });
  if (res.status === 503) return null; // not configured — silent
  if (!res.ok) throw new Error(`Cloud backup failed: HTTP ${res.status}`);
  const json = await res.json();
  localStorage.setItem("blLastCloudPush", json.savedAt || new Date().toISOString());
  return json;
}

/** Fetch the stored cloud backup. Returns the backup object, null if none, or throws on error. */
export async function fetchFromCloud() {
  const res = await fetch("/api/cloud-backup", { headers: cloudHeaders() });
  if (res.status === 404 || res.status === 503) return null;
  if (!res.ok) throw new Error(`Cloud fetch failed: HTTP ${res.status}`);
  return await res.json();
}

/** Apply a backup object to localStorage (same logic as the Settings restore). */
export function applyBackupToLocalStorage(data) {
  if (Array.isArray(data.ownedSets))              localStorage.setItem("blOwnedSets",                      JSON.stringify(data.ownedSets));
  if (Array.isArray(data.brickEconomyNormalized)) localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(data.brickEconomyNormalized));
  if (data.brickEconomySyncInfo  && typeof data.brickEconomySyncInfo  === "object") localStorage.setItem("brickEconomyCollectionSyncInfo", JSON.stringify(data.brickEconomySyncInfo));
  if (Array.isArray(data.soldSets))               localStorage.setItem("blSoldSets",        JSON.stringify(data.soldSets));
  if (Array.isArray(data.portfolioHistory))        localStorage.setItem("blPortfolioHistory", JSON.stringify(data.portfolioHistory));
  if (Array.isArray(data.wantedList))              localStorage.setItem("blWantedList",       JSON.stringify(data.wantedList));
  if (Array.isArray(data.budgetPurchases))         localStorage.setItem("blPurchases",        JSON.stringify(data.budgetPurchases));
  if (Array.isArray(data.stores))                  localStorage.setItem("blStores",           JSON.stringify(data.stores));
  if (data.storeBudgets && typeof data.storeBudgets === "object") localStorage.setItem("blStoreBudgets", JSON.stringify(data.storeBudgets));
  if (data.annualBudget)                           localStorage.setItem("blAnnualBudget",     data.annualBudget);
  if (data.settings) {
    if (data.settings.currency)            localStorage.setItem("blDisplayCurrency",         data.settings.currency);
    if (data.settings.ownedColumns)        localStorage.setItem("blOwnedColumns",            JSON.stringify(data.settings.ownedColumns));
    if (data.settings.acquisitionColumns)  localStorage.setItem("blAcquisitionColumns",      JSON.stringify(data.settings.acquisitionColumns));
    if (data.settings.purchaseColumns)     localStorage.setItem("blPurchaseColumns",         JSON.stringify(data.settings.purchaseColumns));
    if (data.settings.dashboardWidgets)    localStorage.setItem("blDashboardWidgetSettings", JSON.stringify(data.settings.dashboardWidgets));
    if (data.settings.collectionItems)     localStorage.setItem("blCollectionItems",         JSON.stringify(data.settings.collectionItems));
    if (data.settings.ownedColWidths)      localStorage.setItem("blOwnedColWidths",          JSON.stringify(data.settings.ownedColWidths));
    if (data.settings.autoExportDays != null) localStorage.setItem("blAutoExportDays",       String(data.settings.autoExportDays));
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
    annualBudget:    Number(localStorage.getItem("blAnnualBudget"))     || DEFAULT_ANNUAL_BUDGET,
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
