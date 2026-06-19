// @vitest-environment node
//
// The collection CSV export's MSRP/retail columns. Two guarantees:
//   (1) CARD ↔ EXPORT PARITY — a row's msrp/segment/source come from the SAME shared resolver
//       (makeRetailResolver) the MSRP card uses, read into the right columns, over the FULL
//       (unstripped) setNumber. A stripped "30303" would miss the curated rung — pinned below.
//   (2) EXPORT CONTENT — headers + the 6 new columns + values across every segment + CSV escaping.
//
// node env: pure builder, no DOM/localStorage. Clock frozen so the sourced rungs that stamp asOf
// via toValue's `new Date()` default (manual/cmf/curated_sourced) are deterministic.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildCollectionCsv, collectionCsvCells, COLLECTION_CSV_HEADERS } from "./collectionCsv";
import { makeRetailResolver } from "./retailResolver";
import { retailSegment } from "./portfolio";
import { ownedSetFromBlob } from "./beCollection";

const FIXED = "2025-06-01T00:00:00.000Z";
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(FIXED)); });
afterAll(() => { vi.useRealTimers(); });

// Brickset cache with one cached US retail (the brickset rung); everything else resolves off the
// static curated/cmf tables or to null.
const CACHE = { "brickset_10300-1": { data: { retail_price_us: 100 }, fetchedAt: FIXED } };
const resolve = makeRetailResolver(CACHE);

describe("COLLECTION_CSV_HEADERS — 7 original columns + 6 MSRP/retail columns", () => {
  it("appends the 6 retail columns after the original 7, in order", () => {
    expect(COLLECTION_CSV_HEADERS).toEqual([
      "setNumber", "name", "theme", "qty", "paidPrice", "currentValue", "notes",
      "msrp", "msrpSegment", "msrpSource", "msrpConfidence", "msrpCuratedSource", "msrpAsOf",
      "condition",
    ]);
  });
});

describe("collectionCsvCells — card ↔ export parity (same resolver, right columns, full setNumber)", () => {
  // The MSRP card path IS makeRetailResolver (MyCollection.retailFor). Resolve each set both ways and
  // assert the export's amount/segment/source cells equal the card's Value — parity by construction.
  it("msrp/segment/source cells equal the card's resolved Value for every segment", () => {
    const sets = [
      { setNumber: "10300-1" },   // brickset → sourced
      { setNumber: "30303-1" },   // curated_sourced → sourced
      { setNumber: "30370-1" },   // curated_estimated → estimated
      { setNumber: "6490363-1" }, // promo + curated ARV → promo-arv
      { setNumber: "9999999-1" }, // promo, no source → promo-no-msrp
      { setNumber: "22222-1" },   // unsourced → not-listed
    ];
    for (const s of sets) {
      const card = resolve(s);
      const cells = collectionCsvCells(s, resolve);
      expect(cells[7]).toBe(card?.amount ?? "");     // msrp
      expect(cells[8]).toBe(retailSegment(card));    // msrpSegment
      expect(cells[9]).toBe(card?.source ?? "");     // msrpSource
    }
  });

  it("uses the FULL unstripped setNumber — '30303-1' hits curated_sourced; a stripped '30303' would not", () => {
    expect(collectionCsvCells({ setNumber: "30303-1" }, resolve)[8]).toBe("sourced");
    expect(collectionCsvCells({ setNumber: "30303-1" }, resolve)[9]).toBe("curated_sourced");
    expect(collectionCsvCells({ setNumber: "30303" }, resolve)[8]).toBe("not-listed"); // stripped → curated miss
  });

  it("projecting via ownedSetFromBlob yields IDENTICAL retail cells as identity (resolution-neutral)", () => {
    const blobRow = {
      setNumber: "30303-1", name: "Poly", theme: "City", quantity: 1,
      entries: [{ set_number: "30303-1", condition: "new", current_value: 5, paid_price: 2 }],
      averagePaid: 2, totalValue: 5, msrp: null,
    };
    const idCells = collectionCsvCells(blobRow, resolve, (r) => r);
    const projCells = collectionCsvCells(blobRow, resolve, (r) => ownedSetFromBlob(r, {}));
    expect(projCells.slice(7)).toEqual(idCells.slice(7)); // the 6 retail cells match
  });
});

