import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// P4.0 — CHARACTERIZATION NET for the ENRICHMENT SNAPSHOT (sync invariants).
//
// P4 will snapshot bricksetSetCache + blValueCache into the cloud backup as a
// SEPARATE sibling field `backup.enrichmentSnapshot` (NOT a BACKUP_KEYS entry),
// restored in applyCloudBackup AFTER the atomic apply and OUTSIDE its block.
// The whole mechanism rests on one claim: that a sibling field on the backup
// object — and the restored snapshot caches in localStorage — are INVISIBLE to
// the sync dirty-check (dedupHash) and the fresh-device census (hasAnyLocalData),
// so the addition can neither churn the push nor drift the census.
//
// This net pins CURRENT behavior so the P4.2 (wire push) / P4.3 (restore) edits
// are provably non-regressive. NO production code is touched here. Each describe
// maps to one PIN in the P4.0 brief:
//   1. DEDUP-HASH            — byte-identical; projects BACKUP_KEYS-only
//   2. CENSUS                — hasAnyLocalData; projects BACKUP_KEYS-only
//   3. SIBLING INVISIBILITY  — the load-bearing test (sibling field + restored caches)
//   4. ATOMIC-APPLY / OBS-2  — atomic apply + a post-apply cache-only step can't break it
//   5. A4                    — unsynced-wipe refusal, invariant to the snapshot
//   6. EXISTING PUSH PAYLOAD — byte-identical baseline of today's POST body
//   7. MONEY/ENRICHMENT GOLD — the P3 golden (1050/700/350/50 + counts), carried unchanged
// ─────────────────────────────────────────────────────────────────────────────

// readSource (pulled in via valueCache → peekValueCache for PIN 7) toasts on "broke"
// failures; keep it inert. No path here hits the network funnel, but the import must load.
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import {
  dedupHash,
  localContentHash,
  hasAnyLocalData,
  clearLocalUserData,
  applyBackupToLocalStorage,
  markSynced,
  pushToCloudAuth,
  BACKUP_KEYS,
} from "./exportBackup";
import { restoreEnrichmentSnapshot } from "./enrichmentSnapshot";
import { peekValueCache, clearValueCache } from "./valueCache";
import { portfolioValue, portfolioGain, portfolioROI, setCost } from "./portfolio";

