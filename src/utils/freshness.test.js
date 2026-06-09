import { describe, it, expect } from "vitest";
import { valuesAsOf, freshness, STALE_DAYS } from "./freshness";

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// A fixed "now" so the day-math is deterministic.
const NOW = Date.parse("2026-06-09T12:00:00.000Z");

describe("valuesAsOf — newest asOf across a valueMap", () => {
  it("picks the newest asOf across mixed new/used and across sets", () => {
    const map = {
      "a-1": { new: { asOf: "2026-06-02T00:00:00Z" }, used: { asOf: "2026-06-05T00:00:00Z" } }, // used newer here
      "b-1": { new: { asOf: "2026-06-07T03:00:01.779Z" }, used: { asOf: "2026-06-01T00:00:00Z" } }, // new newer & overall newest
      "c-1": { new: { asOf: "2026-05-20T00:00:00Z" }, used: null },
    };
    expect(valuesAsOf(map)).toBe("2026-06-07T03:00:01.779Z");
  });

  it("excludes asOf:null conditions and null records; all-null → null", () => {
    expect(valuesAsOf({
      "a-1": { new: { asOf: null }, used: null }, // BE-fallback: no asOf
      "b-1": null,                                 // deferred CMF
    })).toBeNull();
    // some-null excluded, the one real asOf wins
    expect(valuesAsOf({
      "a-1": { new: { asOf: null }, used: null },
      "b-1": { new: { asOf: "2026-06-04T00:00:00Z" }, used: null },
    })).toBe("2026-06-04T00:00:00Z");
  });

  it("is null-safe for undefined / empty / non-object input", () => {
    expect(valuesAsOf(undefined)).toBeNull();
    expect(valuesAsOf(null)).toBeNull();
    expect(valuesAsOf({})).toBeNull();
    expect(valuesAsOf("nope")).toBeNull();
  });

  it("ignores unparseable asOf strings", () => {
    expect(valuesAsOf({ "a-1": { new: { asOf: "not-a-date" }, used: null } })).toBeNull();
  });
});

describe("freshness — whole-day diff + level + label", () => {
  it("N=0 → 'today' and fresh", () => {
    expect(freshness(iso(NOW), NOW)).toEqual({ days: 0, label: "Values updated today", level: "fresh" });
    // < 1 day elapsed still reads as today
    expect(freshness(iso(NOW - 5 * 60 * 60 * 1000), NOW)).toMatchObject({ days: 0, label: "Values updated today" });
  });

  it("singular vs plural day wording", () => {
    expect(freshness(iso(NOW - 1 * DAY), NOW)).toMatchObject({ days: 1, label: "Values updated 1 day ago" });
    expect(freshness(iso(NOW - 3 * DAY), NOW)).toMatchObject({ days: 3, label: "Values updated 3 days ago" });
  });

  it("the 8-vs-9-day boundary: fresh THROUGH day 8, stale FROM day 9", () => {
    expect(STALE_DAYS).toBe(8);
    expect(freshness(iso(NOW - 8 * DAY), NOW)).toMatchObject({ days: 8, level: "fresh" });
    expect(freshness(iso(NOW - 9 * DAY), NOW)).toMatchObject({ days: 9, level: "stale" });
    expect(freshness(iso(NOW - 14 * DAY), NOW)).toMatchObject({ days: 14, level: "stale" });
  });

  it("a future asOf (clock skew) clamps to today, never negative", () => {
    expect(freshness(iso(NOW + 2 * DAY), NOW)).toMatchObject({ days: 0, level: "fresh", label: "Values updated today" });
  });

  it("returns null for null / unparseable asOf", () => {
    expect(freshness(null, NOW)).toBeNull();
    expect(freshness("not-a-date", NOW)).toBeNull();
  });
});
