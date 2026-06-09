import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// P4.4.1 — CHARACTERIZATION + TARGET NET for the ENRICHMENT-SNAPSHOT FORCE-PUSH.
//
// P4.4 forces a snapshot push when enrichment COMPLETES (coverage grew), so a
// fresh device comes back fully warm instead of re-climbing the trickle. The
// authoritative design is docs/enrichment-p4.4-plan.md. This net pins the
// invariants the build must respect and specifies the force/gate contract as
// tests, so P4.4.2 (push side) / P4.4.3 (hook side) build against a net.
//
// This is a SIBLING to exportBackup.snapshot.test.js (the P4.0 net) — it EXTENDS
// the P4.0 PINs (esp. PIN 3 sibling-invisibility, PIN 6 push-skip), never
// duplicates them. NO production code is touched here.
//
// Each test is tagged:
//   [CHAR]   characterization — pins CURRENT behavior; green now.
//   [TARGET] specifies the NEW behavior the build will satisfy — written against
//            the PLAN-locked interface (snapshotRefresh flag, pushSnapshotIfGrown,
//            blLastSnapshotSig, brickledger:enrichmentsettled) and SKIPPED with a
//            TODO at its build step until that step lands. Future-only symbols are
//            reached via dynamic import INSIDE the skipped body, so the missing
//            export can never break the module load of the green tests.
//
// Areas (mapped to the P4.4.1 brief):
//   1. PUSH-SKIP      — snapshot-only growth is invisible → the push skips (what force bypasses)
//   2. GATE SIGNATURE — count(bricksetSetCache):count(blValueCache); strict-greater fires
//   3. FORCE-PUSH     — snapshotRefresh bypasses ONLY the equality short-circuit
//   4. RESTORE-SEED   — applyCloudBackup seeds blLastSnapshotSig → no echo re-push
//   5. DOUBLE-PUSH    — normal + forced push share the gate state → no double upload
//   6. INVARIANTS     — BACKUP_KEYS / strict-leaf / atomic-apply / golden unchanged
// ─────────────────────────────────────────────────────────────────────────────

// readSource (pulled in via valueCache) toasts on "broke" failures; keep it inert.
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import {
  dedupHash,
  localContentHash,
  hasAnyLocalData,
  applyBackupToLocalStorage,
  pushToCloudAuth,
  pushSnapshotIfGrown,
  snapshotSig,
  BACKUP_KEYS,
} from "./exportBackup";
import { restoreEnrichmentSnapshot } from "./enrichmentSnapshot";
import { getBricksetCache, restoreBricksetSnapshot } from "./brickset";
import { getValueCacheRaw, restoreValueCache, clearValueCache } from "./valueCache";
import { setItemSafe } from "./safeStorage";

