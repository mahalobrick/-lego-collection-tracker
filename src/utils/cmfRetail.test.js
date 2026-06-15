// @vitest-environment node
// Pure CMF era-table unit test (no DOM/localStorage) — pinned to node so it skips
// jsdom setup and the parallel-load starvation that flaked the retail tests. See
// portfolio.retail.test.js for the full rationale.
import { describe, it, expect } from "vitest";
import { cmfEraRetail, cmfEraPriceForSeries } from "./cmfRetail";

// ─────────────────────────────────────────────────────────────────────────────
// CMF era-table MSRP fallback. Brickset's series-bag (-0) retail is canonical and
// ALWAYS wins when present (this is a GATED fallback — see the ladder test); it only
// fills the gap where Brickset has the series but never priced it (e.g. 71034 /
// Series 23, confirmed null via a read-only probe; 10/11 owned series return $4.99).
// Bag MSRP by era: Series 1–11 → $2.99 · 12–17 → $3.99 · 18–29 → $4.99.
// Base→series# mapping spot-checked against Brickset -0 names: 8833→S8 … 71034→S23
// … 71052→S29.
// ─────────────────────────────────────────────────────────────────────────────

describe("cmfEraRetail — CMF series-bag MSRP era-table fallback", () => {
  it("71034 (Series 23) figs resolve to $4.99 — the gap Brickset has no -0 retail for", () => {
    expect(cmfEraRetail("71034-3")).toBe(4.99);
    expect(cmfEraRetail("71034-1")).toBe(4.99);
    expect(cmfEraRetail("71034")).toBe(4.99); // the series box itself
  });

  it("a working series base (71052 / Series 29) also HAS an era price — the ladder lets Brickset win", () => {
    // cmfEraRetail is unconditional by design; gating to 'only when Brickset is null' is the
    // ladder's job (source order), proven in retailLadder.test.js. Here we just pin the value.
    expect(cmfEraRetail("71052-5")).toBe(4.99);
  });

  it("era tiers map by series ordinal: 1–11 → $2.99, 12–17 → $3.99, 18–29 → $4.99", () => {
    expect(cmfEraRetail("8683-1")).toBe(2.99);  // Series 1
    expect(cmfEraRetail("71002-4")).toBe(2.99); // Series 11 — tier-1 ceiling
    expect(cmfEraRetail("71007-2")).toBe(3.99); // Series 12 — tier-2 floor
    expect(cmfEraRetail("71018-9")).toBe(3.99); // Series 17 — tier-2 ceiling
    expect(cmfEraRetail("71021-1")).toBe(4.99); // Series 18 — tier-3 floor
    expect(cmfEraRetail("71052-1")).toBe(4.99); // Series 29 — tier-3 ceiling
  });

  it("cmfEraPriceForSeries maps ordinals to tiers and rejects out-of-range / non-integers", () => {
    expect(cmfEraPriceForSeries(11)).toBe(2.99);
    expect(cmfEraPriceForSeries(12)).toBe(3.99);
    expect(cmfEraPriceForSeries(17)).toBe(3.99);
    expect(cmfEraPriceForSeries(18)).toBe(4.99);
    expect(cmfEraPriceForSeries(29)).toBe(4.99);
    expect(cmfEraPriceForSeries(0)).toBeNull();
    expect(cmfEraPriceForSeries(30)).toBeNull();
    expect(cmfEraPriceForSeries(12.5)).toBeNull();
  });

  it("themed CMF series (no numeric series#) get NO fallback — their Brickset -0 retail works", () => {
    expect(cmfEraRetail("71038-5")).toBeNull(); // Disney 100
    expect(cmfEraRetail("71039-3")).toBeNull(); // Marvel Studios
    expect(cmfEraRetail("71047-2")).toBeNull(); // Dungeons & Dragons
    expect(cmfEraRetail("71049-1")).toBeNull(); // F1 Race Cars
  });

  it("non-CMF sets and junk input get NO fallback (null, never a phantom price)", () => {
    expect(cmfEraRetail("10300-1")).toBeNull();
    expect(cmfEraRetail("75192-1")).toBeNull();
    expect(cmfEraRetail("")).toBeNull();
    expect(cmfEraRetail(null)).toBeNull();
    expect(cmfEraRetail(undefined)).toBeNull();
  });
});