beforeEach(() => {
  localStorage.clear();
  clearValueCache(); // drop valueCache's module-level memo between tests
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// A fixed, fully-populated localStorage user-data fixture (every census key set to a
// stable non-default value). Deterministic → its dedupHash is a stable golden.
function seedFixture() {
  localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497", qty: 1 }]));
  localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify([{ setNumber: "75192" }]));
  localStorage.setItem("brickEconomyCollectionSyncInfo", JSON.stringify({ lastSync: "2026-01-01" }));
  localStorage.setItem("blSoldSets", JSON.stringify([{ setNumber: "21318", soldPrice: 200 }]));
  localStorage.setItem("blPortfolioHistory", JSON.stringify([{ date: "2026-01-01", value: 1000 }]));
  localStorage.setItem("blWantedList", JSON.stringify([{ setNumber: "10300" }]));
  localStorage.setItem("blPurchases", JSON.stringify([{ store: "Amazon", total: 50 }]));
  localStorage.setItem("blStores", JSON.stringify(["Amazon", "Costco"]));
  localStorage.setItem("blStoreBudgets", JSON.stringify({ Amazon: 500 }));
  localStorage.setItem("blAnnualBudget", "5000");
  localStorage.setItem("blDisplayCurrency", "GBP");
}

// A representative restored enrichment snapshot, as P4.3 will write it into localStorage:
// whole-entry maps for the two snapshotted caches (fetchedAt embedded, round-tripped verbatim).
function seedSnapshotCaches() {
  localStorage.setItem("bricksetSetCache", JSON.stringify({
    "brickset_10497-1": { fetchedAt: "2026-06-01T00:00:00.000Z", data: { minifigs: 3, pieces: 3955 } },
  }));
  localStorage.setItem("blValueCache", JSON.stringify({
    "10497-1": { record: { new: { amount: 250, basis: "sold" }, used: null }, fetchedAt: 1717200000000 },
  }));
}

// ── PIN 1 — DEDUP-HASH: byte-identical, projects BACKUP_KEYS-only ──────────────
describe("PIN 1 — dedupHash projects over BACKUP_KEYS only (byte-identical)", () => {
  it("is deterministic for a fixed fixture (a stable golden)", () => {
    seedFixture();
    const h1 = localContentHash();
    const h2 = localContentHash();
    expect(h1).toBe(h2);
    // Golden: the exact fingerprint of this fixture today. If a future change moves it,
    // that is a deliberate sync-format change and must be re-pinned consciously.
    expect(h1).toMatchInlineSnapshot(`"eatfp5"`);
  });

  it("depends ONLY on BACKUP_KEYS fields — a backup differing on every NON-registry field hashes the same", () => {
    const registryBackup = {};
    for (const k of BACKUP_KEYS) {
      const target = k.settings ? (registryBackup.settings ||= {}) : registryBackup;
      target[k.field] = k.kind === "array" ? [{ x: 1 }] : k.kind === "object" ? { x: 1 } : "v";
    }
    const a = JSON.parse(JSON.stringify(registryBackup));
    const b = JSON.parse(JSON.stringify(registryBackup));
    // Mutate ONLY non-registry fields on `b` (timestamp, regeneratable cache, device pref, junk).
    b.exportedAt = "2099-12-31T00:00:00.000Z";
    b.brickEconomySetCache = { huge: "x".repeat(1000) };
    b.settings.autoExportDays = 99;
    b.somethingElse = { random: true };
    expect(dedupHash(b)).toBe(dedupHash(a));
  });

  it("DOES change when a registry field changes (the projection is not vacuous)", () => {
    seedFixture();
    const before = localContentHash();
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497", qty: 2 }]));
    expect(localContentHash()).not.toBe(before);
  });
});

// ── PIN 2 — CENSUS: hasAnyLocalData projects over BACKUP_KEYS(census:true) only ─
describe("PIN 2 — hasAnyLocalData (census) projects over BACKUP_KEYS(census:true) only", () => {
  it("genuinely empty device → false (the legitimate silent fresh-device pull still fires)", () => {
    expect(hasAnyLocalData()).toBe(false);
  });

  it("NON-registry keys alone (caches) → still false (census ignores non-registry keys)", () => {
    seedSnapshotCaches();
    localStorage.setItem("brickEconomySetCache", JSON.stringify({ "10497": { pieces: 1 } }));
    expect(hasAnyLocalData()).toBe(false);
  });

  it("a census:true registry key with real data → true", () => {
    seedFixture();
    expect(hasAnyLocalData()).toBe(true);
  });
});

// ── PIN 3 — SIBLING-FIELD INVISIBILITY (the load-bearing test) ─────────────────
// If ANY assertion here fails, the whole P4 mechanism is unsound — STOP and report.
describe("PIN 3 — enrichment snapshot is INVISIBLE to dedupHash AND census (LOAD-BEARING)", () => {
  it("dedupHash: adding backup.enrichmentSnapshot to the backup object leaves the hash byte-identical", () => {
    seedFixture();
    // Build a real backup object the way pushToCloudAuth does, then attach the sibling.
    const base = {};
    for (const k of BACKUP_KEYS) {
      const target = k.settings ? (base.settings ||= {}) : base;
      const raw = localStorage.getItem(k.key);
      target[k.field] = k.kind === "scalar" ? raw : JSON.parse(raw || (k.kind === "array" ? "[]" : "{}"));
    }
    const without = dedupHash(base);

    base.enrichmentSnapshot = {
      v: 1,
      bricksetSetCache: { "brickset_10497-1": { fetchedAt: "2026-06-01T00:00:00.000Z", data: { minifigs: 3 } } },
      blValueCache: { "10497-1": { record: { new: { amount: 250, basis: "sold" } }, fetchedAt: 1717200000000 } },
    };
    expect(dedupHash(base)).toBe(without);

    // …and remains identical regardless of the snapshot's CONTENTS (so a background refresh
    // that changes the snapshot can never mark the device dirty → no push churn).
    base.enrichmentSnapshot.blValueCache["10497-1"].record.new.amount = 9999;
    base.enrichmentSnapshot.bricksetSetCache = {};
    expect(dedupHash(base)).toBe(without);
  });

  it("census: a device holding ONLY the restored snapshot caches still reads as a FRESH device", () => {
    // The restore (P4.3) writes bricksetSetCache + blValueCache into localStorage. A fresh
    // device that has nothing BUT a restored snapshot must still census as empty, or it would
    // skip the silent cloud pull and stay cold (defeating P4) — SYNC-CRIT-1 / A4 class.
    seedSnapshotCaches();
    expect(hasAnyLocalData()).toBe(false);
  });

  it("census: the snapshot caches do not change the census verdict when real data IS present", () => {
    seedFixture();
    const withoutSnapshot = hasAnyLocalData();
    seedSnapshotCaches();
    expect(hasAnyLocalData()).toBe(withoutSnapshot); // true either way — snapshot is inert to census
  });

  it("localContentHash: seeding the snapshot caches into localStorage does not change the sync hash", () => {
    seedFixture();
    const before = localContentHash();
    seedSnapshotCaches();
    expect(localContentHash()).toBe(before);
  });
});

// ── PIN 4 — ATOMIC-APPLY + OBS-2, and the restore slot can't break it ──────────
function failSetItemFrom(n = 1) {
  const real = Storage.prototype.setItem;
  let calls = 0;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (k, v) {
    calls += 1;
    if (calls >= n) { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
    return real.call(this, k, v);
  });
}
function fullBackup() {
  return {
    version: 2,
    ownedSets: [{ a: 1 }], brickEconomyNormalized: [{ a: 1 }], brickEconomySyncInfo: { a: 1 },
    soldSets: [{ a: 1 }], portfolioHistory: [{ a: 1 }], wantedList: [{ a: 1 }],
    budgetPurchases: [{ a: 1 }], stores: ["Amazon"], storeBudgets: { Amazon: 1 },
    annualBudget: 5000, settings: { currency: "GBP" },
  };
}

describe("PIN 4 — atomic apply (OBS-2) + a failing post-apply cache-only step does NOT break it", () => {
  it("apply is atomic: a mid-way quota failure rolls back to nothing (no mixed state)", () => {
    failSetItemFrom(3); // 1st + 2nd land, 3rd onward throw
    const res = applyBackupToLocalStorage(fullBackup());
    expect(res.ok).toBe(false);
    expect(res.applied).toEqual([]);            // rolled back → nothing remains applied
    expect(res.failedKey).toBe(BACKUP_KEYS[2].key);
    expect(localStorage.getItem(BACKUP_KEYS[0].key)).toBeNull(); // reverted
    expect(localStorage.getItem(BACKUP_KEYS[1].key)).toBeNull();
  });

  it("the restore SLOT: the REAL restoreEnrichmentSnapshot failing AFTER a successful apply cannot corrupt user data", () => {
    // 1) A successful atomic apply of cloud user-data + mark synced → device is settled.
    const cloud = { version: 2, ownedSets: [{ setNumber: "CLOUD" }], wantedList: [{ setNumber: "W" }], settings: { currency: "USD" } };
    expect(applyBackupToLocalStorage(cloud).ok).toBe(true);
    markSynced(cloud, "user_1");
    const ownedAfterApply = localStorage.getItem("blOwnedSets");
    const hashAfterApply = localContentHash(); // the device fingerprint to hold invariant

    // 2) Now the REAL P4.3 restore step writes the snapshot caches and HITS QUOTA. It runs OUTSIDE
    //    the atomic block; restoreEnrichmentSnapshot swallows quota → returns false, never throws.
    failSetItemFrom(1);
    let threw = false;
    let ok = true;
    try {
      ok = restoreEnrichmentSnapshot({
        v: 1,
        bricksetSetCache: { "brickset_10497-1": { fetchedAt: "2026-06-01T00:00:00.000Z", data: { minifigs: 3 } } },
        blValueCache: { "10497-1": { record: { new: { amount: 250, basis: "sold" } }, fetchedAt: 1717200000000 } },
      });
    } catch { threw = true; }
    vi.restoreAllMocks();

    // 3) The failed restore neither threw nor advanced any state: user data is byte-for-byte
    //    its post-apply self, the sync fingerprint is unchanged, and only the cache seed was skipped.
    expect(threw).toBe(false);
    expect(ok).toBe(false);                                 // cold-but-correct: seed failed, reported false
    expect(localStorage.getItem("blOwnedSets")).toBe(ownedAfterApply);
    expect(localContentHash()).toBe(hashAfterApply);       // fingerprint unchanged → no spurious re-push
    expect(localStorage.getItem("bricksetSetCache")).toBeNull(); // cache seed skipped (cold-but-correct)
  });
});

// ── PIN 5 — A4 (unsynced-wipe refusal), invariant to the snapshot ──────────────
// A4: clearLocalUserData must NEVER destroy unsynced/dirty USER data (offline / failed-sync
// sign-out). The decision derives from the census (BACKUP_KEYS census:true) vs blLastPushHash —
// so the presence of (regeneratable) snapshot caches must not change the verdict either way.
describe("PIN 5 — A4 unsynced-wipe refusal is invariant to the snapshot caches", () => {
  it("dirty user data + snapshot caches present → still refuses { skipped: 'unsynced' }", () => {
    seedFixture();
    seedSnapshotCaches();
    expect(clearLocalUserData()).toEqual({ skipped: "unsynced" }); // never pushed → dirty
    expect(localStorage.getItem("blOwnedSets")).not.toBeNull();
  });

  it("cleanly-synced user data + snapshot caches present → wipes (and clears the caches too)", () => {
    seedFixture();
    localStorage.setItem("blLastPushHash", localContentHash()); // mark in-sync (snapshot is hash-invisible)
    seedSnapshotCaches();
    expect(clearLocalUserData()).toEqual({ cleared: true });
    expect(localStorage.getItem("blOwnedSets")).toBeNull();
    expect(localStorage.getItem("bricksetSetCache")).toBeNull(); // wiped by the bl/brickset prefix superset
    expect(localStorage.getItem("blValueCache")).toBeNull();
  });
});

// ── PIN 6 — PUSH PAYLOAD: the enrichmentSnapshot field is ADDITIVE (P4.2) ───────
// P4.2 wired `backup.enrichmentSnapshot = buildEnrichmentSnapshot()` onto the push body at the
// BE-strip slot. This pins that the change is PURELY ADDITIVE: every pre-existing field byte-
// identical, brickEconomySetCache still stripped, dedupHash + census byte-identical to a body
// WITHOUT the sibling — exactly one new top-level key (`enrichmentSnapshot`) appears.
async function capturePushBody() {
  let body = null;
  const fetchMock = vi.fn(async (_url, opts) => { body = opts.body; return { status: 200, ok: true, json: async () => ({ savedAt: "2026-06-06T00:00:00.000Z" }) }; });
  vi.stubGlobal("fetch", fetchMock);
  const res = await pushToCloudAuth(async () => "tok");
  return { body: JSON.parse(body), res, fetchMock };
}

describe("PIN 6 — push payload: enrichmentSnapshot is an ADDITIVE sibling field", () => {
  // The pre-P4.2 baseline top-level key-set (registry fields + the 4 wrapper keys), STILL minus
  // brickEconomySetCache. P4.2 adds EXACTLY one key to this.
  const baselineKeys = [
    "version", "app", "exportedAt", "settings",
    ...BACKUP_KEYS.filter((k) => !k.settings).map((k) => k.field),
  ];

  it("the body GAINS exactly `enrichmentSnapshot`; every pre-existing field is byte-identical; BE still stripped", async () => {
    seedFixture();
    const { body, fetchMock } = await capturePushBody();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Exactly one new top-level key vs the baseline.
    expect(Object.keys(body).sort()).toEqual([...baselineKeys, "enrichmentSnapshot"].sort());
    expect("enrichmentSnapshot" in body).toBe(true);    // P4.2 — now attached
    expect("brickEconomySetCache" in body).toBe(false); // still stripped before push

    // Pre-existing fields byte-identical: strip the new sibling and the residue is the old baseline.
    const { enrichmentSnapshot, ...rest } = body;
    expect(Object.keys(rest).sort()).toEqual(baselineKeys.sort());
    expect(rest.version).toBe(2);
    expect(rest.app).toBe("BrickLedger");
    expect(rest.ownedSets).toEqual([{ setNumber: "10497", qty: 1 }]);
    expect(rest.settings.currency).toBe("GBP");
    expect(typeof rest.exportedAt).toBe("string"); // ISO timestamp (the only volatile field)

    // The sibling has the buildEnrichmentSnapshot shape (empty caches → well-defined empty shape).
    expect(enrichmentSnapshot).toEqual({ v: 1, bricksetSetCache: {}, blValueCache: {} });
  });

  it("ADDITIVE to dedupHash AND census: both byte-identical to a body WITHOUT the sibling (no churn)", async () => {
    // Seed the snapshot caches too, so the sibling carries REAL entries — the hash must still ignore it.
    seedFixture();
    seedSnapshotCaches();
    const censusBefore = hasAnyLocalData();
    const { body } = await capturePushBody();

    // The sibling now carries entries…
    expect(Object.keys(body.enrichmentSnapshot.bricksetSetCache).length).toBeGreaterThan(0);
    expect(Object.keys(body.enrichmentSnapshot.blValueCache).length).toBeGreaterThan(0);

    // …yet dedupHash is byte-identical with vs without it (BACKUP_KEYS-only projection — PIN 3 in prod).
    const withoutSibling = { ...body };
    delete withoutSibling.enrichmentSnapshot;
    expect(dedupHash(body)).toBe(dedupHash(withoutSibling));

    // …and census is unchanged by the snapshot caches (they are not registry/user data).
    expect(hasAnyLocalData()).toBe(censusBefore);
  });

  it("a second push with no change is skipped (no_change) — the dedup guard is active", async () => {
    seedFixture();
    const first = await capturePushBody();
    expect(first.res).toMatchObject({ savedAt: "2026-06-06T00:00:00.000Z" });
    // pushToCloudAuth recorded blLastPushHash on success → an identical re-push short-circuits.
    const fetchMock2 = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock2);
    const res2 = await pushToCloudAuth(async () => "tok");
    expect(res2).toEqual({ skipped: "no_change" });
    expect(fetchMock2).not.toHaveBeenCalled();
  });
});

