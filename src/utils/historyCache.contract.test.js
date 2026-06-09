import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT TEST — the by-construction lock for the /api/history response shape
// (trend BE→BL swap, Phase 1; mirrors valueCache.contract.test.js for /api/values).
// Pins the exact fields the client read (historyCache) + adapter (historyFromBL)
// consume. A field-select change in api/history.js that drops/renames a consumed
// field — or re-adds the implied per-point `source`/`condition`/`basis`/`lots` —
// fails this shape → unmergeable red.
//
// Fixture: a representative /api/history POST response. See test-data/history-fixtures/README.md.
// ─────────────────────────────────────────────────────────────────────────────
import response from "../../test-data/history-fixtures/history-response.json";
import { historyFromBL } from "./historyEvents";

const WITH_HISTORY = ["10275-1", "30303-1", "71045-12"]; // sets with ≥1 stored point
const EMPTY = "99999-1"; // no history list → []
const POINT_KEYS = ["asOf", "new", "used"]; // the curated per-point shape

const isIsoString = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

function assertPoint(p) {
  expect(typeof p).toBe("object");
  expect(p).not.toBeNull();
  // EXACTLY the curated keys — source/condition/basis/lots are implied/absent and must be selected out.
  expect(Object.keys(p).sort()).toEqual([...POINT_KEYS].sort());
  expect(p).not.toHaveProperty("source");
  expect(p).not.toHaveProperty("basis");
  expect(p).not.toHaveProperty("lots");
  expect(isIsoString(p.asOf)).toBe(true);
  // new/used are number or null (null = unknown, never a fabricated 0).
  expect(p.new === null || typeof p.new === "number").toBe(true);
  expect(p.used === null || typeof p.used === "number").toBe(true);
}

describe("/api/history response contract", () => {
  it("top-level is a { [setNumber]: Array } map (never null — [] is the no-history value)", () => {
    expect(response && typeof response).toBe("object");
    expect(Array.isArray(response)).toBe(false);
    for (const series of Object.values(response)) {
      expect(Array.isArray(series)).toBe(true);
    }
  });

  it("every stored point has EXACTLY {asOf, new, used} with the right types", () => {
    for (const set of WITH_HISTORY) {
      expect(response[set].length).toBeGreaterThan(0);
      response[set].forEach(assertPoint);
    }
  });

  it("a set with no history is an empty array (distinct from a value cache-miss null)", () => {
    expect(response[EMPTY]).toEqual([]);
  });

  it("series are newest-first as stored (the cron's LPUSH order)", () => {
    const multi = response["10275-1"];
    expect(multi.length).toBeGreaterThan(1);
    for (let i = 1; i < multi.length; i++) {
      expect(Date.parse(multi[i - 1].asOf)).toBeGreaterThanOrEqual(Date.parse(multi[i].asOf));
    }
  });

  it("the adapter consumes the contract → ASC [{date,value}], unknown (null) dropped", () => {
    // 71045-12 has used:null → its used series must be empty; new is present.
    const { new: newSeries, used: usedSeries } = historyFromBL(response["71045-12"]);
    expect(newSeries).toEqual([{ date: "2026-06-07", value: 4.5 }]);
    expect(usedSeries).toEqual([]);

    // 10275-1 → ASC oldest→newest, {date,value} only.
    const out = historyFromBL(response["10275-1"]).new;
    expect(out).toEqual([
      { date: "2026-06-02", value: 120.84 },
      { date: "2026-06-07", value: 119.56 },
    ]);
  });
});
