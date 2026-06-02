import { describe, it, expect } from "vitest";
import { collectionFromBlob, buildWorkList, isCmfOrPromo, blSetId, condOf } from "./setList.mjs";

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

describe("isCmfOrPromo — the Phase-2 skip predicate", () => {
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

describe("buildWorkList — dedupe, skip, conditions", () => {
  it("skips CMF/promo and counts them; keeps real sets", () => {
    const entries = [
      e("75298-1", "Star Wars", ["new"]),
      e("71045-12", "Minifigure Series", ["usedasnew"]),   // CMF → skipped
      e("6490363-1", "Seasonal", ["new"]),                  // promo ID → skipped
      e("30303-1", "DC Comics Super Heroes", ["new"]),
    ];
    const { work, cmfSkipped, uniqueCount } = buildWorkList(entries);
    expect(uniqueCount).toBe(4);
    expect(cmfSkipped).toBe(2);
    expect(work.map((w) => w.number)).toEqual(["75298-1", "30303-1"]);
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
