// ─────────────────────────────────────────────────────────────────────────────
// BrickEconomy collection shape — the canonical per-set roll-up used by BOTH the
// BrickEconomy CSV importer (AppSettings) and the purchase-promotion path
// (Budget / Wanted → My Collection). Keeping one aggregation here means a promoted
// purchase produces a byte-identical normalized row to an imported one — no second,
// drifting writer of the blob (brickEconomyNormalizedCollection).
//
// Phase 1 adds the promotion helpers (buildCopyEntries / promoteIntoBlob /
// promoteToCollection) on top of the Phase-0 aggregation. They are NOT wired to any
// call site yet — Phase 2 is the write boundary.
// ─────────────────────────────────────────────────────────────────────────────

import { setItemSafe } from "./safeStorage";
import { setConditionDisplay } from "./condition";
import { toISODate } from "./formatting";

/**
 * Per-set aggregation over a group of per-copy entries — the roll-up shared by the
 * importer and the promotion path. Pure. Sums paid / value / retail across copies;
 * a 0 / absent figure contributes 0, so an unknown-valued copy never inflates the
 * total (it just doesn't add to it). Base fields (setNumber/name/theme/…) come from
 * the caller (the importer takes them from the group's first copy).
 *
 * @param {Object} base    { setNumber, name, theme, subtheme, year, pieces, retired }.
 * @param {Array}  entries per-copy items; paid_price / current_value / retail_price read
 *                         in snake- or Title-case (same readers as the CSV importer).
 * @returns {Object} normalized blob row: { ...base, quantity, totalPaid, totalValue,
 *                   totalRetailPrice, averagePaid, retailPrice, unrealizedGain, roiPct, entries }.
 */
export function aggregateFromEntries(base, entries) {
  let quantity = 0, totalPaid = 0, totalValue = 0, totalRetailPrice = 0;
  for (const item of entries) {
    quantity         += 1;
    totalPaid        += Number(item.paid_price    ?? item.Paid   ?? item.paid   ?? 0) || 0;
    totalValue       += Number(item.current_value ?? item.Value  ?? item.value  ?? 0) || 0;
    totalRetailPrice += Number(item.retail_price  ?? item.Retail ?? 0) || 0;
  }
  return {
    ...base,
    quantity,
    totalPaid,
    totalValue,
    totalRetailPrice,
    averagePaid:    quantity ? totalPaid / quantity : 0,
    retailPrice:    quantity ? totalRetailPrice / quantity : 0,
    unrealizedGain: totalValue - totalPaid,
    roiPct:         totalPaid ? ((totalValue - totalPaid) / totalPaid) * 100 : null,
    entries,
  };
}

/**
 * Group a flat list of per-copy items by set number into normalized blob rows.
 * Behavior-identical to the former inline AppSettings function: base attributes are
 * taken from each group's FIRST copy, sums via {@link aggregateFromEntries}.
 *
 * @param {Array} collection per-copy items (BrickEconomy CSV rows).
 * @returns {Array<Object>} normalized rows for brickEconomyNormalizedCollection.
 */
export function normalizeBrickEconomyCollection(collection) {
  const bySet = {};
  for (const item of collection) {
    const setNumber = item.set_number || item.Number || item.number;
    if (!setNumber) continue;
    if (!bySet[setNumber]) {
      bySet[setNumber] = {
        base: {
          setNumber,
          name:     item.name     || item.Name     || "",
          theme:    item.theme    || item.Theme    || "",
          subtheme: item.subtheme || item.Subtheme || "",
          year:     Number(item.year || item.Year || 0) || 0,
          pieces:   Number(item.pieces_count || item.Pieces || 0) || 0,
          retired:  !!item.retired,
        },
        entries: [],
      };
    }
    bySet[setNumber].entries.push(item);
  }
  return Object.values(bySet).map(({ base, entries }) => aggregateFromEntries(base, entries));
}

/**
 * Load-time projection of ONE stored normalized blob row (a {@link aggregateFromEntries} row read
 * back from `brickEconomyNormalizedCollection`) into the MyCollection component "set" shape — the
 * object every consumer reads (the table rows, the rollups, `retailFor`/`isPromoNoRetail`, the detail
 * panel). Pure; extracted verbatim from the MyCollection `sets` initializer so the projection is
 * single-sourced and testable (a dropped field can no longer hide in a component initializer).
 *
 * @param {Object} item    a stored normalized blob row (has setNumber/name/theme/subtheme/quantity/
 *                         entries/averagePaid/totalPaid/totalValue/retailPrice/totalRetailPrice/…).
 * @param {Object} [bsCache] the Brickset cache (`bricksetSetCache`) for minifig/piece/date fallbacks;
 *                         entries never store those, so they fall back to the canonical Brickset row.
 * @returns {Object} the component set object.
 */
