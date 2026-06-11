import { describe, it, expect } from "vitest";
import { collectionFromBlob, buildWorkList, isCmfOrPromo, blSetId, condOf, cmfBlId, CMF_PREFIX_TABLE } from "./setList.mjs";

// 75298-style fixtures. Pins the set-sourcing the batch shares across input sources (backup file or
// the live Upstash per-user blobs) — so the source swap is provably equivalent on the same data.

const e = (setNumber, theme, conds, name = "") =>
  ({ setNumber, theme, name, entries: conds.map((c) => ({ condition: c, current_value: 10 })) });

describe("collectionFromBlob — extract the normalized collection from a synced blob", () => {
  it("reads the canonical brickEconomyNormalized key", () => {
    expect(collectionFromBlob({ brickEconomyNormalized: [{ setNumber: "75298-1" }] })).toHaveLength(1);
  });
  it("falls back to the localStorage-variant key name", () => {
    expect(collectionFromBlob({ brickEconomyNormalizedCollection: [{ setNumber: "10298-1" }] })).toHaveLength(1);
  });
  it("is [] for an empty / missing / malformed blob", () => {
    expect(collectionFromBlob(null)).toEqual([]);
    expect(collectionFromBlob({})).toEqual([]);
    expect(collectionFromBlob("nope")).toEqual([]);
  });
});

describe("isCmfOrPromo — the CMF/promo classifier (no longer the skip gate: mapped CMFs are valued)", () => {
  it("skips theme 'Minifigure Series' (any set number)", () => {
    expect(isCmfOrPromo({ setNumber: "71045-12", theme: "Minifigure Series" })).toBe(true);
    expect(isCmfOrPromo({ setNumber: "71034-1", theme: "Minifigure Series" })).toBe(true);
  });
  it("skips the 2 numeric promo IDs (themed Seasonal)", () => {
    expect(isCmfOrPromo({ setNumber: "6490363-1", theme: "Seasonal" })).toBe(true);
    expect(isCmfOrPromo({ setNumber: "6550806-1", theme: "Seasonal" })).toBe(true);
  });
  it("keeps a real boxed set (incl. other Seasonal / 71xxx boxed sets)", () => {
    expect(isCmfOrPromo({ setNumber: "75298-1", theme: "Star Wars" })).toBe(false);
    expect(isCmfOrPromo({ setNumber: "71741-1", theme: "Ninjago" })).toBe(false);
    expect(isCmfOrPromo({ setNumber: "40584-1", theme: "Seasonal" })).toBe(false);
  });
});

describe("blSetId / condOf", () => {
  it("blSetId appends -1 only when no variant suffix", () => {
    expect(blSetId("75298")).toBe("75298-1");
    expect(blSetId("75298-1")).toBe("75298-1");
    expect(blSetId("71045-12")).toBe("71045-12");
  });
  it("condOf maps any used* condition to 'used', else 'new'", () => {
    expect(condOf("new")).toBe("new");
    expect(condOf("sealed")).toBe("new");
    expect(condOf(null)).toBe("new");
    expect(condOf("usedasnew")).toBe("used");
    expect(condOf("usedcomplete")).toBe("used");
  });
});

// ── CMF Phase-2 mapping (docs/cmf-mapping-spike.md — VPS probe: 11/11 prefixes healthy, promos 404) ──

describe("cmfBlId — our CMF 'BASE-N' → BL col SET id (position preserved, curated prefixes)", () => {
  it("maps every curated series base, preserving the figure position", () => {
    // Expectations hardcoded from the spike doc's validated table — NOT derived from the export,
    // so a typo'd prefix in setList.mjs fails here instead of silently mispricing a series.
    const expected = {
      71034: "col23", 71037: "col24", 71038: "coldis100", 71039: "colmar2",
      71045: "col25", 71046: "col26", 71047: "coldnd", 71048: "col27",
      71049: "colf1rc", 71051: "col28", 71052: "col29",
    };
    for (const [base, prefix] of Object.entries(expected)) {
      expect(cmfBlId(`${base}-7`)).toBe(`${prefix}-7`);
    }
    expect(Object.keys(CMF_PREFIX_TABLE).sort()).toEqual(Object.keys(expected).sort());
  });
  it("preserves two-digit positions (Disney 100 runs to 18)", () => {
    expect(cmfBlId("71038-18")).toBe("coldis100-18");
    expect(cmfBlId("71039-11")).toBe("colmar2-11");
  });
  it("is null for an unmapped series base (future series stay deferred, never raw-queried)", () => {
    expect(cmfBlId("71050-3")).toBe(null);
    expect(cmfBlId("71054-1")).toBe(null);
  });
  it("is null for promos, malformed numbers, and non-BASE-N shapes", () => {
    expect(cmfBlId("6490363-1")).toBe(null);
    expect(cmfBlId("71034")).toBe(null);
    expect(cmfBlId("col23-1")).toBe(null);
    expect(cmfBlId("")).toBe(null);
  });
});

