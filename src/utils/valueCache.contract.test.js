import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT TEST — the by-construction lock for the /api/values response shape
// (docs/integration-standard.md §5). Pins a REAL captured response against the
// exact fields the app-read (Step 2) will consume. A field-select change in
// api/values.js that drops/renames a consumed field — or re-adds the implied
// `source`/`condition` — fails this shape → unmergeable red.
//
// Fixture: a real /api/values POST response captured 2026-06-02 from the live
// handler reading the BrickLink value cache. See test-data/values-fixtures/README.md.
// ─────────────────────────────────────────────────────────────────────────────
import response from "../../test-data/values-fixtures/values-response.json";

const CACHED = ["75298-1", "30303-1"]; // present in the cache → real records
const ABSENT = "71045-12";             // deferred CMF → null (no cached value)
const VALID_BASES = ["sold", "sold_thin", "modeled", "modeled_thin", "asking", "unknown"];
const COND_KEYS = ["amount", "basis", "lots", "asOf"]; // the curated per-condition shape

const isIsoString = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

function assertCondition(c) {
  // null is a valid condition value (unknown ≠ a fabricated record).
  if (c === null) return;
  expect(typeof c).toBe("object");
  // EXACTLY the curated keys — `source`/`condition` are implied and must be field-selected out.
  expect(Object.keys(c).sort()).toEqual([...COND_KEYS].sort());
  expect(c).not.toHaveProperty("source");
  expect(c).not.toHaveProperty("condition");
  expect(c.amount === null || typeof c.amount === "number").toBe(true); // null = unknown, never fake 0
  expect(typeof c.basis).toBe("string");
  expect(VALID_BASES).toContain(c.basis);
  expect(typeof c.lots).toBe("number");
  expect(isIsoString(c.asOf)).toBe(true);
}

describe("/api/values response contract", () => {
  it("top-level is a { [setNumber]: record|null } map", () => {
    expect(response && typeof response).toBe("object");
    expect(Array.isArray(response)).toBe(false);
  });

  describe.each(CACHED)("cached set %s → a { new, used } record", (num) => {
    const rec = response[num];

    it("is a record carrying new + used", () => {
      expect(rec).toBeTruthy();
      expect(typeof rec).toBe("object");
      expect(rec).toHaveProperty("new");
      expect(rec).toHaveProperty("used");
    });

    it("new condition matches the curated {amount,basis,lots,asOf} shape", () => {
      assertCondition(rec.new);
    });

    it("used condition matches the curated {amount,basis,lots,asOf} shape", () => {
      assertCondition(rec.used);
    });
  });

  it(`deferred CMF ${ABSENT} → null (no cached value)`, () => {
    expect(response).toHaveProperty(ABSENT);
    expect(response[ABSENT]).toBeNull();
  });

  it("source is implied BrickLink — never echoed into a per-condition object", () => {
    for (const num of CACHED) {
      for (const cond of ["new", "used"]) {
        const c = response[num][cond];
        if (c !== null) expect(c).not.toHaveProperty("source");
      }
    }
  });
});
