import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// P4.1 — INERT enrichment-snapshot helpers (buildEnrichmentSnapshot /
// restoreEnrichmentSnapshot). These build/restore the snapshot over the cache
// modules' getRaw/saveRaw chokepoint; nothing in the sync round-trip calls them
// yet (P4.2 wires push, P4.3 wires restore). Tests cover:
//   • round-trip: build → restore → getRaw byte-identical, timestamps verbatim
//   • memo reconciled after restore (a post-restore peek sees restored entries)
//   • cache set is EXACTLY {bricksetSetCache, blValueCache}
//   • empty / missing snapshot → safe no-op
//   • quota failure → returns false, no throw ("cold-but-correct")
// ─────────────────────────────────────────────────────────────────────────────

// readSource (pulled in via valueCache/brickset) toasts on "broke" failures; keep it inert.
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
// No network is exercised here, but the modules import apiFetch — keep it inert.
const apiFetchMock = vi.fn();
vi.mock("./apiFetch", () => ({ apiFetch: (...a) => apiFetchMock(...a) }));

import { buildEnrichmentSnapshot, restoreEnrichmentSnapshot } from "./enrichmentSnapshot";
import { getBricksetCache, clearBricksetCache, fetchBricksetSet } from "./brickset";
import { getValueCacheRaw, clearValueCache, peekValueCache } from "./valueCache";
import { applyBackupToLocalStorage } from "./exportBackup";

// Fixed whole-entry maps as they live in localStorage: ISO `fetchedAt` for brickset,
// ms-epoch `fetchedAt` for value. Stamped in the past but WITHIN their TTL (7d / 24h) so a
// post-restore peek (fresh-only) returns them.
const FRESH_BRICKSET_ISO = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago (<7d)
const FRESH_VALUE_MS = Date.now() - 60 * 60 * 1000;                              // 1h ago (<24h)

function bricksetMap() {
  return {
    "brickset_10497-1": { fetchedAt: FRESH_BRICKSET_ISO, data: { set_number: "10497-1", minifigs: 3, pieces: 3955 } },
    "brickset_75192-1": { fetchedAt: FRESH_BRICKSET_ISO, data: { set_number: "75192-1", minifigs: 4, pieces: 7541 } },
  };
}
function valueMap() {
  return {
    "10497-1": { record: { new: { amount: 250, basis: "sold" }, used: null }, fetchedAt: FRESH_VALUE_MS },
    "75192-1": { record: { new: { amount: 800, basis: "sold" }, used: null }, fetchedAt: FRESH_VALUE_MS },
  };
}