describe("buildWorkList — dedupe, CMF translation, deferrals, conditions", () => {
  it("translates mapped CMFs into the work list; defers promos; keeps real sets", () => {
    const entries = [
      e("75298-1", "Star Wars", ["new"]),
      e("71045-12", "Minifigure Series", ["usedasnew"]),   // CMF → translated, now valued
      e("6490363-1", "Seasonal", ["new"]),                  // promo ID → stays deferred (404 on SET endpoint)
      e("30303-1", "DC Comics Super Heroes", ["new"]),
    ];
    const { work, cmfSkipped, uniqueCount } = buildWorkList(entries);
    expect(uniqueCount).toBe(4);
    expect(cmfSkipped).toBe(1); // only the promo remains deferred
    expect(work.map((w) => w.number)).toEqual(["75298-1", "71045-12", "30303-1"]);
  });

  it("a mapped CMF fetches the col SET id but keeps OUR number for the value:SET keyspace", () => {
    const { work } = buildWorkList([e("71045-12", "Minifigure Series", ["usedasnew"])]);
    expect(work[0]).toMatchObject({ number: "71045-12", setId: "col25-12" });
    expect(work[0].ownedConditions).toEqual(["used"]);
  });

  it("defers a CMF series NOT in the curated table (fail-safe — never raw-queried)", () => {
    const { work, cmfSkipped } = buildWorkList([e("71050-3", "Minifigure Series", ["new"])]);
    expect(work).toHaveLength(0);
    expect(cmfSkipped).toBe(1);
  });

  it("defers both promo IDs", () => {
    const { work, cmfSkipped } = buildWorkList([
      e("6490363-1", "Seasonal", ["new"]),
      e("6550806-1", "Seasonal", ["new"]),
    ]);
    expect(work).toHaveLength(0);
    expect(cmfSkipped).toBe(2);
  });

  it("GUARD: a theme-drifted entry on a CMF base still translates — raw 71xxx-N never reaches the fetch", () => {
    // BL's own 71048-2 is a whole-series packaging variant (~12× a single figure) — the trap.
    const { work } = buildWorkList([e("71048-2", "Collectible Minifigures", ["new"])]);
    expect(work[0]).toMatchObject({ number: "71048-2", setId: "col27-2" });
  });

  it("GUARD: suffix-less numbers are normalized BEFORE the promo skip and the translation", () => {
    // The wanted-list path strips '-1' suffixes, so suffix-less numbers reach the collection.
    // Both checks must see the suffixed form, or '71048' raw-queries and '6490363' un-defers.
    const { work, cmfSkipped } = buildWorkList([
      e("71048", "Collectable Minifigures", ["new"]), // drifted theme AND no suffix → still col27-1
      e("6490363", "Seasonal", ["new"]),              // suffix-less promo → still deferred
      e("71034", "Minifigure Series", ["new"]),       // suffix-less CMF theme → col23-1
    ]);
    expect(work.map((w) => w.setId)).toEqual(["col27-1", "col23-1"]);
    expect(cmfSkipped).toBe(1);
  });

  it("GUARD sweep: no emitted setId is ever a raw BASE-N on a curated CMF base", () => {
    const entries = [
      ...Object.keys(CMF_PREFIX_TABLE).map((base) => e(`${base}-2`, "Minifigure Series", ["new"])),
      ...Object.keys(CMF_PREFIX_TABLE).map((base) => e(base, "", ["new"])), // suffix-less, theme lost
      e("6490363-1", "Seasonal", ["new"]),
      e("6550806", "Seasonal", ["new"]),  // suffix-less promo
      e("75298-1", "Star Wars", ["new"]),
      e("71741-1", "Ninjago", ["new"]),   // boxed 71xxx that is NOT a CMF base — must stay raw
      e("40584-1", "Seasonal", ["new"]),
    ];
    const { work, cmfSkipped } = buildWorkList(entries);
    const rawCmf = work.filter((w) => {
      const m = /^(\d+)-\d+$/.exec(w.setId);
      return m && CMF_PREFIX_TABLE[m[1]] !== undefined;
    });
    expect(rawCmf).toEqual([]);
    expect(work.filter((w) => w.setId.startsWith("col")).length).toBe(22); // 11 suffixed + 11 suffix-less
    expect(work.find((w) => w.number === "71741-1")?.setId).toBe("71741-1"); // non-CMF 71xxx untouched
    expect(cmfSkipped).toBe(2); // just the promos (one of them suffix-less)
  });

  it("dedupes by set number across the union (first occurrence wins)", () => {
    const { work, uniqueCount } = buildWorkList([
      e("75298-1", "Star Wars", ["new"]),
      e("75298-1", "Star Wars", ["usedcomplete"]), // duplicate (e.g. a second user) → one work item
    ]);
    expect(uniqueCount).toBe(1);
    expect(work).toHaveLength(1);
  });

  it("captures owned conditions (new/used) and the BL set id", () => {
    const { work } = buildWorkList([e("10698-1", "Classic", ["new", "usedasnew", "new"])]);
    expect(work[0]).toMatchObject({ number: "10698-1", setId: "10698-1" });
    expect(work[0].ownedConditions.sort()).toEqual(["new", "used"]);
  });

  it("ignores blank set numbers", () => {
    expect(buildWorkList([{ setNumber: "", theme: "X" }, { theme: "Y" }]).work).toHaveLength(0);
  });
});
