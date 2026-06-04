import { describe, it, expect, beforeEach } from "vitest";
import {
  aggregateFromEntries,
  normalizeBrickEconomyCollection,
  buildCopyEntries,
  promoteIntoBlob,
  promoteToCollection,
} from "./beCollection";
import { setValueProvenance, setCost } from "./portfolio";
import { setConditionDisplay } from "./condition";

// ─────────────────────────────────────────────────────────────────────────────
// beCollection — the shared roll-up + the purchase-promotion path.
// Pins the promotion-value-laundering fix: value is LAZY (null, never cost/MSRP),
// copies append on a blob match (A1), a legacy-manual match is skipped-and-surfaced
// (B1 / refinement #3), and the join is CMF base-number aware.
// ─────────────────────────────────────────────────────────────────────────────

describe("aggregateFromEntries", () => {
  it("sums paid/value/retail across copies and derives the averages", () => {
    const row = aggregateFromEntries(
      { setNumber: "75192", name: "Falcon", theme: "Star Wars", subtheme: "", year: 2017, pieces: 7541, retired: true },
      [
        { paid_price: 600, current_value: 800, retail_price: 850 },
        { paid_price: 700, current_value: 900, retail_price: 850 },
      ],
    );
    expect(row).toMatchObject({
      setNumber: "75192", quantity: 2, totalPaid: 1300, totalValue: 1700, totalRetailPrice: 1700,
      averagePaid: 650, retailPrice: 850,
    });
    expect(row.unrealizedGain).toBe(400);
    expect(row.roiPct).toBeCloseTo((400 / 1300) * 100, 5);
    expect(row.entries).toHaveLength(2);
  });

  it("an all-unknown-value group totals 0 value (unknown copies never inflate the total)", () => {
    const row = aggregateFromEntries(
      { setNumber: "10300" },
      [{ paid_price: 100, current_value: null }, { paid_price: 120, current_value: null }],
    );
    expect(row.totalValue).toBe(0);   // → valueAmount(0) === null downstream
    expect(row.totalPaid).toBe(220);  // cost is real
  });

  it("roiPct is null when nothing was paid (no ÷0)", () => {
    expect(aggregateFromEntries({ setNumber: "x" }, [{ paid_price: 0, current_value: 0 }]).roiPct).toBeNull();
  });
});

describe("normalizeBrickEconomyCollection (Phase-0 behavior preserved)", () => {
  it("groups per-copy rows by set number into normalized blob rows", () => {
    const out = normalizeBrickEconomyCollection([
      { set_number: "71052-1", name: "CMF A", theme: "Collectible", paid_price: 5, current_value: 12 },
      { set_number: "71052-1", name: "CMF A", theme: "Collectible", paid_price: 5, current_value: 12 },
      { set_number: "75192",   name: "Falcon", theme: "Star Wars",  paid_price: 600, current_value: 800 },
    ]);
    expect(out).toHaveLength(2);
    const cmf = out.find((r) => r.setNumber === "71052-1");
    expect(cmf).toMatchObject({ quantity: 2, totalPaid: 10, totalValue: 24 });
    expect(cmf.entries).toHaveLength(2);
  });
});

describe("buildCopyEntries — refinements", () => {
  it("emits qty copies; value lazy-null, origin tagged, condition param-driven (default new)", () => {
    const entries = buildCopyEntries({ setNumber: "75192", name: "Falcon", theme: "SW", paidPerUnit: 650, retail: 850, qty: 3, date: "2026-06-03" });
    expect(entries).toHaveLength(3);
    for (const e of entries) {
      expect(e).toMatchObject({
        set_number: "75192", condition: "new", paid_price: 650,
        current_value: null,        // LAZY — never paid/MSRP
        retail_price: 850, origin: "purchase", acquired_date: "2026-06-03",
      });
    }
  });

  it("condition is threaded, not hardcoded", () => {
    expect(buildCopyEntries({ setNumber: "x", condition: "used", qty: 1 })[0].condition).toBe("used");
    expect(buildCopyEntries({ setNumber: "x", qty: 1 })[0].condition).toBe("new"); // default
  });

  it("retail_price is `retail ?? null` — unknown MSRP stays null, never a fake 0", () => {
    expect(buildCopyEntries({ setNumber: "x", paidPerUnit: 10 })[0].retail_price).toBeNull();   // omitted
    expect(buildCopyEntries({ setNumber: "x", retail: null })[0].retail_price).toBeNull();      // explicit null
    expect(buildCopyEntries({ setNumber: "x", retail: 59.99 })[0].retail_price).toBe(59.99);
  });

  it("clamps qty to a positive integer", () => {
    expect(buildCopyEntries({ setNumber: "x", qty: 0 })).toHaveLength(1);
    expect(buildCopyEntries({ setNumber: "x", qty: 2.7 })).toHaveLength(2);
  });
});

