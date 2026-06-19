// The collection CSV export's column model + builder. The 7 original set fields stay byte-identical
// to the pre-MSRP export; 6 retail-provenance columns are appended, sourced from the SHARED retail
// ladder (setRetailProvenance via makeRetailResolver) + the shared retailSegment classifier — so a
// row's MSRP and segment match the Overview MSRP card EXACTLY (parity by construction). A 14th
// `condition` column carries New/Used faithfully: a MIXED set (entries[] spanning both) exports as
// one row per condition (see conditionRowsForSet) so re-import preserves the per-condition split.
import { retailSegment } from "./portfolio";
import { aggregateFromEntries } from "./beCollection";
import { conditionBucket, setConditionDisplay } from "./condition";

export const COLLECTION_CSV_HEADERS = [
  "setNumber", "name", "theme", "qty", "paidPrice", "currentValue", "notes",
  "msrp", "msrpSegment", "msrpSource", "msrpConfidence", "msrpCuratedSource", "msrpAsOf",
  "condition",
];

// CSV field escaping — wrap every cell in quotes, doubling any embedded quote. Matches the other
// BrickLedger CSV exporters byte-for-byte.
const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;

/**
 * One CSV row (14 cells in {@link COLLECTION_CSV_HEADERS} order) for a collection set. The first 7
 * cells read the raw stored row UNCHANGED (byte-identical to the pre-MSRP export); the next 6 read
 * the resolved retail {@link import("./value").Value}; the 14th is the row's condition. `resolve` is
 * the shared resolver ({@link import("./retailResolver").makeRetailResolver}); `project` shapes the
 * row into what the resolver reads — pass `ownedSetFromBlob` so a row matches the card's per-set
 * Value. (The resolver reads only setNumber/msrp, both preserved by the projection, so the 6 retail
 * cells are card-identical regardless of projection; projecting just locks it.) The FULL unstripped
 * setNumber is preserved — curated/Brickset rungs key on "30303-1"; a stripped "30303" would miss
 * them. `condition` reads the row's explicit bucket (set by {@link conditionRowsForSet}); a direct
 * call on a raw set falls back to {@link setConditionDisplay}.
 *
 * @param {Object} row                            a per-condition row (or a raw collectionSetsForExport row).
 * @param {(set:Object)=>(Object|null)} resolve   the shared retail resolver.
 * @param {(row:Object)=>Object} [project]        row → the shape the resolver reads (default identity).
 * @returns {Array<string|number>} 14 cells.
 */
export function collectionCsvCells(row, resolve, project = (r) => r) {
  const r = resolve(project(row));
  return [
    row.setNumber || "",
    row.name || "",
    row.theme || "",
    row.quantity || row.qty || 1,
    row.averagePaid ?? row.paidPrice ?? "",
    row.totalValue ?? row.currentValue ?? "",
    row.notes || "",
    r?.amount ?? "",          // msrp — per-unit; null → "" (the file's empty convention)
    retailSegment(r),         // msrpSegment — the card's exact segment token
    r?.source ?? "",          // msrpSource — winning rung (brickset/manual/curated_*/cmf)
    r?.curatedConfidence ?? "", // blank when the winning rung isn't curated
    r?.curatedSource ?? "",   // curated source string (the "converted (UK→USD)" tag rides inline here)
    r?.asOf ?? "",            // brickset fetch stamp / resolve-time for other sourced rungs / blank
    row.condition ?? setConditionDisplay(row), // 'new'/'used' on per-condition rows; derived for direct calls
  ];
}

/**
 * Split a collection set into per-condition export ROWS so a MIXED set (entries[] spanning new and
 * used copies) is representable per-condition. A set whose entries[] fall in a single bucket — or a
 * manual set with no entries[] — yields ONE row (its bucket); a genuinely mixed set yields TWO, one
 * per bucket, each carrying that bucket's copy count (quantity), per-copy average paid (averagePaid)
 * and summed value (totalValue) via the SHARED {@link aggregateFromEntries}. Buckets via the
 * canonical {@link conditionBucket} — no re-derivation. Per-condition sums reconstruct the set
 * totals (qtyNew+qtyUsed = qty; valueNew+valueUsed = totalValue; paid is never double-counted).
 *
 * @param {Object} set a collectionSetsForExport row (raw blob with entries[], or manual).
 * @returns {Array<Object>} 1–2 rows, each with {condition, quantity, averagePaid, totalValue} set.
 */
export function conditionRowsForSet(set) {
  const entries = Array.isArray(set.entries) ? set.entries : [];
  if (!entries.length) {
    // Manual / single-condition set: one row, condition from the stored value (never 'mixed').
    return [{ ...set, condition: setConditionDisplay(set) }];
  }
  const byBucket = { new: [], used: [] };
  for (const e of entries) byBucket[conditionBucket(e?.condition)].push(e);
  return ["new", "used"]
    .filter((b) => byBucket[b].length)
    .map((b) => ({ ...aggregateFromEntries(set, byBucket[b]), condition: b }));
}

/**
 * Build the full collection CSV string (header + one row per set, expanded per condition — a mixed
 * set emits two). Pure — the resolver and projector are injected so the export and its tests share
 * the exact path.
 *
 * @param {Array<Object>} sets
 * @param {(set:Object)=>(Object|null)} resolve  the shared retail resolver.
 * @param {(row:Object)=>Object} [project]       row → the shape the resolver reads.
 * @returns {string}
 */
export function buildCollectionCsv(sets, resolve, project) {
  return [
    COLLECTION_CSV_HEADERS.join(","),
    ...sets.flatMap((s) => conditionRowsForSet(s).map((row) => collectionCsvCells(row, resolve, project).map(esc).join(","))),
  ].join("\n");
}
