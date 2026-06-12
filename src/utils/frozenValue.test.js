import { describe, it, expect } from "vitest";
import { FROZEN_VALUE_SETS, FROZEN_VALUE_ASOF, isFrozenValueSet, frozenAsOf, frozenValue } from "./frozenValue";
import { NUMERIC_PROMO_SKIP } from "../../scripts/lib/setList.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// BE-removal D1 — the frozen-value registry. The two promos (6490363-1 / 6550806-1)
// 404 on BrickLink's SET endpoint, have no live market source and no retail MSRP, so
// their last BrickEconomy number is kept as STATIC provenance. This pins the EXACT
// allowlist (never a prefix wildcard), the de-variant normalization (so the suffixed
// app form and the stripped beSyncValues form both resolve), and the frozen Value shape.
// ─────────────────────────────────────────────────────────────────────────────

describe("FROZEN_VALUE_SETS — the exact 2-promo allowlist", () => {
  it("is exactly the two deferred promos, -1-suffixed (canonical form)", () => {
    expect([...FROZEN_VALUE_SETS.keys()].sort()).toEqual(["6490363-1", "6550806-1"]);
  });

  it("can NOT drift from the cron's NUMERIC_PROMO_SKIP (one fact, two places)", () => {
    // The app-side freeze and the cron-side defer MUST name the same two promos. A
    // drift here means a set is frozen in the app but still cron-valued (or vice versa).
    expect([...FROZEN_VALUE_SETS.keys()].sort()).toEqual([...NUMERIC_PROMO_SKIP].sort());
  });
});

describe("isFrozenValueSet — exact membership, de-variant normalized, never prefix-matched", () => {
  it("matches the canonical -1 form (the app / valueMap key)", () => {
    expect(isFrozenValueSet("6490363-1")).toBe(true);
    expect(isFrozenValueSet("6550806-1")).toBe(true);
  });

  it("matches the de-varianted form (the form beSyncValues strips '-1' to)", () => {
    expect(isFrozenValueSet("6490363")).toBe(true);
    expect(isFrozenValueSet("6550806")).toBe(true);
  });

  it("does NOT match a different variant or a prefix/superstring (exact, not wildcard)", () => {
    expect(isFrozenValueSet("6490363-2")).toBe(false); // different variant
    expect(isFrozenValueSet("64903631")).toBe(false);  // superstring, no dash
    expect(isFrozenValueSet("649036")).toBe(false);    // prefix
    expect(isFrozenValueSet("10300-1")).toBe(false);   // unrelated set
  });

  it("is null-safe (empty / null / undefined → false, no throw)", () => {
    expect(isFrozenValueSet("")).toBe(false);
    expect(isFrozenValueSet(null)).toBe(false);
    expect(isFrozenValueSet(undefined)).toBe(false);
  });
});

describe("frozenAsOf — the honest static 'as-of' date", () => {
  it("returns the freeze date for a frozen set (either form)", () => {
    expect(frozenAsOf("6490363-1")).toBe(FROZEN_VALUE_ASOF);
    expect(frozenAsOf("6550806")).toBe(FROZEN_VALUE_ASOF);
  });

  it("returns null for a non-frozen set", () => {
    expect(frozenAsOf("10300-1")).toBeNull();
    expect(frozenAsOf(null)).toBeNull();
  });
});

describe("frozenValue — the static-provenance Value struct", () => {
  it("carries the stored amount with basis+source 'frozen' and the as-of date", () => {
    const v = frozenValue(23.72, { condition: "new", setNumber: "6490363-1" });
    expect(v).toEqual({
      amount: 23.72,
      source: "frozen",
      condition: "new",
      basis: "frozen",
      asOf: FROZEN_VALUE_ASOF,
      lots: null,
    });
  });

  it("defaults condition to null and tolerates a missing setNumber (asOf null)", () => {
    const v = frozenValue(10);
    expect(v.condition).toBeNull();
    expect(v.asOf).toBeNull();
    expect(v.basis).toBe("frozen");
  });
});
