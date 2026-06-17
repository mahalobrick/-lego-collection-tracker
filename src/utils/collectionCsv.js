// The collection CSV export's column model + builder. The 7 original set fields stay byte-identical
// to the pre-MSRP export; 6 retail-provenance columns are appended, sourced from the SHARED retail
// ladder (setRetailProvenance via makeRetailResolver) + the shared retailSegment classifier — so a
// row's MSRP and segment match the Overview MSRP card EXACTLY (parity by construction).
import { retailSegment } from "./portfolio";

export const COLLECTION_CSV_HEADERS = [
  "setNumber", "name", "theme", "qty", "paidPrice", "currentValue", "notes",
  "msrp", "msrpSegment", "msrpSource", "msrpConfidence", "msrpCuratedSource", "msrpAsOf",
];

// CSV field escaping — wrap every cell in quotes, doubling any embedded quote. Matches the other
// BrickLedger CSV exporters byte-for-byte.
const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;

/**
 * One CSV row (13 cells in {@link COLLECTION_CSV_HEADERS} order) for a collection set. The first 7
 * cells read the raw stored row UNCHANGED (byte-identical to the pre-MSRP export); the last 6 read
 * the resolved retail {@link import("./value").Value}. `resolve` is the shared resolver
 * ({@link import("./retailResolver").makeRetailResolver}); `project` shapes the row into what the
 * resolver reads — pass `ownedSetFromBlob` so a row matches the card's per-set Value. (The resolver
 * reads only setNumber/msrp, both preserved by the projection, so the 6 retail cells are
 * card-identical regardless of projection; projecting just locks it.) The FULL unstripped setNumber
 * is preserved — curated/Brickset rungs key on "30303-1"; a stripped "30303" would miss them.
 *
 * @param {Object} row                            a collectionSetsForExport row (raw blob / manual).
 * @param {(set:Object)=>(Object|null)} resolve   the shared retail resolver.
 * @param {(row:Object)=>Object} [project]        row → the shape the resolver reads (default identity).
 * @returns {Array<string|number>} 13 cells.
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
  ];
}

/**
 * Build the full collection CSV string (header + one row per set). Pure — the resolver and projector
 * are injected so the export and its tests share the exact path.
 *
 * @param {Array<Object>} sets
 * @param {(set:Object)=>(Object|null)} resolve  the shared retail resolver.
 * @param {(row:Object)=>Object} [project]       row → the shape the resolver reads.
 * @returns {string}
 */
export function buildCollectionCsv(sets, resolve, project) {
  return [
    COLLECTION_CSV_HEADERS.join(","),
    ...sets.map((s) => collectionCsvCells(s, resolve, project).map(esc).join(",")),
  ].join("\n");
}
