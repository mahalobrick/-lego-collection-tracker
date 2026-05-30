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
    },
  };
}

describe("characterization — buildBackup <-> apply (Phase C)", () => {
  it("round-trip: state in == state out for all 17 user-data keys (incl nested settings.*)", async () => {
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
    };
    for (const [k, v] of Object.entries(fixture)) localStorage.setItem(k, ser(v));

    const { backup } = await exportAndCapture();
    localStorage.clear();
    applyBackupToLocalStorage(backup);

    for (const [k, v] of Object.entries(fixture)) {
      expect(localStorage.getItem(k)).toBe(ser(v));
    }
  });

  it("apply's setItem key-set == BACKUP_KEYS (17) exactly", () => {
    const keys = captureApplyKeys(makeFullBackup());
    expect(keys.sort()).toEqual(BACKUP_KEYS.map((k) => k.key).sort());
  });

  it("buildBackup's getItem key-set == BACKUP_KEYS ∪ {brickEconomySetCache, blAutoExportDays}", async () => {
    const { getKeys } = await exportAndCapture();
    const expected = [...BACKUP_KEYS.map((k) => k.key), "brickEconomySetCache", "blAutoExportDays"].sort();
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
