import { beforeEach, describe, it, expect } from "vitest";
import { hasAnyLocalData, BACKUP_KEYS, localContentHash, clearLocalUserData } from "./exportBackup";
import { DEFAULT_STORES } from "./storeDefaults";

// Mirrors the app default (DEFAULT_ANNUAL_BUDGET in exportBackup.js) for test setup.
const DEFAULT_ANNUAL_BUDGET = 10320;

beforeEach(() => localStorage.clear());

// SYNC-CRIT-1 regression: the emptiness census must cover every DATA key that a cloud
// pull (applyBackupToLocalStorage) would overwrite — so a device whose only unsynced
// work lives in sold-sets / portfolio / budget is NOT misclassified as "fresh device"
// and silently overwritten. It must ALSO still return false for a genuinely fresh
// device (default/empty state) so the legitimate silent pull keeps working.
describe("hasAnyLocalData — SYNC-CRIT-1 census", () => {
  it("genuinely empty device → false (allows the legitimate silent fresh-device pull)", () => {
    expect(hasAnyLocalData()).toBe(false);
  });

  it("default annual budget alone → false (default-on-mount must not count as data)", () => {
    localStorage.setItem("blAnnualBudget", String(DEFAULT_ANNUAL_BUDGET));
    expect(hasAnyLocalData()).toBe(false);
  });

  it("empty arrays/objects written on mount → false", () => {
    for (const k of ["blOwnedSets", "blWantedList", "blPurchases", "blSoldSets", "blPortfolioHistory"]) {
      localStorage.setItem(k, "[]");
    }
    localStorage.setItem("blStoreBudgets", "{}");
    expect(hasAnyLocalData()).toBe(false);
  });

  it("RED-TEAM: sold-everything (owned empty, soldSets populated) → true", () => {
    localStorage.setItem("blOwnedSets", "[]");
    localStorage.setItem("blSoldSets", JSON.stringify([{ setNumber: "75192", soldPrice: 800 }]));
    expect(hasAnyLocalData()).toBe(true);
  });

  it("RED-TEAM: portfolio history populated → true", () => {
    localStorage.setItem("blPortfolioHistory", JSON.stringify([{ date: "2026-01-01", value: 100 }]));
    expect(hasAnyLocalData()).toBe(true);
  });

  it("RED-TEAM: budget-only first session (custom annual budget) → true", () => {
    localStorage.setItem("blAnnualBudget", "5000");
    expect(hasAnyLocalData()).toBe(true);
  });

  it("RED-TEAM: per-store budgets set → true", () => {
    localStorage.setItem("blStoreBudgets", JSON.stringify({ Amazon: 500 }));
    expect(hasAnyLocalData()).toBe(true);
  });

  it("custom display currency → true; default USD alone → false", () => {
    localStorage.setItem("blDisplayCurrency", "GBP");
    expect(hasAnyLocalData()).toBe(true);
    localStorage.clear();
    localStorage.setItem("blDisplayCurrency", "USD");
    expect(hasAnyLocalData()).toBe(false);
  });

  it("owned sets populated → true", () => {
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
    expect(hasAnyLocalData()).toBe(true);
  });

  it("DEFERRED (Step 5): a view-config settings key alone does NOT count", () => {
    localStorage.setItem("blOwnedColumns", JSON.stringify([{ key: "name", visible: true }]));
    expect(hasAnyLocalData()).toBe(false);
  });

  it("default store list alone → false (default-on-mount must not count)", () => {
    localStorage.setItem("blStores", JSON.stringify(DEFAULT_STORES));
    expect(hasAnyLocalData()).toBe(false);
  });

  it("customized store list → true (via the exported DEFAULT_STORES comparison)", () => {
    localStorage.setItem("blStores", JSON.stringify(["Amazon", "Costco"]));
    expect(hasAnyLocalData()).toBe(true);
  });
});

