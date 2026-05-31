import { describe, it, expect } from "vitest";
import { priceEventsFromBE } from "./priceEvents";

// Real captured BrickEconomy /set payloads — the pinned contract (Phase 1).
// See test-data/be-fixtures/README.md. Each file is { data: {…} }.
import retiredNewUsed from "../../test-data/be-fixtures/30432-1.json"; // retired, new + used events
import retiredNewOnly from "../../test-data/be-fixtures/71460-1.json"; // retired, new-only events
import atRetailA from "../../test-data/be-fixtures/10300-1.json"; // at-retail (events absent)
import atRetailB from "../../test-data/be-fixtures/10307-1.json"; // at-retail (events absent)
import atRetailC from "../../test-data/be-fixtures/10363-1.json"; // at-retail (events absent)

const isAsc = (series) =>
  series.every((p, i) => i === 0 || series[i - 1].date.localeCompare(p.date) <= 0);

describe("priceEventsFromBE — pure read adapter (price_events Phase 2)", () => {
  describe("retired set with new + used events (30432-1)", () => {
    const d = retiredNewUsed.data;
    const out = priceEventsFromBE(d);

    it("populates both series with the full fixture lengths", () => {
      expect(out.new).toHaveLength(d.price_events_new.length); // 12
      expect(out.used).toHaveLength(d.price_events_used.length); // 12
    });

    it("returns two separate series — does not merge by date", () => {
      // new & used dates differ in the real data; lengths summing to both arrays' totals
      // proves nothing was merged/deduped across the two.
      expect(out.new.length + out.used.length).toBe(
        d.price_events_new.length + d.price_events_used.length
      );
    });

    it("re-sorts each series ASC (oldest → newest); BE delivers DESC", () => {
      expect(isAsc(out.new)).toBe(true);
      expect(isAsc(out.used)).toBe(true);
      // BE's raw order is newest-first → our first point is BE's last entry.
      expect(out.new[0].date).toBe(d.price_events_new[d.price_events_new.length - 1].date);
      expect(out.new[out.new.length - 1].date).toBe(d.price_events_new[0].date);
    });

    it("preserves {date, value} shape and real values", () => {
      for (const p of [...out.new, ...out.used]) {
        expect(typeof p.date).toBe("string");
        expect(typeof p.value).toBe("number");
        expect(p.value).toBeGreaterThan(0);
        expect(Object.keys(p).sort()).toEqual(["date", "value"]);
      }
    });
  });

  describe("retired set with new-only events (71460-1)", () => {
    const d = retiredNewOnly.data;
    const out = priceEventsFromBE(d);

    it("populates new, used is the empty 'no series' state", () => {
      expect(out.new).toHaveLength(d.price_events_new.length); // 12
      expect(out.used).toEqual([]); // price_events_used absent → []
    });

    it("new series is ASC", () => {
      expect(isAsc(out.new)).toBe(true);
    });
  });

  describe.each([
    ["10300-1", atRetailA],
    ["10307-1", atRetailB],
    ["10363-1", atRetailC],
  ])("at-retail set %s — the 'no history' case", (_num, fixture) => {
    const out = priceEventsFromBE(fixture.data);

    it("both keys absent → both series empty (never a phantom point)", () => {
      // sanity: the fixture genuinely has no price_events keys
      expect(fixture.data.price_events_new).toBeUndefined();
      expect(fixture.data.price_events_used).toBeUndefined();
      expect(out.new).toEqual([]);
      expect(out.used).toEqual([]);
    });
  });

  describe("0 = unknown discipline (defensive — no zeros in real fixtures)", () => {
    it("omits points with 0, missing, null, or unparseable value — never emits a $0 point", () => {
      const data = {
        price_events_new: [
          { date: "2026-01-01", value: 0 }, // genuine zero → unknown → omit
          { date: "2026-02-01", value: null }, // null → omit
          { date: "2026-03-01", value: "" }, // empty → omit
          { date: "2026-04-01" }, // missing value → omit
          { date: "2026-05-01", value: "abc" }, // unparseable → omit
          { date: "2026-06-01", value: 7.5 }, // the only real point
        ],
      };
      const out = priceEventsFromBE(data);
      expect(out.new).toEqual([{ date: "2026-06-01", value: 7.5 }]);
      expect(out.new.every((p) => p.value > 0)).toBe(true);
      expect(out.used).toEqual([]);
    });

    it("omits points with no usable date (can't be placed on the axis)", () => {
      const out = priceEventsFromBE({
        price_events_new: [{ value: 5 }, { date: null, value: 6 }, { date: "2026-01-01", value: 7 }],
      });
      expect(out.new).toEqual([{ date: "2026-01-01", value: 7 }]);
    });
  });

  describe("defensive input handling (pure, no throw)", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["empty object", {}],
      ["non-array price_events_new", { price_events_new: "oops", price_events_used: 42 }],
    ])("returns empty series for %s without throwing", (_label, input) => {
      const out = priceEventsFromBE(input);
      expect(out).toEqual({ new: [], used: [] });
    });
  });
});
