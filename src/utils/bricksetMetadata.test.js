import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./brickset", () => ({
  fetchBricksetSet: vi.fn(),
  cacheBricksetSet: vi.fn(),
}));

import { fetchBricksetSet, cacheBricksetSet } from "./brickset";
import { metadataGaps, syncBricksetMetadata, cleanSetNumber } from "./bricksetMetadata";

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// Characterization for the net extraction of runBricksetEnrichment's fetch loop
// (panel-design SOP commit 2). The legacy counter quirk (any truthy fetch counts as
// "updated", even one with null fields) is pinned deliberately.
// ─────────────────────────────────────────────────────────────────────────────

describe("metadataGaps()", () => {
  it("excludes sets with no setNumber", () => {
    expect(metadataGaps([{ minifigs: null, pieces: null }])).toEqual([]);
  });

  it("excludes complete sets (both pieces + minifigs known) unless forced; 0 counts as known", () => {
    const complete = { setNumber: "10300-1", minifigs: 2, pieces: 1000 };
    const zeroes   = { setNumber: "30-1",    minifigs: 0, pieces: 0 };
    expect(metadataGaps([complete, zeroes])).toEqual([]);
    expect(metadataGaps([complete], true)).toEqual([complete]);
  });

  it("includes a set missing either pieces or minifigs", () => {
    const a = { setNumber: "1", minifigs: 2, pieces: null };
    const b = { setNumber: "2", minifigs: null, pieces: 500 };
    expect(metadataGaps([a, b])).toEqual([a, b]);
  });
});

describe("syncBricksetMetadata()", () => {
  it("fetches + caches each gap and patches the present fields via onPatch", async () => {
    fetchBricksetSet.mockResolvedValue({ minifigs: 3, pieces: 1200 });
    const patches = [];
    const sets = [{ setNumber: "10300-1", minifigs: null, pieces: null }];
    const res = await syncBricksetMetadata(sets, { delayMs: 0, onPatch: (k, u) => patches.push([k, u]) });
    expect(fetchBricksetSet).toHaveBeenCalledWith("10300");
    expect(cacheBricksetSet).toHaveBeenCalledWith("10300", { minifigs: 3, pieces: 1200 });
    expect(patches).toEqual([["10300", { minifigs: 3, pieces: 1200 }]]);
    expect(res).toEqual({ attempted: 1, updated: 1 });
  });

  it("caches + counts a fetch with null fields, but emits no patch (legacy counter quirk)", async () => {
    fetchBricksetSet.mockResolvedValue({ minifigs: null, pieces: null });
    const patches = [];
    const res = await syncBricksetMetadata(
      [{ setNumber: "1", minifigs: null, pieces: null }],
      { delayMs: 0, onPatch: (k, u) => patches.push([k, u]) }
    );
    expect(cacheBricksetSet).toHaveBeenCalled();
    expect(patches).toEqual([]);
    expect(res.updated).toBe(1);
  });

  it("skips a null fetch result entirely (no cache, no patch, not counted)", async () => {
    fetchBricksetSet.mockResolvedValue(null);
    const patches = [];
    const res = await syncBricksetMetadata(
      [{ setNumber: "1", minifigs: null, pieces: null }],
      { delayMs: 0, onPatch: (k, u) => patches.push([k, u]) }
    );
    expect(cacheBricksetSet).not.toHaveBeenCalled();
    expect(patches).toEqual([]);
    expect(res).toEqual({ attempted: 1, updated: 0 });
  });

  it("emits only the present field when the other is null", async () => {
    fetchBricksetSet.mockResolvedValue({ minifigs: 5, pieces: null });
    const patches = [];
    await syncBricksetMetadata(
      [{ setNumber: "1", minifigs: null, pieces: null }],
      { delayMs: 0, onPatch: (k, u) => patches.push([k, u]) }
    );
    expect(patches).toEqual([["1", { minifigs: 5 }]]);
  });

  it("force=true refetches an otherwise-complete set", async () => {
    fetchBricksetSet.mockResolvedValue({ minifigs: 1, pieces: 1 });
    const res = await syncBricksetMetadata(
      [{ setNumber: "1", minifigs: 9, pieces: 9 }],
      { delayMs: 0, force: true }
    );
    expect(res.attempted).toBe(1);
  });

  it("reports onProgress for every attempted set (success, null, and error alike)", async () => {
    fetchBricksetSet
      .mockResolvedValueOnce({ pieces: 1 })    // success
      .mockResolvedValueOnce(null)             // null result
      .mockRejectedValueOnce(new Error("x"));  // error
    const calls = [];
    await syncBricksetMetadata(
      [{ setNumber: "1", minifigs: null, pieces: null },
       { setNumber: "2", minifigs: null, pieces: null },
       { setNumber: "3", minifigs: null, pieces: null }],
      { delayMs: 0, onProgress: (done, total) => calls.push([done, total]) }
    );
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("swallows a fetch error and continues to the next set", async () => {
    fetchBricksetSet
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ pieces: 100 });
    const patches = [];
    const res = await syncBricksetMetadata(
      [{ setNumber: "1", minifigs: null, pieces: null }, { setNumber: "2", minifigs: null, pieces: null }],
      { delayMs: 0, onPatch: (k, u) => patches.push([k, u]) }
    );
    expect(res.updated).toBe(1);
    expect(patches).toEqual([["2", { pieces: 100 }]]);
  });
});

describe("cleanSetNumber()", () => {
  it("strips a trailing -1 suffix and coerces null to empty string", () => {
    expect(cleanSetNumber("10300-1")).toBe("10300");
    expect(cleanSetNumber("10300")).toBe("10300");
    expect(cleanSetNumber(75192)).toBe("75192");
    expect(cleanSetNumber(null)).toBe("");
  });
});
