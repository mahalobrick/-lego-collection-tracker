import { beforeEach, describe, it, expect } from "vitest";
import { exportFullBackup, applyBackupToLocalStorage, BACKUP_KEYS } from "./exportBackup";

// CHARACTERIZATION tests — pin TODAY's buildBackup <-> applyBackupToLocalStorage behavior
// so the Step 3 registry-driven refactor can't change it silently. Behavioral only: we
// drive the (unexported) buildBackup through exportFullBackup's Downloads-fallback path
// (jsdom has no showSaveFilePicker) and capture the serialized backup + the getItem
// key-set via prototype patches. No source-parsing, no production-code change.

beforeEach(() => localStorage.clear());

const ser = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v));

// Run exportFullBackup with file-writing stubbed; return the real buildBackup output
// (the serialized backup object) plus the exact set of keys buildBackup read.
async function exportAndCapture() {
  const RealBlob = globalThis.Blob;
  const realGet = Storage.prototype.getItem;
  const _create = URL.createObjectURL, _revoke = URL.revokeObjectURL, _ce = document.createElement;
  let content = null;
  const getKeys = [];
  globalThis.Blob = class extends RealBlob { constructor(parts, opts) { content = parts && parts[0]; super(parts, opts); } };
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
  document.createElement = () => ({ href: "", download: "", click() {} }); // no navigation in jsdom
  Storage.prototype.getItem = function (k) { getKeys.push(k); return realGet.call(this, k); };
  try {
    await exportFullBackup();
  } finally {
    globalThis.Blob = RealBlob;
    Storage.prototype.getItem = realGet;
    URL.createObjectURL = _create; URL.revokeObjectURL = _revoke; document.createElement = _ce;
  }
  return { backup: JSON.parse(content), getKeys: [...new Set(getKeys)] };
}

// Capture the localStorage keys that applyBackupToLocalStorage writes.
function captureApplyKeys(backup) {
  const realSet = Storage.prototype.setItem;
  const keys = [];
  Storage.prototype.setItem = function (k, v) { keys.push(k); realSet.call(this, k, v); };
  try { applyBackupToLocalStorage(backup); } finally { Storage.prototype.setItem = realSet; }
  return [...new Set(keys)];
}

// A backup object with every restorable field populated (backup field names + nested settings).
function makeFullBackup() {
  return {
    version: 2,
    ownedSets: [{ a: 1 }],
    brickEconomyNormalized: [{ a: 1 }],
    brickEconomySyncInfo: { a: 1 },
    soldSets: [{ a: 1 }],
    portfolioHistory: [{ a: 1 }],
    wantedList: [{ a: 1 }],
    budgetPurchases: [{ a: 1 }],
    stores: ["Amazon"],
    storeBudgets: { Amazon: 1 },
    annualBudget: 5000,
    settings: {
      currency: "GBP",
      ownedColumns: [{ a: 1 }],
      acquisitionColumns: [{ a: 1 }],
      purchaseColumns: [{ a: 1 }],
      dashboardWidgets: { a: 1 },
      collectionItems: [{ a: 1 }],
      ownedColWidths: { a: 1 },
      ownedRowDensity: "full",
    },
  };
}

describe("characterization — buildBackup <-> apply (Phase C)", () => {
  it("round-trip: state in == state out for all 18 user-data keys (incl nested settings.*)", async () => {
    const fixture = {
      blOwnedSets: [{ setNumber: "10497", qty: 1 }],
      brickEconomyNormalizedCollection: [{ setNumber: "75192" }],
      brickEconomyCollectionSyncInfo: { piecesCount: 1234, lastSync: "2026-01-01" },
      blSoldSets: [{ setNumber: "21318", soldPrice: 200 }],
      blPortfolioHistory: [{ date: "2026-01-01", value: 1000 }],
      blWantedList: [{ setNumber: "10300" }],
      blPurchases: [{ store: "Amazon", total: 50 }],
      blStores: ["Amazon", "Costco"],
      blStoreBudgets: { Amazon: 500 },
      blAnnualBudget: 5000,        // non-zero on purpose (0 would hit the known falsy-zero default)
      blDisplayCurrency: "GBP",
      blOwnedColumns: [{ key: "name", visible: true }],
      blAcquisitionColumns: [{ key: "setNumber", visible: true }],
      blPurchaseColumns: [{ key: "date", visible: true }],
      blDashboardWidgetSettings: { spend: true },
      blCollectionItems: [{ key: "value", visible: true }],
      blOwnedColWidths: { name: 150 },
      blOwnedRowDensity: "full",
    };
    for (const [k, v] of Object.entries(fixture)) localStorage.setItem(k, ser(v));

    const { backup } = await exportAndCapture();
    localStorage.clear();
    applyBackupToLocalStorage(backup);

    for (const [k, v] of Object.entries(fixture)) {
      expect(localStorage.getItem(k)).toBe(ser(v));
    }
  });

  it("apply's setItem key-set == BACKUP_KEYS (18) exactly", () => {
    const keys = captureApplyKeys(makeFullBackup());
    expect(keys.sort()).toEqual(BACKUP_KEYS.map((k) => k.key).sort());
  });

  it("buildBackup's getItem key-set == BACKUP_KEYS ∪ {brickEconomySetCache, blAutoExportDays, blLastAutoExport}", async () => {
    const { getKeys } = await exportAndCapture();
    // blLastAutoExport: exportFullBackup's final stamp now writes via the guarded setItemSafe,
    // which reads the key first for change-detection (Phase E choke point — the production
    // monkey-patch always did this read; this characterization just now sees it).
    const expected = [...BACKUP_KEYS.map((k) => k.key), "brickEconomySetCache", "blAutoExportDays", "blLastAutoExport"].sort();
    expect(getKeys.sort()).toEqual(expected);
  });

  it("build-only keys (brickEconomySetCache, blAutoExportDays) are NOT restored by apply", () => {
    localStorage.setItem("blAutoExportDays", "7");
    localStorage.setItem("brickEconomySetCache", JSON.stringify({ local: true }));
    applyBackupToLocalStorage({
      version: 2,
      brickEconomySetCache: { cloud: true },
      settings: { autoExportDays: 99, currency: "USD" },
    });
    expect(localStorage.getItem("blAutoExportDays")).toBe("7");
    expect(localStorage.getItem("brickEconomySetCache")).toBe(JSON.stringify({ local: true }));
  });

  it("version guard: apply rejects backup.version > BACKUP_VERSION", () => {
    expect(() => applyBackupToLocalStorage({ version: 999 })).toThrow(/newer than this app supports/);
  });
});

