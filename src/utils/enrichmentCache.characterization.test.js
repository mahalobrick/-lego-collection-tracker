import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// P3.0 — CHARACTERIZATION NET for the shared-enrichment-cache refactor.
//
// Pins TODAY's behavior of the 4 PER-ENTRY caches in P3 scope —
//   blValueCache · bricksetSetCache · brickEconomySetCache · blPriceGuideCache
// — so the later generalize-into-one-module refactor (P3.1+) is provably
// behavior-neutral. Each describe block maps to one PIN in the P3.0 brief:
//   1. contents & read/write (hit returns cache, miss falls through)
//   2. TTL math — both timestamp formats + field-name split + priceguide DUAL ttl
//   3. key namespacing — brickset_<n> prefix; BE/priceguide -1 de-variant; value no-strip
//   4. datachange triggers — skip vs fire membership (a guard that breaks on drift)
//   5. sync baseline — dedupHash + pushed payload byte-identical, caches NOT pulled in
//   6. money/enrichment golden — headline value/cost/gain/ROI + minifig/piece counts
//
// NOTE: this net pins CURRENT behavior only — no production code is touched, and
// the divergences (ms-epoch vs ISO ts, fetchedAt vs cachedAt, verbatim vs de-variant
// keys) are pinned AS-IS, not normalized. Normalizing them would be a behavior change.
// ─────────────────────────────────────────────────────────────────────────────

// One apiFetch mock shared by every module under test (all import "./apiFetch").
const apiFetchMock = vi.fn();
vi.mock("./apiFetch", () => ({ apiFetch: (...a) => apiFetchMock(...a) }));
// readSource → toast on "broke" failures; keep it inert.
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import { fetchValues, peekValueCache, clearValueCache } from "./valueCache";
import { fetchBricksetSet } from "./brickset";
import { syncBEValues } from "./beSyncValues";
import { fetchBrickLinkPriceGuide, bulkSyncPrices } from "./bricklink-client";
import { localContentHash, BACKUP_KEYS, exportFullBackup } from "./exportBackup";

// Drive the (unexported) buildBackup through exportFullBackup's Downloads-fallback path
// (jsdom has no showSaveFilePicker) and capture the serialized backup object — same technique
// as exportBackup.roundtrip.test.js, so no production export is added for the test.
async function captureBackup() {
  const RealBlob = globalThis.Blob;
  const _create = URL.createObjectURL, _revoke = URL.revokeObjectURL, _ce = document.createElement;
  let content = null;
  globalThis.Blob = class extends RealBlob { constructor(parts, opts) { content = parts && parts[0]; super(parts, opts); } };
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
  document.createElement = () => ({ href: "", download: "", click() {} });
  try { await exportFullBackup(); }
  finally { globalThis.Blob = RealBlob; URL.createObjectURL = _create; URL.revokeObjectURL = _revoke; document.createElement = _ce; }
  return JSON.parse(content);
}
import { portfolioValue, portfolioGain, portfolioROI, setCost } from "./portfolio";
import { setItemSafe } from "./safeStorage";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();

