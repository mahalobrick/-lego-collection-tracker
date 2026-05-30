import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { setItemSafe } from "./safeStorage";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

// Capture brickledger:* events for the assertions below.
function listen(type) {
  const calls = [];
  const fn = (e) => calls.push(e.detail ?? true);
  window.addEventListener(type, fn);
  return { calls, stop: () => window.removeEventListener(type, fn) };
}

describe("setItemSafe — success path (behaviour-preserving)", () => {
  it("persists exactly String(value) under the same key and returns true", () => {
    expect(setItemSafe("blOwnedSets", '[{"setNumber":"10497"}]')).toBe(true);
    expect(localStorage.getItem("blOwnedSets")).toBe('[{"setNumber":"10497"}]');
  });

  it("stringifies non-string values like raw setItem does", () => {
    setItemSafe("blAnnualBudget", 5000);
    expect(localStorage.getItem("blAnnualBudget")).toBe("5000");
  });
});

describe("setItemSafe — datachange dispatch (auto-push trigger)", () => {
  it("dispatches datachange when a data key actually changes", () => {
    const { calls, stop } = listen("brickledger:datachange");
    setItemSafe("blWantedList", "[1]");
    stop();
    expect(calls.length).toBe(1);
  });

  it("does NOT dispatch when the value is unchanged (no-op re-write)", () => {
    localStorage.setItem("blWantedList", "[1]");
    const { calls, stop } = listen("brickledger:datachange");
    setItemSafe("blWantedList", "[1]");
    stop();
    expect(calls.length).toBe(0);
  });

  it("does NOT dispatch for SYNC_SKIP_KEYS (sync bookkeeping)", () => {
    const { calls, stop } = listen("brickledger:datachange");
    setItemSafe("blLastPushHash", "abc");
    setItemSafe("brickEconomySetCache", "{}");
    stop();
    expect(calls.length).toBe(0);
  });

  it("does NOT dispatch for non-bl/brickEconomy keys", () => {
    const { calls, stop } = listen("brickledger:datachange");
    setItemSafe("someClerkKey", "x");
    stop();
    expect(calls.length).toBe(0);
  });
});

describe("setItemSafe — quota handling (OBS-2)", () => {
  it("returns false, surfaces storagefull, and does NOT dispatch datachange on quota", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      const err = new Error("full");
      err.name = "QuotaExceededError";
      throw err;
    });
    const full = listen("brickledger:storagefull");
    const change = listen("brickledger:datachange");
    const ok = setItemSafe("blOwnedSets", "[1]");
    full.stop(); change.stop();
    expect(ok).toBe(false);
    expect(full.calls).toEqual([{ key: "blOwnedSets" }]);
    expect(change.calls.length).toBe(0);
  });

  it("re-throws non-quota errors (real bugs, not a full disk)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new TypeError("boom");
    });
    expect(() => setItemSafe("blOwnedSets", "[1]")).toThrow(TypeError);
  });
});