export function ownedSetFromBlob(item, bsCache = {}) {
  const entries = item.entries || [];
  // One bucketed derivation (Phase 1): per-copy entries collapse to New / Used / Mixed.
  const condition = setConditionDisplay(item);
  // Pull per-entry fields — same across copies for set attributes; pick latest acquired.
  // Normalize to ISO FIRST so the lexical .sort() orders chronologically (raw "M/D/YYYY"
  // sorts wrong, e.g. "10/1/2023" < "9/1/2020"); the derived holding date is then ISO too.
  const acquiredDates = entries.map(e => toISODate(e.acquired_date || e.aquired_date)).filter(Boolean).sort();

  // minifigs / pieces: entries never store these; fall back to the Brickset cache (canonical,
  // backfilled for every owned set by runBricksetEnrichment on mount).
  const clean   = String(item.setNumber || "").replace(/-1$/, "");
  const bsData  = bsCache[`brickset_${clean}`]?.data || bsCache[clean]?.data || {};
  const minifigs = entries[0]?.minifigs_count ?? bsData.minifigs ?? null;
  const pieces   = entries[0]?.pieces_count   ?? bsData.pieces   ?? null;

  return {
    setNumber:    item.setNumber,
    name:         item.name,
    theme:        item.theme,
    // subtheme must reach the set object: isPromoNoRetail reads theme/subtheme/name, and many GWPs
    // file under a parent theme with subtheme:"Promotional" — dropping it here under-caught them as
    // promo (they leaked into "not listed"). The stored blob always carries it (aggregateFromEntries).
    subtheme:     item.subtheme,
    qty:          item.quantity,
    paidPrice:    item.averagePaid,
    currentValue: item.totalValue,
    totalPaid:    item.totalPaid,
    totalValue:   item.totalValue,
    // Carry retail through so setPaidProvenance can test paid-vs-retail (msrp classification)
    // and the Retail Value card reads a real figure rather than undefined. (Provenance Step 2)
    retailPrice:      item.retailPrice,
    totalRetailPrice: item.totalRetailPrice,
    // Hand-entered MSRP override (Phase 3a.1) — an app-level field persisted onto the BE blob
    // via persistBESetEdit; read back here so the manual retail rung survives reload.
    msrp:             item.msrp ?? null,
    // Explicit Edit-drawer MSRP override (beats Brickset) — app-level, persisted via persistBESetEdit;
    // read back so the override rung survives reload (mirrors `msrp` above).
    msrpOverride:     item.msrpOverride ?? null,
    roiPct:       item.roiPct,
    retired:      item.retired,
    condition,
    entries,
    source:       "BrickEconomy",
    minifigs,
    pieces,
    acquiredDate: acquiredDates[acquiredDates.length - 1] || null, // most recent
    // Retirement / release dates from the Brickset cache (exit_date / launch_date) — same
    // source the add-form and detail panel use — since BE-CSV entries don't carry these.
    // entries[0] kept as a fallback. Active sets have null/future exit_date → empty is correct.
    retiredDate:  bsData.exit_date   ?? entries[0]?.retired_date  ?? null,
    releasedDate: bsData.launch_date ?? entries[0]?.released_date ?? null,
    notes:        entries.map(e => e.notes).filter(Boolean)[0] || "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Purchase promotion (Budget / Wanted → My Collection). The fix for the
// promotion-value-laundering finding: a promoted purchase writes the SAME rich
// per-copy blob shape an import would, with value LEFT UNKNOWN (lazy) rather than
// seeded from cost/MSRP. One blob writer; blOwnedSets is never touched here.
// ─────────────────────────────────────────────────────────────────────────────

/** Base (variant-stripped) set number for the CMF-aware join: "71052-5" → "71052". */
const baseNum = (n) => String(n ?? "").replace(/-\d+$/, "").trim().toLowerCase();

/**
 * Build `qty` per-copy entries for a promoted purchase — the shape `aggregateFromEntries`
 * and the My Collection loader consume (snake_case, like the CSV importer's rows).
 *
 * Refinements baked in:
 *   - `condition` is PARAM-DRIVEN (default "new") — never a literal inside, so the caller
 *     threads the purchase's real condition (Budget: conditionBucket(purchase.condition);
 *     Wanted: buyModal.condition ?? "new").
 *   - `current_value: null` — LAZY: value is left unknown, never seeded from paid or MSRP.
 *     The BL value overlay + the BE value-sync fill it at read time; `valueAmount` renders
 *     the null as "—" until then (unknown ≠ $0, and ≠ cost).
 *   - `retail_price: retail ?? null` — an unknown MSRP stays null, never a fake $0.
 *   - `origin: "purchase"` — provenance marker (does NOT affect the value basis), so a
 *     promoted copy is distinguishable from an imported one.
 *
 * @param {Object} p
 * @param {string} p.setNumber
 * @param {string} [p.name]
 * @param {string} [p.theme]
 * @param {string} [p.condition="new"]   bucketed condition for every copy.
 * @param {number} [p.paidPerUnit]       per-copy cost basis (real money).
 * @param {number|null} [p.retail]       per-copy MSRP, or null/undefined when unknown.
 * @param {number} [p.qty=1]             number of copies (≥ 1, integer).
 * @param {string} [p.date]              acquired date (ISO yyyy-mm-dd) or "".
 * @returns {Array<Object>} `qty` identical per-copy items.
 */
export function buildCopyEntries({ setNumber, name, theme, condition = "new", paidPerUnit, retail, qty = 1, date } = {}) {
  const copies = Math.max(1, Math.floor(Number(qty) || 1));
  const one = {
    set_number:    setNumber || "",
    name:          name  || "",
    theme:         theme || "",
    condition,
    paid_price:    Number(paidPerUnit) || 0,
    current_value: null,         // lazy — never paid/MSRP
    retail_price:  retail ?? null,
    acquired_date: date || "",
    origin:        "purchase",
    notes:         "",
  };
  return Array.from({ length: copies }, () => ({ ...one }));
}

/**
 * Fold promoted per-copy items into the BrickEconomy blob, joined on base set number
 * (CMF-aware). Pure — returns the next blob plus any user-facing warnings; it never
 * mutates its inputs and never touches blOwnedSets.
 *
 *   - blob match  → A1: APPEND the copies to that row's entries[] and re-aggregate
 *                   (one more real copy of something you own).
 *   - manual-only → skip-and-surface (B1 / refinement #3): emit a warning, create NO
 *                   row, leave blOwnedSets alone. A legacy flat manual entry and a blob
 *                   row can't be combined without the (deferred) dual-store unification,
 *                   so we decline rather than create a double-counting second row.
 *   - no match    → create a fresh blob row from the group.
 *
 * @param {Array<Object>} blob      current brickEconomyNormalizedCollection rows.
 * @param {Array<Object>} manual    current blOwnedSets rows (read-only — for the dedup check).
 * @param {Array<Object>} copyItems per-copy items from {@link buildCopyEntries} (may span sets).
 * @returns {{ blob: Array<Object>, warnings: string[] }}
 */
export function promoteIntoBlob(blob, manual, copyItems) {
  const nextBlob   = Array.isArray(blob) ? blob.slice() : [];
  const manualList = Array.isArray(manual) ? manual : [];
  const warnings   = [];

  // Group incoming copies by base number, preserving encounter order.
  const groups = new Map();
  for (const it of copyItems || []) {
    const key = baseNum(it.set_number);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  for (const [key, items] of groups) {
    const blobIdx = nextBlob.findIndex((s) => baseNum(s.setNumber) === key);
    if (blobIdx >= 0) {
      const row = nextBlob[blobIdx];
      const base = {
        setNumber: row.setNumber,
        name:      row.name ?? items[0].name ?? "",
        theme:     row.theme ?? items[0].theme ?? "",
        subtheme:  row.subtheme ?? "",
        year:      row.year ?? 0,
        pieces:    row.pieces ?? 0,
        retired:   !!row.retired,
      };
      // Re-aggregate COST (totalPaid/quantity/averagePaid) and retail from the full entry list,
      // but PRESERVE the row's existing totalValue and add only the new copies' value (null→0).
      // Why not re-derive value from entries[]: totalValue is maintained by the BE value-sync
      // (applyCache writes the ROW, not entries[].current_value), so the stored entry values are
      // import-time / stale — re-deriving from them would silently REVERT the whole set's synced
      // value. Cost IS entry-sourced, so it grows immediately and correctly.
      const full       = aggregateFromEntries(base, [...(row.entries || []), ...items]);
      const addedValue = items.reduce((s, e) => s + (Number(e.current_value) || 0), 0); // lazy copies → 0
      const totalValue = (Number(row.totalValue) || 0) + addedValue;
      nextBlob[blobIdx] = {
        ...full,
        totalValue,
        unrealizedGain: totalValue - full.totalPaid,
        roiPct:         full.totalPaid ? ((totalValue - full.totalPaid) / full.totalPaid) * 100 : null,
      };
      continue;
    }

    if (manualList.some((m) => baseNum(m.setNumber) === key)) {
      warnings.push(`${items[0].set_number || key} is already in your collection as a manually-added entry — skipped.`);
      continue;
    }

    const first = items[0];
    nextBlob.push(aggregateFromEntries(
      { setNumber: first.set_number, name: first.name || "", theme: first.theme || "", subtheme: "", year: 0, pieces: 0, retired: false },
      items,
    ));
  }

  return { blob: nextBlob, warnings };
}

/**
 * Promote purchases into My Collection — the single localStorage writer for the
 * promotion path. Reads the blob + blOwnedSets, folds the copies in via
 * {@link promoteIntoBlob}, and persists the blob with `setItemSafe` (quota guard +
 * auto-sync; the key is already in BACKUP_KEYS). blOwnedSets is never written.
 *
 * @param {Array<Object>} copyItems from {@link buildCopyEntries} (may span multiple sets).
 * @returns {{ warnings: string[] }} warnings for the caller to surface (e.g. a toast).
 */
export function promoteToCollection(copyItems) {
  let blob = [], manual = [];
  try { blob   = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]"); } catch { /* unreadable → start empty */ }
  try { manual = JSON.parse(localStorage.getItem("blOwnedSets") || "[]"); } catch { /* unreadable → no dedup */ }
  const { blob: nextBlob, warnings } = promoteIntoBlob(blob, manual, copyItems);
  setItemSafe("brickEconomyNormalizedCollection", JSON.stringify(nextBlob));
  return { warnings };
}