beforeEach(() => {
  localStorage.clear();
  clearValueCache(); // also drop valueCache's module-level memo between tests
  apiFetchMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

// A /api/values-shaped batch response: { [num]: {new,used}|null }
function valuesResponse(map) {
  return { ok: true, status: 200, json: async () => map };
}
function jsonOk(body) {
  return { ok: true, status: 200, json: async () => body };
}

// ── PIN 1 + 2 + 3 — blValueCache (value records; ms-epoch `fetchedAt`; trim-only key) ──
describe("blValueCache — contents, TTL (ms-epoch), key (trim-only, NO -1 strip)", () => {
  it("stored shape is { [num]: { record, fetchedAt(ms) } } and a fresh peek returns the record (no fetch)", async () => {
    apiFetchMock.mockResolvedValue(valuesResponse({ "10300-1": { new: { amount: 5, basis: "sold", lots: 1, asOf: "2026-06-01" }, used: null } }));
    await fetchValues(["10300-1"]);

    const raw = JSON.parse(localStorage.getItem("blValueCache"));
    expect(Object.keys(raw)).toEqual(["10300-1"]);            // trim-only key — NOT de-varianted
    expect(typeof raw["10300-1"].fetchedAt).toBe("number");   // ms-epoch, not ISO
    expect(raw["10300-1"].record.new.amount).toBe(5);

    apiFetchMock.mockClear();
    const peek = peekValueCache(["10300-1"]);                 // fresh → synchronous hit, no network
    expect(peek["10300-1"].new.amount).toBe(5);
    expect(apiFetchMock).not.toHaveBeenCalled();

    const second = await fetchValues(["10300-1"]);            // fresh → served from cache
    expect(second["10300-1"].new.amount).toBe(5);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("24h TTL boundary: fresh (<24h) peeks; stale (>24h) does not", () => {
    const fresh = { record: { new: { amount: 9, basis: "sold", lots: 1, asOf: "x" }, used: null }, fetchedAt: Date.now() - (DAY - HOUR) };
    localStorage.setItem("blValueCache", JSON.stringify({ "111-1": fresh }));
    expect(peekValueCache(["111-1"])["111-1"].new.amount).toBe(9);

    localStorage.setItem("blValueCache", JSON.stringify({ "111-1": { ...fresh, fetchedAt: Date.now() - (DAY + HOUR) } }));
    expect(peekValueCache(["111-1"])).toEqual({}); // stale → excluded
  });

  it("a miss falls through to /api/values (one fetch for the needed number)", async () => {
    apiFetchMock.mockResolvedValue(valuesResponse({ "999-1": null }));
    await fetchValues(["999-1"]);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(apiFetchMock.mock.calls[0][1].body)).toEqual({ setNumbers: ["999-1"] });
  });
});

// ── PIN 1 + 2 + 3 — bricksetSetCache (data; ISO `fetchedAt`; brickset_<n> verbatim key) ──
describe("bricksetSetCache — contents, TTL (ISO, 7d), key (brickset_<n>, verbatim)", () => {
  it("writes { [brickset_<n>]: { fetchedAt(ISO), data } } verbatim and a fresh entry is served without a fetch", async () => {
    apiFetchMock.mockResolvedValue(jsonOk({ data: { set_number: "75192-1", minifigs: 4, pieces: 7541 } }));
    await fetchBricksetSet("75192-1");

    const raw = JSON.parse(localStorage.getItem("bricksetSetCache"));
    expect(Object.keys(raw)).toEqual(["brickset_75192-1"]);             // prefixed + verbatim (NO -1 strip here)
    expect(typeof raw["brickset_75192-1"].fetchedAt).toBe("string");    // ISO string, not ms
    expect(Number.isNaN(Date.parse(raw["brickset_75192-1"].fetchedAt))).toBe(false);
    expect(raw["brickset_75192-1"].data.minifigs).toBe(4);

    apiFetchMock.mockClear();
    const hit = await fetchBricksetSet("75192-1");                      // fresh within 7d → cache hit
    expect(hit.minifigs).toBe(4);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("7d TTL boundary: <7d hit (no fetch); >7d stale → re-fetch", async () => {
    const data = { set_number: "10300-1", minifigs: 0, pieces: 1872 };
    localStorage.setItem("bricksetSetCache", JSON.stringify({ "brickset_10300-1": { fetchedAt: iso(Date.now() - (7 * DAY - HOUR)), data } }));
    apiFetchMock.mockResolvedValue(jsonOk({ data: { ...data, pieces: 9999 } }));
    expect((await fetchBricksetSet("10300-1")).pieces).toBe(1872);      // fresh → cached value
    expect(apiFetchMock).not.toHaveBeenCalled();

    localStorage.setItem("bricksetSetCache", JSON.stringify({ "brickset_10300-1": { fetchedAt: iso(Date.now() - (7 * DAY + HOUR)), data } }));
    expect((await fetchBricksetSet("10300-1")).pieces).toBe(9999);      // stale → re-fetched value
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── PIN 1 + 2 + 3 — brickEconomySetCache (data; ISO; -1 de-variant key) ──
describe("brickEconomySetCache — contents, TTL (ISO, 24h manual), key (-1 de-variant)", () => {
  function seedCollection(num) {
    localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify([{ setNumber: num, condition: "new", quantity: 1 }]));
    localStorage.setItem("blOwnedSets", JSON.stringify([]));
  }

  it("fresh (<24h) cache entry under the DE-VARIANTED key is skipped (no fetch)", async () => {
    seedCollection("10300-1");
    localStorage.setItem("brickEconomySetCache", JSON.stringify({
      "10300": { fetchedAt: iso(Date.now() - HOUR), data: { current_value_new: 200 } }, // key is "10300", not "10300-1"
    }));
    const r = await syncBEValues(undefined, false);
    expect(r.skipped).toBe(1);            // fresh → excluded from the fetch list
    expect(r.failed).toBe(0);
    expect(apiFetchMock).not.toHaveBeenCalled();
    // NOTE: syncBEValues still runs applyCache over the WHOLE cache at the end, so a fresh
    // (un-fetched) entry is re-applied and counts as updated — pinned here so the refactor keeps it.
    expect(r.updated).toBe(1);
  });

  it("stale (>24h) entry re-fetches via /api/brickeconomy-set?number=<de-varianted>", async () => {
    seedCollection("10300-1");
    localStorage.setItem("brickEconomySetCache", JSON.stringify({
      "10300": { fetchedAt: iso(Date.now() - (DAY + HOUR)), data: { current_value_new: 200 } },
    }));
    apiFetchMock.mockResolvedValue(jsonOk({ data: { current_value_new: 250 } }));
    await syncBEValues(undefined, false);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0][0]).toContain("number=10300");   // de-varianted in the request too
    expect(apiFetchMock.mock.calls[0][0]).not.toContain("10300-1");
    const raw = JSON.parse(localStorage.getItem("brickEconomySetCache"));
    expect(typeof raw["10300"].fetchedAt).toBe("string");              // ISO timestamp preserved
  });
});

// ── PIN 1 + 2 + 3 — blPriceGuideCache (data; ms `cachedAt`; -1 de-variant; DUAL ttl) ──
describe("blPriceGuideCache — contents, key (-1 de-variant), field `cachedAt`(ms), DUAL TTL", () => {
  it("fresh (<6h) entry under the de-varianted key returns from cache WITHOUT auth/fetch", async () => {
    localStorage.setItem("blPriceGuideCache", JSON.stringify({
      "75192": { data: { avg: 500 }, cachedAt: Date.now() - HOUR },      // key "75192" for "75192-1"
    }));
    const r = await fetchBrickLinkPriceGuide("75192-1");
    expect(r).toEqual({ avg: 500 });
    expect(apiFetchMock).not.toHaveBeenCalled();                         // cache hit returns before getBrickLinkSession
  });

  it("single-fetch path: 6h+ entry is no longer a hit (cachedAt field, ms-epoch)", async () => {
    localStorage.setItem("blPriceGuideCache", JSON.stringify({
      "75192": { data: { avg: 500 }, cachedAt: Date.now() - (6 * HOUR + HOUR) }, // 7h old → stale for the 6h single TTL
    }));
    // No BL access token seeded → getBrickLinkSession returns null → null (proves the 7h entry was NOT served as fresh).
    expect(await fetchBrickLinkPriceGuide("75192-1")).toBeNull();
  });

  it("DUAL TTL: the SAME 7h-old entry is STALE for single (6h) but FRESH for bulk (12h) → bulk skips it", async () => {
    localStorage.setItem("blPriceGuideCache", JSON.stringify({
      "75192": { data: { avg: 500 }, cachedAt: Date.now() - (7 * HOUR) },
    }));
    const r = await bulkSyncPrices(["75192-1"]);
    expect(r).toEqual({ synced: 0, skipped: 1, failed: 0, unreachable: 0 }); // 7h < 12h bulk window → skipped
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("writes the de-varianted key with a numeric `cachedAt` on a successful fetch", async () => {
    localStorage.setItem("blBrickLinkAccessToken", "tok");
    apiFetchMock.mockImplementation((url) => {
      if (String(url).includes("/api/bricklink-auth")) return Promise.resolve(jsonOk({ sessionToken: "sess" }));
      return Promise.resolve(jsonOk({ avg: 750 })); // /api/bricklink-priceguide
    });
    const r = await fetchBrickLinkPriceGuide("10300-1");
    expect(r).toEqual({ avg: 750 });
    const raw = JSON.parse(localStorage.getItem("blPriceGuideCache"));
    expect(Object.keys(raw)).toEqual(["10300"]);                         // de-varianted write key
    expect(typeof raw["10300"].cachedAt).toBe("number");                 // ms-epoch, field name `cachedAt`
  });
});

// ── PIN 4 — datachange trigger membership (skip vs fire) — guard breaks on drift ──
describe("datachange trigger membership — pinned per cache key (guard against SYNC_SKIP drift)", () => {
  function firesDatachange(key, value) {
    const calls = [];
    const fn = () => calls.push(1);
    window.addEventListener("brickledger:datachange", fn);
    setItemSafe(key, value); // exercise the real write choke point

    window.removeEventListener("brickledger:datachange", fn);
    return calls.length > 0;
  }

  it("SKIP keys do NOT fire datachange (regeneratable caches stay out of the auto-push)", () => {
    expect(firesDatachange("bricksetSetCache", '{"a":1}')).toBe(false);
    expect(firesDatachange("brickEconomySetCache", '{"a":1}')).toBe(false);
    expect(firesDatachange("blPriceGuideCache", '{"a":1}')).toBe(false);
  });

  it("blValueCache + blBFRetirementCache DO fire datachange today (bl* and not skipped)", () => {
    // This pins the CURRENT (intentionally preserved) behavior. The SYNC_SKIP cleanup for these
    // two is a SEPARATE later hygiene commit — if it lands inside the refactor, this test fails.
    expect(firesDatachange("blValueCache", '{"a":1}')).toBe(true);
    expect(firesDatachange("blBFRetirementCache", '{"a":1}')).toBe(true);
  });

  it("non-bl/brickEconomy cache keys never fire (prefix miss)", () => {
    expect(firesDatachange("bricksetThemesCache", '{"a":1}')).toBe(false); // brickset* prefix
    expect(firesDatachange("legoLastChanceCache", '{"a":1}')).toBe(false); // lego* prefix
  });
});

// ── PIN 5 — sync baseline: dedupHash + pushed payload byte-identical; caches NOT pulled in ──
describe("sync baseline — the 4 caches must not enter BACKUP_KEYS / the synced payload", () => {
  function seedUserData() {
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10300-1", condition: "new", quantity: 1, totalPaid: 100 }]));
    localStorage.setItem("blWantedList", JSON.stringify([{ id: "wl_1", setNumber: "75192-1" }]));
    localStorage.setItem("blPurchases", JSON.stringify([{ id: "p1", amount: 50 }]));
    localStorage.setItem("blAnnualBudget", "10320");
  }
  function seedAllFourCaches() {
    localStorage.setItem("blValueCache", JSON.stringify({ "10300-1": { record: { new: { amount: 9 } }, fetchedAt: Date.now() } }));
    localStorage.setItem("bricksetSetCache", JSON.stringify({ "brickset_10300-1": { fetchedAt: iso(Date.now()), data: { minifigs: 2 } } }));
    localStorage.setItem("brickEconomySetCache", JSON.stringify({ "10300": { fetchedAt: iso(Date.now()), data: { current_value_new: 200 } } }));
    localStorage.setItem("blPriceGuideCache", JSON.stringify({ "10300": { data: { avg: 1 }, cachedAt: Date.now() } }));
  }

  it("none of the 4 cache keys are BACKUP_KEYS registry entries", () => {
    const keys = BACKUP_KEYS.map((k) => k.key);
    for (const c of ["blValueCache", "bricksetSetCache", "brickEconomySetCache", "blPriceGuideCache"]) {
      expect(keys).not.toContain(c);
    }
  });

  it("dedupHash is byte-identical with vs without the 4 caches seeded (the synced fingerprint ignores them)", () => {
    seedUserData();
    const before = localContentHash();
    seedAllFourCaches();
    const after = localContentHash();
    expect(after).toBe(before);
  });

  it("the PUSHED payload (buildBackup minus brickEconomySetCache) is byte-identical with vs without the caches", async () => {
    const pushed = (b) => { const c = { ...b }; delete c.brickEconomySetCache; delete c.exportedAt; return JSON.stringify(c); };
    seedUserData();
    const before = pushed(await captureBackup());
    seedAllFourCaches();
    expect(pushed(await captureBackup())).toBe(before);
  });

  it("buildBackup still INCLUDES brickEconomySetCache in the file export (current behavior pinned)", async () => {
    seedUserData();
    seedAllFourCaches();
    const b = await captureBackup();
    expect(b).toHaveProperty("brickEconomySetCache");
    expect(b.brickEconomySetCache["10300"].data.current_value_new).toBe(200);
    // …but the other three caches never appear in the backup object at all.
    expect(b).not.toHaveProperty("blValueCache");
    expect(b).not.toHaveProperty("bricksetSetCache");
    expect(b).not.toHaveProperty("blPriceGuideCache");
  });
});

// ── PIN 6 — money / enrichment golden for a fixed collection fixture ──
describe("money/enrichment golden — headline numbers unchanged for a fixed fixture", () => {
  // Two owned sets; values come from blValueCache via peekValueCache (the BL overlay path).
  const SETS = [
    { setNumber: "10300-1", condition: "new", quantity: 1, totalPaid: 100, minifigs: 2, pieces: 1872 },
    { setNumber: "75192-1", condition: "new", quantity: 2, totalPaid: 600, minifigs: 4, pieces: 7541 },
  ];
  function valueMapFromCache() {
    localStorage.setItem("blValueCache", JSON.stringify({
      "10300-1": { record: { new: { amount: 250, basis: "sold", lots: 5, asOf: "2026-06-01" }, used: null }, fetchedAt: Date.now() },
      "75192-1": { record: { new: { amount: 800, basis: "sold", lots: 3, asOf: "2026-06-01" }, used: null }, fetchedAt: Date.now() },
    }));
    return peekValueCache(["10300-1", "75192-1"]);
  }

  it("value / cost / gain / ROI + minifig & piece totals match the golden", () => {
    const valueMap = valueMapFromCache();

    const value = portfolioValue(SETS, valueMap);
    const cost = SETS.reduce((s, x) => s + setCost(x), 0);
    const gain = portfolioGain(SETS, valueMap);
    const roi = portfolioROI(SETS, valueMap);
    const minifigs = SETS.reduce((s, x) => s + (x.minifigs || 0) * (x.quantity || 1), 0);
    const pieces = SETS.reduce((s, x) => s + (x.pieces || 0) * (x.quantity || 1), 0);

    // GOLDEN (current outputs). The BL-overlay `valueMap` amount is the set's value as-is — it is
    // NOT multiplied by quantity in this path: value = 250 + 800 = 1050 (not 250×1 + 800×2).
    // cost = totalPaid summed (already a per-set total) = 100 + 600 = 700.
    // gain = value − cost = 350; portfolioROI returns a PERCENT = gain/cost×100 = 50.
    expect(value).toBe(1050);
    expect(cost).toBe(700);
    expect(gain).toBe(350);
    expect(roi).toBe(50);
    expect(minifigs).toBe(2 * 1 + 4 * 2);     // 10  (fixture sum, ×qty)
    expect(pieces).toBe(1872 * 1 + 7541 * 2); // 16954
  });
});
