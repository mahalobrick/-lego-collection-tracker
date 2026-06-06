import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// P3.3 — bricksetSetCache routed through the shared enrichmentCache instance.
// Pins that BOTH writers + the resolver feed produce BYTE-IDENTICAL keys/entries:
//   • fetchBricksetSet's own write path
//   • cacheBricksetSet — the writer used by the MyCollection mount-enrichment path (was the inline
//     setItemSafe at MyCollection.jsx:412; the P3.0 net's documented blind spot, now covered here)
//   • getBricksetCache — the whole-map read the retail/CMF cache-walkers consume
// ─────────────────────────────────────────────────────────────────────────────

const apiFetchMock = vi.fn();
vi.mock("./apiFetch", () => ({ apiFetch: (...a) => apiFetchMock(...a) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import { fetchBricksetSet, cacheBricksetSet, getBricksetCache } from "./brickset";

beforeEach(() => {
  localStorage.clear();
  apiFetchMock.mockReset();
  // Clear the module-singleton memo carried by brickset's instance between tests by overwriting
  // every key it could have memoized: simplest is to re-key per test (each test uses a unique number).
});
afterEach(() => vi.clearAllMocks());

const jsonOk = (body) => ({ ok: true, status: 200, json: async () => body });
const isIso = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));

describe("cacheBricksetSet — the MyCollection.jsx:412 writer path (byte-identical)", () => {
  it("writes `brickset_<n>` verbatim with a { fetchedAt(ISO), data } entry", () => {
    cacheBricksetSet("10300-1", { minifigs: 2, pieces: 1872 });
    const raw = JSON.parse(localStorage.getItem("bricksetSetCache"));
    expect(Object.keys(raw)).toEqual(["brickset_10300-1"]); // prefixed, NO -1 de-variant
    const entry = raw["brickset_10300-1"];
    expect(Object.keys(entry).sort()).toEqual(["data", "fetchedAt"]); // exactly the prior entry shape
    expect(isIso(entry.fetchedAt)).toBe(true);
    expect(entry.data).toEqual({ minifigs: 2, pieces: 1872 });
  });

  it("MC writes a de-varianted `clean` key (brickset_10300) exactly as the mount path passes it", () => {
    // MyCollection.jsx passes `clean = setNumber.replace(/-1$/,"")`; the key must be brickset_<clean>.
    cacheBricksetSet("10300", { minifigs: 0 });
    expect(Object.keys(JSON.parse(localStorage.getItem("bricksetSetCache")))).toEqual(["brickset_10300"]);
  });
});

describe("getBricksetCache — the resolver/CMF cache-walker feed", () => {
  it("returns the whole map identical to a raw localStorage read", () => {
    const map = {
      "brickset_71052-0": { fetchedAt: new Date().toISOString(), data: { retail_price_us: 4.99 } },
      "brickset_10300-1": { fetchedAt: new Date().toISOString(), data: { retail_price_us: 199.99 } },
    };
    localStorage.setItem("bricksetSetCache", JSON.stringify(map));
    expect(getBricksetCache()).toEqual(map);
  });

  it("empty/absent cache → {} (never throws)", () => {
    expect(getBricksetCache()).toEqual({});
  });
});

describe("fetchBricksetSet — write goes through the instance under the verbatim key", () => {
  it("a fetched set is cached under brickset_<n> with an ISO fetchedAt, then served without a re-fetch", async () => {
    apiFetchMock.mockResolvedValue(jsonOk({ data: { set_number: "60380-1", minifigs: 9, pieces: 688 } }));
    const first = await fetchBricksetSet("60380-1"); // unique number → no memo carryover
    expect(first).toEqual({ set_number: "60380-1", minifigs: 9, pieces: 688 });

    const raw = JSON.parse(localStorage.getItem("bricksetSetCache"));
    expect(raw["brickset_60380-1"]).toBeTruthy();
    expect(isIso(raw["brickset_60380-1"].fetchedAt)).toBe(true);
    expect(raw["brickset_60380-1"].data.minifigs).toBe(9);

    apiFetchMock.mockClear();
    const second = await fetchBricksetSet("60380-1"); // fresh within 7d → cache hit, no network
    expect(second.minifigs).toBe(9);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
