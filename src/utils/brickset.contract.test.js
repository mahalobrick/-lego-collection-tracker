import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT TEST — the by-construction lock for the Brickset field-select proxies
// (integration-standard.md §5, P4). Brickset's getSets endpoint backs BOTH
// /api/brickset-set and /api/brickset-search; getThemes backs /api/brickset-themes.
//
// The HIGH-VALUE pin is the UPSTREAM shape: a field-select proxy hides an upstream
// rename as a silent `null` (the key persists with a null value), so a proxy-OUTPUT
// pin would miss it — only asserting the upstream carries the fields the proxy reads
// catches that drift.
//
// STATIC-FIXTURE lock: this locks code-conformance to the captured shape + documents
// it; it does NOT auto-detect a live upstream rename (frozen fixtures). Re-run
// scripts/capture-brickset.mjs out-of-band to detect live drift. See
// test-data/brickset-fixtures/README.md.
// ─────────────────────────────────────────────────────────────────────────────
import set75192 from "../../test-data/brickset-fixtures/set-75192.json";   // full (UCS Falcon)
import set10300 from "../../test-data/brickset-fixtures/set-10300.json";   // full (BTTF)
import set10363 from "../../test-data/brickset-fixtures/set-10363.json";   // full, current 2025
import setPolybag from "../../test-data/brickset-fixtures/set-30432.json"; // SPARSE polybag
import search from "../../test-data/brickset-fixtures/search-millennium-falcon.json";
import themes from "../../test-data/brickset-fixtures/themes.json";

const FULL = [["75192", set75192], ["10300", set10300], ["10363", set10363]];
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// ── /set — THOROUGH ──────────────────────────────────────────────────────────
describe("Brickset /set (getSets) — upstream field-select contract", () => {
  it.each([...FULL, ["30432", setPolybag]])("%s — getSets envelope shape", (_n, fx) => {
    expect(fx.status).toBe("success");
    expect(Array.isArray(fx.sets)).toBe(true);
    expect(fx.sets.length).toBeGreaterThanOrEqual(1);
  });

  // Every REQUIRED field the proxy field-selects is present + typed on the full fixtures.
  it.each(FULL)("%s — carries every required field-selected source path", (_n, fx) => {
    const s = fx.sets[0];
    expect(typeof s.number).toBe("string");
    expect(typeof s.numberVariant).toBe("number");
    expect(typeof s.name).toBe("string");
    expect(typeof s.year).toBe("number");
    expect(typeof s.theme).toBe("string");
    expect(typeof s.themeGroup).toBe("string");
    expect(typeof s.subtheme).toBe("string");
    expect(typeof s.pieces).toBe("number");
    expect(typeof s.minifigs).toBe("number");
    expect(typeof s.rating).toBe("number");
    expect(typeof s.reviewCount).toBe("number");
    expect(typeof s.packagingType).toBe("string");
    expect(typeof s.availability).toBe("string");
    expect(typeof s.released).toBe("boolean");
    expect(typeof s.instructionsCount).toBe("number");
    expect(typeof s.bricksetURL).toBe("string");
    expect(typeof s.launchDate).toBe("string");
    expect(typeof s.exitDate).toBe("string");
    // nested objects the proxy reaches into
    expect(typeof s.dimensions.height).toBe("number");
    expect(typeof s.dimensions.width).toBe("number");
    expect(typeof s.dimensions.depth).toBe("number");
    expect(typeof s.image.imageURL).toBe("string");
    expect(typeof s.image.thumbnailURL).toBe("string");
    expect(typeof s.collections.ownedBy).toBe("number");
    expect(typeof s.collections.wantedBy).toBe("number");
    // optional-on-sparse, but present + typed on full sets
    expect(typeof s.LEGOCom.US.retailPrice).toBe("number");
    expect(typeof s.ageRange.min).toBe("number");
    expect(typeof s.barcode.EAN).toBe("string");
    expect(Array.isArray(s.extendedData.tags)).toBe(true);
    expect(s.LEGOCom).toHaveProperty("US");
    expect(s.LEGOCom).toHaveProperty("UK");
    expect(s.LEGOCom).toHaveProperty("CA");
    expect(s.LEGOCom).toHaveProperty("DE");
  });

  // OBSERVATION 1 — sparse sets return EMPTY OBJECTS, not absent keys.
  it("sparse polybag (30432) — optional containers present but empty (not absent keys)", () => {
    const s = setPolybag.sets[0];
    // containers exist…
    expect(s).toHaveProperty("LEGOCom");
    expect(s).toHaveProperty("ageRange");
    expect(s).toHaveProperty("barcode");
    // …but the leaf fields the proxy reads are absent (→ proxy yields null/""/[])
    expect(s.LEGOCom.US).toEqual({});
    expect(s.LEGOCom.US.retailPrice).toBeUndefined();
    expect(s.ageRange.min).toBeUndefined();
    expect(s.barcode.EAN).toBeUndefined();
    // core fields still present on a sparse set
    expect(typeof s.name).toBe("string");
    expect(typeof s.year).toBe("number");
    expect(typeof s.exitDate).toBe("string");
  });

  // OBSERVATION 2 — exit_date is ALWAYS present, a year-end placeholder, NOT a retirement flag.
  it("exitDate present on EVERY set (active + retired) — compare the date, never presence", () => {
    for (const [, fx] of [...FULL, ["30432", setPolybag]]) {
      expect(typeof fx.sets[0].exitDate).toBe("string");
    }
    // active sets carry a current/future year-end; the retired polybag a past year-end
    expect(new Date(set75192.sets[0].exitDate).getTime()).toBeGreaterThan(new Date("2026-05-31").getTime());
    expect(new Date(setPolybag.sets[0].exitDate).getTime()).toBeLessThan(new Date("2026-05-31").getTime());
  });

  // OBSERVATION 3 — dates are ISO datetimes, not YYYY-MM-DD.
  it("launchDate/exitDate are ISO datetimes", () => {
    expect(set75192.sets[0].launchDate).toMatch(ISO_DATETIME);
    expect(set75192.sets[0].exitDate).toMatch(ISO_DATETIME);
  });

  // proxy→client: the 11 fields MyCollection/WantedList consume off the proxy's `data`,
  // with the types those consumers rely on (mirrors api/brickset-set.js field-select).
  it.each(FULL)("%s — proxy→client consumed fields resolve with the right types", (_n, fx) => {
    const s = fx.sets[0];
    const data = {
      set_number: `${s.number}-${s.numberVariant || 1}`,
      name: s.name || "",
      theme: s.theme || "",
      subtheme: s.subtheme || "",
      year: s.year || null,
      pieces: s.pieces || null,
      minifigs: s.minifigs || null,
      launch_date: s.launchDate || null,
      exit_date: s.exitDate || null,
      retail_price_us: (s.LEGOCom.US && s.LEGOCom.US.retailPrice) || null,
      thumbnail_url: (s.image && s.image.thumbnailURL) || "",
    };
    expect(data.set_number).toMatch(/^\d{3,8}-\d+$/);
    expect(typeof data.name).toBe("string");
    expect(typeof data.year).toBe("number");
    expect(typeof data.pieces).toBe("number");
    expect(typeof data.minifigs).toBe("number");
    expect(typeof data.retail_price_us).toBe("number");          // present on full sets
    expect(new Date(data.exit_date).toString()).not.toBe("Invalid Date"); // consumers new Date() it
    expect(new Date(data.launch_date).toString()).not.toBe("Invalid Date");
    expect(typeof data.thumbnail_url).toBe("string");
  });

  it("sparse polybag — retail_price_us resolves to null (consumer treats as 'no MSRP')", () => {
    const s = setPolybag.sets[0];
    const retail_price_us = (s.LEGOCom.US && s.LEGOCom.US.retailPrice) || null;
    expect(retail_price_us).toBeNull();
  });
});

