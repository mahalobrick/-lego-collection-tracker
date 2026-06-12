import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// BE-removal D1 — the freeze guard in the CANONICAL BE engine (syncBEValues /
// runDailyBEBatch). The 2 frozen promos are kept as STATIC provenance, so the daily
// batch must (a) never re-FETCH them (allUniqueNums skips them) and (b) never re-APPLY
// a BE number over their stored value (applyCache skips them) — even if a stale cache
// entry lingers from before the freeze. Every OTHER set keeps refreshing exactly as before.
// Mirrors beSyncValues.cache.test.js's mocked-apiFetch + jsdom-localStorage harness.
// ─────────────────────────────────────────────────────────────────────────────

const apiFetchMock = vi.fn();
vi.mock("./apiFetch", () => ({ apiFetch: (...a) => apiFetchMock(...a) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import { syncBEValues } from "./beSyncValues";

const iso = (ms) => new Date(ms).toISOString();
const jsonOk = (body) => ({ ok: true, status: 200, json: async () => body });
const readNorm = () => JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection"));

beforeEach(() => {
  localStorage.clear();
  apiFetchMock.mockReset();
  // A frozen promo (stored at its last BE number) + a normal BE set, both owned new.
  localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify([
    { setNumber: "6490363-1", source: "BrickEconomy", condition: "new", quantity: 1, totalValue: 23.72, currentValue: 23.72 },
    { setNumber: "10300-1", source: "BrickEconomy", condition: "new", quantity: 1, totalValue: 10, currentValue: 10 },
  ]));
  localStorage.setItem("blOwnedSets", JSON.stringify([]));
});
afterEach(() => vi.clearAllMocks());

describe("freeze guard — the frozen promo is never re-fetched", () => {
  it("syncBEValues fetches the normal set but NOT the frozen promo", async () => {
    apiFetchMock.mockResolvedValue(jsonOk({ data: { current_value_new: 200 } }));
    await syncBEValues(undefined, true); // force: would fetch every non-frozen set

    const fetchedNums = apiFetchMock.mock.calls.map((c) => c[0]);
    expect(fetchedNums.some((u) => u.includes("number=10300"))).toBe(true);   // normal set fetched
    expect(fetchedNums.some((u) => u.includes("6490363"))).toBe(false);       // frozen promo NEVER fetched
  });
});

describe("freeze guard — a lingering cache entry does NOT overwrite the frozen value", () => {
  it("applyCache skips the frozen promo even with a FRESH cache carrying a different number", async () => {
    // A pre-freeze cache entry that, without the guard, applyCache would write over the frozen value.
    localStorage.setItem("brickEconomySetCache", JSON.stringify({
      "6490363": { fetchedAt: iso(Date.now()), data: { current_value_new: 999 } }, // would overwrite 23.72 → 999
      "10300":   { fetchedAt: iso(Date.now()), data: { current_value_new: 200 } }, // normal set DOES update
    }));
    await syncBEValues(undefined, false); // both fresh → no fetch; applyCache runs over the collection

    expect(apiFetchMock).not.toHaveBeenCalled();
    const norm = readNorm();
    const frozen = norm.find((s) => s.setNumber === "6490363-1");
    const normal = norm.find((s) => s.setNumber === "10300-1");
    expect(frozen.totalValue).toBe(23.72);   // FROZEN — untouched by the cache
    expect(frozen.currentValue).toBe(23.72);
    expect(normal.totalValue).toBe(200);     // normal set refreshed from cache as before
  });
});
