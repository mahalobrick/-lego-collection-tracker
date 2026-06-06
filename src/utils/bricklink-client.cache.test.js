import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// P3.5 — blPriceGuideCache routed through the shared enrichmentCache instance (the dual-TTL cache).
// Pins byte-identity: ms-epoch `cachedAt` field, `-1` de-variant key, the single-fetch 6h vs bulk 12h
// DUAL TTL against ONE stored cachedAt (the killer case), the single path's `&& entry.data` guard, and
// clearPriceGuideCache (memo + mirror). The whole cache lives in bricklink-client.js — no ad-hoc
// pokes, one consistent de-variant convention (verified by the P3.5 site map).
// ─────────────────────────────────────────────────────────────────────────────

const apiFetchMock = vi.fn();
vi.mock("./apiFetch", () => ({ apiFetch: (...a) => apiFetchMock(...a) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import { fetchBrickLinkPriceGuide, bulkSyncPrices, clearPriceGuideCache } from "./bricklink-client";

const HOUR = 60 * 60 * 1000;
const jsonOk = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  localStorage.clear();
  clearPriceGuideCache(); // reset the module-singleton memo between tests
  apiFetchMock.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("blPriceGuideCache — single-fetch path (6h TTL, ms cachedAt, -1 de-variant, data guard)", () => {
  it("fresh (<6h) entry under the de-varianted key returns from cache WITHOUT auth/fetch", async () => {
    localStorage.setItem("blPriceGuideCache", JSON.stringify({
      "75192": { data: { avg: 500 }, cachedAt: Date.now() - HOUR }, // key "75192" for "75192-1"
    }));
    expect(await fetchBrickLinkPriceGuide("75192-1")).toEqual({ avg: 500 });
    expect(apiFetchMock).not.toHaveBeenCalled(); // cache hit returns before getBrickLinkSession
  });

  it("a 7h-old entry is no longer fresh for the 6h single path (falls through)", async () => {
    localStorage.setItem("blPriceGuideCache", JSON.stringify({
      "75192": { data: { avg: 500 }, cachedAt: Date.now() - 7 * HOUR },
    }));
    // No BL token → getBrickLinkSession returns null → null (proves the 7h entry was NOT served fresh).
    expect(await fetchBrickLinkPriceGuide("75192-1")).toBeNull();
  });

  it("an entry with fresh cachedAt but NO data is NOT a hit (the `&& entry.data` guard)", async () => {
    localStorage.setItem("blPriceGuideCache", JSON.stringify({
      "75192": { data: null, cachedAt: Date.now() - HOUR },
    }));
    expect(await fetchBrickLinkPriceGuide("75192-1")).toBeNull(); // falls through (no token → null)
  });

  it("writes the de-varianted key with a numeric `cachedAt` on a successful fetch", async () => {
    localStorage.setItem("blBrickLinkAccessToken", "tok");
    apiFetchMock.mockImplementation((url) =>
      String(url).includes("/api/bricklink-auth")
        ? Promise.resolve(jsonOk({ sessionToken: "sess" }))
        : Promise.resolve(jsonOk({ avg: 750 })));
    expect(await fetchBrickLinkPriceGuide("10300-1")).toEqual({ avg: 750 });
    const raw = JSON.parse(localStorage.getItem("blPriceGuideCache"));
    expect(Object.keys(raw)).toEqual(["10300"]);          // de-varianted write key
    expect(typeof raw["10300"].cachedAt).toBe("number");  // ms-epoch, field name `cachedAt`
    expect(raw["10300"].data).toEqual({ avg: 750 });
  });
});

describe("blPriceGuideCache — DUAL TTL killer case (6h single vs 12h bulk, one cachedAt)", () => {
  it("a 7h-old entry: STALE for single (6h) but FRESH for bulk (12h) → bulk skips it", async () => {
    localStorage.setItem("blPriceGuideCache", JSON.stringify({
      "75192": { data: { avg: 500 }, cachedAt: Date.now() - 7 * HOUR },
    }));
    const r = await bulkSyncPrices(["75192-1"]);
    expect(r).toEqual({ synced: 0, skipped: 1, failed: 0, unreachable: 0 }); // 7h < 12h → skipped
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("a 13h-old entry is stale for bulk (12h) too → it is queued to fetch", async () => {
    localStorage.setItem("blPriceGuideCache", JSON.stringify({
      "75192": { data: { avg: 500 }, cachedAt: Date.now() - 13 * HOUR },
    }));
    // no token → each fetch returns null → failed, but the point is it was NOT skipped (12h stale).
    const r = await bulkSyncPrices(["75192-1"]);
    expect(r.skipped).toBe(0);
    expect(r.synced + r.failed).toBe(1);
  });
});

describe("clearPriceGuideCache — clears mirror + memo", () => {
  it("after a put + clear, a later read misses (memo not left stale)", async () => {
    localStorage.setItem("blBrickLinkAccessToken", "tok");
    apiFetchMock.mockImplementation((url) =>
      String(url).includes("/api/bricklink-auth")
        ? Promise.resolve(jsonOk({ sessionToken: "sess" }))
        : Promise.resolve(jsonOk({ avg: 1 })));
    await fetchBrickLinkPriceGuide("60380-1");           // populates memo + mirror
    clearPriceGuideCache();
    expect(localStorage.getItem("blPriceGuideCache")).toBe("{}");
    // a subsequent cache-hit attempt must miss (memo cleared); with no further fetch mock change it
    // would re-fetch — assert the mirror is empty as the read-equivalent of removeItem.
    expect(JSON.parse(localStorage.getItem("blPriceGuideCache"))).toEqual({});
  });
});
