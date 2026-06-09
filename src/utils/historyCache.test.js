import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// historyCache delegates to createEntryCache + apiFetch. Mock apiFetch (the network boundary);
// setItemSafe / the factory run for real so the churn assertion is meaningful.
vi.mock("./apiFetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./apiFetch";
import { fetchHistory, peekHistoryCache, clearHistoryCache } from "./historyCache";

const okRes = (body) => ({ ok: true, status: 200, json: async () => body });

const SERIES = [
  { asOf: "2026-06-07T03:00:01.779Z", new: 119.56, used: 89.67 },
  { asOf: "2026-06-02T00:57:57.212Z", new: 120.84, used: 90.63 },
];

function listen(type) {
  const calls = [];
  const fn = (e) => calls.push(e.detail ?? true);
  window.addEventListener(type, fn);
  return { calls, stop: () => window.removeEventListener(type, fn) };
}

beforeEach(() => {
  localStorage.clear();
  clearHistoryCache();
  apiFetch.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("historyCache — fetchHistory / peek (mirrors valueCache)", () => {
  it("fetches a set's series, returns it keyed by set number, and caches it", async () => {
    apiFetch.mockResolvedValue(okRes({ "10275-1": SERIES }));
    const out = await fetchHistory(["10275-1"]);
    expect(out).toEqual({ "10275-1": SERIES });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/api/history", expect.objectContaining({ method: "POST" }));
  });

  it("peekHistoryCache returns the fresh cached series synchronously (no network)", async () => {
    apiFetch.mockResolvedValue(okRes({ "10275-1": SERIES }));
    await fetchHistory(["10275-1"]);
    apiFetch.mockClear();
    expect(peekHistoryCache(["10275-1"])).toEqual({ "10275-1": SERIES });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("readThrough serves the cache on a second call (one fetch only)", async () => {
    apiFetch.mockResolvedValue(okRes({ "10275-1": SERIES }));
    await fetchHistory(["10275-1"]);
    const again = await fetchHistory(["10275-1"]);
    expect(again).toEqual({ "10275-1": SERIES });
    expect(apiFetch).toHaveBeenCalledTimes(1); // second read hit the cache
  });

  it("coerces a malformed (non-array) series to [] — never poisons the cache", async () => {
    apiFetch.mockResolvedValue(okRes({ "10275-1": "junk", "30303-1": null }));
    const out = await fetchHistory(["10275-1", "30303-1"]);
    expect(out).toEqual({ "10275-1": [], "30303-1": [] });
  });

  it("on a fetch failure returns whatever is cached (never throws)", async () => {
    apiFetch.mockResolvedValue(okRes({ "10275-1": SERIES }));
    await fetchHistory(["10275-1"]);
    apiFetch.mockRejectedValue(new Error("offline"));
    const out = await fetchHistory(["10275-1"], { force: true }); // force → must refetch, fails
    expect(out).toEqual({}); // nothing fresh re-served (forced past the cache), no throw
  });

  it("does NOT churn sync — writing blHistoryCache fires no datachange (SYNC_SKIP_KEYS)", async () => {
    apiFetch.mockResolvedValue(okRes({ "10275-1": SERIES }));
    const change = listen("brickledger:datachange");
    await fetchHistory(["10275-1"]); // writes blHistoryCache via setItemSafe
    change.stop();
    expect(localStorage.getItem("blHistoryCache")).toBeTruthy(); // it really wrote
    expect(change.calls.length).toBe(0); // ...but did not trigger an auto-push
  });
});