describe("buildCollectionCsv — per-condition rows: a MIXED set splits into new + used", () => {
  // 2 new copies (paid 100/120, value 200/220) + 1 used copy (paid 60, value 150).
  const mixed = {
    setNumber: "75313-1", name: "AT-AT", theme: "Star Wars",
    entries: [
      { condition: "new",          paid_price: 100, current_value: 200 },
      { condition: "usedcomplete", paid_price: 60,  current_value: 150 },
      { condition: "new",          paid_price: 120, current_value: 220 },
    ],
  };
  let rows;
  beforeAll(() => { rows = buildCollectionCsv([mixed], resolve, (s) => s).split("\n").slice(1); }); // drop header
  const cell = (line, i) => Number(line.split(",")[i].replace(/"/g, ""));
  const cond = (line) => line.split(",").pop().replace(/"/g, "");

  it("emits exactly 2 rows — one 'new', one 'used' — never a single 'mixed'", () => {
    expect(rows).toHaveLength(2);
    expect(rows.map(cond).sort()).toEqual(["new", "used"]);
  });

  it("per-bucket qty + value sum back to the set totals; paid is not double-counted", () => {
    const by = Object.fromEntries(rows.map((r) => [cond(r), r]));
    const qN = cell(by.new, 3), qU = cell(by.used, 3);   // qty
    const vN = cell(by.new, 5), vU = cell(by.used, 5);   // currentValue
    const pN = cell(by.new, 4), pU = cell(by.used, 4);   // paidPrice (per-unit avg)
    expect([qN, qU]).toEqual([2, 1]);
    expect(qN + qU).toBe(3);                              // = 3 copies
    expect(vN + vU).toBe(570);                            // 200 + 220 + 150
    expect([pN, pU]).toEqual([110, 60]);
    expect(pN * qN + pU * qU).toBe(280);                  // 100 + 120 + 60 — no double count
  });
});

describe("buildCollectionCsv — full file content across every segment + escaping", () => {
  const sets = [
    { setNumber: "10300-1", name: "Falcon", theme: "Star Wars", quantity: 2, averagePaid: 600, totalValue: 900 },
    { setNumber: "30566-1", name: "Polybag", theme: "City", quantity: 1, averagePaid: 0, totalValue: 5 }, // curated_sourced, converted UK→USD
    { setNumber: "30370-1", name: "Poly2", theme: "City", quantity: 3, averagePaid: 4, totalValue: 6 },    // curated_estimated
    { setNumber: "6490363-1", name: "GWP", theme: "Promotional", quantity: 1, averagePaid: 0, totalValue: 25 }, // promo-arv
    { setNumber: "9999999-1", name: "GWP2", theme: "Promotional", quantity: 1, averagePaid: 0, totalValue: 0 }, // promo-no-msrp
    { setNumber: "22222-1", name: "Plain", theme: "City", quantity: 1, averagePaid: 10, totalValue: 12 },  // not-listed
    { setNumber: "11111-1", name: 'Big, "Rare" Set', theme: "Ideas", quantity: 1, averagePaid: 0, totalValue: 0, msrp: 49.99 }, // manual + escaping
  ];
  // Build AFTER the clock freeze (the top-level beforeAll). The describe body runs during collection,
  // before any beforeAll — building here would stamp the toValue-sourced rungs (manual/curated_sourced)
  // with the real clock, so defer to a beforeAll that runs once timers are fake.
  let lines;
  beforeAll(() => { lines = buildCollectionCsv(sets, resolve, (s) => s).split("\n"); });

  it("header row is the 14 columns, comma-joined", () => {
    expect(lines[0]).toBe(COLLECTION_CSV_HEADERS.join(","));
  });

  it("brickset → sourced: msrp 100, source brickset, asOf = the fetch stamp", () => {
    expect(lines[1]).toBe(
      `"10300-1","Falcon","Star Wars","2","600","900","","100","sourced","brickset","","","${FIXED}","new"`
    );
  });

  it("curated_sourced → sourced: carries confidence + the 'converted (UK→USD)' tag verbatim", () => {
    expect(lines[2]).toBe(
      `"30566-1","Polybag","City","1","0","5","","4.68","sourced","curated_sourced","B","converted (UK→USD); Brickset UK RRP £3.49×1.34","${FIXED}","new"`
    );
  });

  it("curated_estimated → estimated: basis estimated, asOf blank (not toValue-stamped)", () => {
    expect(lines[3]).toBe(
      `"30370-1","Poly2","City","3","4","6","","4.99","estimated","curated_estimated","C","Retail polybag standard","","new"`
    );
  });

  it("promo + curated ARV → promo-arv (a valued GWP)", () => {
    expect(lines[4]).toBe(
      `"6490363-1","GWP","Promotional","1","0","25","","19.99","promo-arv","curated_estimated","D","Seasonal GWP value proxy","","new"`
    );
  });

  it("promo, no source → promo-no-msrp (empty msrp/source)", () => {
    expect(lines[5]).toBe(
      `"9999999-1","GWP2","Promotional","1","0","0","","","promo-no-msrp","","","","","new"`
    );
  });

  it("unsourced → not-listed (empty retail cells)", () => {
    expect(lines[6]).toBe(
      `"22222-1","Plain","City","1","10","12","","","not-listed","","","","","new"`
    );
  });

  it("manual rung + CSV escaping: embedded comma & quotes are doubled and the field is quoted", () => {
    expect(lines[7]).toBe(
      `"11111-1","Big, ""Rare"" Set","Ideas","1","0","0","","49.99","sourced","manual","","","${FIXED}","new"`
    );
  });
});
