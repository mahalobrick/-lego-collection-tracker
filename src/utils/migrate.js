// One-time migrations — runs on every app boot, skips already-applied steps.
import { setItemSafe } from "./safeStorage";

const V1_KEY_MAP = {
  legoAnnualBudget:         "blAnnualBudget",
  legoStores:               "blStores",
  legoBudgetPurchases_2026: "blPurchases_2026",
  legoOwnedSets:            "blOwnedSets",
  legoWantedList:           "blWantedList",
  legoPurchaseColumns:      "blPurchaseColumns",
  legoOwnedColumns:         "blOwnedColumns",
  legoAcquisitionColumns:   "blAcquisitionColumns",
  legoDashboardWidgetSettings: "blDashboardWidgetSettings",
};

export function runMigrations() {
  // v1 — rename lego* localStorage keys to bl*
  if (!localStorage.getItem("blMigrated_v1")) {
    for (const [oldKey, newKey] of Object.entries(V1_KEY_MAP)) {
      const value = localStorage.getItem(oldKey);
      if (value !== null) {
        setItemSafe(newKey, value);
        localStorage.removeItem(oldKey);
      }
    }
    setItemSafe("blMigrated_v1", "1");
  }

  // v2 — collapse year-suffixed purchases key into blPurchases
  if (!localStorage.getItem("blMigrated_v2")) {
    const old = localStorage.getItem("blPurchases_2026");
    if (old !== null && localStorage.getItem("blPurchases") === null) {
      setItemSafe("blPurchases", old);
      localStorage.removeItem("blPurchases_2026");
    }
    setItemSafe("blMigrated_v2", "1");
  }

  // v3 — remove auto-seeded store budgets so user starts with blank inputs
  if (!localStorage.getItem("blMigrated_v3")) {
    const seeded = { Amazon: 3000, "Best Buy": 120, Bricklink: 1200, LEGO: 2400, Target: 1800, Walmart: 1800 };
    const saved = localStorage.getItem("blStoreBudgets");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // if every key matches the seeded defaults exactly, it was auto-generated — clear it
        const keys = Object.keys(parsed);
        const isSeeded = keys.length === Object.keys(seeded).length &&
          keys.every(k => seeded[k] === parsed[k]);
        if (isSeeded) localStorage.removeItem("blStoreBudgets");
      } catch {}
    }
    setItemSafe("blMigrated_v3", "1");
  }
}
