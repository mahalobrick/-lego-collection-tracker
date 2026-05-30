import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { applyBackupToLocalStorage, markSynced, pushToCloudAuth, localContentHash, BACKUP_KEYS } from "./exportBackup";

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

  it("fails partway → ok:false, ATOMIC rollback (nothing left written) + reports the failed key", () => {
    failSetItemFrom(3); // 1st + 2nd writes land, 3rd onward throw
    const res = applyBackupToLocalStorage(fullBackup());
    expect(res.ok).toBe(false);
    expect(res.failedKey).toBe(BACKUP_KEYS[2].key);
    expect(res.applied).toEqual([]); // rolled back → nothing remains applied
    // All-or-nothing: the two keys written before the failure were rolled back (here to null,
    // since storage started empty), and the keys after it were never written.
    expect(localStorage.getItem(BACKUP_KEYS[0].key)).toBeNull();
    expect(localStorage.getItem(BACKUP_KEYS[1].key)).toBeNull();
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

describe("partial apply is ATOMIC across a reload — a mixed local state can never clobber cloud (E.5 / OBS-2)", () => {
  // Byte-budget quota: setItem throws QuotaExceededError once the TOTAL stored size would
  // exceed `cap`. Restores (which shrink usage) still succeed — exactly how a real full disk
  // behaves — so the atomic rollback can run. (failSetItemFrom's unconditional throw can't
  // model a rollback that needs to write the prior, smaller values back.)
  function quotaCap(cap) {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (k, v) {
      let total = k.length + String(v).length;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key === k) continue; // this key is being replaced, not added
        total += key.length + (localStorage.getItem(key) || "").length;
      }
      if (total > cap) { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
      return real.call(this, k, v);
    });
  }

  it("clean synced device + oversized newer cloud → apply fails, local fully rolled back, reads CLEAN, push is no_change", () => {
    // 1) A clean, in-sync device: a small collection whose hash is recorded, so it is NOT dirty.
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
    localStorage.setItem("blWantedList", JSON.stringify([{ setNumber: "10300" }]));
    localStorage.setItem("blSyncedUserId", "user_1");
    localStorage.setItem("blLastPushHash", localContentHash()); // device is clean (== last push)
    const cleanHash = localStorage.getItem("blLastPushHash");
    const ownedBefore = localStorage.getItem("blOwnedSets");
    const wantedBefore = localStorage.getItem("blWantedList");

    // 2) A newer cloud backup whose blSoldSets is too big to fit. Apply order writes ownedSets
    //    first (fits → overwritten), then overflows on soldSets, so a NAIVE apply would leave a
    //    MIXED device (cloud ownedSets + old wantedList).
    const cloud = {
      version: 2,
      exportedAt: "2026-05-30T00:00:00Z",
      ownedSets: [{ setNumber: "CLOUD-SET" }],
      soldSets: [{ pad: "x".repeat(200000) }], // overflows the cap
      wantedList: [{ setNumber: "CLOUD-WANT" }],
    };
    quotaCap(100000);

    const res = applyBackupToLocalStorage(cloud);

    // 3) Apply failed AND rolled back: the device is byte-for-byte its prior self.
    expect(res.ok).toBe(false);
    expect(res.failedKey).toBe("blSoldSets");
    expect(localStorage.getItem("blOwnedSets")).toBe(ownedBefore);   // cloud write reverted
    expect(localStorage.getItem("blWantedList")).toBe(wantedBefore);
    expect(localStorage.getItem("blSoldSets")).toBeNull();           // overflowing key never landed

    // 4) The integrity guarantee: a reload reads the device as CLEAN (no mixed dirty state),
    //    because local still hashes to the recorded push hash.
    expect(localContentHash()).toBe(cleanHash);

    vi.restoreAllMocks(); // drop the quota so a real push could proceed if it wanted to
  });

  it("after the rolled-back apply, the post-reload auto-push sends NOTHING (no_change) — cloud is untouched", async () => {
    // Same clean device + rolled-back oversized apply as above…
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
    localStorage.setItem("blWantedList", JSON.stringify([{ setNumber: "10300" }]));
    localStorage.setItem("blSyncedUserId", "user_1");
    localStorage.setItem("blLastPushHash", localContentHash());

    quotaCap(100000);
    applyBackupToLocalStorage({
      version: 2, exportedAt: "2026-05-30T00:00:00Z",
      ownedSets: [{ setNumber: "CLOUD-SET" }],
      soldSets: [{ pad: "x".repeat(200000) }],
    });
    vi.restoreAllMocks();

    // …now simulate the reload's auto-push. A POST would clobber the good cloud backup.
    const fetchMock = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await pushToCloudAuth(async () => "tok");

    expect(result).toEqual({ skipped: "no_change" }); // local == last push → nothing to send
    expect(fetchMock).not.toHaveBeenCalled();          // the good cloud backup is never overwritten
  });
});
