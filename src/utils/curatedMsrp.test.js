// @vitest-environment node
//
// Curated MSRP — DRIFT GUARD + lookup contract. The CSV (docs/curated-msrp.csv) is the single
// source of truth; src/utils/curatedMsrp.js is generated from it (scripts/gen-curated-msrp.mjs)
// and committed. This pins that the committed module has NOT drifted from the CSV (re-run the
// shared parser on the CSV and compare), so a CSV edit without `node scripts/gen-curated-msrp.mjs`
// turns CI red instead of silently shipping a stale table.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildCuratedMap, CSV_PATH } from "../../scripts/gen-curated-msrp.mjs";
import { CURATED_MSRP, curatedRetail } from "./curatedMsrp.js";

describe("curatedMsrp — drift guard (module must match the CSV)", () => {
  it("the committed module equals a fresh build from docs/curated-msrp.csv", () => {
    const built = buildCuratedMap(readFileSync(CSV_PATH, "utf8"));
    expect(CURATED_MSRP).toEqual(built); // edit the CSV without regenerating → RED here
  });

  it("omits tier=none / blank-msrp rows → 128 priced entries (34 sourced + 94 estimated)", () => {
    expect(Object.keys(CURATED_MSRP).length).toBe(128);
    const tiers = Object.values(CURATED_MSRP).reduce((m, e) => ((m[e.tier] = (m[e.tier] || 0) + 1), m), {});
    expect(tiers).toEqual({ sourced: 34, estimated: 94 });
  });
});

describe("curatedRetail — pure lookup contract", () => {
  it("returns the curated row for a known set", () => {
    expect(curatedRetail("30303-1")).toEqual({
      msrp: 3.99, tier: "sourced", confidence: "B", source: "Brickset website RRP (verified live)",
    });
  });

  it("30625 (tier=none, no standalone MSRP) → null → set stays not-listed", () => {
    expect(curatedRetail("30625-1")).toBeNull();
  });

  it("an unknown set → null", () => {
    expect(curatedRetail("99999-1")).toBeNull();
  });

  it("30566 is tagged as a UK→USD conversion (confirmed decision)", () => {
    const e = curatedRetail("30566-1");
    expect(e.tier).toBe("sourced");
    expect(e.msrp).toBe(4.68);
    expect(e.source).toContain("converted (UK→USD)");
  });

  it("carries the curated confidence + source for every entry (for the detail/tooltip)", () => {
    for (const [, e] of Object.entries(CURATED_MSRP)) {
      expect(["A", "B", "C", "D"]).toContain(e.confidence);
      expect(typeof e.source).toBe("string");
      expect(e.source.length).toBeGreaterThan(0);
    }
  });
});