beforeEach(() => {
  localStorage.clear();
  clearValueCache(); // drop valueCache's module-level memo between tests
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Fully-populated user-data fixture (every census key a stable non-default value),
// so hasAnyLocalData() → true and a push is not short-circuited by { skipped: "no_data" }.
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

// Whole-entry cache maps the snapshot snapshots, sized to caller-chosen counts.
// Entry shapes are byte-identical to what restoreEnrichmentSnapshot writes.
function bricksetMap(n) {
  const m = {};
  for (let i = 0; i < n; i++) {
    m[`brickset_900${i}-1`] = { fetchedAt: "2026-06-01T00:00:00.000Z", data: { minifigs: i, pieces: 100 + i } };
  }
  return m;
}
function valueMap(n) {
  const m = {};
  for (let i = 0; i < n; i++) {
    m[`900${i}-1`] = { record: { new: { amount: 100 + i, basis: "sold" }, used: null }, fetchedAt: 1717200000000 };
  }
  return m;
}
// Seed the two snapshot caches to (bsCount, valCount) entries via the real restore chokepoints.
function seedCoverage(bsCount, valCount) {
  if (bsCount > 0) restoreBricksetSnapshot(bricksetMap(bsCount));
  if (valCount > 0) restoreValueCache(valueMap(valCount));
}

// Mock fetch for a successful POST and capture how many times /api/sync was hit.
function mockSyncOK(savedAt = "2026-06-06T00:00:00.000Z") {
  const fetchMock = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ savedAt }) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const TOKEN = async () => "tok";

// ── AREA 1 — PUSH-SKIP: snapshot-only growth is INVISIBLE → the push skips ──────
// [CHAR] Extends P4.0 PIN 6 ("second push with no change skipped"): here the
// snapshot caches GROW between the two pushes, yet the second still reads no_change
// — proving an enrichment-only change is invisible to the push. THIS is exactly the
// skip the force-push (Area 3) must surgically bypass WITHOUT altering it.
describe("AREA 1 — PUSH-SKIP: enrichment-only growth is invisible to the dedup skip [CHAR]", () => {
  it("[CHAR] localContentHash is byte-identical before/after the snapshot caches grow", () => {
    seedFixture();
    const before = localContentHash();
    seedCoverage(3, 3);                       // real cache growth, not a hand-built object (cf. PIN 3)
    expect(Object.keys(getBricksetCache()).length).toBe(3);
    expect(Object.keys(getValueCacheRaw()).length).toBe(3);
    expect(localContentHash()).toBe(before);  // the sig the push compares is unmoved
  });

  it("[CHAR] a second push after snapshot-only growth returns { skipped: 'no_change' } (no POST)", async () => {
    seedFixture();
    const fetch1 = mockSyncOK();
    const first = await pushToCloudAuth(TOKEN);
    expect(first).toMatchObject({ savedAt: "2026-06-06T00:00:00.000Z" });
    expect(fetch1).toHaveBeenCalledTimes(1);  // first push recorded blLastPushHash

    // Grow ONLY the enrichment caches — no BACKUP_KEYS field moves.
    seedCoverage(5, 4);

    const fetch2 = mockSyncOK();
    const second = await pushToCloudAuth(TOKEN);
    expect(second).toEqual({ skipped: "no_change" }); // enrichment growth invisible → still skips
    expect(fetch2).not.toHaveBeenCalled();
  });
});

// ── AREA 2 — GATE SIGNATURE: monotonic key-growth, strict-greater fires ─────────
// The signature is `${count(bricksetSetCache)}:${count(blValueCache)}` and growth
// is "either count strictly greater than the stored sig". §3 of the plan justifies
// entry-COUNTS (not a content hash) by the claim that each enrichment write ADDS a
// key, so coverage growth is monotonic key growth.
describe("AREA 2 — GATE SIGNATURE: coverage growth is monotonic key growth", () => {
  it("[CHAR] each restored entry adds a key; the snapshot caches' key-counts track coverage", () => {
    // Pins the building block the count-based signature rests on: counts ARE the coverage.
    seedCoverage(2, 1);
    expect(Object.keys(getBricksetCache()).length).toBe(2);
    expect(Object.keys(getValueCacheRaw()).length).toBe(1);
    seedCoverage(4, 3);                       // a later, fuller enrichment cycle
    expect(Object.keys(getBricksetCache()).length).toBe(4); // grew
    expect(Object.keys(getValueCacheRaw()).length).toBe(3); // grew
  });

  it("[TARGET P4.4.2] snapshotSig(snapshot) === `${count(bricksetSetCache)}:${count(blValueCache)}`", () => {
    expect(snapshotSig({ v: 1, bricksetSetCache: bricksetMap(3), blValueCache: valueMap(2) })).toBe("3:2");
    expect(snapshotSig({ v: 1, bricksetSetCache: {}, blValueCache: {} })).toBe("0:0");
    expect(snapshotSig(null)).toBe("0:0");    // absent snapshot ⇒ 0:0 baseline
  });

  it("[TARGET P4.4.2] pushSnapshotIfGrown fires on strict-greater, skips on equal/lower (anti-storm)", async () => {
    seedFixture();

    // prev = 2:2; growth in EITHER count must fire.
    localStorage.setItem("blLastSnapshotSig", "2:2");
    seedCoverage(3, 2);                       // bs grew (3>2), val equal → fires
    const f1 = mockSyncOK();
    expect(await pushSnapshotIfGrown(TOKEN)).toMatchObject({ savedAt: expect.any(String) });
    expect(f1).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("blLastSnapshotSig")).toBe("3:2"); // sig advanced to current coverage

    // Equal coverage → no growth → skip, no POST.
    const f2 = mockSyncOK();
    expect(await pushSnapshotIfGrown(TOKEN)).toEqual({ skipped: "snapshot_no_growth" });
    expect(f2).not.toHaveBeenCalled();

    // Lower coverage (an eviction/TTL drop) → strict-greater is false → skip, no POST.
    localStorage.setItem("blLastSnapshotSig", "9:9");
    const f3 = mockSyncOK();
    expect(await pushSnapshotIfGrown(TOKEN)).toEqual({ skipped: "snapshot_no_growth" });
    expect(f3).not.toHaveBeenCalled();
  });

  it("[TARGET P4.4.2] absent blLastSnapshotSig ⇒ prev 0:0 ⇒ any coverage counts as growth", async () => {
    seedFixture();
    seedCoverage(1, 0);                        // 1:0 vs absent(0:0) → grew
    const f = mockSyncOK();
    expect(await pushSnapshotIfGrown(TOKEN)).toMatchObject({ savedAt: expect.any(String) });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

// ── AREA 3 — FORCE-PUSH: snapshotRefresh bypasses ONLY the equality short-circuit ─
describe("AREA 3 — FORCE-PUSH: snapshotRefresh bypasses the skip, leaves dedup semantics intact", () => {
  it("[P4.4.3 SKIP-SET GUARD] writing blLastSnapshotSig must NOT dispatch brickledger:datachange (no churn loop)", () => {
    // blLastSnapshotSig is bl-prefixed; without it being in SYNC_SKIP_KEYS, setItemSafe would raise
    // brickledger:datachange → the datachange push effect → which records blLastSnapshotSig → … a
    // self-perpetuating push loop (the churn caught in P4.4.2). Pin that the gate write is silent.
    let datachange = 0;
    const onChange = () => { datachange++; };
    window.addEventListener("brickledger:datachange", onChange);
    expect(setItemSafe("blLastSnapshotSig", "5:5")).toBe(true); // a real value change…
    expect(setItemSafe("blLastSnapshotSig", "6:6")).toBe(true); // …and again
    window.removeEventListener("brickledger:datachange", onChange);
    expect(datachange).toBe(0); // …yet no datachange fired → no auto-push churn
  });

  it("[CHAR] blLastSnapshotSig is a non-registry bl-key → invisible to dedupHash AND census", () => {
    // The force-push's gate state must live OUTSIDE the BACKUP_KEYS projection (same class as
    // blLastPushHash), so recording it can never churn the push or drift the census.
    seedFixture();
    const hBefore = localContentHash();
    const censusBefore = hasAnyLocalData();
    localStorage.setItem("blLastSnapshotSig", "42:17");
    expect(localContentHash()).toBe(hBefore);   // not in the dedup projection
    expect(hasAnyLocalData()).toBe(censusBefore); // not a census key
  });

  it("[TARGET P4.4.2] snapshotRefresh:true POSTs even when dedupHash === blLastPushHash; default still skips", async () => {
    seedFixture();
    const f1 = mockSyncOK();
    await pushToCloudAuth(TOKEN);              // records blLastPushHash
    expect(f1).toHaveBeenCalledTimes(1);

    seedCoverage(5, 4);                         // enrichment-only growth → dedupHash unchanged

    // Default path: the dedup equality short-circuit still fires (PIN 6 preserved).
    const f2 = mockSyncOK();
    expect(await pushToCloudAuth(TOKEN)).toEqual({ skipped: "no_change" });
    expect(f2).not.toHaveBeenCalled();

    // Forced path: bypasses ONLY the equality short-circuit → POSTs the grown snapshot.
    const f3 = mockSyncOK();
    const forced = await pushToCloudAuth(TOKEN, { snapshotRefresh: true });
    expect(forced).toMatchObject({ savedAt: expect.any(String) });
    expect(f3).toHaveBeenCalledTimes(1);
    const body = JSON.parse(f3.mock.calls[0][1].body);
    expect(Object.keys(body.enrichmentSnapshot.bricksetSetCache).length).toBe(5); // grown snapshot uploaded
    expect(Object.keys(body.enrichmentSnapshot.blValueCache).length).toBe(4);
  });

  it("[TARGET P4.4.2] a forced push STILL records blLastPushHash + blLastSnapshotSig (dedup unaffected)", async () => {
    seedFixture();
    const f1 = mockSyncOK();
    await pushToCloudAuth(TOKEN);
    const hashAfterNormal = localStorage.getItem("blLastPushHash");
    expect(f1).toHaveBeenCalledTimes(1);

    seedCoverage(2, 2);
    mockSyncOK();
    await pushToCloudAuth(TOKEN, { snapshotRefresh: true });

    // blLastPushHash is STILL recorded — its value is UNCHANGED (no BACKUP_KEYS field moved),
    // so the next NORMAL push correctly skips. The sig is recorded to the grown coverage.
    expect(localStorage.getItem("blLastPushHash")).toBe(hashAfterNormal);
    expect(localStorage.getItem("blLastSnapshotSig")).toBe("2:2");

    const f3 = mockSyncOK();
    expect(await pushToCloudAuth(TOKEN)).toEqual({ skipped: "no_change" }); // next normal push unaffected
    expect(f3).not.toHaveBeenCalled();
  });
});

// ── AREA 4 — RESTORE-SEED (echo guard): a restored device doesn't re-push what it pulled ─
describe("AREA 4 — RESTORE-SEED: applyCloudBackup seeds blLastSnapshotSig so no echo re-push", () => {
  it("[CHAR] restoreEnrichmentSnapshot lands exactly the snapshot's coverage (the counts the seed reads)", () => {
    // Pins the INPUT the §4 seed depends on: post-restore, the cache key-counts equal the
    // restored snapshot's counts — so seeding blLastSnapshotSig from them yields no growth.
    const snapshot = { v: 1, bricksetSetCache: bricksetMap(6), blValueCache: valueMap(4) };
    expect(restoreEnrichmentSnapshot(snapshot)).toBe(true);
    expect(Object.keys(getBricksetCache()).length).toBe(6);
    expect(Object.keys(getValueCacheRaw()).length).toBe(4);
  });

  it("[TARGET P4.4.2] after the applyCloudBackup seed, an immediate settle shows NO growth", async () => {
    // Mirrors the §4 applyCloudBackup seed sequence (restore → seed blLastSnapshotSig) here.
    seedFixture();
    const snapshot = { v: 1, bricksetSetCache: bricksetMap(6), blValueCache: valueMap(4) };
    restoreEnrichmentSnapshot(snapshot);                          // caches at cloud ceiling
    localStorage.setItem("blLastSnapshotSig", snapshotSig(snapshot)); // the §4 echo-guard seed

    const f = mockSyncOK();
    expect(await pushSnapshotIfGrown(TOKEN)).toEqual({ skipped: "snapshot_no_growth" });
    expect(f).not.toHaveBeenCalled();                            // does NOT re-push the just-pulled coverage
  });
});

// ── AREA 5 — DOUBLE-PUSH / COALESCE: normal + forced push share one gate state ──
describe("AREA 5 — DOUBLE-PUSH: a datachange push and a force-push for the same growth coalesce", () => {
  it("[TARGET P4.4.2] a normal push advances blLastSnapshotSig → the later force-push sees no growth", async () => {
    seedFixture();
    localStorage.setItem("blLastSnapshotSig", "1:1");
    seedCoverage(3, 2);                         // coverage grew since the last sig

    // The opportunistic (datachange) push: a BACKUP_KEYS field changes so it actually POSTs,
    // and on success it records blLastSnapshotSig to the CURRENT coverage.
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497", qty: 99 }]));
    const f1 = mockSyncOK();
    await pushToCloudAuth(TOKEN);
    expect(f1).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("blLastSnapshotSig")).toBe("3:2"); // normal push advanced the gate

    // The enrichmentsettled force-push for the SAME growth now sees no growth → skips. No double upload.
    const f2 = mockSyncOK();
    expect(await pushSnapshotIfGrown(TOKEN)).toEqual({ skipped: "snapshot_no_growth" });
    expect(f2).not.toHaveBeenCalled();
  });

  it("[TARGET P4.4.2] a force-push advances the gate → a subsequent settle for the same coverage skips", async () => {
    seedFixture();
    localStorage.setItem("blLastSnapshotSig", "1:1");
    seedCoverage(4, 4);

    const f1 = mockSyncOK();
    await pushSnapshotIfGrown(TOKEN);           // fires, records sig 4:4
    expect(f1).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("blLastSnapshotSig")).toBe("4:4");

    const f2 = mockSyncOK();
    expect(await pushSnapshotIfGrown(TOKEN)).toEqual({ skipped: "snapshot_no_growth" });
    expect(f2).not.toHaveBeenCalled();          // coalesced — no second upload at the same coverage
  });
});

// ── AREA 6 — INVARIANTS HELD: registry / strict-leaf / atomic-apply unchanged ──
describe("AREA 6 — INVARIANTS: the force-push touches no BACKUP_KEYS / atomic-apply contract [CHAR]", () => {
  it("[CHAR] BACKUP_KEYS is unchanged: no snapshot-sig entry leaks into the sync registry", () => {
    // The gate state (blLastSnapshotSig) must NOT be a registry key — else it would enter the
    // dedupHash projection / census and the whole P4 invisibility argument collapses.
    expect(BACKUP_KEYS).toHaveLength(18);
    const keys = BACKUP_KEYS.map((k) => k.key);
    const fields = BACKUP_KEYS.map((k) => k.field);
    expect(keys).not.toContain("blLastSnapshotSig");
    expect(fields).not.toContain("snapshotSig");
    expect(keys).not.toContain("enrichmentSnapshot"); // the sibling is not a registry key either
  });

  it("[CHAR] atomic apply is unaffected by a pre-existing blLastSnapshotSig (it is not a registry key)", () => {
    localStorage.setItem("blLastSnapshotSig", "7:7"); // gate state present before a cold-start apply
    const cloud = {
      version: 2,
      ownedSets: [{ setNumber: "CLOUD" }],
      wantedList: [{ setNumber: "W" }],
      settings: { currency: "USD" },
    };
    const res = applyBackupToLocalStorage(cloud);
    expect(res.ok).toBe(true);
    expect(JSON.parse(localStorage.getItem("blOwnedSets"))).toEqual([{ setNumber: "CLOUD" }]);
    expect(localStorage.getItem("blLastSnapshotSig")).toBe("7:7"); // apply never touches the gate key
  });

  it("[CHAR] strict-leaf boundary intact: dedupHash ignores the enrichmentSnapshot sibling on a built body", () => {
    // Cross-ref P4.0 PIN 3 — re-pinned here through real localStorage cache growth (not a hand-built
    // object) to guard the force-push's promise that it alters NO dedup semantics.
    seedFixture();
    const built = {};
    for (const k of BACKUP_KEYS) {
      const target = k.settings ? (built.settings ||= {}) : built;
      const raw = localStorage.getItem(k.key);
      target[k.field] = k.kind === "scalar" ? raw : JSON.parse(raw || (k.kind === "array" ? "[]" : "{}"));
    }
    const without = dedupHash(built);
    built.enrichmentSnapshot = { v: 1, bricksetSetCache: bricksetMap(9), blValueCache: valueMap(9) };
    expect(dedupHash(built)).toBe(without); // sibling invisible regardless of its (large) contents
  });
});