describe("promoteIntoBlob — A1 append / B1 skip-and-surface / CMF join", () => {
  it("creates a fresh blob row when the set is new", () => {
    const items = buildCopyEntries({ setNumber: "10497", name: "Galaxy Explorer", paidPerUnit: 99, qty: 1 });
    const { blob, warnings } = promoteIntoBlob([], [], items);
    expect(warnings).toEqual([]);
    expect(blob).toHaveLength(1);
    expect(blob[0]).toMatchObject({ setNumber: "10497", quantity: 1, totalPaid: 99, totalValue: 0 });
    expect(blob[0].entries[0].origin).toBe("purchase");
  });

  it("A1: appends real copies to an existing blob row and re-aggregates (CMF base join)", () => {
    const blob = [aggregateFromEntries(
      { setNumber: "71052", name: "CMF", theme: "Collectible", retired: false },
      [{ paid_price: 5, current_value: 12 }],
    )];
    // Promote a variant number — must join the base "71052".
    const items = buildCopyEntries({ setNumber: "71052-5", paidPerUnit: 6, qty: 2 });
    const { blob: next, warnings } = promoteIntoBlob(blob, [], items);
    expect(warnings).toEqual([]);
    expect(next).toHaveLength(1);                 // no new row — appended
    expect(next[0].quantity).toBe(3);             // 1 + 2
    expect(next[0].totalPaid).toBe(5 + 6 + 6);    // cost grows immediately
    expect(next[0].entries).toHaveLength(3);
  });

  it("A1 preserves the row's BE-synced totalValue (adds only the new copies' null→0 value)", () => {
    // A synced row: applyCache wrote totalValue onto the ROW, leaving entries[].current_value at
    // its import-time figure (700). Appending must NOT revert the set's value to that stale sum.
    const row = aggregateFromEntries(
      { setNumber: "75192", name: "Falcon", retired: true },
      [{ paid_price: 600, current_value: 700 }],
    );
    row.totalValue = 950;            // a later value-sync bumped the row's value
    row.currentValue = 950;
    const { blob } = promoteIntoBlob([row], [], buildCopyEntries({ setNumber: "75192", paidPerUnit: 650, qty: 1 }));
    expect(blob[0].totalValue).toBe(950);             // PRESERVED — not reverted to 700
    expect(blob[0].quantity).toBe(2);
    expect(blob[0].totalPaid).toBe(600 + 650);        // cost grown from entries[]
    expect(blob[0].averagePaid).toBe((600 + 650) / 2);
    expect(blob[0].unrealizedGain).toBe(950 - 1250);  // value preserved, cost grown
  });

  it("B1/#3: a legacy-manual-only match is SKIPPED with a warning — no row, blOwnedSets untouched", () => {
    const manual = [{ setNumber: "10497-1", name: "Galaxy Explorer", qty: 1, source: undefined }];
    const items = buildCopyEntries({ setNumber: "10497", paidPerUnit: 99, qty: 1 });
    const { blob, warnings } = promoteIntoBlob([], manual, items);
    expect(blob).toEqual([]);                      // created nothing
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/manually-added entry — skipped/);
  });

  it("does not mutate the input blob array", () => {
    const blob = [];
    promoteIntoBlob(blob, [], buildCopyEntries({ setNumber: "x", qty: 1 }));
    expect(blob).toHaveLength(0);
  });
});

describe("round-trip pin — promote → serialize → MC-load mapping → value unknown, not cost", () => {
  // Minimal replica of the MyCollection blob→set mapping (MyCollection.jsx:187) for the
  // fields the value/cost layer reads. The point: after a full persist/reload cycle a
  // promoted set's VALUE is unknown (null), while its COST is the real money paid.
  const mapBlobRowToSet = (row) => ({
    setNumber:    row.setNumber,
    qty:          row.quantity,
    paidPrice:    row.averagePaid,
    totalPaid:    row.totalPaid,
    currentValue: row.totalValue,
    totalValue:   row.totalValue,
    retired:      row.retired,
    condition:    setConditionDisplay(row),
    entries:      row.entries,
    source:       "BrickEconomy",
  });

  it("pins entries[]/qty/origin and value-unknown-not-cost across a JSON round-trip", () => {
    const items = buildCopyEntries({ setNumber: "75192", name: "Falcon", paidPerUnit: 650, retail: 850, qty: 2 });
    const { blob } = promoteIntoBlob([], [], items);

    // Serialize + re-parse — the persist/reload boundary.
    const reloaded = JSON.parse(JSON.stringify(blob));
    const row = reloaded[0];

    expect(row.entries).toHaveLength(2);
    expect(row.quantity).toBe(2);
    expect(row.entries.every((e) => e.origin === "purchase")).toBe(true);

    const set = mapBlobRowToSet(row);
    expect(setValueProvenance(set).amount).toBeNull();   // VALUE unknown — never seeded from cost/MSRP
    expect(setCost(set)).toBe(1300);                     // COST is the real money paid (2 × 650)
  });

  it("lazy guard: with no valueMap, setValueProvenance amount is null (not the paid figure)", () => {
    const { blob } = promoteIntoBlob([], [], buildCopyEntries({ setNumber: "10497", paidPerUnit: 99, qty: 1 }));
    const set = mapBlobRowToSet(blob[0]);
    expect(setValueProvenance(set, undefined).amount).toBeNull();
    expect(setCost(set)).toBe(99);
  });
});

describe("promoteToCollection — the single localStorage writer", () => {
  beforeEach(() => localStorage.clear());

  it("writes the blob via setItemSafe and never touches blOwnedSets", () => {
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "0000", name: "manual" }]));
    const { warnings } = promoteToCollection(buildCopyEntries({ setNumber: "75192", name: "Falcon", paidPerUnit: 650, qty: 1 }));
    expect(warnings).toEqual([]);

    const blob = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection"));
    expect(blob).toHaveLength(1);
    expect(blob[0].setNumber).toBe("75192");

    // blOwnedSets untouched by the promotion writer.
    expect(JSON.parse(localStorage.getItem("blOwnedSets"))).toEqual([{ setNumber: "0000", name: "manual" }]);
  });

  it("surfaces the skip warning when the set is owned only as a manual entry", () => {
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497-1", name: "Galaxy Explorer" }]));
    const { warnings } = promoteToCollection(buildCopyEntries({ setNumber: "10497", paidPerUnit: 99, qty: 1 }));
    expect(warnings).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection"))).toEqual([]);
  });
});