beforeEach(() => {
  localStorage.clear();
  clearBricksetCache(); // drop module memos so a stale memo can't leak across tests
  clearValueCache();
  localStorage.clear(); // clear() above writes "{}"; reset to truly empty
  apiFetchMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("buildEnrichmentSnapshot — exactly two caches, whole entries, verbatim timestamps", () => {
  it("reads bricksetSetCache + blValueCache verbatim into the snapshot shape", () => {
    localStorage.setItem("bricksetSetCache", JSON.stringify(bricksetMap()));
    localStorage.setItem("blValueCache", JSON.stringify(valueMap()));

    const snap = buildEnrichmentSnapshot();
    expect(snap.v).toBe(1);
    expect(snap.bricksetSetCache).toEqual(bricksetMap()); // byte-identical (incl. ISO fetchedAt)
    expect(snap.blValueCache).toEqual(valueMap());        // byte-identical (incl. ms fetchedAt)
  });

  it("the snapshot's cache set is EXACTLY {bricksetSetCache, blValueCache} (no BE, no priceguide)", () => {
    // Seed the EXCLUDED caches too — they must NOT appear in the snapshot.
    localStorage.setItem("bricksetSetCache", JSON.stringify(bricksetMap()));
    localStorage.setItem("blValueCache", JSON.stringify(valueMap()));
    localStorage.setItem("brickEconomySetCache", JSON.stringify({ "10497": { data: { pieces: 1 }, fetchedAt: FRESH_BRICKSET_ISO } }));
    localStorage.setItem("blPriceGuideCache", JSON.stringify({ "10497-1": { data: { qty: 1 }, cachedAt: FRESH_VALUE_MS } }));

    const snap = buildEnrichmentSnapshot();
    expect(Object.keys(snap).sort()).toEqual(["blValueCache", "bricksetSetCache", "v"]);
    expect(snap).not.toHaveProperty("brickEconomySetCache");
    expect(snap).not.toHaveProperty("blPriceGuideCache");
  });

  it("empty / missing caches → well-defined empty shape ({}), never undefined", () => {
    const snap = buildEnrichmentSnapshot();
    expect(snap).toEqual({ v: 1, bricksetSetCache: {}, blValueCache: {} });
  });
});

describe("restoreEnrichmentSnapshot — verbatim round-trip + memo reconcile", () => {
  it("round-trip: build → clear → restore → getRaw is byte-identical (timestamps verbatim)", () => {
    localStorage.setItem("bricksetSetCache", JSON.stringify(bricksetMap()));
    localStorage.setItem("blValueCache", JSON.stringify(valueMap()));
    const snap = buildEnrichmentSnapshot();

    // Simulate a fresh device: wipe both caches entirely.
    localStorage.clear();
    clearBricksetCache(); clearValueCache(); localStorage.clear();
    expect(getBricksetCache()).toEqual({});
    expect(getValueCacheRaw()).toEqual({});

    const ok = restoreEnrichmentSnapshot(snap);
    expect(ok).toBe(true);
    expect(getBricksetCache()).toEqual(bricksetMap()); // byte-identical restore
    expect(getValueCacheRaw()).toEqual(valueMap());
    // Timestamps survived verbatim (no re-stamp): the exact stored fetchedAt values round-tripped.
    expect(getBricksetCache()["brickset_10497-1"].fetchedAt).toBe(FRESH_BRICKSET_ISO);
    expect(getValueCacheRaw()["10497-1"].fetchedAt).toBe(FRESH_VALUE_MS);
  });

  it("memo reconciled: a fresh peek/fetch sees restored entries (no network)", async () => {
    const snap = { v: 1, bricksetSetCache: bricksetMap(), blValueCache: valueMap() };
    restoreEnrichmentSnapshot(snap);

    // valueCache: peekValueCache (memo+store, fresh-only) returns the restored records, no fetch.
    const peeked = peekValueCache(["10497-1", "75192-1"]);
    expect(peeked["10497-1"]).toEqual({ new: { amount: 250, basis: "sold" }, used: null });

    // brickset: fetchBricksetSet reads via the memo-aware peek; a fresh restored entry short-circuits
    // the network entirely (apiFetch must not be called).
    const hit = await fetchBricksetSet("10497-1");
    expect(hit).toEqual({ set_number: "10497-1", minifigs: 3, pieces: 3955 });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("only non-empty sub-caches are written (an empty sub-cache is not seeded)", () => {
    const ok = restoreEnrichmentSnapshot({ v: 1, bricksetSetCache: bricksetMap(), blValueCache: {} });
    expect(ok).toBe(true);
    expect(getBricksetCache()).toEqual(bricksetMap());
    // blValueCache had no entries → no write happened → localStorage key absent.
    expect(localStorage.getItem("blValueCache")).toBeNull();
  });
});

describe("restoreEnrichmentSnapshot — safe no-ops", () => {
  it("missing / null / non-object snapshot → no-op true, no write, no throw", () => {
    for (const bad of [undefined, null, 42, "x", []]) {
      expect(() => restoreEnrichmentSnapshot(bad)).not.toThrow();
      expect(restoreEnrichmentSnapshot(bad)).toBe(true);
    }
    expect(localStorage.getItem("bricksetSetCache")).toBeNull();
    expect(localStorage.getItem("blValueCache")).toBeNull();
  });

  it("empty snapshot ({} sub-caches) → no-op true, no write", () => {
    expect(restoreEnrichmentSnapshot({ v: 1, bricksetSetCache: {}, blValueCache: {} })).toBe(true);
    expect(localStorage.getItem("bricksetSetCache")).toBeNull();
    expect(localStorage.getItem("blValueCache")).toBeNull();
  });
});

// ── P4.3 — the applyCloudBackup cold-start SEQUENCE (atomic apply → restore) ────
// App.jsx applyCloudBackup runs: applyBackupToLocalStorage(cloud) [atomic] → on ok,
// restoreEnrichmentSnapshot(cloud.enrichmentSnapshot) [cache-only, OUTSIDE the block] → markSynced.
// These integration tests replicate that exact sequence (the closure itself isn't unit-importable).
describe("P4.3 — cold-start apply sequence: warm-start + old-backup grace", () => {
  it("WARM PROOF: a cloud backup carrying a snapshot → caches populated, fetch/peek short-circuit (no apiFetch)", async () => {
    const cloud = {
      version: 2,
      ownedSets: [{ setNumber: "10497", qty: 1 }],
      settings: { currency: "USD" },
      enrichmentSnapshot: { v: 1, bricksetSetCache: bricksetMap(), blValueCache: valueMap() },
    };

    // The applyCloudBackup body: atomic apply (user data), then restore (caches) outside the block.
    expect(applyBackupToLocalStorage(cloud).ok).toBe(true);
    expect(restoreEnrichmentSnapshot(cloud.enrichmentSnapshot)).toBe(true);

    // User data applied…
    expect(JSON.parse(localStorage.getItem("blOwnedSets"))).toEqual([{ setNumber: "10497", qty: 1 }]);
    // …and the device is WARM: both caches seeded, and the cold-start read paths short-circuit.
    expect(getBricksetCache()).toEqual(bricksetMap());
    expect(getValueCacheRaw()).toEqual(valueMap());

    const hit = await fetchBricksetSet("10497-1");
    expect(hit).toEqual({ set_number: "10497-1", minifigs: 3, pieces: 3955 });
    expect(peekValueCache(["10497-1"])["10497-1"]).toEqual({ new: { amount: 250, basis: "sold" }, used: null });
    expect(apiFetchMock).not.toHaveBeenCalled(); // no minifig trickle / value re-batch
  });

  it("OLD-BACKUP GRACE: a backup with NO enrichmentSnapshot → no-op, no throw, user data intact (cold)", () => {
    const cloud = { version: 2, ownedSets: [{ setNumber: "75192", qty: 2 }], settings: { currency: "USD" } };

    expect(applyBackupToLocalStorage(cloud).ok).toBe(true);
    expect(() => restoreEnrichmentSnapshot(cloud.enrichmentSnapshot)).not.toThrow(); // undefined → safe no-op
    expect(restoreEnrichmentSnapshot(cloud.enrichmentSnapshot)).toBe(true);

    expect(JSON.parse(localStorage.getItem("blOwnedSets"))).toEqual([{ setNumber: "75192", qty: 2 }]); // intact
    expect(localStorage.getItem("bricksetSetCache")).toBeNull(); // cold, as today
    expect(localStorage.getItem("blValueCache")).toBeNull();
  });
});

describe("restoreEnrichmentSnapshot — quota failure is cold-but-correct", () => {
  it("a quota failure on the mirror returns false WITHOUT throwing (cold-but-correct)", () => {
    // setItem throws QuotaExceededError → setItemSafe swallows it (returns false) → saveRaw false.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      const e = new Error("full"); e.name = "QuotaExceededError"; throw e;
    });
    let result, threw = false;
    try { result = restoreEnrichmentSnapshot({ v: 1, bricksetSetCache: bricksetMap(), blValueCache: valueMap() }); }
    catch { threw = true; }
    expect(threw).toBe(false);
    expect(result).toBe(false);
  });
});
