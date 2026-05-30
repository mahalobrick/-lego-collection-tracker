import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { applyBackupToLocalStorage, markSynced, pushToCloudAuth, BACKUP_KEYS } from "./exportBackup";

// Phase E.4 — the INTEGRITY half of the quota policy. setItemSafe returns false on a full
// quota; these tests force that (Storage.setItem throws QuotaExceededError) and assert the
// integrity-critical writers react instead of silently continuing / falsely marking synced.

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Make Storage.prototype.setItem throw a quota error — on every call, or only from the Nth
// call onward (to simulate a restore that fills the disk partway through).
function failSetItemFrom(n = 1) {
  const real = Storage.prototype.setItem;
  let calls = 0;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (k, v) {
    calls += 1;
    if (calls >= n) {
      const err = new Error("full");
      err.name = "QuotaExceededError";
      throw err;
    }
    return real.call(this, k, v);
  });
}

// A backup with every registry field populated, so apply attempts a write for each key.
function fullBackup() {
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
    settings: { currency: "GBP" },
  };
}

describe("applyBackupToLocalStorage — aborts + flags a partial restore on full storage (E.4 / 2a)", () => {
  it("first write fails → { ok:false }, nothing applied, failedKey is the first registry key", () => {
    failSetItemFrom(1); // every setItem throws
    const res = applyBackupToLocalStorage(fullBackup());
    expect(res.ok).toBe(false);
    expect(res.applied).toEqual([]);
    expect(res.failedKey).toBe(BACKUP_KEYS[0].key); // blOwnedSets
  });

  it("fails partway → reports ok:false and STOPS (later keys are not written)", () => {
    failSetItemFrom(3); // 1st + 2nd writes land, 3rd onward throw
    const res = applyBackupToLocalStorage(fullBackup());
    expect(res.ok).toBe(false);
    expect(res.applied).toEqual([BACKUP_KEYS[0].key, BACKUP_KEYS[1].key]);
    expect(res.failedKey).toBe(BACKUP_KEYS[2].key);
    // Aborted, not continued: a key after the failure was never written.
    expect(localStorage.getItem("blWantedList")).toBeNull();
  });

  it("does NOT report a full success on a partial restore", () => {
    failSetItemFrom(2);
    expect(applyBackupToLocalStorage(fullBackup()).ok).not.toBe(true);
  });
});

describe("markSynced — does not advance blLastPushHash on a failed write (E.4 / 2b)", () => {
  it("returns false and leaves the prior hash untouched when the write fails", () => {
    localStorage.setItem("blLastPushHash", "OLDHASH");
    failSetItemFrom(1);
    const ok = markSynced({ ownedSets: [{ a: 1 }], exportedAt: "2026-05-29T00:00:00Z" }, "user_1");
    expect(ok).toBe(false);
    expect(localStorage.getItem("blLastPushHash")).toBe("OLDHASH"); // not advanced
  });
});

describe("pushToCloudAuth — cloud push succeeds but local hash mark is not falsely advanced (E.4 / 2b)", () => {
  it("POSTs to cloud, yet leaves blLastPushHash unadvanced when the local write fails", async () => {
    // Local has data + a stale push hash so the function doesn't early-return as no_change.
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
    localStorage.setItem("blLastPushHash", "OLDHASH");
    const fetchMock = vi.fn(async () => ({
      status: 200, ok: true, json: async () => ({ savedAt: "2026-05-29T00:00:00Z" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    failSetItemFrom(1); // the post-fetch blLastCloudPush/blLastPushHash writes both fail

    const result = await pushToCloudAuth(async () => "tok");

    expect(fetchMock).toHaveBeenCalledTimes(1);          // data DID reach the cloud
    expect(result).toEqual({ savedAt: "2026-05-29T00:00:00Z" });
    expect(localStorage.getItem("blLastPushHash")).toBe("OLDHASH"); // mark NOT falsely advanced
  });
});
