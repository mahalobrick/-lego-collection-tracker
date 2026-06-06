import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// P3.4 — the CANONICAL BE engine (syncBEValues / runDailyBEBatch) routed through the shared
// enrichmentCache instance via getRaw()/saveRaw() (the load-whole / mutate-many / save-once pattern).
// Pins that the routing is byte-identical: the de-variant cache key + the `{ fetchedAt, data }` entry
// shape are preserved, a fresh entry is skipped (no fetch), and a stale one re-fetches + re-saves.
// (The ad-hoc -1-keyed lookup pokes in MyCollection/WantedList/BudgetDashboard are NOT routed here;
// they keep their own raw reads/writes — a separate, divergent key convention.)
// ─────────────────────────────────────────────────────────────────────────────

const apiFetchMock = vi.fn();
vi.mock("./apiFetch", () => ({ apiFetch: (...a) => apiFetchMock(...a) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import { syncBEValues, clearBESetCache } from "./beSyncValues";

const iso = (ms) => new Date(ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
  apiFetchMock.mockReset();
  localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify([{ setNumber: "10300-1", condition: "new", quantity: 1 }]));
  localStorage.setItem("blOwnedSets", JSON.stringify([]));
});
afterEach(() => vi.clearAllMocks());

const jsonOk = (body) => ({ ok: true, status: 200, json: async () => body });

describe("syncBEValues routed through getRaw/saveRaw — byte-identical cache I/O", () => {
  it("fresh entry under the DE-VARIANTED key is skipped (no fetch), value preserved", async () => {
    localStorage.setItem("brickEconomySetCache", JSON.stringify({
      "10300": { fetchedAt: iso(Date.now() - HOUR), data: { current_value_new: 200 } }, // key "10300", not "10300-1"
    }));
    const r = await syncBEValues(undefined, false);
    expect(r.skipped).toBe(1);
    expect(apiFetchMock).not.toHaveBeenCalled();
    // saveRaw wrote the map back verbatim — the fresh entry's original timestamp is untouched.
    const raw = JSON.parse(localStorage.getItem("brickEconomySetCache"));
    expect(raw["10300"].data.current_value_new).toBe(200);
  });

  it("stale entry re-fetches (number de-varianted) and saveRaw persists under the de-variant key", async () => {
    localStorage.setItem("brickEconomySetCache", JSON.stringify({
      "10300": { fetchedAt: iso(Date.now() - (DAY + HOUR)), data: { current_value_new: 200 } },
    }));
    apiFetchMock.mockResolvedValue(jsonOk({ data: { current_value_new: 250 } }));
    await syncBEValues(undefined, false);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0][0]).toContain("number=10300");
    expect(apiFetchMock.mock.calls[0][0]).not.toContain("10300-1");
    const raw = JSON.parse(localStorage.getItem("brickEconomySetCache"));
    expect(Object.keys(raw)).toEqual(["10300"]);                  // de-variant key preserved
    expect(typeof raw["10300"].fetchedAt).toBe("string");         // ISO timestamp shape preserved
    expect(raw["10300"].data.current_value_new).toBe(250);
  });

  it("force re-fetches even a fresh entry (saveRaw round-trips the whole map)", async () => {
    localStorage.setItem("brickEconomySetCache", JSON.stringify({
      "10300": { fetchedAt: iso(Date.now()), data: { current_value_new: 200 } },
    }));
    apiFetchMock.mockResolvedValue(jsonOk({ data: { current_value_new: 999 } }));
    await syncBEValues(undefined, true);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("brickEconomySetCache"))["10300"].data.current_value_new).toBe(999);
  });
});

describe("clearBESetCache — clearApiCache routes through it (P3.7a memo coherence)", () => {
  // BE has no memo-aware reader today (every read is store-direct), so no ghost manifests — but the
  // routed clear must still wipe BOTH layers so the contract holds and a future peek can't be poisoned.
  // After a sync populates the memo (via saveRaw), clearBESetCache empties the store; the next sync
  // therefore re-fetches the (now-absent) entry instead of skipping it from a surviving memo.
  it("after a populated sync, clearBESetCache empties the store and the next sync re-fetches", async () => {
    localStorage.setItem("brickEconomySetCache", JSON.stringify({
      "10300": { fetchedAt: iso(Date.now()), data: { current_value_new: 200 } },
    }));
    await syncBEValues(undefined, true);            // force → populates memo + store via saveRaw
    expect(JSON.parse(localStorage.getItem("brickEconomySetCache"))["10300"]).toBeTruthy();

    clearBESetCache();
    expect(localStorage.getItem("brickEconomySetCache")).toBe("{}"); // store wiped (was a raw removeItem)

    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue(jsonOk({ data: { current_value_new: 300 } }));
    await syncBEValues(undefined, false);           // entry gone → must re-fetch, not skip from a ghost memo
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });
});
