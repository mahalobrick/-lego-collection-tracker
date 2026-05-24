// Shared full-backup export — called by both AppSettings (manual) and App (auto).
//
// Manual calls (from a button click) get a native Save As dialog in Chrome/Edge
// via showSaveFilePicker. Safari/Firefox and auto-export fall back to the
// browser's default Downloads folder.
//
// Returns the date string (e.g. "2026-05-23") on success, or null if the user
// cancelled the save dialog.

const DEFAULT_ANNUAL_BUDGET = 10320;

function buildBackup(now) {
  return {
    version: 1,
    app: "BrickLedger",
    exportedAt: now.toISOString(),
    ownedSets: JSON.parse(localStorage.getItem("blOwnedSets") || "[]"),
    brickEconomyNormalized: JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]"),
    brickEconomySetCache: JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}"),
    wantedList: JSON.parse(localStorage.getItem("blWantedList") || "[]"),
    budgetPurchases: JSON.parse(localStorage.getItem("blPurchases") || "[]"),
    stores: JSON.parse(localStorage.getItem("blStores") || "[]"),
    storeBudgets: JSON.parse(localStorage.getItem("blStoreBudgets") || "{}"),
    annualBudget: Number(localStorage.getItem("blAnnualBudget")) || DEFAULT_ANNUAL_BUDGET,
    settings: {
      ownedColumns: JSON.parse(localStorage.getItem("blOwnedColumns") || "null"),
      acquisitionColumns: JSON.parse(localStorage.getItem("blAcquisitionColumns") || "null"),
      purchaseColumns: JSON.parse(localStorage.getItem("blPurchaseColumns") || "null"),
      dashboardWidgets: JSON.parse(localStorage.getItem("blDashboardWidgetSettings") || "null"),
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
