import { describe, it, expect } from "vitest";
import { historyFromBL } from "./historyEvents";
import { priceEventsFromBE } from "./priceEvents";

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE-PARITY LOCK (trend swap, Phase 1). historyFromBL must produce output
// BYTE-IDENTICAL to priceEventsFromBE so the Phase 2 chart swap is a drop-in:
// { new:[{date,value}], used:[{date,value}] }, ASC (oldest→newest), date "YYYY-MM-DD",
// unknown (0/missing) values OMITTED, dateless points dropped.
//
// priceEventsFromBE is the reference; this never modifies it. The two adapters read
// different INPUT shapes (BE: price_events_new/used, DESC [{date,value}]; BL: a list
// of {asOf,new,used}, newest-first) but the OUTPUT contract is the invariant.
// ─────────────────────────────────────────────────────────────────────────────

// Equivalent inputs: same two observations, newest-first, mapping to identical {date,value}.
const BE_DATA = {
  price_events_new: [
    { date: "2026-06-07", value: 119.56 }, // newest first (BE DESC)
    { date: "2026-06-02", value: 120.84 },
  ],
  price_events_used: [
    { date: "2026-06-07", value: 89.67 },
    { date: "2026-06-02", value: 90.63 },
  ],
};
const BL_SERIES = [
  { asOf: "2026-06-07T03:00:01.779Z", new: 119.56, used: 89.67 }, // newest first (LPUSH)
  { asOf: "2026-06-02T00:57:57.212Z", new: 120.84, used: 90.63 },
];

describe("historyFromBL — output shape parity with priceEventsFromBE", () => {
  it("produces the identical { new, used } [{date,value}] ASC series for equivalent input", () => {
    const be = priceEventsFromBE(BE_DATA);
    const bl = historyFromBL(BL_SERIES);
    expect(bl).toEqual(be);
    // explicit: ASC oldest→newest, date is YYYY-MM-DD, value numeric
    expect(bl.new).toEqual([
      { date: "2026-06-02", value: 120.84 },
      { date: "2026-06-07", value: 119.56 },
    ]);
    expect(bl.used).toEqual([
      { date: "2026-06-02", value: 90.63 },
      { date: "2026-06-07", value: 89.67 },
    ]);
  });

  it("each emitted point has EXACTLY the keys {date, value} (no asOf/extra leakage)", () => {
    const bl = historyFromBL(BL_SERIES);
    for (const p of [...bl.new, ...bl.used]) {
      expect(Object.keys(p).sort()).toEqual(["date", "value"]);
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof p.value).toBe("number");
    }
  });

  it("drops unknown (0 / missing / null) values — never a $0 plot — matching priceEventsFromBE", () => {
    const series = [
      { asOf: "2026-06-07T03:00:01.779Z", new: 0, used: 50 }, // new=0 → unknown → dropped
      { asOf: "2026-06-02T00:57:57.212Z", new: null, used: 40 }, // new=null → dropped
      { asOf: "2026-06-01T00:00:00.000Z", new: 100, used: 30 },
    ];
    const out = historyFromBL(series);
    expect(out.new).toEqual([{ date: "2026-06-01", value: 100 }]); // only the real new point
    expect(out.used).toEqual([
      { date: "2026-06-01", value: 30 },
      { date: "2026-06-02", value: 40 },
      { date: "2026-06-07", value: 50 },
    ]);
  });

  it("drops dateless points and tolerates absent/empty/non-array input (→ empty series)", () => {
    expect(historyFromBL([{ new: 10, used: 5 }])).toEqual({ new: [], used: [] }); // no asOf
    expect(historyFromBL([])).toEqual({ new: [], used: [] });
    expect(historyFromBL(null)).toEqual({ new: [], used: [] });
    expect(historyFromBL(undefined)).toEqual({ new: [], used: [] });
    expect(historyFromBL("junk")).toEqual({ new: [], used: [] });
    // structurally identical to priceEventsFromBE's absent-input handling:
    expect(priceEventsFromBE({})).toEqual({ new: [], used: [] });
  });
});