// ── PIN 7 — MONEY / ENRICHMENT GOLDEN (carried from the P3 net, unchanged) ─────
describe("PIN 7 — money/enrichment golden (1050 / 700 / 350 / 50 + counts) — carried unchanged", () => {
  const SETS = [
    { setNumber: "10300-1", condition: "new", quantity: 1, totalPaid: 100, minifigs: 2, pieces: 1872 },
    { setNumber: "75192-1", condition: "new", quantity: 2, totalPaid: 600, minifigs: 4, pieces: 7541 },
  ];
  it("value / cost / gain / ROI + minifig & piece totals match the golden", () => {
    localStorage.setItem("blValueCache", JSON.stringify({
      "10300-1": { record: { new: { amount: 250, basis: "sold", lots: 5, asOf: "2026-06-01" }, used: null }, fetchedAt: Date.now() },
      "75192-1": { record: { new: { amount: 800, basis: "sold", lots: 3, asOf: "2026-06-01" }, used: null }, fetchedAt: Date.now() },
    }));
    const valueMap = peekValueCache(["10300-1", "75192-1"]);

    expect(portfolioValue(SETS, valueMap)).toBe(1050);
    expect(SETS.reduce((s, x) => s + setCost(x), 0)).toBe(700);
    expect(portfolioGain(SETS, valueMap)).toBe(350);
    expect(portfolioROI(SETS, valueMap)).toBe(50);
    expect(SETS.reduce((s, x) => s + (x.minifigs || 0) * (x.quantity || 1), 0)).toBe(10);
    expect(SETS.reduce((s, x) => s + (x.pieces || 0) * (x.quantity || 1), 0)).toBe(16954);
  });
});
