import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// P3 S6.3 — fetchBricksetSet skips identifiers Brickset can't serve BEFORE the proxy call.
// Mock the network so we can assert whether a request was made. react-hot-toast is mocked so the
// (unreached) failure path never tries to render.

const apiFetchMock = vi.fn();
vi.mock("./apiFetch", () => ({ apiFetch: (...args) => apiFetchMock(...args) }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import { fetchBricksetSet } from "./brickset";

beforeEach(() => {
  localStorage.clear();
  apiFetchMock.mockReset();
  // Default: a valid Brickset success envelope-free payload ({ data }) so "call made" cases resolve.
  apiFetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { set_number: "75192-1", name: "UCS Falcon" } }),
  });
});
afterEach(() => vi.clearAllMocks());

describe("fetchBricksetSet — client-side number validation (mirrors the proxy accept-set)", () => {
  it.each(["L0002221", "L0002232", "L0002288"])(
    "skips malformed L-prefixed id %s WITHOUT calling the proxy",
    async (id) => {
      const result = await fetchBricksetSet(id);
      expect(result).toBeNull();
      expect(apiFetchMock).not.toHaveBeenCalled();
    }
  );

  it.each(["75192", "75192-1", "5007428"])(
    "valid-format %s passes through → proxy call made",
    async (id) => {
      await fetchBricksetSet(id);
      expect(apiFetchMock).toHaveBeenCalledTimes(1);
      expect(apiFetchMock.mock.calls[0][0]).toContain(`number=${encodeURIComponent(id)}`);
    }
  );

  it.each(["12", "75192-", "", "  ", "abc"])(
    "other malformed input %p is skipped (no call)",
    async (id) => {
      const result = await fetchBricksetSet(id);
      expect(result).toBeNull();
      expect(apiFetchMock).not.toHaveBeenCalled();
    }
  );

  it("tolerates internal whitespace the proxy would strip (e.g. '75 192' → call made)", async () => {
    await fetchBricksetSet("75 192");
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });
});