// CHARACTERIZATION — the edge cases a registry-driven rewrite is most likely to DRIFT on:
// keys absent from localStorage, and present-but-empty/falsy values. These pin the exact
// build->apply behavior TODAY (top-level vs nested guard asymmetry, default coercions,
// falsy-zero budget) so Step 3's registry rewrite can't change any of it silently.
describe("characterization — edge cases: absent / empty / falsy (Phase D net)", () => {
  it("absent keys: apply (re)writes top-level data keys as empty containers + defaults; leaves 6 nested view-config absent", async () => {
    localStorage.clear(); // every backup key absent → build reads its default
    const { backup } = await exportAndCapture();
    localStorage.clear();
    applyBackupToLocalStorage(backup);

    // Top-level data keys are unconditionally (re)written by apply's Array.isArray / typeof-object guards.
    expect(localStorage.getItem("blOwnedSets")).toBe("[]");
    expect(localStorage.getItem("brickEconomyNormalizedCollection")).toBe("[]");
    expect(localStorage.getItem("brickEconomyCollectionSyncInfo")).toBe("{}");
    expect(localStorage.getItem("blSoldSets")).toBe("[]");
    expect(localStorage.getItem("blPortfolioHistory")).toBe("[]");
    expect(localStorage.getItem("blWantedList")).toBe("[]");
    expect(localStorage.getItem("blPurchases")).toBe("[]");
    expect(localStorage.getItem("blStores")).toBe("[]"); // build defaults to "[]" here, NOT DEFAULT_STORES
    expect(localStorage.getItem("blStoreBudgets")).toBe("{}");
    expect(localStorage.getItem("blAnnualBudget")).toBe("10320"); // DEFAULT_ANNUAL_BUDGET
    expect(localStorage.getItem("blDisplayCurrency")).toBe("USD");
    expect(localStorage.getItem("blOwnedRowDensity")).toBe("compact"); // scalar-with-default, like currency: always restored

    // The 6 nested view-config keys build to null → apply's truthy settings.* guard skips them.
    for (const k of ["blOwnedColumns", "blAcquisitionColumns", "blPurchaseColumns",
                     "blDashboardWidgetSettings", "blCollectionItems", "blOwnedColWidths"]) {
      expect(localStorage.getItem(k)).toBeNull();
    }
  });

  it("present empty/falsy values: characterized coercions survive build->apply", async () => {
    localStorage.clear();
    localStorage.setItem("blOwnedSets", "[]");                 // empty array stays empty
    localStorage.setItem("blStoreBudgets", "{}");             // empty object stays empty
    localStorage.setItem("blDisplayCurrency", "");           // "" coerces to "USD" via build's `|| "USD"`
    localStorage.setItem("blAnnualBudget", "0");            // falsy-zero MUST survive (Number(0) != null)
    localStorage.setItem("blOwnedColumns", "[]");           // nested empty array (truthy) is written back
    localStorage.setItem("blDashboardWidgetSettings", "{}"); // nested empty object (truthy) is written back

    const { backup } = await exportAndCapture();
    localStorage.clear();
    applyBackupToLocalStorage(backup);

    expect(localStorage.getItem("blOwnedSets")).toBe("[]");
    expect(localStorage.getItem("blStoreBudgets")).toBe("{}");
    expect(localStorage.getItem("blDisplayCurrency")).toBe("USD"); // "" → default
    expect(localStorage.getItem("blAnnualBudget")).toBe("0");      // 0 preserved, not defaulted away
    expect(localStorage.getItem("blOwnedColumns")).toBe("[]");
    expect(localStorage.getItem("blDashboardWidgetSettings")).toBe("{}");
  });

  it("blAnnualBudget coercions: '0' stays '0', '' becomes '0', absent becomes the default", async () => {
    for (const [raw, expected] of [["0", "0"], ["", "0"]]) {
      localStorage.clear();
      localStorage.setItem("blAnnualBudget", raw);
      const { backup } = await exportAndCapture();
      localStorage.clear();
      applyBackupToLocalStorage(backup);
      expect(localStorage.getItem("blAnnualBudget")).toBe(expected);
    }
    localStorage.clear();
    const { backup } = await exportAndCapture(); // absent → DEFAULT_ANNUAL_BUDGET
    localStorage.clear();
    applyBackupToLocalStorage(backup);
    expect(localStorage.getItem("blAnnualBudget")).toBe("10320");
  });
});