// The registry is the ONE shared list. These tests pin which keys the census counts vs
// defers, and assert the registry covers the full applyBackupToLocalStorage overwrite
// set — so census and overwrite scope can never silently drift apart again.
describe("BACKUP_KEYS registry — one shared list", () => {
  const census = BACKUP_KEYS.filter((k) => k.census).map((k) => k.key).sort();
  const deferred = BACKUP_KEYS.filter((k) => !k.census).map((k) => k.key).sort();

  it("census = the 11 data keys (incl. blStores via exported DEFAULT_STORES)", () => {
    expect(census).toEqual(
      [
        "blAnnualBudget", "blDisplayCurrency", "blOwnedSets", "blPortfolioHistory",
        "blPurchases", "blSoldSets", "blStoreBudgets", "blStores", "blWantedList",
        "brickEconomyCollectionSyncInfo", "brickEconomyNormalizedCollection",
      ].sort(),
    );
  });

  it("deferred = the 7 view-config keys (tracked in Step 5)", () => {
    expect(deferred).toEqual(
      [
        "blAcquisitionColumns", "blCollectionItems", "blDashboardWidgetSettings",
        "blOwnedColWidths", "blOwnedColumns", "blPurchaseColumns", "blOwnedRowDensity",
      ].sort(),
    );
  });

  it("registry covers the full applyBackupToLocalStorage overwrite set (no silent drift)", () => {
    const overwriteSet = [
      "blOwnedSets", "brickEconomyNormalizedCollection", "brickEconomyCollectionSyncInfo",
      "blSoldSets", "blPortfolioHistory", "blWantedList", "blPurchases", "blStores",
      "blStoreBudgets", "blAnnualBudget", "blDisplayCurrency", "blOwnedColumns",
      "blAcquisitionColumns", "blPurchaseColumns", "blDashboardWidgetSettings",
      "blCollectionItems", "blOwnedColWidths", "blOwnedRowDensity",
    ].sort();
    expect(BACKUP_KEYS.map((k) => k.key).sort()).toEqual(overwriteSet);
  });
});

// A4 regression: the sign-out wipe must NOT destroy never-pushed local data (offline /
// failed-sync sign-out). clearLocalUserData refuses to wipe unsynced/dirty censused data
// unless forced; the shared-browser foreign-data wipe (BIZLOGIC-1) passes { force: true }.
describe("clearLocalUserData — A4 guard", () => {
  it("refuses to wipe never-pushed data (no blLastPushHash) → { skipped: 'unsynced' }", () => {
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
    expect(clearLocalUserData()).toEqual({ skipped: "unsynced" });
    expect(localStorage.getItem("blOwnedSets")).not.toBeNull();
  });

  it("refuses to wipe dirty data (local edits diverged from last push)", () => {
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
    localStorage.setItem("blLastPushHash", localContentHash()); // mark in-sync…
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }, { setNumber: "75192" }])); // …then edit
    expect(clearLocalUserData()).toEqual({ skipped: "unsynced" });
    expect(localStorage.getItem("blOwnedSets")).not.toBeNull();
  });

  it("wipes cleanly-synced data (fingerprint matches last push)", () => {
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
    localStorage.setItem("blLastPushHash", localContentHash());
    expect(clearLocalUserData()).toEqual({ cleared: true });
    expect(localStorage.getItem("blOwnedSets")).toBeNull();
  });

  it("force: true wipes even unsynced data (foreign-device path / BIZLOGIC-1)", () => {
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
    expect(clearLocalUserData({ force: true })).toEqual({ cleared: true });
    expect(localStorage.getItem("blOwnedSets")).toBeNull();
  });

  it("empty device wipes (nothing to lose) and clears caches + sync metadata", () => {
    localStorage.setItem("brickEconomySetCache", JSON.stringify({ "10497": { pieces: 1 } }));
    localStorage.setItem("blLastPushHash", "abc");
    expect(clearLocalUserData()).toEqual({ cleared: true });
    expect(localStorage.getItem("brickEconomySetCache")).toBeNull();
    expect(localStorage.getItem("blLastPushHash")).toBeNull();
  });

  it("SIGNOUT_KEEP_KEYS (device-local prefs) survive the wipe", () => {
    localStorage.setItem("blAutoExportDays", "7");
    localStorage.setItem("blLastAutoExport", "2026-01-01");
    clearLocalUserData({ force: true });
    expect(localStorage.getItem("blAutoExportDays")).toBe("7");
    expect(localStorage.getItem("blLastAutoExport")).toBe("2026-01-01");
  });
});

// A11 (docs/audit-action-plan.md): the dedup hash must NOT include device-local prefs
// (settings.autoExportDays) or the regeneratable cache, so two devices with identical user
// data but different auto-export schedules don't read as mutually dirty (spurious push churn
// / conflict dialogs). Fixed in Step 3 — dedupHash now projects only the BACKUP_KEYS registry,
// so prefs + caches are excluded by construction. (Was `it.fails` before the fix.)
describe("dedupHash determinism — device-local pref + cache must not change the sync hash (A11)", () => {
  it("states differing ONLY in blAutoExportDays / brickEconomySetCache hash the same", () => {
    localStorage.clear();
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497", qty: 1 }]));
    localStorage.setItem("blAutoExportDays", "1");
    localStorage.setItem("brickEconomySetCache", JSON.stringify({ "10497": { pieces: 100 } }));
    const h1 = localContentHash();

    // identical user data; only the device-local pref + regeneratable cache differ
    localStorage.setItem("blAutoExportDays", "30");
    localStorage.setItem("brickEconomySetCache", JSON.stringify({ "10497": { pieces: 999 } }));
    const h2 = localContentHash();

    expect(h1).toBe(h2);
  });
});