// ── /search — LIGHT ──────────────────────────────────────────────────────────
describe("Brickset /search (getSets, multi) — field-select contract (light)", () => {
  it("multi-result envelope: status, numeric matches, pageSize-capped sets[]", () => {
    expect(search.status).toBe("success");
    expect(typeof search.matches).toBe("number");
    expect(Array.isArray(search.sets)).toBe(true);
    expect(search.sets.length).toBeGreaterThan(1);
    expect(search.sets.length).toBeLessThanOrEqual(20); // proxy pageSize
  });

  it("sets[0] carries the search field-selected paths", () => {
    const s = search.sets[0];
    expect(typeof s.number).toBe("string");
    expect(s).toHaveProperty("numberVariant");
    expect(typeof s.name).toBe("string");
    expect(typeof s.theme).toBe("string");
    expect(s).toHaveProperty("year");
    expect(s).toHaveProperty("LEGOCom");          // msrp source (may be empty per set)
    expect(s.image).toHaveProperty("thumbnailURL");
    expect(s).toHaveProperty("availability");
  });
});

// ── /themes — LIGHT ──────────────────────────────────────────────────────────
describe("Brickset /themes (getThemes) — field-select contract (light)", () => {
  it("themes[] of objects with a string `theme` (the only field the proxy reads)", () => {
    expect(themes.status).toBe("success");
    expect(Array.isArray(themes.themes)).toBe(true);
    expect(themes.themes.length).toBeGreaterThan(50);
    expect(typeof themes.themes[0].theme).toBe("string");
    expect(themes.themes.every((t) => typeof t.theme === "string")).toBe(true);
  });
});
