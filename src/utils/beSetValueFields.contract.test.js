import { describe, it, expect } from "vitest";
import { beValueForCondition } from "./beSyncValues";

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT TEST — the by-construction lock for BrickEconomy /set VALUE fields
// (integration-standard.md §5, P2). Sibling to priceEvents.test.js: it pins the
// REAL captured /set payload shape against the exact fields the value path and the
// value-bearing detail panels consume. A silent upstream rename (e.g. BE renames
// current_value_new) makes a re-captured fixture fail this shape → unmergeable red.
//
// This is distinct from value.characterization.test.js, which asserts the DERIVED
// behavior of beValueForCondition/beValueForSet on hand-authored inputs. This file
// asserts the upstream FIELD SHAPE in real payloads — the gap §5 logs as P2
// ("value-field shape not directly asserted, only derived output").
//
// Fixtures: real GET /api/v1/set/{num}?currency=USD payloads captured 2026-05-31
// (generator scripts/capture-price-events.mjs removed in the BE teardown — these are now a frozen
// snapshot). See test-data/be-fixtures/README.md. Each file is the verbatim { data: {…} } envelope
// the BE cache stores.
// ─────────────────────────────────────────────────────────────────────────────
import retiredNewUsed from "../../test-data/be-fixtures/30432-1.json"; // retired, new + used + band
import retiredNewOnly from "../../test-data/be-fixtures/71460-1.json"; // retired, used value + retired_date
import atRetailA from "../../test-data/be-fixtures/10300-1.json";       // at-retail (BTTF DeLorean)
import atRetailB from "../../test-data/be-fixtures/10307-1.json";       // at-retail (Eiffel Tower)
import atRetailC from "../../test-data/be-fixtures/10363-1.json";       // at-retail (da Vinci)

const RETIRED = [
  ["30432-1", retiredNewUsed],
  ["71460-1", retiredNewOnly],
];
const AT_RETAIL = [
  ["10300-1", atRetailA],
  ["10307-1", atRetailB],
  ["10363-1", atRetailC],
];
const ALL = [...RETIRED, ...AT_RETAIL];

// The fields the code actually CONSUMES off the /set payload, and who reads them.
// (Catalog only — the assertions below pin presence + type per the presence matrix.)
//   current_value_new          → beValueForCondition (beSyncValues.js:22), WatchDetailPanel:35
//   current_value_used         → beValueForCondition (beSyncValues.js:23)            [retired only]
//   retail_price_us            → beValueForCondition fallback (beSyncValues.js:24), SetDetailPanel:66
//   retired                    → applyCache provenance (beSyncValues.js:75,90), SetDetailPanel:108
//   retired_date               → MyCollection reads entries[0]?.retired_date:195      [retired, inconsistent]
// (forecast_value_new_2/5_years were consumed by the detail panels until the BE-removal D2 drop —
//  no code reads them now, so they are no longer pinned here.)

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

describe("BE /set value-field contract — fields present in EVERY real fixture", () => {
  describe.each(ALL)("%s", (_num, fixture) => {
    const d = fixture.data;

    it("envelope is { data: {…} } — the shape beSyncValues.fetchSet caches", () => {
      expect(d).toBeTruthy();
      expect(typeof d).toBe("object");
    });

    it("current_value_new is a positive number (the canonical value field)", () => {
      // beValueForCondition reads d.current_value_new first; the rollup depends on it.
      expect(isNum(d.current_value_new)).toBe(true);
      expect(d.current_value_new).toBeGreaterThan(0);
    });

    it("retail_price_us is a positive number (the value fallback + MSRP label)", () => {
      expect(isNum(d.retail_price_us)).toBe(true);
      expect(d.retail_price_us).toBeGreaterThan(0);
    });

    it("beValueForCondition('new') returns the fixture's current_value_new (field is wired)", () => {
      expect(beValueForCondition(d, "new")).toBe(d.current_value_new);
    });
  });
});

describe("BE /set value-field contract — RETIRED sets carry the used cluster", () => {
  describe.each(RETIRED)("%s", (_num, fixture) => {
    const d = fixture.data;

    it("retired === true (boolean) — drives value provenance + UI status", () => {
      expect(d.retired).toBe(true);
    });

    it("current_value_used is a positive number (used-condition value source)", () => {
      expect(isNum(d.current_value_used)).toBe(true);
      expect(d.current_value_used).toBeGreaterThan(0);
    });

    it("used value band (current_value_used_low/high) is present and ordered", () => {
      // The band travels with the used value on retired sets (README presence matrix).
      expect(isNum(d.current_value_used_low)).toBe(true);
      expect(isNum(d.current_value_used_high)).toBe(true);
      expect(d.current_value_used_low).toBeLessThanOrEqual(d.current_value_used_high);
    });

    it("beValueForCondition('used') returns the fixture's current_value_used (wired)", () => {
      expect(beValueForCondition(d, "used")).toBe(d.current_value_used);
    });
  });
});

describe("BE /set value-field contract — AT-RETAIL sets (the value-fallback shape)", () => {
  describe.each(AT_RETAIL)("%s", (_num, fixture) => {
    const d = fixture.data;

    it("'retired' key is ABSENT (not retired:false) — read defensively", () => {
      // The whole retired/used cluster is absent together; code treats absent retired
      // as falsy provenance. Pin absence so a future retired:false isn't mistaken.
      expect("retired" in d).toBe(false);
    });

    it("current_value_used is ABSENT — used falls back to new (G2 launder path)", () => {
      expect("current_value_used" in d).toBe(false);
    });

    it("current_value_new mirrors retail_price_us (at-primary-retail invariant)", () => {
      expect(d.current_value_new).toBe(d.retail_price_us);
    });
  });
});

describe("BE /set value-field contract — documented shape facts (drift guards)", () => {
  it("current_value_new_low/high are NOT delivered by BE — only the USED band exists", () => {
    // Orientation listed (+low/high) for NEW as a candidate; reality has no new band
    // in any captured payload. No production code reads new_low/high, so this is
    // benign today — but pin the absence so a consumer can't quietly assume it exists.
    for (const [, fixture] of ALL) {
      expect("current_value_new_low" in fixture.data).toBe(false);
      expect("current_value_new_high" in fixture.data).toBe(false);
    }
  });

  it("retired_date, when present, is a strict YYYY-MM-DD string (travels inconsistently)", () => {
    // Present on 71460-1, ABSENT on 30432-1 — so it is NOT a guaranteed retired field.
    // Pin the type where present; do not require it. (Consumer reads it off entries[].)
    expect("retired_date" in retiredNewOnly.data).toBe(true);
    expect(retiredNewOnly.data.retired_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect("retired_date" in retiredNewUsed.data).toBe(false);
  });
});
