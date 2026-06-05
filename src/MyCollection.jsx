import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { searchInput, filterSelect, clearFilterButton, filterBar } from "./uiStyles";
import { DEFAULT_OWNED_COLUMNS } from "./utils/columnDefaults";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, AreaChart, Area, CartesianGrid } from "recharts";
import SetDetailPanel, { openSetDetail } from "./SetDetailPanel";
import TriValueCell from "./TriValueCell";
import RowHoverCard from "./RowHoverCard";
import { asNumber, money, setImageUrl, priorityScore, recommendation, daysUntilRetirement, lineCashPaid } from "./utils/formatting";
import { setConditionDisplay, conditionDisplayColor, conditionDisplayLabel } from "./utils/condition";
import { fetchBrickLinkPriceGuide, hasBrickLinkAuth } from "./utils/bricklink-client";
import { searchBricksetCatalog, fetchBricksetSet, fetchLegoThemes, bricksetRetailEntry, cmfSeriesRetailTargets } from "./utils/brickset";
import { loadRebrickable, rbLookupSet, rbReady } from "./utils/rebrickable";
import WatchDetailPanel from "./WatchDetailPanel";
import { beValueForCondition, revalueBESet } from "./utils/beSyncValues";
import { portfolioValue, portfolioRetail, knownValueCount, setValueProvenance, setRetailProvenance, isPromoNoRetail, manualMsrpPatch, setCost, totalSpent, portfolioGain, portfolioValuedCost, portfolioROI, setROI, setGain, groupRollup, estimatedValueShare, buildPurchaseMap, costBasisBreakdown, reconcilePaidEdit, reconcileConditionEdit } from "./utils/portfolio";
import { formatValue, formatAggregateValue, formatValueCell, unknownValueNote, retailPricedNote, estimatedValueNote, estimatedCostNote, totalRoiNote, netGainBasisNote } from "./utils/valueDisplay";
import { fetchValues, peekValueCache } from "./utils/valueCache";
import { apiFetch } from "./utils/apiFetch";
import { setItemSafe } from "./utils/safeStorage";

const PIE_COLORS = ["#c9a84c", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#5aa832"];
const CONDITION_CYCLE = ["new", "used_as_new", "used_good", "used_acceptable"];

const DEFAULT_COLLECTION_ITEMS = [
  { key: "qty",          type: "card",  label: "Total Sets",       visible: true,  width: "auto",  collapsed: false },
  { key: "value",        type: "card",  label: "Collection Value", visible: true,  width: "auto",  collapsed: false },
  { key: "cost",         type: "card",  label: "Cost Basis",       visible: true,  width: "auto",  collapsed: false },
  { key: "gain",         type: "card",  label: "Net Gain / Loss",  visible: true,  width: "auto",  collapsed: false },
  { key: "roi",          type: "card",  label: "ROI",              visible: true,  width: "auto",  collapsed: false },
  { key: "themes",       type: "card",  label: "Themes",           visible: true,  width: "auto",  collapsed: false },
  { key: "duplicates",   type: "card",  label: "Multi-Copy Sets",  visible: true,  width: "auto",  collapsed: false },
  { key: "retired",      type: "card",  label: "Retired Sets",     visible: false, width: "auto",  collapsed: false },
  { key: "newUsed",      type: "card",  label: "New / Used",       visible: false, width: "auto",  collapsed: false },
  { key: "avgValue",     type: "card",  label: "Avg Set Value",    visible: false, width: "auto",  collapsed: false },
  { key: "avgPaid",      type: "card",  label: "Avg Paid / Set",   visible: false, width: "auto",  collapsed: false },
  { key: "pieces",       type: "card",  label: "Total Pieces",     visible: false, width: "auto",  collapsed: false },
  { key: "minifigs",     type: "card",  label: "Minifigs",         visible: false, width: "auto",  collapsed: false },
  { key: "retailValue",  type: "card",  label: "MSRP Value",       visible: false, width: "auto",  collapsed: false },
  { key: "newValue",     type: "card",  label: "New Sets Value",   visible: false, width: "auto",  collapsed: false },
  { key: "usedValue",    type: "card",  label: "Used Sets Value",  visible: false, width: "auto",  collapsed: false },
  { key: "watchList",    type: "card",  label: "Wanted List",      visible: false, width: "auto",  collapsed: false },
  { key: "condition-breakdown", type: "panel", label: "Condition Breakdown", visible: false, width: "half", collapsed: false },
  { key: "theme-chart",   type: "panel", label: "Value by Theme",     visible: true,  width: "half",  collapsed: false },
  { key: "roi-leaders",   type: "panel", label: "ROI Leaders",        visible: true,  width: "half",  collapsed: false },
  { key: "most-valuable", type: "panel", label: "Most Valuable Sets", visible: true,  width: "half",  collapsed: false },
  { key: "watch-list",    type: "panel", label: "Wanted List",        visible: true,  width: "half",  collapsed: false },
  { key: "budget",           type: "panel", label: "Budget Snapshot",    visible: true,  width: "full",  collapsed: false },
  { key: "portfolio-history", type: "panel", label: "Portfolio History",  visible: true,  width: "full",  collapsed: false },
  { key: "theme-performance", type: "panel", label: "Theme Performance",  visible: true,  width: "full",  collapsed: false },
];

// DEFAULT_OWNED_COLUMNS imported from ./utils/columnDefaults

// Default column widths (px). All columns are resizable; widths persist in blOwnedColWidths.
// With Condition + Notes hidden (defaults), visible cols total ~700px — fits a ~720px panel.
const OWNED_COL_WIDTHS = {
  thumb:        52,
  setNumber:    62,
  name:        150,
  theme:        84,
  condition:    84,
  qty:          66,
  value:       132,  // three-up: Retail / Paid / Market labels + figures (MSRP Step 2)
  gain:         82,
  roi:          62,
  minifigs:     68,
  acquiredDate: 90,
  retiredDate:  90,
  releasedDate: 90,
  notes:        80,
};

function fmtShortDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function MyCollection({ onBuyNow, onSwitchTab }) {
  const [tab, setTab] = useState("overview");
  const [searchText, setSearchText] = useState("");
  const [filterTheme, setFilterTheme] = useState("");
  const [filterCondition, setFilterCondition] = useState("");
  const [sortColumn, setSortColumn] = useState(() => localStorage.getItem("blOwnedSort") || "setNumber");
  const [sortDirection, setSortDirection] = useState(() => localStorage.getItem("blOwnedSortDir") || "asc");
  // Row density (blOwnedRowDensity): "compact" = Market-only row + Retail/Paid in the hover card;
  // "full" = the TriValueCell three-up stack in the row. Default compact.
  const [rowDensity, setRowDensity] = useState(() => localStorage.getItem("blOwnedRowDensity") || "compact");
  const [checkedSets, setCheckedSets] = useState([]);

  const [selectedSetIndex, setSelectedSetIndex] = useState(null);
  const [detailSet, setDetailSet] = useState(null);
  const [detailSetIndex, setDetailSetIndex] = useState(null);
  const [showAllThemes, setShowAllThemes] = useState(false);
  const [showAllRoi, setShowAllRoi] = useState(false);
  const [showAllValuable, setShowAllValuable] = useState(false);
  const [showAllWatchHighlights, setShowAllWatchHighlights] = useState(false);
  const [detailWatchItem, setDetailWatchItem] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hoveredSet, setHoveredSet] = useState(null);
  const [hoveredWatchItem, setHoveredWatchItem] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null); // { index, key, value }
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const [chartTypes, setChartTypes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blCollChartTypes") || "{}"); } catch { return {}; }
  });
  const [collPillsCollapsed, setCollPillsCollapsed] = useState(false);
  const [collGearOpen, setCollGearOpen] = useState(false);
  const [hoveredCollItem, setHoveredCollItem] = useState(null);
  const [draggedCollItem, setDraggedCollItem] = useState(null);
  const [metaRefreshing, setMetaRefreshing] = useState(false);
  const [collectionItems, setCollectionItems] = useState(() => {
    const saved = localStorage.getItem("blCollectionItems");
    if (!saved) return DEFAULT_COLLECTION_ITEMS;
    const parsed = JSON.parse(saved);
    // Migration: remove retired keys, carry forward their visibility into replacement
    const legacyVisible = new Set(parsed.filter(c => c.visible).map(c => c.key));
    const REMOVED_KEYS = new Set(["newSets", "usedSets", "retiringSoon"]);
    const knownKeys = new Set(DEFAULT_COLLECTION_ITEMS.map(c => c.key));
    const filtered = parsed.filter(c => !REMOVED_KEYS.has(c.key) && knownKeys.has(c.key));
    const typeMap = Object.fromEntries(DEFAULT_COLLECTION_ITEMS.map(c => [c.key, c.type]));
    const labelMap = Object.fromEntries(DEFAULT_COLLECTION_ITEMS.map(c => [c.key, c.label]));
    const merged = filtered.map(c => ({ ...c, type: typeMap[c.key] ?? c.type, label: labelMap[c.key] ?? c.label }));
    const savedKeys = new Set(merged.map(c => c.key));
    const missing = DEFAULT_COLLECTION_ITEMS.filter(c => !savedKeys.has(c.key)).map(c => ({
      ...c,
      // newUsed inherits visibility if either old card was visible
      visible: c.key === "newUsed" ? (legacyVisible.has("newSets") || legacyVisible.has("usedSets") || c.visible) : c.visible,
    }));
    return [...merged, ...missing];
  });

  const [ownedColumnsOpen, setOwnedColumnsOpen] = useState(false);
  const [draggedOwnedColumn, setDraggedOwnedColumn] = useState(null);

  const [ownedColumns, setOwnedColumns] = useState(() => {
    const saved = localStorage.getItem("blOwnedColumns");
    if (!saved) return DEFAULT_OWNED_COLUMNS;
    const parsed = JSON.parse(saved);
    const labelMap = Object.fromEntries(DEFAULT_OWNED_COLUMNS.map(c => [c.key, c.label]));
    // Drop keys no longer in defaults (e.g. the removed "paid" column) so a stale saved
    // config can't render a headerless, rendererless ghost column.
    const defaultKeys = new Set(DEFAULT_OWNED_COLUMNS.map(c => c.key));
    const merged = parsed.filter(c => defaultKeys.has(c.key)).map(c => ({ ...c, label: labelMap[c.key] ?? c.label }));
    const savedKeys = new Set(merged.map(c => c.key));
    const missing = DEFAULT_OWNED_COLUMNS.filter(c => !savedKeys.has(c.key));
    return missing.length ? [...merged, ...missing] : merged;
  });

  const [columnWidths, setColumnWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("blOwnedColWidths") || "{}");
      return { ...OWNED_COL_WIDTHS, ...saved };
    } catch { return { ...OWNED_COL_WIDTHS }; }
  });
  const resizingCol = useRef(null); // { key, startX, startWidth }

  const [sets, setSets] = useState(() => {
    // Load BrickEconomy-synced items
    let beItems = [];
    const brickEconomySaved = localStorage.getItem("brickEconomyNormalizedCollection");
    if (brickEconomySaved) {
      try {
        // Cache lookups for minifigs/pieces fallback (entries never store these fields)
        let bsCache = {}, beSetCache = {};
        try { bsCache    = JSON.parse(localStorage.getItem("bricksetSetCache")      || "{}"); } catch {}
        try { beSetCache = JSON.parse(localStorage.getItem("brickEconomySetCache")  || "{}"); } catch {}

        beItems = JSON.parse(brickEconomySaved).map(item => {
          const entries = item.entries || [];
          // One bucketed derivation (Phase 1): per-copy entries collapse to New / Used / Mixed.
          const condition = setConditionDisplay(item);
          // Pull per-entry fields — same across copies for set attributes; pick latest acquired
          const acquiredDates = entries.map(e => e.aquired_date || e.acquired_date).filter(Boolean).sort();

          // minifigs / pieces: entries never store these; fall back to Brickset cache then BE cache
          const clean   = String(item.setNumber || "").replace(/-1$/, "");
          const bsData  = bsCache[`brickset_${clean}`]?.data || bsCache[clean]?.data || {};
          const beData  = beSetCache[clean]?.data || beSetCache[item.setNumber]?.data || {};
          const minifigs = entries[0]?.minifigs_count ?? bsData.minifigs ?? beData.minifigs_count ?? null;
          const pieces   = entries[0]?.pieces_count   ?? bsData.pieces   ?? beData.pieces_count   ?? null;

          return {
            setNumber:    item.setNumber,
            name:         item.name,
            theme:        item.theme,
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
            roiPct:       item.roiPct,
            retired:      item.retired,
            condition,
            entries,
            source:       "BrickEconomy",
            minifigs,
            pieces,
            acquiredDate: acquiredDates[acquiredDates.length - 1] || null, // most recent
            retiredDate:  entries[0]?.retired_date || null,
            releasedDate: entries[0]?.released_date || null,
            notes:        entries.map(e => e.notes).filter(Boolean)[0] || "",
          };
        });
      } catch {}
    }

    // Load manually-added items (excludes any stale BE entries previously saved here)
    let manualItems = [];
    const manualSaved = localStorage.getItem("blOwnedSets");
    if (manualSaved) {
      try {
        manualItems = JSON.parse(manualSaved).filter(m => m.source !== "BrickEconomy");
      } catch {}
    }

    if (beItems.length === 0) return manualItems;

    // Merge: always include all manual items as separate entries.
    // Manual sets can coexist with BE sets of the same number (e.g. user bought another copy).
    return [...beItems, ...manualItems];
  });

  // ── BE sync info (for pieces, minifigs and aggregate stats) ─────────────
  const [beSyncInfo] = useState(() => {
    try { return JSON.parse(localStorage.getItem("brickEconomyCollectionSyncInfo") || "{}"); } catch { return {}; }
  });

  // ── Purchase ledger → paid provenance (Provenance Step 2) ──────────────────
  // Read blPurchases once; buildPurchaseMap indexes by base set-number so a CMF series
  // purchase joins every owned figure. Drives setPaidProvenance (ledger/manual/msrp/none)
  // for the Cost Basis split, real-cost ROI, and the row "MSRP?" markers.
  const [purchases] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blPurchases") || "[]"); } catch { return []; }
  });
  const purchaseMap = useMemo(() => buildPurchaseMap(purchases), [purchases]);

  // ── Retail (MSRP) source cache — read once, same cache SetDetailPanel reads ──
  // Brickset is keyed `brickset_${n}` (canonical). retailFor() builds the per-set sources
  // for setRetailProvenance. (BrickEconomy was removed from the retail ladder in Phase 3c.)
  const [retailCaches, setRetailCaches] = useState(() => {
    let bs = {};
    try { bs = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}"); } catch {}
    return { bs };
  });
  function retailFor(set) {
    const n = set.setNumber;
    // The Brickset rung walks figure→base→series-0→-1 and takes the first with a real retail
    // (CMF series retail lives on the -0 variant; the figure's own entry has none) — see
    // bricksetRetailEntry.
    const bsEntry = bricksetRetailEntry(retailCaches.bs, n) || {};
    return setRetailProvenance(
      {
        brickset: { amount: bsEntry.data?.retail_price_us, asOf: bsEntry.fetchedAt },
        manual:   { amount: set.msrp }, // hand-entered MSRP (Phase 3a rung); 0/absent → skipped
      },
      { condition: set.condition, promo: isPromoNoRetail(set) }
    );
  }

  // ── Sold / realized gains ────────────────────────────────────────────────
  const [soldSets, setSoldSets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blSoldSets") || "[]"); } catch { return []; }
  });
  const [sellModal, setSellModal] = useState(false);
  const [sellPrice, setSellPrice] = useState("");
  const [sellDate,  setSellDate]  = useState(() => new Date().toISOString().slice(0, 10));
  const [sellNotes, setSellNotes] = useState("");
  const [retireDismissed, setRetireDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blOwnedRetireDismissed") || "[]"); } catch { return []; }
  });
  const [histRange, setHistRange] = useState("all");

  const [form, setForm] = useState({
    setNumber: "",
    name: "",
    theme: "",
    condition: "new",
    qty: 1,
    paidPrice: "",
    msrp: "",
    currentValue: "",
    notes: ""
  });
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupMessage, setLookupMessage] = useState("");
  const [addDupeWarning, setAddDupeWarning] = useState(null); // "collection" | "watchlist" | null
  const [setNumSuggestions, setSetNumSuggestions]   = useState([]);
  const [setNumSuggestLoading, setSetNumSuggestLoading] = useState(false);
  const [addCatalogMode, setAddCatalogMode]       = useState(false);

  // ── Extra metadata from Brickset lookup (not shown in form UI, merged on save) ──
  const [lookupData, setLookupData] = useState({});
  // The cleaned set number the current lookup result belongs to — used to drop the
  // stale result when the user edits/erases the number without re-looking-up.
  const [lookedUpNum, setLookedUpNum] = useState("");

  // ── Purchase log modal (shown after Add to Collection when paidPrice > 0) ──
  const [purchaseModal, setPurchaseModal] = useState(null); // null | { setNumber, name, theme, qty, price }
  const [pmForm, setPmForm] = useState({ store: "", date: "", tax: "", shipping: "", gc: "", orderLabel: "" });
  const [savedStores]       = useState(() => { try { return JSON.parse(localStorage.getItem("blStores") || "[]"); } catch { return []; } });
  const [addCatalogQuery, setAddCatalogQuery]     = useState("");
  const [addCatalogResults, setAddCatalogResults] = useState([]);
  const [addCatalogLoading, setAddCatalogLoading] = useState(false);
  const [addCatalogError, setAddCatalogError]     = useState("");

  useEffect(() => {
    // Only persist manually-added items; BE data lives in brickEconomyNormalizedCollection
    const manualItems = sets.filter(s => s.source !== "BrickEconomy");
    setItemSafe("blOwnedSets", JSON.stringify(manualItems));
  }, [sets]);

  // ── BrickLink value cache overlay (app-read Step 2) ─────────────────────────
  // `valueMap` PREFERS BL cache values (condition-matched) over the stored BE provenance, BE as
  // fallback (see setValueProvenance). `undefined` = not yet loaded → value figures render a brief
  // loading state instead of flashing the old BE number then swapping to BL. NON-DESTRUCTIVE:
  // nothing here is written back to stored collection data — it's a read-time overlay only.
  const [valueMap, setValueMap] = useState(undefined);
  const valuesReady = valueMap !== undefined;
  const ownedNumbers = useMemo(
    () => [...new Set(sets.map(s => String(s.setNumber || "")).filter(Boolean))],
    [sets]
  );
  const ownedKey = ownedNumbers.join(",");
  useEffect(() => {
    if (ownedNumbers.length === 0) { setValueMap({}); return; }
    // Warm cache → seed synchronously so the first paint already shows BL (no BE→BL flash).
    const warm = peekValueCache(ownedNumbers);
    if (Object.keys(warm).length) setValueMap(warm);
    let cancelled = false;
    fetchValues(ownedNumbers).then(map => { if (!cancelled) setValueMap(map); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedKey]);

  // One aggregate value→display formatter that holds back a phantom number while the overlay
  // loads (renders "…" until valuesReady), then defers to the standard formatAggregateValue.
  const fmtAgg = (total, knownCount) => valuesReady ? formatAggregateValue(total, knownCount) : "…";

  useEffect(() => {
    setItemSafe("blCollectionItems", JSON.stringify(collectionItems));
  }, [collectionItems]);

  useEffect(() => {
    setItemSafe("blCollChartTypes", JSON.stringify(chartTypes));
  }, [chartTypes]);

  useEffect(() => {
    setItemSafe("blSoldSets", JSON.stringify(soldSets));
  }, [soldSets]);

  useEffect(() => {
    setItemSafe("blOwnedRetireDismissed", JSON.stringify(retireDismissed));
  }, [retireDismissed]);

  useEffect(() => {
    setItemSafe("blOwnedColumns", JSON.stringify(ownedColumns));
  }, [ownedColumns]);

  useEffect(() => {
    setItemSafe("blOwnedColWidths", JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    setItemSafe("blOwnedSort", sortColumn);
    setItemSafe("blOwnedSortDir", sortDirection);
  }, [sortColumn, sortDirection]);

  useEffect(() => {
    setItemSafe("blOwnedRowDensity", rowDensity);
  }, [rowDensity]);

  // ── Rebrickable — load local catalog in background on mount ─────────────
  useEffect(() => { loadRebrickable(); }, []);

  // ── Brickset metadata enrichment — pieces & minifigs via Brickset ────────
  // Source-of-truth for structural set data (Brickset); BE is value-only.
  // forceAll=false skips sets that already have both fields populated in state.
  async function runBricksetEnrichment(currentSets, forceAll = false) {
    if (metaRefreshing) return;
    const toFetch = currentSets.filter(s => {
      if (!s.setNumber) return false;
      if (!forceAll && s.minifigs != null && s.pieces != null) return false;
      return true;
    });
    if (!toFetch.length) {
      if (forceAll) toast.success("Collection metadata is already complete.");
      return;
    }
    setMetaRefreshing(true);
    let updated = 0;
    for (const item of toFetch) {
      const clean = String(item.setNumber).replace(/-1$/, "");
      try {
        const bsData = await fetchBricksetSet(clean);
        if (!bsData) { await new Promise(r => setTimeout(r, 400)); continue; }
        // Persist to Brickset cache so future loads don't need to re-fetch
        const cache = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}");
        cache[`brickset_${clean}`] = { fetchedAt: new Date().toISOString(), data: bsData };
        setItemSafe("bricksetSetCache", JSON.stringify(cache));
        // Patch sets state — minifigs + pieces only (BE owns value fields)
        setSets(prev => prev.map(s => {
          if (String(s.setNumber || "").replace(/-1$/, "") !== clean) return s;
          const upd = {};
          if (bsData.minifigs != null) upd.minifigs = bsData.minifigs;
          if (bsData.pieces   != null) upd.pieces   = bsData.pieces;
          return Object.keys(upd).length ? { ...s, ...upd } : s;
        }));
        updated++;
      } catch {}
      await new Promise(r => setTimeout(r, 400));
    }
    setMetaRefreshing(false);
    if (forceAll) {
      if (updated > 0) toast.success(`Brickset metadata synced for ${updated} set${updated !== 1 ? "s" : ""}.`);
      else toast.error("Could not fetch metadata — check your connection.");
    }
  }

  // Bounded one-pass: fetch each owned CMF series' -0 Brickset entry (71052-0 → $4.99 per-bag =
  // per-figure) so bricksetRetailEntry can resolve CMF retail off the series, not the null per-figure
  // entries. ~one call per series (deduped), skips already-cached -0. Returns how many were fetched.
  async function fetchCmfSeriesRetail(currentSets) {
    let bsCache = {};
    try { bsCache = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}"); } catch {}
    const targets = cmfSeriesRetailTargets(currentSets, bsCache);
    if (!targets.length) return 0;
    let fetched = 0;
    for (const num of targets) {
      // fetchBricksetSet caches under brickset_${num} via setItemSafe (and skips if fresh-cached).
      if (await fetchBricksetSet(num)) fetched++;
      await new Promise(r => setTimeout(r, 400));
    }
    return fetched;
  }

  // Silent enrichment on mount — fills gaps for BE-synced sets missing pieces/minifigs, then fetches
  // the CMF series -0 retail entries (sequential, so the two cache writers don't race). Refresh the
  // Brickset snapshot afterward so newly-cached retail renders without a reload.
  useEffect(() => {
    (async () => {
      await runBricksetEnrichment(sets, false);
      const fetched = await fetchCmfSeriesRetail(sets);
      if (fetched > 0) {
        try {
          const bs = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}");
          setRetailCaches(prev => ({ ...prev, bs }));
        } catch {}
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // ── Portfolio snapshot — record once per day ──────────────────────────────
  useEffect(() => {
    if (sets.length === 0) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const history = JSON.parse(localStorage.getItem("blPortfolioHistory") || "[]");
      if (history.some(h => h.date === today)) return;
      // Null-aware: snapshot the same headline figures (unknown excluded from value).
      // (unknown≠0 sweep)
      const totalValue = portfolioValue(sets);
      const totalPaid  = totalSpent(sets);
      const next = [...history.filter(h => h.date !== today), { date: today, value: totalValue, paid: totalPaid }];
      setItemSafe("blPortfolioHistory", JSON.stringify(next.sort((a, b) => a.date.localeCompare(b.date)).slice(-365)));
    } catch {}
  }, [sets]);

  function cycleChartType(key) {
    setChartTypes(prev => {
      const cur = prev[key] || "donut";
      const next = cur === "donut" ? "pie" : cur === "pie" ? "bar" : "donut";
      return { ...prev, [key]: next };
    });
  }

  // Refresh localStorage-backed memos when returning to overview sub-tab
  useEffect(() => {
    if (tab === "overview") setRefreshKey(k => k + 1);
  }, [tab]);

  // Refresh when another window/tab writes to localStorage (e.g. Budget opened in a second tab)
  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1);
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const stats = useMemo(() => {
    const totalQty = sets.reduce((sum, s) => sum + (asNumber(s.qty) || 1), 0);
    // Prefer pre-computed totals for BE items (totalValue/totalPaid already account for qty).
    // Fall back to per-unit × qty for manually added sets that don't have those fields.
    const costBasis = totalSpent(sets);
    // Cost-basis split by paid provenance (Step 2, revised): headline the TOTAL cost; the split
    // drives the quality disclosure ("N estimated at MSRP"). ROI is over the total cost basis.
    const costSplit = costBasisBreakdown(sets, purchaseMap);
    const value = portfolioValue(sets, valueMap);
    const themes = new Set(sets.map(s => s.theme).filter(Boolean)).size;
    const duplicates = sets.filter(s => (asNumber(s.qty) || 1) > 1).length;
    const retiredSets = sets.filter(s => s.retired).length;
    const newSets     = sets.filter(s => !s.condition || s.condition === "new" || s.condition === "sealed").length;
    const usedSets    = sets.filter(s => s.condition && s.condition.startsWith("used")).length;
    // Avg over sets that HAVE a value — unknown-value sets are excluded so they
    // don't drag the average down as phantom $0s (avgPaid still spans all sets:
    // a paid price is known even when the current value isn't).
    const valuedSets  = knownValueCount(sets, valueMap);
    const avgValue    = valuedSets ? value / valuedSets : 0;
    const avgPaid     = sets.length ? costBasis / sets.length : 0;

    // Stats sourced from normalized BE data (entries carry the raw fields)
    const pieces      = sets.reduce((sum, s) => sum + (s.pieces || 0) * (asNumber(s.qty) || 1), 0);
    // Retail (MSRP) headline — sum the SHARED retail ladder (retailFor → setRetailProvenance),
    // the same source the per-set Retail column and detail-panel chip read, so the card can't
    // drift from the rows. Promo (no-RRP) and unsourced sets resolve to null → contribute 0;
    // `retailValueKnown` (the priced count) drives formatAggregateValue ("—" when 0) and the
    // "N of M sets priced" note. (Retail Phase 3b — was the BE-import blob
    // totalRetailPrice || (retailPrice || msrp) × qty.)
    const { total: retailValue, known: retailValueKnown } = portfolioRetail(sets, retailFor);
    const minifigs    = sets.reduce((sum, s) => sum + (asNumber(s.minifigs) || 0) * (asNumber(s.qty) || 1), 0);

    // Entry-level counts — each copy counted individually, matching BE's method.
    // BE sets use the entries[] array; manually-added sets fall back to a single synthetic entry.
    const allEntries    = sets.flatMap(s => s.entries?.length ? s.entries : [{ condition: s.condition, current_value: asNumber(s.currentValue), retired: s.retired }]);
    const newEntries    = allEntries.filter(e => !e.condition || e.condition === "new" || e.condition === "sealed").length;
    const usedEntries   = allEntries.filter(e => e.condition && e.condition.startsWith("used")).length;
    // New/Used Sets Value via the portfolio funnel on condition-filtered SETS — unknown
    // value contributes 0 and is excluded from the known-count, so an all-unknown subset
    // renders "—" (formatAggregateValue), never a phantom $0. (Workstream A)
    const newSetsList   = sets.filter(s => !s.condition || s.condition === "new" || s.condition === "sealed");
    const usedSetsList  = sets.filter(s => s.condition && s.condition.startsWith("used"));
    const newSetsValue   = portfolioValue(newSetsList, valueMap);
    const usedSetsValue  = portfolioValue(usedSetsList, valueMap);
    const newValueKnown  = knownValueCount(newSetsList, valueMap);
    const usedValueKnown = knownValueCount(usedSetsList, valueMap);

    return {
      totalQty, costBasis, value, valuedSets, themes, duplicates,
      retiredSets, newSets, usedSets, avgValue, avgPaid,
      pieces, retailValue, retailValueKnown, minifigs, newEntries, usedEntries,
      newSetsValue, usedSetsValue, newValueKnown, usedValueKnown,
      // Paid-provenance split (Step 2 revised): msrpCost/msrpCount drive the quality disclosure
      // beside the TOTAL cost-basis headline. realCost/realCount kept for any consumer needing them.
      realCost: costSplit.realCost, realCount: costSplit.realCount,
      msrpCost: costSplit.msrpCost, msrpCount: costSplit.msrpCount,
      // Gain over value-known sets; % ROI over the TOTAL cost basis {value known, cost > 0} —
      // includes the MSRP-estimated portion (disclosed via totalRoiNote). (Step 2 revised)
      gainLoss: portfolioGain(sets, valueMap),
      // Cost over the value-known subset — the denominator gainLoss is actually computed
      // against. Drives the Net Gain tile's reconciling breakdown (value − valuedCost === gain).
      valuedCost: portfolioValuedCost(sets, valueMap),
      roi: portfolioROI(sets, valueMap),
      // Quiet disclosure: share of value that is estimated (modeled + asking). (Step 3)
      estimatedShare: estimatedValueShare(sets, valueMap)
    };
    // retailCaches: retailFor (the retail-ladder sum) closes over it, so the Retail Value card
    // recomputes when the CMF series -0 fetch refreshes the Brickset snapshot. (Retail Phase 3b)
  }, [sets, valueMap, purchaseMap, retailCaches]);

  const themeChartData = useMemo(() => {
    // groupRollup sums KNOWN values per theme (unknown excluded, not counted as $0).
    // (unknown≠0 sweep)
    return groupRollup(sets, s => s.theme, valueMap)
      .map(g => ({ name: g.key, qty: g.qty, value: g.value, known: g.knownValueCount }))
      .sort((a, b) => b.value - a.value);
  }, [sets, valueMap]);

  const topRoiSets = useMemo(() => {
    return [...sets]
      // %ROI rule: value known AND cost > 0. Excludes $0-cost (÷0) and unknown-value
      // sets (would otherwise rank as a false −100%). (V2 cleanup)
      .filter(s => asNumber(s.paidPrice) > 0 && setValueProvenance(s, valueMap).amount !== null)
      // _roi from the LIVE overlay-aware setROI, not the stored roiPct snapshot: a lazily-promoted
      // set stores roiPct from its promote-time 0 value (a false −100%) that the value-sync never
      // refreshes. The filter guarantees value-known + cost > 0, so setROI is non-null here.
      .map(s => ({ ...s, _roi: setROI(s, valueMap) }))
      .sort((a, b) => b._roi - a._roi);
  }, [sets, valueMap]);

  const topValueSets = useMemo(() => {
    // Sort by null-aware value; unknown (null) sorts as 0 → bottom. (unknown≠0 sweep)
    return [...sets].sort((a, b) =>
      (setValueProvenance(b, valueMap).amount ?? 0) - (setValueProvenance(a, valueMap).amount ?? 0)
    );
  }, [sets, valueMap]);

  const watchListHighlights = useMemo(() => {
    try {
      const wl = JSON.parse(localStorage.getItem("blWantedList") || "[]");
      const scored = [...wl]
        .map(w => ({ ...w, _score: priorityScore(w) }))
        .sort((a, b) => b._score - a._score);
      return {
        total: wl.length,
        retiringSoon: wl.filter(w => w.retiringSoon || Number(w.retirementYear) <= new Date().getFullYear() + 1).length,
        critical: wl.filter(w => ["Buy Soon", "Critical"].includes(w.status)).length,
        scored
      };
    } catch { return { total: 0, retiringSoon: 0, critical: 0, scored: [] }; }
  }, [refreshKey]);

  // ── Portfolio history chart data ──────────────────────────────────────────
  const portfolioHistory = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("blPortfolioHistory") || "[]"); } catch { return []; }
  }, [refreshKey, sets]);

  // ── Theme performance table ───────────────────────────────────────────────
  const themePerformance = useMemo(() => {
    // Per-theme rollup via the null-aware funcs: value/gain/roi exclude unknown-value
    // sets exactly like the headline; `spent` stays inclusive. (unknown≠0 sweep)
    return groupRollup(sets, s => s.theme, valueMap)
      .map(g => ({ theme: g.key, sets: g.count, paid: g.spent, value: g.value, gain: g.gain, roi: g.roi, knownCount: g.knownValueCount }))
      .sort((a, b) => (b.roi ?? -999) - (a.roi ?? -999));
  }, [sets, valueMap]);

  // ── Retirement alerts for owned sets ─────────────────────────────────────
  const retirementAlertsForOwned = useMemo(() => {
    const bsCache = (() => { try { return JSON.parse(localStorage.getItem("bricksetSetCache") || "{}"); } catch { return {}; } })();
    const lc      = (() => { try { return JSON.parse(localStorage.getItem("legoLastChanceCache") || "null"); } catch { return null; } })();
    const lcCodes = lc?.setCodes || [];
    return sets.flatMap(s => {
      const clean = String(s.setNumber || "").replace(/-1$/, "");
      if (retireDismissed.includes(clean)) return [];
      const bs = (bsCache[clean] || bsCache[`${clean}-1`] || {}).data || {};
      const isLC = lcCodes.includes(clean) || lcCodes.includes(`${clean}-1`);
      const exitDate = bs.exit_date || null;
      const days = exitDate ? daysUntilRetirement(exitDate) : null;
      if (isLC) return [{ ...s, alertType: "lastchance", days: 0 }];
      if (days !== null && days >= 0 && days <= 60) return [{ ...s, alertType: "retiring", days }];
      return [];
    });
  }, [sets, retireDismissed, refreshKey]);

  const budgetSnapshot = useMemo(() => {
    try {
      const purchases = JSON.parse(localStorage.getItem("blPurchases") || "[]");
      const annualBudget = asNumber(localStorage.getItem("blAnnualBudget")) || 0;
      const totalSpent = purchases.reduce((sum, p) => sum + lineCashPaid(p), 0);
      const pct = annualBudget ? Math.min((totalSpent / annualBudget) * 100, 100) : 0;
      const color = pct >= 100 ? "#ef4444" : pct >= 70 ? "#f7b731" : "#22c55e";
      const status = pct >= 100 ? "Over Budget" : pct >= 70 ? "Approaching Limit" : "Healthy";
      return { annualBudget, totalSpent, remaining: annualBudget - totalSpent, pct, color, status };
    } catch { return { annualBudget: 0, totalSpent: 0, remaining: 0, pct: 0, color: "#22c55e", status: "Healthy" }; }
  }, [refreshKey]);

  // ── Duplicate detection for Add Set ───────────────────────────────────────
  useEffect(() => {
    const num = String(form.setNumber || "").replace(/-1$/, "").trim();
    if (!num) { setAddDupeWarning(null); return; }
    const inCollection = sets.some(s => String(s.setNumber || "").replace(/-1$/, "") === num);
    if (inCollection) { setAddDupeWarning("collection"); return; }
    try {
      const wl = JSON.parse(localStorage.getItem("blWantedList") || "[]");
      const onList = wl.some(w => String(w.setNumber || "").replace(/-1$/, "") === num);
      setAddDupeWarning(onList ? "watchlist" : null);
    } catch { setAddDupeWarning(null); }
  }, [form.setNumber, sets]);

  // ── Set number autocomplete (By Set Number mode) ──────────────────────────
  useEffect(() => {
    const q = form.setNumber.trim();
    if (addCatalogMode || q.length < 3) { setSetNumSuggestions([]); return; }
    const t = setTimeout(async () => {
      setSetNumSuggestLoading(true);
      const result = await searchBricksetCatalog(q);
      setSetNumSuggestLoading(false);
      setSetNumSuggestions(result.sets?.slice(0, 6) || []);
    }, 350);
    return () => clearTimeout(t);
  }, [form.setNumber, addCatalogMode]);

  // ── Catalog search debounce (Add Set) ─────────────────────────────────────
  useEffect(() => {
    if (!addCatalogMode || addCatalogQuery.trim().length < 2) { setAddCatalogResults([]); return; }
    const t = setTimeout(async () => {
      setAddCatalogLoading(true); setAddCatalogError("");
      const result = await searchBricksetCatalog(addCatalogQuery.trim());
      setAddCatalogLoading(false);
      if (result.noKey) { setAddCatalogError("Brickset API key not configured."); setAddCatalogResults([]); }
      else if (result.error) { setAddCatalogError(result.error); setAddCatalogResults([]); }
      else setAddCatalogResults(result.sets || []);
    }, 420);
    return () => clearTimeout(t);
  }, [addCatalogQuery, addCatalogMode]);

  function normalizeSetNum(raw) {
    const s = String(raw || "").trim();
    return s && !s.includes("-") ? `${s}-1` : s;
  }

  // Brickset = metadata authority · BE = value only
  async function lookupSet() {
    const bsKey = String(form.setNumber || "").replace(/-1$/, "").trim();
    const beKey = normalizeSetNum(form.setNumber); // "75192-1" for BE cache
    if (!bsKey) return;

    setLookupLoading(true);
    setLookupMessage("");

    // ── 1. Rebrickable — instant local pre-fill (no network) ───────────────
    const rb = rbLookupSet(beKey);
    if (rb) {
      setForm(prev => ({
        ...prev,
        name:  prev.name  || rb.name,
        theme: prev.theme || rb.theme,
      }));
      setLookupData(prev => ({
        ...prev,
        pieces:  rb.numParts || prev.pieces,
        year:    rb.year     || prev.year,
      }));
    }

    try {
      // ── 2. Brickset — canonical metadata + MSRP + retirement (primary) ───
      const bsData = await fetchBricksetSet(bsKey);

      if (!bsData && !rb) {
        setLookupMessage("Set not found — check the number.");
        setLookupLoading(false);
        return;
      }

      setLookedUpNum(bsKey); // this lookup result belongs to bsKey

      if (bsData) {
        const retired = bsData.exit_date ? new Date(bsData.exit_date) < new Date() : false;
        setLookupData({
          pieces:       bsData.pieces      ?? rb?.numParts ?? null,
          minifigs:     bsData.minifigs    ?? null,
          subtheme:     bsData.subtheme    ?? null,
          year:         bsData.year        ?? rb?.year     ?? null,
          exit_date:    bsData.exit_date   ?? null,
          releasedDate: bsData.launch_date ?? null,
          retiredDate:  bsData.exit_date   ?? null,
          retired,
          retiringSoon: bsData.exit_date
            ? (new Date(bsData.exit_date) - new Date()) < 180 * 86400000 && !retired
            : false,
          thumbnail:    bsData.thumbnail_url ?? null,
        });

        setForm(prev => ({
          ...prev,
          setNumber:    bsData.set_number?.replace(/-1$/, "") || bsKey,
          name:         bsData.name          || prev.name,
          theme:        bsData.theme         || prev.theme,
          msrp:         bsData.retail_price_us ? String(bsData.retail_price_us) : prev.msrp,
          currentValue: bsData.retail_price_us ? String(bsData.retail_price_us) : prev.currentValue,
        }));

        const metaParts = [
          bsData.pieces   ? `${Number(bsData.pieces).toLocaleString()} pcs` : rb?.numParts ? `${rb.numParts.toLocaleString()} pcs` : null,
          bsData.minifigs ? `${bsData.minifigs} figs` : null,
          bsData.year     ? String(bsData.year) : null,
          retired         ? "Retired" : null,
        ].filter(Boolean);
        setLookupMessage(`Found: ${bsData.name || bsKey}${metaParts.length ? " · " + metaParts.join(" · ") : ""}`);
      }

      // ── 3. BrickEconomy — value only (non-blocking, cache-first) ──────────
      ;(async () => {
        try {
          const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
          let beData = cache[beKey]?.data;
          if (!beData) {
            const res  = await apiFetch(`/api/brickeconomy-set?number=${encodeURIComponent(beKey)}&currency=USD`);
            const json = await res.json();
            if (res.ok && !json.error) {
              beData = json.data || json;
              cache[beKey] = { fetchedAt: new Date().toISOString(), data: beData };
              setItemSafe("brickEconomySetCache", JSON.stringify(cache));
            }
          }
          const beVal = beValueForCondition(beData, form.condition);
          if (beVal) {
            setForm(prev => ({ ...prev, currentValue: String(beVal) }));
          } else if (!bsData?.retail_price_us && beData?.retail_price_us) {
            // BE MSRP only if Brickset had none
            setForm(prev => ({ ...prev, msrp: String(beData.retail_price_us), currentValue: String(beData.retail_price_us) }));
          }
        } catch { /* non-critical */ }
      })();

    } catch {
      setLookupMessage("Lookup failed — check your connection.");
    } finally {
      setLookupLoading(false);
    }
  }

  // ── Rebrickable bulk enrichment ───────────────────────────────────────────
  // Fills missing pieces / theme / year on every set from local Rebrickable data.
  // Pure local lookup — zero API calls. Skips sets that already have the field.
  const [rbEnriching, setRbEnriching] = useState(false);
  const [rbEnrichResult, setRbEnrichResult] = useState(null);

  function enrichFromRebrickable() {
    if (!rbReady()) {
      toast("Rebrickable catalog still loading — try again in a moment.");
      return;
    }
    setRbEnriching(true);
    let enriched = 0;
    setSets(prev => {
      const next = prev.map(s => {
        const rb = rbLookupSet(s.setNumber);
        if (!rb) return s;
        const updates = {};
        if (!s.pieces   && rb.numParts) updates.pieces   = rb.numParts;
        if (!s.theme    && rb.theme)    updates.theme    = rb.theme;
        if (!s.year     && rb.year)     updates.year     = rb.year;
        if (!s.name     && rb.name)     updates.name     = rb.name;
        if (Object.keys(updates).length) { enriched++; return { ...s, ...updates }; }
        return s;
      });
      setItemSafe("blOwnedSets", JSON.stringify(next.filter(s => s.source !== "BrickEconomy")));
      return next;
    });
    // Also enrich Wanted List from same local data
    try {
      const wl = JSON.parse(localStorage.getItem("blWantedList") || "[]");
      let wlEnriched = 0;
      const wlNext = wl.map(w => {
        const rb = rbLookupSet(w.setNumber);
        if (!rb) return w;
        const updates = {};
        if (!w.pieces   && rb.numParts) updates.pieces   = rb.numParts;
        if (!w.theme    && rb.theme)    updates.theme    = rb.theme;
        if (!w.name     && rb.name)     updates.name     = rb.name;
        if (Object.keys(updates).length) { wlEnriched++; return { ...w, ...updates }; }
        return w;
      });
      if (wlEnriched > 0) setItemSafe("blWantedList", JSON.stringify(wlNext));
      enriched += wlEnriched;
    } catch {}

    setRbEnrichResult(enriched);
    setRbEnriching(false);
    if (enriched > 0) toast.success(`Rebrickable: filled ${enriched} missing fields`);
    else toast("Rebrickable: nothing new to fill in");
  }

  function addSet() {
    if (!form.setNumber && !form.name) return;

    const qty       = asNumber(form.qty) || 1;
    const paidPrice = asNumber(form.paidPrice);

    setSets(prev => [
      ...prev,
      {
        ...lookupData,  // Brickset metadata (pieces, minifigs, dates, retired, etc.)
        ...form,
        qty,
        paidPrice,
        ...manualMsrpPatch(form.msrp), // { msrp, retailPrice } — same contract the edit form uses
        currentValue: asNumber(form.currentValue),
        addedAt: new Date().toISOString()
      }
    ]);

    setLookupData({});
    setLookedUpNum("");
    setForm({ setNumber: "", name: "", theme: "", condition: "new", qty: 1, paidPrice: "", msrp: "", currentValue: "", notes: "" });
    setLookupMessage("");
    setSetNumSuggestions([]);

    // Auto-remove from Wanted List if it's being tracked there
    try {
      const wl = JSON.parse(localStorage.getItem("blWantedList") || "[]");
      const cleanNum = String(form.setNumber || "").replace(/-1$/, "").trim();
      const filtered = wl.filter(w => String(w.setNumber || "").replace(/-1$/, "").trim() !== cleanNum);
      if (filtered.length < wl.length) {
        setItemSafe("blWantedList", JSON.stringify(filtered));
        toast.success(`Removed from Wanted List — now in collection`);
      }
    } catch { /* non-critical */ }

    // If a price was entered, offer to log a purchase record
    if (paidPrice > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const firstStore = savedStores[0] || "";
      setPurchaseModal({ setNumber: form.setNumber, name: form.name, theme: form.theme, qty, price: paidPrice });
      setPmForm({ store: firstStore, date: today, tax: "", shipping: "", gc: "", orderLabel: "" });
    }
  }

  function commitPurchaseLog() {
    if (!purchaseModal) return;
    try {
      const { setNumber, name, theme, qty, price } = purchaseModal;
      const faceValue  = price;
      const tax        = asNumber(pmForm.tax)      || 0;
      const shipping   = asNumber(pmForm.shipping) || 0;
      const gcApplied  = asNumber(pmForm.gc)       || 0;
      const total      = Math.round((faceValue * qty + tax + shipping) * 100) / 100;
      const cashPaid   = Math.max(0, Math.round((total - gcApplied) * 100) / 100);
      const date       = pmForm.date || new Date().toISOString().slice(0, 10);
      const d          = new Date(date + "T00:00:00");
      const month      = d.toLocaleString("en-US", { month: "long" }) + " " + d.getFullYear();
      const purchase   = {
        setNumber, name, theme, qty,
        faceValue, tax: tax || null, shipping: shipping || null, gcApplied: gcApplied || null,
        total, cashPaid, amount: faceValue,
        store:      pmForm.store || "",
        date, month, year: d.getFullYear(),
        orderLabel: pmForm.orderLabel || null,
        orderNotes: null,
        _fromCollection: true,
      };
      const existing = JSON.parse(localStorage.getItem("blPurchases") || "[]");
      setItemSafe("blPurchases", JSON.stringify([...existing, purchase]));
    } catch {}
    setPurchaseModal(null);
  }

  function dropCollItem(targetKey) {
    if (!draggedCollItem || draggedCollItem === targetKey) return;
    setCollectionItems(prev => {
      const next = [...prev];
      const from = next.findIndex(c => c.key === draggedCollItem);
      const to   = next.findIndex(c => c.key === targetKey);
      if (from < 0 || to < 0) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDraggedCollItem(null);
  }

  function toggleCollWidth(key) {
    setCollectionItems(prev => prev.map(i => i.key === key ? { ...i, width: i.width === "full" ? "half" : "full" } : i));
  }

  function toggleCollCollapse(key) {
    setCollectionItems(prev => prev.map(i => i.key === key ? { ...i, collapsed: !i.collapsed } : i));
  }

  function dropOwnedColumn(targetKey) {
    if (!draggedOwnedColumn || draggedOwnedColumn === targetKey) return;

    setOwnedColumns(prev => {
      const next = [...prev];
      const fromIndex = next.findIndex(col => col.key === draggedOwnedColumn);
      const toIndex = next.findIndex(col => col.key === targetKey);

      if (fromIndex < 0 || toIndex < 0) return prev;

      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      return next;
    });

    setDraggedOwnedColumn(null);
  }

  function toggleOwnedColumn(key) {
    setOwnedColumns(prev =>
      prev.map(col =>
        col.key === key
          ? { ...col, visible: !col.visible }
          : col
      )
    );
  }

  function moveOwnedColumn(key, direction) {
    setOwnedColumns(prev => {
      const next = [...prev];

      const index = next.findIndex(col => col.key === key);
      const newIndex = index + direction;

      if (index < 0 || newIndex < 0 || newIndex >= next.length) {
        return prev;
      }

      const [item] = next.splice(index, 1);
      next.splice(newIndex, 0, item);

      return next;
    });
  }

  function startResize(colKey, e) {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = {
      key: colKey,
      startX: e.clientX,
      startWidth: columnWidths[colKey] ?? 80,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(ev) {
      const { key, startX, startWidth } = resizingCol.current;
      const newW = Math.max(36, startWidth + (ev.clientX - startX));
      setColumnWidths(prev => ({ ...prev, [key]: newW }));
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizingCol.current = null;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function renderOwnedCell(set, column) {
    const qty = asNumber(set.qty) || 1;
    // null when value is unknown → "—", never a phantom −cost loss. (unknown≠0 sweep)
    const gain = setGain(set, valueMap);
    // null when excluded from %ROI (unknown value OR cost ≤ 0) → cell reads "—".
    // Never Infinity/NaN. (V2 cleanup)
    const roi = setROI(set, valueMap);
    // Hold value-bearing cells at a loading state until the BL overlay resolves (no BE→BL flash).
    if (!valuesReady && (column.key === "value" || column.key === "gain" || column.key === "roi")) return "…";

    if (column.key === "setNumber") return <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{set.setNumber || "—"}</span>;
    if (column.key === "name") return set.name || "—";
    if (column.key === "theme") return set.theme || "—";
    if (column.key === "qty") return qty;
    if (column.key === "value") {
      // Three-up (MSRP Step 2): Retail / Paid / Market in one compact cell.
      //   Retail → setRetailProvenance (Brickset canonical, BE deprecated fallback, "—" when none)
      //   Paid   → setCost; $0 / unrecorded → null → "—" (a genuine GWP $0 is indistinguishable here)
      //   Market → setValueProvenance (the prior cell's value — pinned by TriValueCell's Market line)
      const cost = setCost(set);
      return <TriValueCell density={rowDensity} retail={retailFor(set)} paid={cost > 0 ? cost : null} market={setValueProvenance(set, valueMap)} />;
    }
    if (column.key === "gain") return gain === null ? "—" : money(gain);
    if (column.key === "roi") return roi !== null ? `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%` : "—";
    if (column.key === "minifigs") return set.minifigs != null ? set.minifigs : "—";
    if (column.key === "acquiredDate") return fmtShortDate(set.acquiredDate);
    if (column.key === "retiredDate")  return fmtShortDate(set.retiredDate);
    if (column.key === "releasedDate") return fmtShortDate(set.releasedDate);
    if (column.key === "notes") return set.notes || "";

    return "";
  }

  function isNumericOwnedColumn(key) {
    return ["qty", "paid", "value", "gain", "roi"].includes(key);
  }

  const localThemes = Array.from(new Set(sets.map(s => s.theme).filter(Boolean))).sort();
  const [legoThemes, setLegoThemes] = useState([]);
  useEffect(() => { fetchLegoThemes().then(t => { if (t.length) setLegoThemes(t); }); }, []);
  // Merge: Brickset master list + anything the user typed locally that isn't in it
  const themes = legoThemes.length
    ? Array.from(new Set([...legoThemes, ...localThemes])).sort()
    : localThemes;

  function sortHeader(column) {
    if (sortColumn === column) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection(column === "value" || column === "gain" ? "desc" : "asc");
    }
  }

  function sortLabel(label, column) {
    if (sortColumn !== column) return label;
    return label + (sortDirection === "asc" ? " ↑" : " ↓");
  }

  const visibleSets = (searchText.trim()
    ? (() => {
        const q = searchText.trim().toLowerCase();
        return sets.filter(s =>
          (s.setNumber || "").toLowerCase().includes(q) ||
          (s.name     || "").toLowerCase().includes(q) ||
          (s.theme    || "").toLowerCase().includes(q) ||
          (s.subtheme || "").toLowerCase().includes(q) ||
          (s.notes    || "").toLowerCase().includes(q) ||
          String(s.year || "").includes(q)
        );
      })()
    : sets
  ).filter(set => {
      const matchesTheme = !filterTheme || set.theme === filterTheme;
      const matchesCondition = !filterCondition || setConditionDisplay(set) === filterCondition;
      return matchesTheme && matchesCondition;
    })
    .sort((a, b) => {
      let result = 0;

      if (sortColumn === "qty") {
        result = asNumber(a.qty) - asNumber(b.qty);
      } else if (sortColumn === "value") {
        // Null-aware: unknown value sorts as 0. (unknown≠0 sweep)
        result = (setValueProvenance(a, valueMap).amount ?? 0) - (setValueProvenance(b, valueMap).amount ?? 0);
      } else if (sortColumn === "gain") {
        // Null-aware: unknown-value sets (no computable gain) sort as 0. (unknown≠0 sweep)
        result = (setGain(a, valueMap) ?? 0) - (setGain(b, valueMap) ?? 0);
      } else if (sortColumn === "condition") {
        // New / Used / Mixed, consistent order — bucketed display, never raw tokens.
        const rank = { new: 0, used: 1, mixed: 2 };
        result = (rank[setConditionDisplay(a)] ?? 0) - (rank[setConditionDisplay(b)] ?? 0);
      } else if (sortColumn === "addedAt") {
        result = String(a.addedAt || "").localeCompare(String(b.addedAt || ""));
      } else {
        result = String(a[sortColumn] || "").localeCompare(String(b[sortColumn] || ""));
      }

      return sortDirection === "asc" ? result : -result;
    });

  // Persist an edit to a BrickEconomy set. BE data lives in the brickEconomyNormalizedCollection
  // blob, which the blOwnedSets persist effect deliberately skips — so a BE-set edit would
  // otherwise revert on reload. Patch the blob surgically (spread preserves every other normalized
  // field — no lossy in-memory→normalized reverse-map) via setItemSafe, which auto-pushes to the
  // cloud through brickledger:datachange; then mirror the patch into state for immediate UI.
  // Field-agnostic: callers pass whatever keys changed (paid today, per-copy condition next).
  function persistBESetEdit(setNumber, patch) {
    try {
      const blob = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]");
      // Never persist a derived per-set `condition` to the blob: it's recomputed from entries[] on
      // load and may be "mixed" (which must not be stored). entries[]/value fields persist as given.
      const blobPatch = { ...patch };
      delete blobPatch.condition;
      setItemSafe("brickEconomyNormalizedCollection", JSON.stringify(
        blob.map(s => (s.setNumber === setNumber ? { ...s, ...blobPatch } : s)),
      ));
    } catch { /* blob unreadable — still update state so the UI reflects the edit */ }
    // State keeps the full patch (incl. the fresh derived condition) so the column pill + stats are
    // consistent in-session without a reload.
    setSets(prev => prev.map(s => (s.setNumber === setNumber && s.source === "BrickEconomy" ? { ...s, ...patch } : s)));
  }

  // Re-value a BE set from the cached BrickEconomy figures — each copy at its OWN (now-edited)
  // condition, mirroring beSyncValues' applyCache. Returns { currentValue, totalValue } or null
  // when the cache has no figure for this set (→ caller leaves value to the next value-sync, which
  // preserves entries[] and re-values). currentValue is the per-copy average so currentValue × qty
  // == totalValue.
  function revalueFromCache(s) {
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}"); } catch { /* no cache */ }
    const d = cache[String(s.setNumber || "").replace(/-1$/, "")]?.data;
    return revalueBESet(s, d); // { currentValue, totalValue } | null (pure; mirrors applyCache)
  }

  // Per-copy condition edit (SetDetailPanel's per-copy control). Only entries[copyIndex] changes →
  // the set becomes Mixed when copies disagree (setConditionDisplay derives it; nothing "mixed" is
  // stored). Same rails as the bulk edit: reconcileConditionEdit → re-value → persistBESetEdit, plus
  // a detailSet refresh so the open panel's per-copy rows + value update live. BE sets only — manual
  // sets have no entries[] (and no per-copy rows); materializing entries[] for a manual Mixed set is
  // a separate, unbuilt feature.
  function editCopyCondition(index, copyIndex, bucket) {
    const cur = sets[index];
    if (!cur || cur.source !== "BrickEconomy") return;
    const condPatch = reconcileConditionEdit(cur, bucket, copyIndex); // { entries: only copyIndex changed }
    const edited = { ...cur, ...condPatch };
    const rev = revalueFromCache(edited); // { currentValue, totalValue } | null
    persistBESetEdit(cur.setNumber, { ...condPatch, condition: setConditionDisplay(edited), ...(rev || {}) });
    // Refresh the open panel (its item is the blob shape — no per-set condition; entries + value only).
    setDetailSet(prev => (prev ? { ...prev, ...condPatch, ...(rev || {}) } : prev));
  }

  function updateSet(index, field, value) {
    const cur = sets[index];
    if (!cur) return;
    const coerced = field === "qty" || field === "paidPrice" || field === "currentValue" || field === "msrp" ? asNumber(value) : value;

    // Paid is a per-unit field, but setCost() reads the precomputed `totalPaid` FIRST — so editing
    // paidPrice (or qty) alone is a silent no-op on gain/ROI/Cost-Basis for any set carrying
    // totalPaid (every BE import). reconcilePaidEdit re-derives the canonical (totalPaid +
    // entries[].paid_price) so the edit lands and paid provenance reclassifies (msrp → manual).
    const rec = { ...cur, [field]: coerced };
    if (field === "paidPrice" || field === "qty") Object.assign(rec, reconcilePaidEdit(rec));
    // Hand-entered MSRP mirrors to retailPrice (the shared Add-Set contract) so the manual rung +
    // the headline card stay in lockstep. (Phase 3a.1)
    if (field === "msrp") Object.assign(rec, manualMsrpPatch(value));

    // BE sets are excluded from the blOwnedSets effect, so blob-relevant edits must persist via the
    // blob (persistBESetEdit auto-pushes); manual sets persist via the effect — branch so there's no
    // double-write.
    if (cur.source === "BrickEconomy" && field === "paidPrice") {
      // paidPrice↔averagePaid is the in-memory↔blob alias, so include both names: the one patch
      // derives paidPrice from averagePaid on reload and updates state.
      const perUnit = asNumber(rec.paidPrice);
      const patch = { paidPrice: perUnit, averagePaid: perUnit, totalPaid: rec.totalPaid };
      if (Array.isArray(rec.entries)) patch.entries = rec.entries;
      persistBESetEdit(cur.setNumber, patch);
    } else if (cur.source === "BrickEconomy" && field === "condition") {
      // Bulk: every copy → the chosen bucket. reconcileConditionEdit rewrites entries[].condition;
      // condition drives value (new vs used), so re-value immediately (from the BE cache) so
      // gain/ROI/tri-value move at edit time. entries[].condition shares its name across both shapes.
      const condPatch = reconcileConditionEdit(cur, value); // { entries: all := bucket }
      const edited = { ...cur, ...condPatch, condition: value };
      const rev = revalueFromCache(edited); // { currentValue, totalValue } | null (→ next value-sync)
      persistBESetEdit(cur.setNumber, { ...condPatch, condition: value, ...(rev || {}) });
    } else if (cur.source === "BrickEconomy" && field === "msrp") {
      // msrp is an app-level override, NOT a native BE blob field — persist it (+ its retailPrice
      // mirror) onto the blob so a hand-entered MSRP for an existing (BE-imported) set survives reload.
      persistBESetEdit(cur.setNumber, manualMsrpPatch(value));
    } else {
      setSets(prev => prev.map((s, i) => (i === index ? rec : s)));
    }
  }

  function toggleChecked(index) {
    setCheckedSets(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  }

  function toggleAll() {
    const visibleIndexes = visibleSets.map(set => sets.indexOf(set));
    const allChecked = visibleIndexes.length > 0 && visibleIndexes.every(i => checkedSets.includes(i));

    if (allChecked) {
      setCheckedSets(prev => prev.filter(i => !visibleIndexes.includes(i)));
    } else {
      setCheckedSets(prev => Array.from(new Set([...prev, ...visibleIndexes])));
    }
  }

  function deleteCheckedSets() {
    if (checkedSets.length === 0) return;
    if (!window.confirm(`Delete ${checkedSets.length} selected owned set(s)?`)) return;

    setSets(prev => prev.filter((_, i) => !checkedSets.includes(i)));
    setCheckedSets([]);
    setSelectedSetIndex(null);
  }

  function deleteSet(index) {
    setSets(prev => prev.filter((_, i) => i !== index));
  }

  function logSale(index) {
    const s = sets[index];
    const qty  = asNumber(s.qty) || 1;
    const paid = asNumber(s.totalPaid) || asNumber(s.paidPrice) * qty;
    const sold = asNumber(sellPrice);
    const entry = {
      setNumber: s.setNumber, name: s.name, theme: s.theme, condition: s.condition,
      qty, soldPrice: sold, soldDate: sellDate, paidPrice: paid,
      gain: sold - paid, roi: paid > 0 ? ((sold - paid) / paid) * 100 : null,
      notes: sellNotes, loggedAt: new Date().toISOString()
    };
    setSoldSets(prev => [entry, ...prev]);
    deleteSet(index);
    setSelectedSetIndex(null);
    setSellModal(false); setSellPrice(""); setSellNotes("");
    setSellDate(new Date().toISOString().slice(0, 10));
    setTab("sold");
  }

  return (
    <div style={page} onMouseMove={e => setTipPos({ x: e.clientX, y: e.clientY })} onTouchStart={() => { setHoveredSet(null); setHoveredWatchItem(null); }}>
      <div style={tabHeader}>
        <div>
          <h2 style={{ margin: 0 }}>My Collection</h2>
          <p style={{ ...muted, margin: "4px 0 0" }}>Track collection value, growth, and ROI across your sets.</p>
        </div>
        <div style={tabBar}>
          {[
            { key: "overview", label: "Overview" },
            { key: "collection", label: "Sets" },
            { key: "sold", label: soldSets.length > 0 ? `Sold (${soldSets.length})` : "Sold" },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={tab === t.key ? activeTabStyle : tabBtnStyle}>
              {t.label}
            </button>
          ))}
          <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.12)", alignSelf: "center" }} />
          <button onClick={() => setTab("add")} style={tab === "add" ? addSetBtnActive : addSetBtn}>
            + Add Set
          </button>
        </div>
      </div>

      {tab === "overview" && sets.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
          <div style={{ fontWeight: 900, fontSize: 20, color: "#e8e2d5", marginBottom: 8 }}>Start your collection</div>
          <div style={{ color: "#8a9bb0", fontSize: 14, maxWidth: 420, margin: "0 auto 24px", lineHeight: 1.6 }}>
            Already tracking sets in BrickEconomy or Brickset? Import your CSV in one step.
            Otherwise add sets manually or restore from a cloud backup.
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => onSwitchTab("settings")} style={{ background: "#c9a84c", color: "#0d1623", border: "none", borderRadius: 10, padding: "12px 24px", fontWeight: 900, fontSize: 14, cursor: "pointer" }}>
              Import Collection →
            </button>
            <button onClick={() => setTab("collection")} style={{ background: "transparent", color: "#8a9bb0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Add a Set Manually
            </button>
          </div>
        </div>
      )}

      {tab === "overview" && sets.length > 0 && (
        <>
          {/* ── Stat pill container ─────────────────────────────────── */}
          <div style={{ background: "rgba(11,21,32,0.7)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "14px 16px", marginBottom: 14, marginTop: 8, position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: collPillsCollapsed ? 0 : 12 }}>
              <span style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Collection Stats</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => runBricksetEnrichment(sets, true)} disabled={metaRefreshing} style={{ ...hoverCtrlBtn, color: metaRefreshing ? "#c9a84c" : "#8a9bb0" }} title="Sync pieces & minifig counts from Brickset">{metaRefreshing ? "⟳" : "⟳"}</button>
                <button onClick={() => setCollGearOpen(prev => !prev)} style={{ ...hoverCtrlBtn, color: collGearOpen ? "#c9a84c" : "#8a9bb0" }} title="Show / hide stats">⚙</button>
                <button onClick={() => setCollPillsCollapsed(prev => !prev)} style={hoverCtrlBtn} title={collPillsCollapsed ? "Expand" : "Collapse"}>{collPillsCollapsed ? "▼" : "▲"}</button>
              </div>
            </div>

            {collGearOpen && (
              <>
                <div onClick={() => setCollGearOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 29 }} />
                <div style={{ position: "absolute", top: 46, right: 10, zIndex: 30, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "12px 16px", minWidth: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                  <div style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Stats</div>
                  {collectionItems.filter(i => i.type === "card").sort((a, b) => a.label.localeCompare(b.label)).map(item => (
                    <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: item.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                      <input type="checkbox" checked={item.visible} onChange={() => setCollectionItems(prev => prev.map(x => x.key === item.key ? { ...x, visible: !x.visible } : x))} style={{ accentColor: "#c9a84c" }} />
                      {item.label}
                    </label>
                  ))}
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "10px 0 8px" }} />
                  <div style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Panels</div>
                  {collectionItems.filter(i => i.type === "panel").sort((a, b) => a.label.localeCompare(b.label)).map(item => (
                    <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: item.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                      <input type="checkbox" checked={item.visible} onChange={() => setCollectionItems(prev => prev.map(x => x.key === item.key ? { ...x, visible: !x.visible } : x))} style={{ accentColor: "#c9a84c" }} />
                      {item.label}
                    </label>
                  ))}
                </div>
              </>
            )}

            {!collPillsCollapsed && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {collectionItems.filter(i => i.type === "card" && i.visible).map(item => (
                  <div key={item.key} draggable
                    onDragStart={() => setDraggedCollItem(item.key)}
                    onDragEnd={() => setDraggedCollItem(null)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => dropCollItem(item.key)}
                    style={{ opacity: draggedCollItem === item.key ? 0.4 : 1, cursor: "grab" }}
                  >
                    {item.key === "qty"          ? <Card title="Total Sets" value={stats.totalQty} sub={`${sets.length} unique set${sets.length !== 1 ? "s" : ""}`} /> :
                     item.key === "value"        ? <Card title="Collection Value" value={fmtAgg(stats.value, stats.valuedSets)} sub={valuesReady ? [unknownValueNote(stats.valuedSets, sets.length), estimatedValueNote(stats.estimatedShare)].filter(Boolean).join(" · ") || null : null} /> :
                     item.key === "cost"         ? <Card title="Cost Basis"       value={money(stats.costBasis)} sub={estimatedCostNote(stats.msrpCount, stats.msrpCost)} /> :
                     item.key === "gain"         ? <Card title="Net Gain / Loss"  value={fmtAgg(stats.gainLoss, stats.valuedSets)} good={stats.valuedSets > 0 ? stats.gainLoss >= 0 : undefined} sub={valuesReady ? netGainBasisNote(stats.value, stats.valuedCost, stats.valuedSets, stats.costBasis) : null} /> :
                     item.key === "roi"          ? <Card title="ROI"              value={!valuesReady ? "…" : stats.roi === null ? "—" : `${stats.roi.toFixed(1)}%`} good={stats.roi === null ? undefined : stats.roi >= 0} sub={totalRoiNote(stats.msrpCount)} /> :
                     item.key === "themes"       ? <Card title="Themes"           value={stats.themes} /> :
                     item.key === "duplicates"   ? <Card title="Multi-Copy Sets"  value={stats.duplicates} /> :
                     item.key === "retired"      ? <Card title="Retired Sets"     value={stats.retiredSets} sub={sets.length ? `${((stats.retiredSets / sets.length) * 100).toFixed(1)}% of unique sets` : null} /> :
                     item.key === "newUsed"      ? (
                       <div style={{ ...panel, marginTop: 0, minHeight: 88, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "14px 16px" }}>
                         <div style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>New / Used</div>
                         <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                           <span style={{ fontSize: 22, fontWeight: 900, color: "#5aa832", lineHeight: 1.1 }}>{stats.newEntries}</span>
                           <span style={{ fontSize: 14, color: "#3d4f60", fontWeight: 700 }}>/</span>
                           <span style={{ fontSize: 22, fontWeight: 900, color: "#e8e2d5", lineHeight: 1.1 }}>{stats.usedEntries}</span>
                         </div>
                         <div style={{ fontSize: 11, color: "#3d4f60", minHeight: 14 }}>new · used</div>
                       </div>
                     ) :
                     item.key === "avgValue"     ? <Card title="Avg Set Value"    value={fmtAgg(stats.avgValue, stats.valuedSets)} /> :
                     item.key === "avgPaid"      ? <Card title="Avg Paid / Set"   value={money(stats.avgPaid)} /> :
                     item.key === "pieces"       ? <Card title="Total Pieces"     value={(stats.pieces || beSyncInfo.piecesCount || 0).toLocaleString()} /> :
                     item.key === "minifigs"     ? <Card title="Minifigs"         value={(stats.minifigs || beSyncInfo.minifsCount || 0).toLocaleString()} /> :
                     item.key === "retailValue"  ? <Card title="MSRP Value"       value={formatAggregateValue(stats.retailValue, stats.retailValueKnown)} sub={retailPricedNote(stats.retailValueKnown, sets.length)} /> :
                     item.key === "newValue"     ? <Card title="New Sets Value"   value={fmtAgg(stats.newSetsValue, stats.newValueKnown)} sub={`${stats.newEntries} sets`} /> :
                     item.key === "usedValue"    ? <Card title="Used Sets Value"  value={fmtAgg(stats.usedSetsValue, stats.usedValueKnown)} sub={`${stats.usedEntries} sets`} /> :
                     item.key === "watchList"    ? <Card title="Wanted List"      value={watchListHighlights.total} /> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Content panels ──────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
            {collectionItems.filter(item => item.type === "panel" && item.visible).map(item => {
              const gridCol = item.width === "full" ? "1 / -1" : "span 1";
              return (
                <div key={item.key}
                  style={{ gridColumn: gridCol, position: "relative" }}
                  draggable
                  onDragStart={() => setDraggedCollItem(item.key)}
                  onDragEnd={() => setDraggedCollItem(null)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => dropCollItem(item.key)}
                  onMouseEnter={() => setHoveredCollItem(item.key)}
                  onMouseLeave={() => setHoveredCollItem(null)}
                >
                  {hoveredCollItem === item.key && (
                    <div style={{ position: "absolute", top: 10, right: 10, zIndex: 20, display: "flex", gap: 4 }}>
                      {item.key === "theme-chart" && (() => {
                        const ct = chartTypes["theme-chart"] || "donut";
                        return (
                          <button onClick={e => { e.stopPropagation(); cycleChartType("theme-chart"); }} style={hoverCtrlBtn}
                            title={`Chart: ${ct} — click to switch to ${ct === "donut" ? "Pie" : ct === "pie" ? "Bar" : "Donut"}`}>
                            {ct === "donut" ? "◎" : ct === "pie" ? "●" : "▬"}
                          </button>
                        );
                      })()}
                      <button onClick={e => { e.stopPropagation(); toggleCollWidth(item.key); }} style={hoverCtrlBtn} title={item.width === "full" ? "Half width" : "Full width"}>
                        {item.width === "full" ? "◧" : "▣"}
                      </button>
                      <button onClick={e => { e.stopPropagation(); toggleCollCollapse(item.key); }} style={hoverCtrlBtn} title={item.collapsed ? "Expand" : "Collapse"}>
                        {item.collapsed ? "▼" : "▲"}
                      </button>
                    </div>
                  )}

                  {item.collapsed ? (
                      <div style={{ ...panel, marginTop: 0, padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: "#8a9bb0", fontSize: 14 }}>{item.label}</span>
                        <button onClick={() => toggleCollCollapse(item.key)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "4px 10px", color: "#8a9bb0", fontSize: 12, cursor: "pointer" }}>▼</button>
                      </div>
                    ) : item.key === "condition-breakdown" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 14px" }}>Condition Breakdown</h4>
                        {sets.length === 0 ? (
                          <div style={{ color: "#5d6f80", fontSize: 13 }}>No sets yet.</div>
                        ) : (() => {
                          // Bucketed to New / Used / Mixed per SET (matches the column + filter),
                          // labelled + coloured via the one condition normalizer — no raw tokens,
                          // no split used-grades, and Mixed gets its own slice.
                          const counts = { new: 0, used: 0, mixed: 0 };
                          sets.forEach(s => { counts[setConditionDisplay(s)] += 1; });
                          const data = ["new", "used", "mixed"]
                            .filter(b => counts[b] > 0)
                            .map(b => ({ name: conditionDisplayLabel(b), value: counts[b], color: conditionDisplayColor(b) }));
                          const total = data.reduce((s, d) => s + d.value, 0);
                          return (
                            <>
                              <ResponsiveContainer width="100%" height={160}>
                                <PieChart>
                                  <Pie data={data} cx="50%" cy="50%" innerRadius={44} outerRadius={70} dataKey="value" paddingAngle={2}>
                                    {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                                  </Pie>
                                  <Tooltip formatter={v => [v, "Sets"]} contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                                </PieChart>
                              </ResponsiveContainer>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 4 }}>
                                {data.map((d, i) => (
                                  <span key={d.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#8a9bb0" }}>
                                    <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, display: "inline-block" }} />
                                    {d.name} <strong style={{ color: "#e8e2d5" }}>{d.value}</strong>
                                    <span style={{ color: "#5d6f80" }}>({((d.value / total) * 100).toFixed(0)}%)</span>
                                  </span>
                                ))}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    ) : item.key === "theme-chart" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 14px" }}>Value by Theme</h4>
                        {themeChartData.length > 0 ? (
                          <>
                            {(() => {
                              const ct = chartTypes["theme-chart"] || "donut";
                              return ct === "bar" ? (
                                <div style={{ height: 240, marginBottom: 4 }}>
                                  <ResponsiveContainer width="100%" height={240}>
                                    <BarChart data={themeChartData.slice(0, 7)} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                                      <XAxis type="number" tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: "#8a9bb0", fontSize: 10 }} axisLine={false} tickLine={false} />
                                      <YAxis type="category" dataKey="name" tick={{ fill: "#8a9bb0", fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
                                      <Tooltip formatter={v => [money(v), "Value"]} contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                        {themeChartData.slice(0, 7).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                      </Bar>
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              ) : (
                                <div style={{ position: "relative", height: 240 }}>
                                  <ResponsiveContainer width="100%" height={240}>
                                    <PieChart>
                                      <Pie data={themeChartData} cx="50%" cy="50%" innerRadius={ct === "donut" ? 68 : 0} outerRadius={106} dataKey="value" paddingAngle={ct === "donut" ? 2 : 1}>
                                        {themeChartData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                      </Pie>
                                      <Tooltip formatter={v => money(v)} contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                                    </PieChart>
                                  </ResponsiveContainer>
                                  {ct === "donut" && (
                                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                                      <div style={{ fontSize: 20, fontWeight: 900, color: "#e8e2d5" }}>{fmtAgg(stats.value, stats.valuedSets)}</div>
                                      <div style={{ color: "#8a9bb0", fontSize: 12 }}>Collection Value</div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                              {themeChartData.slice(0, showAllThemes ? 15 : 5).map((d, i) => (
                                <div key={d.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "#0b1520", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "8px 12px" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{ width: 12, height: 12, borderRadius: 999, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0, display: "inline-block" }} />
                                    <div>
                                      <div style={{ fontWeight: 700, fontSize: 13 }}>{d.name}</div>
                                      <div style={{ color: "#5d6f80", fontSize: 12 }}>{d.qty} set{d.qty !== 1 ? "s" : ""}</div>
                                    </div>
                                  </div>
                                  <div style={{ fontWeight: 900, fontSize: 13 }}>{formatAggregateValue(d.value, d.known)}</div>
                                </div>
                              ))}
                              {themeChartData.length > 5 && (
                                <button onClick={() => setShowAllThemes(prev => !prev)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 12px", color: "#8a9bb0", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                                  {showAllThemes ? "▲ Show less" : `▾ ${Math.min(themeChartData.length, 15) - 5} more themes`}
                                </button>
                              )}
                            </div>
                          </>
                        ) : (
                          <div style={{ textAlign: "center", padding: "28px 20px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10 }}>
                            <div style={{ fontWeight: 700, color: "#8a9bb0", marginBottom: 4 }}>No collection data yet</div>
                            <div style={{ fontSize: 13, color: "#5d6f80" }}>Sync from BrickEconomy in Settings → Data, or add sets manually below.</div>
                          </div>
                        )}
                      </div>
                    ) : item.key === "roi-leaders" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 14px" }}>ROI Leaders</h4>
                        {topRoiSets.length > 0 ? (
                          <div style={{ display: "grid", gap: 8 }}>
                            {topRoiSets.slice(0, showAllRoi ? 15 : 5).map((s, i) => {
                              const realIndex = sets.findIndex(orig => orig.setNumber === s.setNumber);
                              return (
                                <div key={`${s.setNumber}-${i}`}
                                  onClick={() => { setDetailSet(openSetDetail(s.setNumber) || s); setDetailSetIndex(realIndex); }}
                                  onMouseEnter={e => { e.currentTarget.style.border = "1px solid rgba(255,255,255,0.18)"; setHoveredSet(s); }}
                                  onMouseLeave={e => { e.currentTarget.style.border = "1px solid rgba(255,255,255,0.06)"; setHoveredSet(null); }}
                                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0f1a28", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "9px 12px", cursor: "pointer" }}>
                                  <div>
                                    <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name || s.setNumber || "—"}</div>
                                    <div style={{ color: "#5d6f80", fontSize: 12 }}>{s.theme || "—"}</div>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ color: s._roi >= 0 ? "#5aa832" : "#ff8b8b", fontWeight: 900, fontSize: 15, whiteSpace: "nowrap" }}>
                                      {s._roi >= 0 ? "+" : ""}{s._roi.toFixed(1)}%
                                    </span>
                                    <span style={{ color: "#5d6f80", fontSize: 16 }}>›</span>
                                  </div>
                                </div>
                              );
                            })}
                            {topRoiSets.length > 5 && (
                              <button onClick={() => setShowAllRoi(prev => !prev)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 12px", color: "#8a9bb0", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                                {showAllRoi ? "▲ Show less" : `▾ ${Math.min(topRoiSets.length, 15) - 5} more`}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ color: "#5d6f80", padding: "20px 0" }}>Add sets with paid price and value to see ROI rankings.</div>
                        )}
                      </div>
                    ) : item.key === "most-valuable" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 14px" }}>Most Valuable Sets</h4>
                        {topValueSets.length > 0 ? (
                          <div style={{ display: "grid", gap: 8 }}>
                            {topValueSets.slice(0, showAllValuable ? 15 : 5).map((s, i) => {
                              // Unknown value → "—", never "$0.00". (unknown≠0 sweep)
                              const prov = setValueProvenance(s, valueMap);
                              return (
                                <div key={`${s.setNumber}-${i}`}
                                  onClick={() => { setDetailSet(openSetDetail(s.setNumber) || s); setDetailSetIndex(sets.indexOf(s)); }}
                                  onMouseEnter={e => { e.currentTarget.style.border = "1px solid rgba(255,255,255,0.18)"; setHoveredSet(s); }}
                                  onMouseLeave={e => { e.currentTarget.style.border = "1px solid rgba(255,255,255,0.06)"; setHoveredSet(null); }}
                                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0f1a28", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "9px 12px", cursor: "pointer" }}>
                                  <div>
                                    <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name || s.setNumber || "—"}</div>
                                    <div style={{ color: "#5d6f80", fontSize: 12 }}>{s.theme || "—"} · Qty {asNumber(s.qty) || 1}</div>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontWeight: 900, fontSize: 14 }}>{formatValueCell(prov)}</span>
                                    <span style={{ color: "#5d6f80", fontSize: 16 }}>›</span>
                                  </div>
                                </div>
                              );
                            })}
                            {topValueSets.length > 5 && (
                              <button onClick={() => setShowAllValuable(prev => !prev)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 12px", color: "#8a9bb0", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                                {showAllValuable ? "▲ Show less" : `▾ ${Math.min(topValueSets.length, 15) - 5} more`}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ color: "#5d6f80", padding: "20px 0" }}>No sets yet.</div>
                        )}
                      </div>
                    ) : item.key === "watch-list" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 10px" }}>Wanted List</h4>
                        {watchListHighlights.total > 0 ? (
                          <>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                              <span style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "#8a9bb0" }}>{watchListHighlights.total} tracked</span>
                              {watchListHighlights.retiringSoon > 0 && <span style={{ background: "#3b0a0a", border: "1px solid #7f1d1d", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "#ff8b8b", fontWeight: 700 }}>{watchListHighlights.retiringSoon} retiring soon</span>}
                              {watchListHighlights.critical > 0 && <span style={{ background: "#451a03", border: "1px solid #92400e", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "#f59e0b", fontWeight: 700 }}>{watchListHighlights.critical} urgent</span>}
                            </div>
                            <div style={{ display: "grid", gap: 8 }}>
                              {watchListHighlights.scored.slice(0, showAllWatchHighlights ? 15 : 5).map((wlItem, i) => {
                                const rec = recommendation(wlItem._score);
                                const recColor = rec === "Buy Now" ? "#ef4444" : rec === "Watch Closely" ? "#f59e0b" : "#5aa832";
                                return (
                                  <div key={`${wlItem.setNumber}-${i}`}
                                    onClick={() => setDetailWatchItem(wlItem)}
                                    onMouseEnter={e => { e.currentTarget.style.border = "1px solid rgba(255,255,255,0.18)"; setHoveredWatchItem(wlItem); }}
                                    onMouseLeave={e => { e.currentTarget.style.border = "1px solid rgba(255,255,255,0.06)"; setHoveredWatchItem(null); }}
                                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0f1a28", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "9px 12px", cursor: "pointer" }}>
                                    <div>
                                      <div style={{ fontWeight: 700, fontSize: 14 }}>{wlItem.name || wlItem.setNumber || "—"}</div>
                                      <div style={{ color: "#5d6f80", fontSize: 12 }}>{wlItem.theme || "—"}</div>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <div style={{ textAlign: "right" }}>
                                        <div style={{ fontWeight: 900, fontSize: 15 }}>{wlItem._score}</div>
                                        <div style={{ color: recColor, fontSize: 11, fontWeight: 700 }}>{rec}</div>
                                      </div>
                                      <span style={{ color: "#5d6f80", fontSize: 16 }}>›</span>
                                    </div>
                                  </div>
                                );
                              })}
                              {watchListHighlights.total > 5 && (
                                <button onClick={() => setShowAllWatchHighlights(prev => !prev)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 12px", color: "#8a9bb0", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                                  {showAllWatchHighlights ? "▲ Show less" : `▾ ${Math.min(watchListHighlights.total, 15) - 5} more`}
                                </button>
                              )}
                            </div>
                          </>
                        ) : (
                          <div style={{ textAlign: "center", padding: "28px 20px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10 }}>
                            <div style={{ fontWeight: 700, color: "#8a9bb0", marginBottom: 4 }}>Watch list is empty</div>
                            <div style={{ fontSize: 13, color: "#5d6f80" }}>
                              <span style={{ color: "#c9a84c", cursor: "pointer", textDecoration: "underline" }} onClick={() => onSwitchTab && onSwitchTab("acquisition")}>Switch to Wanted List</span> to track sets you want.
                            </div>
                          </div>
                        )}
                      </div>
                    ) : item.key === "budget" ? (
                      budgetSnapshot.annualBudget > 0 ? (
                        <div style={{ ...panel, marginTop: 0, display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ flex: "1 1 180px", minWidth: 180 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <h4 style={{ margin: 0 }}>Budget</h4>
                              <span style={{ fontWeight: 700, fontSize: 13, color: budgetSnapshot.color }}>{budgetSnapshot.status}</span>
                            </div>
                            <div style={{ height: 6, borderRadius: 999, background: "#0b1520", overflow: "hidden" }}>
                              <div style={{ width: `${budgetSnapshot.pct}%`, height: "100%", background: budgetSnapshot.color, borderRadius: 999 }} />
                            </div>
                            <div style={{ marginTop: 5, fontSize: 12, color: "#8a9bb0" }}>{budgetSnapshot.pct.toFixed(0)}% of annual budget used</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: "#8a9bb0", fontSize: 11, marginBottom: 2 }}>Annual Budget</div>
                            <div style={{ fontWeight: 900, fontSize: 18 }}>{money(budgetSnapshot.annualBudget)}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: "#8a9bb0", fontSize: 11, marginBottom: 2 }}>Spent</div>
                            <div style={{ fontWeight: 900, fontSize: 18 }}>{money(budgetSnapshot.totalSpent)}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: "#8a9bb0", fontSize: 11, marginBottom: 2 }}>Remaining</div>
                            <div style={{ fontWeight: 900, fontSize: 18, color: budgetSnapshot.remaining >= 0 ? "#5aa832" : "#ff8b8b" }}>{money(budgetSnapshot.remaining)}</div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ ...panel, marginTop: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                          <div>
                            <h4 style={{ margin: "0 0 4px" }}>Budget</h4>
                            <div style={{ fontSize: 13, color: "#5d6f80" }}>No annual budget configured.</div>
                          </div>
                          <button onClick={() => onSwitchTab && onSwitchTab("settings")} style={{ background: "transparent", color: "#c9a84c", border: "1px solid rgba(201,168,76,0.3)", borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                            Set Budget in Settings →
                          </button>
                        </div>
                      )
                    ) : item.key === "portfolio-history" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                          <h4 style={{ margin: 0 }}>Portfolio History</h4>
                          <div style={{ display: "flex", gap: 6 }}>
                            {["30d","90d","1y","all"].map(r => (
                              <button key={r} onClick={() => setHistRange(r)}
                                style={{ background: histRange === r ? "#c9a84c" : "rgba(255,255,255,0.04)", color: histRange === r ? "#0d1623" : "#8a9bb0", border: `1px solid ${histRange === r ? "#c9a84c" : "rgba(255,255,255,0.1)"}`, borderRadius: 6, padding: "4px 10px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                                {r.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </div>
                        {(() => {
                          const cutoff = histRange === "30d" ? 30 : histRange === "90d" ? 90 : histRange === "1y" ? 365 : 9999;
                          const cutDate = new Date(); cutDate.setDate(cutDate.getDate() - cutoff);
                          const data = portfolioHistory.filter(h => histRange === "all" || new Date(h.date) >= cutDate);
                          if (data.length < 2) return (
                            <div style={{ textAlign: "center", padding: "28px 20px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10 }}>
                              <div style={{ color: "#8a9bb0", fontSize: 13 }}>History builds automatically — sync or open the app daily to add data points.</div>
                            </div>
                          );
                          const fmt = d => { const dt = new Date(d + "T12:00:00"); return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
                          return (
                            <ResponsiveContainer width="100%" height={220}>
                              <AreaChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor="#c9a84c" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#c9a84c" stopOpacity={0.02} />
                                  </linearGradient>
                                  <linearGradient id="paidGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="date" tickFormatter={fmt} tick={{ fill: "#5d6f80", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={40} />
                                <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: "#5d6f80", fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
                                <Tooltip formatter={(v, n) => [money(v), n === "value" ? "Portfolio Value" : "Cost Basis"]} labelFormatter={fmt} contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                                <Area type="monotone" dataKey="paid"  stroke="#3b82f6" fill="url(#paidGrad)"  strokeWidth={1.5} dot={false} name="paid" />
                                <Area type="monotone" dataKey="value" stroke="#c9a84c" fill="url(#valueGrad)" strokeWidth={2}   dot={false} name="value" />
                              </AreaChart>
                            </ResponsiveContainer>
                          );
                        })()}
                      </div>
                    ) : item.key === "theme-performance" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 14px" }}>Theme Performance</h4>
                        {themePerformance.length === 0 ? (
                          <div style={{ color: "#5d6f80", padding: "20px 0" }}>No collection data yet.</div>
                        ) : (
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                              <thead>
                                <tr>
                                  {["Theme","Sets","Cost Basis","Value","Gain","ROI"].map(h => (
                                    <th key={h} style={{ ...thStyle, textAlign: h === "Theme" ? "left" : "right" }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {themePerformance.map(t => (
                                  <tr key={t.theme}>
                                    <td style={tdStyle}>{t.theme}</td>
                                    <td style={tdStyleR}>{t.sets}</td>
                                    <td style={tdStyleR}>{money(t.paid)}</td>
                                    <td style={tdStyleR}>{t.knownCount > 0 ? money(t.value) : "—"}</td>
                                    <td style={{ ...tdStyleR, color: t.knownCount > 0 && t.gain >= 0 ? "#5aa832" : t.knownCount > 0 ? "#ff8b8b" : "#5d6f80" }}>{t.knownCount > 0 ? money(t.gain) : "—"}</td>
                                    <td style={{ ...tdStyleR, color: (t.roi ?? 0) >= 0 ? "#5aa832" : "#ff8b8b", fontWeight: 900 }}>
                                      {t.roi != null ? `${t.roi >= 0 ? "+" : ""}${t.roi.toFixed(1)}%` : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "sold" && (
        <section style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <div>
              <h3 style={{ margin: "0 0 2px" }}>Realized Gains</h3>
              <div style={{ color: "#8a9bb0", fontSize: 13 }}>Sets you've sold — logged for P&L tracking.</div>
            </div>
            {soldSets.length > 0 && (
              <button onClick={() => { if (window.confirm("Clear all sold records?")) setSoldSets([]); }}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "#5d6f80", borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                Clear All
              </button>
            )}
          </div>

          {soldSets.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 12 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🏷️</div>
              <div style={{ fontWeight: 700, color: "#8a9bb0", marginBottom: 6 }}>No sales logged yet</div>
              <div style={{ fontSize: 13, color: "#5d6f80" }}>When you mark a set as sold from the Collection tab, it appears here.</div>
            </div>
          ) : (() => {
            const totalSold = soldSets.reduce((s, x) => s + asNumber(x.soldPrice), 0);
            const totalPaid = soldSets.reduce((s, x) => s + asNumber(x.paidPrice), 0);
            const totalGain = soldSets.reduce((s, x) => s + asNumber(x.gain), 0);
            const overallRoi = totalPaid > 0 ? (totalGain / totalPaid) * 100 : 0;
            return (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
                  {[
                    { label: "Total Proceeds", value: money(totalSold) },
                    { label: "Total Invested", value: money(totalPaid) },
                    { label: "Realized Gain", value: money(totalGain), color: totalGain >= 0 ? "#5aa832" : "#ff8b8b" },
                    { label: "Overall ROI", value: `${overallRoi >= 0 ? "+" : ""}${overallRoi.toFixed(1)}%`, color: overallRoi >= 0 ? "#5aa832" : "#ff8b8b" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px" }}>
                      <div style={{ color: "#8a9bb0", fontSize: 11, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontWeight: 900, fontSize: 16, color: color || "#e8e2d5" }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {soldSets.map((s, i) => {
                    const roiColor = (s.roi ?? 0) >= 0 ? "#5aa832" : "#ff8b8b";
                    return (
                      <div key={i} style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name || s.setNumber}</div>
                          <div style={{ color: "#5d6f80", fontSize: 12 }}>{s.theme || "—"} · {s.soldDate || "no date"}</div>
                          {s.notes && <div style={{ color: "#8a9bb0", fontSize: 12, marginTop: 2 }}>{s.notes}</div>}
                        </div>
                        <div style={{ display: "flex", gap: 16, alignItems: "center", flexShrink: 0 }}>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: "#5d6f80", fontSize: 11 }}>Sold / Paid</div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{money(s.soldPrice)} / {money(s.paidPrice)}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: "#5d6f80", fontSize: 11 }}>Gain · ROI</div>
                            <div style={{ fontWeight: 900, fontSize: 13, color: roiColor }}>{money(s.gain)} · {s.roi != null ? `${s.roi >= 0 ? "+" : ""}${s.roi.toFixed(1)}%` : "—"}</div>
                          </div>
                          <button onClick={() => { if (window.confirm("Remove this sale record?")) setSoldSets(prev => prev.filter((_, j) => j !== i)); }}
                            style={{ background: "none", border: "none", color: "#5d6f80", cursor: "pointer", fontWeight: 900, fontSize: 18 }}>×</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </section>
      )}

      {tab === "add" && (
      <section style={panel}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, letterSpacing: 0.3 }}>Add Owned Set</h3>
          {(form.setNumber || form.name || form.theme || form.paidPrice || form.currentValue || form.notes) && (
            <button
              onClick={() => { setLookupData({}); setLookedUpNum(""); setForm({ setNumber: "", name: "", theme: "", condition: "new", qty: 1, paidPrice: "", msrp: "", currentValue: "", notes: "" }); setLookupMessage(""); setSetNumSuggestions([]); }}
              style={{ background: "transparent", color: "#5d6f80", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
              Reset
            </button>
          )}
        </div>

        {/* ── Mode toggle pill ── */}
        <div style={{ display: "inline-flex", background: "rgba(255,255,255,0.04)", borderRadius: 999, padding: 3, border: "1px solid rgba(255,255,255,0.07)", marginBottom: 16 }}>
          {[
            { label: "By Set Number", catalog: false },
            { label: "Search Catalog", catalog: true },
          ].map(m => (
            <button key={m.label}
              onClick={() => { setAddCatalogMode(m.catalog); if (!m.catalog) { setAddCatalogResults([]); setAddCatalogQuery(""); } }}
              style={{ background: addCatalogMode === m.catalog ? "#c9a84c" : "transparent", color: addCatalogMode === m.catalog ? "#0d1623" : "#8a9bb0", border: "none", borderRadius: 999, padding: "7px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13, transition: "all 0.15s" }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* ── Set number lookup ── */}
        {!addCatalogMode && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Set Number or Name</div>
            <div style={{ display: "flex", gap: 8, position: "relative" }}>
              <div style={{ flex: 1, position: "relative" }}>
                <input
                  placeholder="e.g. 75192 or Millennium Falcon"
                  value={form.setNumber}
                  onChange={e => {
                    const v = e.target.value;
                    const cleaned = String(v).replace(/-1$/, "").trim();
                    // If the number no longer matches the looked-up set, the prior
                    // result is stale — drop its metadata + auto-filled fields.
                    const stale = lookedUpNum && cleaned !== lookedUpNum;
                    setForm(prev => stale
                      ? { ...prev, setNumber: v, name: "", theme: "", msrp: "", currentValue: "" }
                      : { ...prev, setNumber: v });
                    setLookupMessage("");
                    setSetNumSuggestions([]);
                    if (stale) { setLookupData({}); setLookedUpNum(""); }
                  }}
                  onKeyDown={e => { if (e.key === "Enter") { setSetNumSuggestions([]); lookupSet(); } if (e.key === "Escape") setSetNumSuggestions([]); }}
                  style={{ width: "100%", background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)" }}
                  autoComplete="off"
                />
                {/* Autocomplete dropdown */}
                {(setNumSuggestions.length > 0 || setNumSuggestLoading) && (
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#0d1a2a", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, overflow: "hidden", zIndex: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                    {setNumSuggestLoading && (
                      <div style={{ padding: "10px 14px", fontSize: 13, color: "#5d6f80" }}>Searching…</div>
                    )}
                    {setNumSuggestions.map(s => {
                      const clean = String(s.setNumber || "").replace(/-1$/, "");
                      const inColl = sets.some(x => String(x.setNumber || "").replace(/-1$/, "") === clean);
                      return (
                        <div key={s.setNumber}
                          onMouseDown={e => {
                            e.preventDefault(); // keep focus on input
                            setForm(prev => ({ ...prev, setNumber: clean, name: s.name || prev.name, theme: s.theme || prev.theme, msrp: s.msrp ? String(s.msrp) : prev.msrp, currentValue: s.msrp ? String(s.msrp) : prev.currentValue }));
                            setSetNumSuggestions([]);
                            setTimeout(() => lookupSet(), 50);
                          }}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <img src={s.thumbnail || `https://images.brickset.com/sets/small/${clean}-1.jpg`} alt=""
                            onError={e => { e.currentTarget.style.display = "none"; }}
                            style={{ width: 44, height: 36, objectFit: "contain", borderRadius: 4, background: "#0b1520", flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: "#e8e2d5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                            <div style={{ fontSize: 11, color: "#5d6f80" }}>#{clean} · {s.theme} · {s.year}{s.pieces ? ` · ${s.pieces.toLocaleString()} pcs` : ""}{s.msrp ? ` · ${money(s.msrp)}` : ""}</div>
                          </div>
                          {inColl && <span style={{ fontSize: 10, color: "#c9a84c", fontWeight: 700, flexShrink: 0 }}>OWNED</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <button onClick={() => { setSetNumSuggestions([]); lookupSet(); }} disabled={lookupLoading}
                style={{ background: "transparent", color: lookupLoading ? "#5d6f80" : "#8a9bb0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "0 16px", fontWeight: 700, cursor: lookupLoading ? "default" : "pointer", fontSize: 13, whiteSpace: "nowrap" }}>
                {lookupLoading ? "Searching…" : "Look Up"}
              </button>
            </div>
            {lookupMessage && (
              <div style={{ marginTop: 8, fontSize: 13, color: lookupMessage.startsWith("Found") ? "#5aa832" : "#ff8b8b", display: "flex", alignItems: "center", gap: 6 }}>
                {lookupMessage.startsWith("Found") ? "✓" : "✗"} {lookupMessage}
              </div>
            )}
            {addDupeWarning === "collection" && (
              <div style={{ marginTop: 8, background: "rgba(30,64,175,0.12)", border: "1px solid rgba(30,64,175,0.35)", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#93c5fd" }}>
                ℹ Already in your collection — adding as a new entry
              </div>
            )}
            {addDupeWarning === "watchlist" && (
              <div style={{ marginTop: 8, background: "rgba(30,64,175,0.15)", border: "1px solid rgba(30,64,175,0.4)", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#93c5fd" }}>
                ℹ On your Wanted List — adding won't remove it from the list
              </div>
            )}
          </div>
        )}

        {/* ── Catalog search ── */}
        {addCatalogMode && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Search</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input placeholder="Set name or theme…" value={addCatalogQuery}
                onChange={e => setAddCatalogQuery(e.target.value)}
                style={{ flex: 1, background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)" }} autoFocus />
              {addCatalogLoading && <span style={{ color: "#8a9bb0", fontSize: 13, whiteSpace: "nowrap" }}>Searching…</span>}
            </div>
            {addCatalogError && <div style={{ color: "#ff8b8b", fontSize: 13, marginTop: 8 }}>{addCatalogError}</div>}
            {addCatalogResults.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, maxHeight: 380, overflowY: "auto", marginTop: 10 }}>
                {addCatalogResults.map(s => {
                  const clean = String(s.setNumber || "").replace(/-1$/, "");
                  const inColl = sets.some(x => String(x.setNumber || "").replace(/-1$/, "") === clean);
                  return (
                    <div key={s.setNumber}
                      onClick={() => {
                        setForm(prev => ({ ...prev, setNumber: clean, name: s.name || prev.name, theme: s.theme || prev.theme, msrp: s.msrp ? String(s.msrp) : prev.msrp, currentValue: s.msrp ? String(s.msrp) : prev.currentValue }));
                        setAddCatalogMode(false); setAddCatalogResults([]); setAddCatalogQuery("");
                        setTimeout(() => lookupSet(), 50);
                      }}
                      style={{ background: "#0f1a28", border: `1px solid ${inColl ? "rgba(234,179,8,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: 10, padding: 10, cursor: "pointer" }}
                      onMouseEnter={e => { e.currentTarget.style.border = "1px solid rgba(201,168,76,0.5)"; }}
                      onMouseLeave={e => { e.currentTarget.style.border = inColl ? "1px solid rgba(234,179,8,0.4)" : "1px solid rgba(255,255,255,0.07)"; }}
                    >
                      {s.thumbnail ? (
                        <img src={s.thumbnail} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
                          style={{ width: "100%", height: 72, objectFit: "contain", borderRadius: 6, background: "#0b1520", marginBottom: 6 }} />
                      ) : <div style={{ width: "100%", height: 72, borderRadius: 6, background: "#0b1520", marginBottom: 6 }} />}
                      <div style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.3, marginBottom: 3 }}>{s.name}</div>
                      <div style={{ color: "#5d6f80", fontSize: 11 }}>#{clean} · {s.year}</div>
                      {s.pieces && <div style={{ color: "#5d6f80", fontSize: 11 }}>{s.pieces.toLocaleString()} pcs</div>}
                      {s.msrp && <div style={{ color: "#c9a84c", fontWeight: 700, fontSize: 12, marginTop: 4 }}>{money(s.msrp)}</div>}
                      {inColl && <div style={{ color: "#fbbf24", fontSize: 11, marginTop: 2 }}>✓ Already owned</div>}
                    </div>
                  );
                })}
              </div>
            )}
            {addCatalogQuery.length >= 2 && !addCatalogLoading && addCatalogResults.length === 0 && !addCatalogError && (
              <div style={{ color: "#5d6f80", fontSize: 13, padding: "16px 0" }}>No results — try a different name.</div>
            )}
          </div>
        )}

        {/* ── Divider ── */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "4px 0 18px" }} />

        {/* ── Detail fields ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 16px", marginBottom: 20 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Set Name</span>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Millennium Falcon" style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", width: "100%" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Theme</span>
            <select value={form.theme} onChange={e => setForm({ ...form, theme: e.target.value })} style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", width: "100%", color: "#e8e2d5", borderRadius: 8, padding: "7px 10px", fontSize: 13 }}>
              <option value="">— select —</option>
              {themes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Condition</span>
            <select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value })} style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", width: "100%" }}>
              <option value="new">New</option>
              <option value="sealed">Sealed</option>
              <option value="used_as_new">Used — Like New</option>
              <option value="used_good">Used — Good</option>
              <option value="used_acceptable">Used — Acceptable</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Qty</span>
            <input type="number" min="1" step="1" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", width: "100%" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Paid Price</span>
            <input type="number" min="0" step="0.01" value={form.paidPrice} onChange={e => setForm({ ...form, paidPrice: e.target.value })} placeholder="0.00" style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", width: "100%" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>MSRP <span style={{ color: "#3d4f60", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— retail</span></span>
            <input type="number" min="0" step="0.01" value={form.msrp} onChange={e => setForm({ ...form, msrp: e.target.value })} placeholder="0.00" style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", width: "100%" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Current Value</span>
            <input type="number" min="0" step="0.01" value={form.currentValue} onChange={e => setForm({ ...form, currentValue: e.target.value })} placeholder="0.00" style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", width: "100%" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Notes <span style={{ color: "#3d4f60", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— optional</span></span>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Any notes about this set…" style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", width: "100%" }} />
          </label>
        </div>

        <button onClick={addSet} style={{ ...redBtn, width: "100%", padding: "13px", fontSize: 15, letterSpacing: 0.3 }}>
          Add to Collection
        </button>
      </section>
      )}

      <SetDetailPanel
        item={detailSet}
        valueMap={valueMap}
        onClose={() => { setDetailSet(null); setDetailSetIndex(null); }}
        onEdit={detailSetIndex !== null ? () => { setDetailSet(null); setDetailSetIndex(null); setSelectedSetIndex(detailSetIndex); } : undefined}
        onEditCopyCondition={detailSetIndex !== null && Array.isArray(detailSet?.entries) && detailSet.entries.length
          ? (copyIndex, bucket) => editCopyCondition(detailSetIndex, copyIndex, bucket)
          : undefined}
      />
      <WatchDetailPanel
        item={detailWatchItem}
        onClose={() => setDetailWatchItem(null)}
        onBuyNow={onBuyNow ? () => { setDetailWatchItem(null); onBuyNow(detailWatchItem); } : undefined}
      />

      {hoveredSet && (
        <RowHoverCard
          set={hoveredSet}
          retail={retailFor(hoveredSet)}
          market={setValueProvenance(hoveredSet, valueMap)}
          tipPos={tipPos}
        />
      )}

      {hoveredWatchItem && (
        <div style={{ position: "fixed", left: tipPos.x > window.innerWidth - 280 ? tipPos.x - 256 : tipPos.x + 16, top: tipPos.y > window.innerHeight - 230 ? tipPos.y - 215 : tipPos.y - 8, zIndex: 9999, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "10px 14px", pointerEvents: "none", boxShadow: "0 8px 32px rgba(0,0,0,0.55)", minWidth: 240 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <img src={setImageUrl(hoveredWatchItem.setNumber)} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
              style={{ width: 72, height: 72, objectFit: "contain", borderRadius: 8, background: "#111d2e", border: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: "#e8e2d5", marginBottom: 6, fontSize: 13 }}>{hoveredWatchItem.name || hoveredWatchItem.setNumber || "Set"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: 12 }}>
                {hoveredWatchItem.setNumber && <><span style={{ color: "#5d6f80" }}>Set #</span><span style={{ color: "#e8e2d5" }}>{hoveredWatchItem.setNumber}</span></>}
                {hoveredWatchItem.theme && <><span style={{ color: "#5d6f80" }}>Theme</span><span style={{ color: "#e8e2d5" }}>{hoveredWatchItem.theme}</span></>}
                {hoveredWatchItem.msrp > 0 && <><span style={{ color: "#5d6f80" }}>MSRP</span><span style={{ color: "#c9a84c", fontWeight: 700 }}>{money(hoveredWatchItem.msrp)}</span></>}
                {hoveredWatchItem.targetPrice > 0 && <><span style={{ color: "#5d6f80" }}>Target</span><span style={{ color: "#e8e2d5" }}>{money(hoveredWatchItem.targetPrice)}</span></>}
                {hoveredWatchItem.status && <><span style={{ color: "#5d6f80" }}>Status</span><span style={{ color: hoveredWatchItem.status === "Critical" ? "#ef4444" : hoveredWatchItem.status === "Buy Soon" ? "#f59e0b" : "#e8e2d5" }}>{hoveredWatchItem.status}</span></>}
                <span style={{ color: "#5d6f80" }}>Score</span><span style={{ color: "#e8e2d5", fontWeight: 700 }}>{hoveredWatchItem._score}</span>
                {hoveredWatchItem.retiringSoon && <><span style={{ color: "#5d6f80" }}>Retiring</span><span style={{ color: "#f59e0b" }}>⚠ Soon</span></>}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#5d6f80", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>click for details</div>
        </div>
      )}

      {tab === "collection" && retirementAlertsForOwned.length > 0 && (
        <div style={{ background: "#1a0a00", border: "1px solid #92400e", borderRadius: 12, padding: "14px 16px", marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 800, color: "#f59e0b", fontSize: 14 }}>
              ⚠ {retirementAlertsForOwned.length} owned {retirementAlertsForOwned.length === 1 ? "set" : "sets"} retiring soon — sell window open
            </div>
            <button
              onClick={() => { const codes = retirementAlertsForOwned.map(s => String(s.setNumber || "").replace(/-1$/, "")); setRetireDismissed(prev => [...new Set([...prev, ...codes])]); }}
              style={{ background: "none", border: "none", color: "#8a9bb0", cursor: "pointer", fontSize: 18, fontWeight: 900, flexShrink: 0, padding: "0 4px" }}
            >×</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {retirementAlertsForOwned.slice(0, 5).map(s => {
              const qty   = asNumber(s.qty) || 1;
              const paid  = asNumber(s.totalPaid)  || asNumber(s.paidPrice)    * qty;
              // Value through the funnel: null when unknown (never a phantom $0), and
              // gain/roi derive off THAT, not a separate inline read. (Workstream A)
              const value = setValueProvenance(s, valueMap).amount;
              const gain  = value !== null && paid > 0 ? value - paid : null;
              const roi   = gain !== null && paid > 0 ? (gain / paid) * 100 : null;
              const clean = String(s.setNumber || "").replace(/-1$/, "");
              const blUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${clean}-1#T=S&O={"ss":"US"}`;
              return (
                <div key={s.setNumber} style={{ background: "#2a0d00", border: "1px solid #78350f", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#e8e2d5", fontSize: 13, marginBottom: 5 }}>
                      {s.name || s.setNumber}
                      <span style={{ marginLeft: 8, fontSize: 11, color: "#8a9bb0", fontWeight: 400 }}>#{clean}</span>
                    </div>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                      {paid  > 0 && <span style={{ fontSize: 12, color: "#8a9bb0" }}>Paid <strong style={{ color: "#e8e2d5" }}>{money(paid)}</strong></span>}
                      {value !== null && <span style={{ fontSize: 12, color: "#8a9bb0" }}>Market <strong style={{ color: "#c9a84c" }}>{formatValue(value)}</strong></span>}
                      {gain !== null && roi !== null && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: gain >= 0 ? "#5aa832" : "#ff8b8b" }}>
                          {gain >= 0 ? "+" : ""}{money(gain)} ({roi >= 0 ? "+" : ""}{roi.toFixed(1)}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: s.alertType === "lastchance" ? "#ef4444" : "#f59e0b" }}>
                      {s.alertType === "lastchance" ? "🚨 Last Chance" : `${s.days}d left`}
                    </span>
                    <a href={blUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: "#3b82f6", textDecoration: "none", fontWeight: 700 }}>
                      Sell on BrickLink ↗
                    </a>
                  </div>
                </div>
              );
            })}
            {retirementAlertsForOwned.length > 5 && (
              <div style={{ fontSize: 12, color: "#8a9bb0", padding: "4px 2px" }}>
                +{retirementAlertsForOwned.length - 5} more sets retiring soon
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "collection" && (
      <section style={panel}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14
        }}>
          <h3 style={{ margin: 0 }}>Owned Sets</h3>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              placeholder="Search owned sets..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={searchInput}
            />
            <select value={filterTheme} onChange={e => setFilterTheme(e.target.value)} style={filterSelect}>
              <option value="">All Themes</option>
              {themes.map(theme => <option key={theme}>{theme}</option>)}
            </select>
            {sets.length > 0 && (
              <select value={filterCondition} onChange={e => setFilterCondition(e.target.value)} style={filterSelect}>
                <option value="">All Conditions</option>
                {["new", "used", "mixed"].map(b => <option key={b} value={b}>{conditionDisplayLabel(b)}</option>)}
              </select>
            )}
            {(searchText || filterTheme || filterCondition) && (
              <button onClick={() => { setSearchText(""); setFilterTheme(""); setFilterCondition(""); }} style={clearFilterButton}>
                Clear
              </button>
            )}
            {/* Sort control trimmed (MC-Browse polish F4) to its one non-redundant option, "Recently
                Added" (addedAt has no column, so it can't be header-sorted). Every other sort is reached
                by clicking a column header; when one is active the select reflects that with a disabled
                placeholder instead of falsely reading "Recently Added". */}
            <select
              value={sortColumn === "addedAt" ? "addedAt:desc" : ""}
              onChange={e => { if (e.target.value === "addedAt:desc") { setSortColumn("addedAt"); setSortDirection("desc"); } }}
              style={filterSelect}
              title="Sort by most recently added — for any other column, click its header"
            >
              <option value="" disabled>Sorted by column ↑↓</option>
              <option value="addedAt:desc">Recently Added</option>
            </select>
            <button
              onClick={enrichFromRebrickable}
              disabled={rbEnriching}
              title={rbEnrichResult !== null
                ? `Last run: ${rbEnrichResult} fields filled — click to re-run`
                : "Fill missing pieces / theme / name from local Rebrickable catalog (no API call)"}
              style={{
                background: rbEnrichResult ? "rgba(90,168,50,0.08)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${rbEnrichResult ? "rgba(90,168,50,0.25)" : "rgba(255,255,255,0.1)"}`,
                color: rbEnriching ? "#5d6f80" : rbEnrichResult ? "#5aa832" : "#8a9bb0",
                borderRadius: 8, padding: "5px 10px", cursor: rbEnriching ? "not-allowed" : "pointer",
                fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
              }}
            >
              {rbEnriching ? "…" : rbEnrichResult !== null ? `✓ Filled (${rbEnrichResult})` : "Rebrickable Fill"}
            </button>
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.1)", alignSelf: "center", margin: "0 2px", flexShrink: 0 }} />
            <div style={{ display: "flex", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, overflow: "hidden", flexShrink: 0 }} title="Row density — compact shows Market only (MSRP / Paid on hover); full shows all three">
              {[["compact", "Compact"], ["full", "Full"]].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setRowDensity(val)}
                  style={{ background: rowDensity === val ? "rgba(201,168,76,0.15)" : "transparent", color: rowDensity === val ? "#c9a84c" : "#8a9bb0", border: "none", padding: "5px 9px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setOwnedColumnsOpen(prev => !prev)}
                style={{ ...hoverCtrlBtn, color: ownedColumnsOpen ? "#c9a84c" : "#8a9bb0", padding: "5px 8px", display: "flex", alignItems: "center" }}
                title={`Column visibility — ${ownedColumns.filter(c => c.visible).length} of ${ownedColumns.length} shown`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <rect x="0" y="0" width="14" height="3" rx="1"/>
                  <rect x="0" y="5" width="3.5" height="9" rx="1"/>
                  <rect x="5.25" y="5" width="3.5" height="9" rx="1"/>
                  <rect x="10.5" y="5" width="3.5" height="9" rx="1"/>
                </svg>
              </button>
              {ownedColumnsOpen && (
              <>
                <div onClick={() => setOwnedColumnsOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 39 }} />
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "12px 16px", minWidth: 190, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Columns</span>
                    <button onClick={() => setColumnWidths({ ...OWNED_COL_WIDTHS })} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#8a9bb0", fontSize: 11, cursor: "pointer", padding: "2px 7px" }} title="Reset all column widths to defaults">Reset widths</button>
                  </div>
                  {ownedColumns.map((col, i) => (
                    <div key={col.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, cursor: "pointer", color: col.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                        <input type="checkbox" checked={col.visible} onChange={() => toggleOwnedColumn(col.key)} style={{ accentColor: "#c9a84c" }} />
                        {col.label}
                      </label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <button onClick={() => moveOwnedColumn(col.key, -1)} disabled={i === 0} style={{ background: "none", border: "none", color: i === 0 ? "#2a3a4a" : "#8a9bb0", cursor: i === 0 ? "default" : "pointer", padding: "0 2px", fontSize: 10, lineHeight: 1 }}>▲</button>
                        <button onClick={() => moveOwnedColumn(col.key, 1)} disabled={i === ownedColumns.length - 1} style={{ background: "none", border: "none", color: i === ownedColumns.length - 1 ? "#2a3a4a" : "#8a9bb0", cursor: i === ownedColumns.length - 1 ? "default" : "pointer", padding: "0 2px", fontSize: 10, lineHeight: 1 }}>▼</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
              )}
            </div>
          </div>
        </div>

        {sets.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={visibleSets.length > 0 && visibleSets.every(set => checkedSets.includes(sets.indexOf(set)))}
              onChange={toggleAll}
            />
            Check All
          </label>

          {checkedSets.length > 0 && (
            <button
              onClick={deleteCheckedSets}
              style={{
                background: "#7f1d1d",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "8px 12px",
                cursor: "pointer",
                fontWeight: 800
              }}
            >
              Delete Selected ({checkedSets.length})
            </button>
          )}
        </div>
        )}

        {sets.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 20px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 12, marginTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#8a9bb0", marginBottom: 6 }}>Your collection is empty</div>
            <div style={{ fontSize: 13, color: "#5d6f80" }}>Sync from BrickEconomy in Settings → Data, or use the form above to add your first set.</div>
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: selectedSetIndex !== null ? "1fr 380px" : "1fr",
            gap: 16,
            alignItems: "start"
          }}>
            {(() => {
              const visibleCols = ownedColumns.filter(c => c.visible);
              const defaultTotalW = 36 + visibleCols.reduce((s, c) => s + (OWNED_COL_WIDTHS[c.key] ?? 80), 0);
              const currentTotalW = 36 + visibleCols.reduce((s, c) => s + (columnWidths[c.key] ?? 80), 0);
              // Only show horizontal scrollbar when the user has deliberately expanded columns beyond defaults.
              // This hides the 3px browser-rounding artifact from table-layout:fixed + width:100%.
              const needsHScroll = currentTotalW > defaultTotalW + 10;
              return (
            <div className="owned-table-scroll" style={{ overflowX: needsHScroll ? "auto" : "clip" }}>
            <div className="owned-table-scroll" style={{ overflowY: "auto", maxHeight: 560 }}>
              <table style={{
                borderCollapse: "collapse", tableLayout: "fixed", width: "100%",
                minWidth: currentTotalW
              }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 5 }}>
                <tr>
                  <th style={{ ...th, width: 36 }}></th>
                  {ownedColumns.filter(col => col.visible).map(col => (
                    <th
                      key={col.key}
                      draggable
                      onDragStart={e => {
                        if (e.target !== e.currentTarget) { e.preventDefault(); return; }
                        setDraggedOwnedColumn(col.key);
                      }}
                      onDragEnd={() => setDraggedOwnedColumn(null)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => dropOwnedColumn(col.key)}
                      style={{
                        ...(isNumericOwnedColumn(col.key) ? thRightButton : thButton),
                        opacity: draggedOwnedColumn === col.key ? 0.45 : 1,
                        width: columnWidths[col.key] ?? 80,
                        position: "relative",
                        overflow: "hidden",
                      }}
                      onClick={() => sortHeader(col.key)}
                      title="Click to sort · Drag label to reorder · Drag right edge to resize"
                    >
                      <span style={{ color: "rgba(255,255,255,0.22)", fontSize: 9, marginRight: 3, letterSpacing: -1 }}>⠿</span>
                      {sortLabel(col.label, col.key)}
                      <div
                        onMouseDown={e => startResize(col.key, e)}
                        onClick={e => e.stopPropagation()}
                        style={{
                          position: "absolute", right: 0, top: 0, bottom: 0, width: 7,
                          cursor: "col-resize", zIndex: 10,
                          borderRight: "2px solid transparent",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderRightColor = "rgba(201,168,76,0.6)"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderRightColor = "transparent"; }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {visibleSets.map((set) => {
                  const index = sets.indexOf(set);
                  const qty = asNumber(set.qty) || 1;
                  const paid = asNumber(set.paidPrice) * qty;
                  const value = asNumber(set.currentValue) * qty;
                  const gain = value - paid;

                  return (
                    <tr
                      key={`${set.setNumber}-${index}`}
                      onClick={() => { setDetailSet(openSetDetail(set.setNumber) || set); setDetailSetIndex(index); }}
                      onMouseEnter={e => {
                        if (selectedSetIndex !== index) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                        setHoveredSet(set);
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = selectedSetIndex === index ? "#332500" : "transparent";
                        setHoveredSet(null);
                      }}
                      style={{
                        cursor: "pointer",
                        background: selectedSetIndex === index ? "#332500" : "transparent",
                        transition: "background 0.12s ease"
                      }}
                    >
                      <td style={{ ...td, ...stickyCheckbox, borderLeft: hoveredSet === set ? "2px solid #c9a84c" : "2px solid transparent", transition: "border-color 0.12s ease" }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checkedSets.includes(index)}
                          onChange={() => toggleChecked(index)}
                        />
                      </td>

                      {ownedColumns.filter(col => col.visible).map(col => {
                        // Thumbnail image column
                        if (col.key === "thumb") {
                          const imgUrl = set.thumbnail || setImageUrl(set.setNumber);
                          return (
                            <td key="thumb" style={{ ...td, padding: "2px 6px", width: 52, minWidth: 52 }}>
                              <img
                                src={imgUrl}
                                alt=""
                                style={{ width: 44, height: 32, objectFit: "contain", borderRadius: 4, display: "block" }}
                                onError={e => { e.currentTarget.style.opacity = "0"; }}
                              />
                            </td>
                          );
                        }

                        // Condition — New / Used / Mixed pill (double-click to edit)
                        if (col.key === "condition") {
                          const isEditing = inlineEdit?.index === index && inlineEdit?.key === "condition";
                          const display = setConditionDisplay(set);            // 'new' | 'used' | 'mixed'
                          const color = conditionDisplayColor(display);        // green / amber / indigo
                          // Inline editor is still binary New/Used (the entries[]-aware edit is a later step).
                          const editVal = display === "used" ? "used" : "new";
                          const editColor = conditionDisplayColor(editVal);
                          if (isEditing) {
                            return (
                              <td key="condition" style={td} onClick={e => e.stopPropagation()}>
                                <select
                                  autoFocus
                                  value={editVal}
                                  onChange={e => { updateSet(index, "condition", e.target.value); setInlineEdit(null); }}
                                  onBlur={() => setInlineEdit(null)}
                                  onKeyDown={e => { if (e.key === "Escape") setInlineEdit(null); }}
                                  style={{ background: `${editColor}18`, color: editColor, border: `1px solid ${editColor}50`, borderRadius: 10, padding: "2px 6px", fontSize: 11, fontWeight: 700, cursor: "pointer", outline: "none" }}
                                >
                                  <option value="new">New</option>
                                  <option value="used">Used</option>
                                </select>
                              </td>
                            );
                          }
                          return (
                            <td key="condition" style={{ ...td, cursor: "default" }}
                              onClick={e => e.stopPropagation()}
                              onDoubleClick={e => { e.stopPropagation(); setInlineEdit({ index, key: "condition", value: editVal }); }}
                            >
                              <span style={{ background: `${color}18`, color, border: `1px solid ${color}50`, borderRadius: 10, padding: "2px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}>
                                {display === "new" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0, animation: "pulse-dot 2s ease-in-out infinite" }} />}
                                {conditionDisplayLabel(display)}
                              </span>
                            </td>
                          );
                        }

                        // Qty — double-click to edit inline
                        if (col.key === "qty") {
                          const isEditing = inlineEdit?.index === index && inlineEdit?.key === "qty";
                          const qty = asNumber(set.qty) || 1;
                          if (isEditing) {
                            return (
                              <td key="qty" style={tdRight} onClick={e => e.stopPropagation()}>
                                <input
                                  autoFocus
                                  type="number"
                                  min="1"
                                  value={inlineEdit.value}
                                  onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))}
                                  onBlur={() => { updateSet(index, "qty", inlineEdit.value); setInlineEdit(null); }}
                                  onKeyDown={e => {
                                    if (e.key === "Enter")  { updateSet(index, "qty", inlineEdit.value); setInlineEdit(null); }
                                    if (e.key === "Escape") setInlineEdit(null);
                                  }}
                                  style={{ width: 50, background: "#0d1a2a", border: "1px solid rgba(201,168,76,0.5)", borderRadius: 6, color: "#e8e2d5", fontSize: 13, padding: "2px 6px", outline: "none", textAlign: "right" }}
                                />
                              </td>
                            );
                          }
                          return (
                            <td key="qty" style={{ ...tdRight, cursor: "default" }}
                              onClick={e => e.stopPropagation()}
                              onDoubleClick={e => { e.stopPropagation(); setInlineEdit({ index, key: "qty", value: String(qty) }); }}
                            >
                              {qty}
                            </td>
                          );
                        }

                        // ROI — tinted badge
                        if (col.key === "roi") {
                          const label = renderOwnedCell(set, col);
                          const roiColor = String(label).startsWith("-") ? "#ff8b8b" : String(label).startsWith("+") ? "#5aa832" : "#8a9bb0";
                          return (
                            <td key="roi" style={tdRight}>
                              {label !== "—"
                                ? <span style={{ background: `${roiColor}1a`, color: roiColor, borderRadius: 6, padding: "2px 7px", fontSize: 12, fontWeight: 700 }}>{label}</span>
                                : <span style={{ color: "#5d6f80" }}>—</span>}
                            </td>
                          );
                        }

                        return (
                          <td
                            key={col.key}
                            style={
                              col.key === "name"
                                ? { ...td, overflow: "hidden", textOverflow: "ellipsis" }
                                : col.key === "gain"
                                ? { ...tdRight, color: gain >= 0 ? "#5aa832" : "#ff8b8b" }
                                : isNumericOwnedColumn(col.key)
                                ? tdRight
                                : td
                            }
                          >
                            {col.key === "name"
                              ? <span style={{ color: hoveredSet === set ? "#c9a84c" : undefined, transition: "color 0.15s" }}>{renderOwnedCell(set, col)}</span>
                              : renderOwnedCell(set, col)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
            </div>
              ); // end IIFE return
            })()} {/* end IIFE for scroll/width calc */}

            {selectedSetIndex !== null && sets[selectedSetIndex] && (
              <div style={{ ...editPanel, position: "sticky", top: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#e8e2d5" }}>Edit Set</h3>
                  <button onClick={() => setSelectedSetIndex(null)} style={circleButton}>×</button>
                </div>

                {(() => {
                  const s = sets[selectedSetIndex];
                  const lbl = { fontSize: 10, fontWeight: 700, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5, display: "block" };
                  const inp = { width: "100%", background: "#0d1a2a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5", fontSize: 13, padding: "7px 10px", outline: "none", boxSizing: "border-box" };
                  const row = { display: "grid", gap: 10, marginBottom: 10 };
                  const isUsed = String(s.condition || "new").startsWith("used");
                  return (
                    <div>
                      {/* Row 1: Set # + Set Name */}
                      <div style={{ ...row, gridTemplateColumns: "110px 1fr" }}>
                        <label><span style={lbl}>Set #</span><input style={inp} value={s.setNumber || ""} onChange={e => updateSet(selectedSetIndex, "setNumber", e.target.value)} /></label>
                        <label><span style={lbl}>Set Name</span><input style={inp} value={s.name || ""} onChange={e => updateSet(selectedSetIndex, "name", e.target.value)} /></label>
                      </div>

                      {/* Row 2: Theme + Condition toggle */}
                      <div style={{ ...row, gridTemplateColumns: "1fr auto" }}>
                        <label>
                          <span style={lbl}>Theme</span>
                          <select style={inp} value={s.theme || ""} onChange={e => updateSet(selectedSetIndex, "theme", e.target.value)}>
                            <option value="">— select —</option>
                            {themes.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </label>
                        <label>
                          <span style={lbl}>Condition</span>
                          <div style={{ display: "flex", gap: 4, marginTop: 1 }}>
                            {[["new","New","#5aa832"],["used","Used","#f59e0b"]].map(([val, label, color]) => (
                              <button key={val}
                                onClick={() => updateSet(selectedSetIndex, "condition", val)}
                                style={{ border: `1px solid ${(!isUsed && val==="new") || (isUsed && val==="used") ? color : "rgba(255,255,255,0.1)"}`, borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: (!isUsed && val==="new") || (isUsed && val==="used") ? `${color}22` : "transparent", color: (!isUsed && val==="new") || (isUsed && val==="used") ? color : "#5d6f80", transition: "all 0.12s" }}
                              >{label}</button>
                            ))}
                          </div>
                        </label>
                      </div>

                      {/* Row 3: Qty + Paid + Current Value + MSRP */}
                      <div style={{ ...row, gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
                        <label><span style={lbl}>Qty</span><input style={inp} type="number" min="1" value={s.qty || 1} onChange={e => updateSet(selectedSetIndex, "qty", e.target.value)} /></label>
                        <label><span style={lbl}>Paid</span><input style={inp} type="number" step="0.01" value={s.paidPrice || ""} onChange={e => updateSet(selectedSetIndex, "paidPrice", e.target.value)} /></label>
                        <label><span style={lbl}>Value</span><input style={inp} type="number" step="0.01" value={s.currentValue || ""} onChange={e => updateSet(selectedSetIndex, "currentValue", e.target.value)} /></label>
                        <label><span style={lbl}>MSRP</span><input style={inp} type="number" min="0" step="0.01" value={s.msrp || ""} onChange={e => updateSet(selectedSetIndex, "msrp", e.target.value)} /></label>
                      </div>

                      {/* Row 4: Acquired Date + Notes */}
                      <div style={{ ...row, gridTemplateColumns: "1fr 1fr" }}>
                        <label><span style={lbl}>Acquired</span><input style={inp} type="date" value={s.acquiredDate || ""} onChange={e => updateSet(selectedSetIndex, "acquiredDate", e.target.value)} /></label>
                        <label><span style={lbl}>Notes</span><input style={inp} value={s.notes || ""} onChange={e => updateSet(selectedSetIndex, "notes", e.target.value)} /></label>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  <button onClick={() => setSelectedSetIndex(null)}>Done</button>
                  <button
                    onClick={() => { setSellModal(v => !v); setSellPrice(""); setSellNotes(""); }}
                    style={{ background: "transparent", border: "1px solid rgba(239,68,68,0.4)", color: "#ef4444", borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                  >Mark as Sold</button>
                </div>

                {sellModal && (
                  <div style={{ marginTop: 14, background: "#0f1a28", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: 14 }}>
                    <div style={{ fontWeight: 800, color: "#ef4444", marginBottom: 10, fontSize: 13 }}>Log Sale</div>
                    <div style={formGrid}>
                      <label>
                        Sold Price ($)
                        <input type="number" step="0.01" placeholder="e.g. 349.99" value={sellPrice} onChange={e => setSellPrice(e.target.value)} />
                      </label>
                      <label>
                        Sold Date
                        <input type="date" value={sellDate} onChange={e => setSellDate(e.target.value)} />
                      </label>
                      <label style={{ gridColumn: "1 / -1" }}>
                        Notes (optional)
                        <input placeholder="Platform, buyer, etc." value={sellNotes} onChange={e => setSellNotes(e.target.value)} />
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button onClick={() => logSale(selectedSetIndex)} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 10, padding: "8px 18px", fontWeight: 800, cursor: "pointer" }}>
                        Confirm Sale
                      </button>
                      <button onClick={() => setSellModal(false)} style={ghostBtn}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {/* ── Purchase Log Modal ──────────────────────────────────────────────── */}
      {purchaseModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setPurchaseModal(null); }}>
          <div style={{ background: "#0d1a2a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 24, width: "100%", maxWidth: 440, boxShadow: "0 16px 48px rgba(0,0,0,0.7)" }}>
            {/* Header */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Log Purchase</div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#e8e2d5" }}>{purchaseModal.name || purchaseModal.setNumber}</div>
              <div style={{ fontSize: 12, color: "#5d6f80", marginTop: 2 }}>
                #{purchaseModal.setNumber} · Qty {purchaseModal.qty} · {money(purchaseModal.price)} ea
              </div>
            </div>

            {/* Fields */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5, gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Store</span>
                <select value={pmForm.store} onChange={e => setPmForm(p => ({ ...p, store: e.target.value }))}
                  style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "#e8e2d5", padding: "8px 10px", fontSize: 14, width: "100%" }}>
                  <option value="">— select store —</option>
                  {savedStores.map(s => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Date</span>
                <input type="date" value={pmForm.date} onChange={e => setPmForm(p => ({ ...p, date: e.target.value }))}
                  style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "#e8e2d5", padding: "8px 10px", fontSize: 14, width: "100%" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Order #</span>
                <input placeholder="optional" value={pmForm.orderLabel} onChange={e => setPmForm(p => ({ ...p, orderLabel: e.target.value }))}
                  style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "#e8e2d5", padding: "8px 10px", fontSize: 14, width: "100%" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Tax / Fee</span>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={pmForm.tax} onChange={e => setPmForm(p => ({ ...p, tax: e.target.value }))}
                  style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "#e8e2d5", padding: "8px 10px", fontSize: 14, width: "100%" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>Shipping</span>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={pmForm.shipping} onChange={e => setPmForm(p => ({ ...p, shipping: e.target.value }))}
                  style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "#e8e2d5", padding: "8px 10px", fontSize: 14, width: "100%" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6 }}>GC / Rewards</span>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={pmForm.gc} onChange={e => setPmForm(p => ({ ...p, gc: e.target.value }))}
                  style={{ background: "#0f1c2e", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "#e8e2d5", padding: "8px 10px", fontSize: 14, width: "100%" }} />
              </label>
            </div>

            {/* Total preview */}
            {(() => {
              const total    = Math.round((purchaseModal.price * purchaseModal.qty + (asNumber(pmForm.tax) || 0) + (asNumber(pmForm.shipping) || 0)) * 100) / 100;
              const cashPaid = Math.max(0, Math.round((total - (asNumber(pmForm.gc) || 0)) * 100) / 100);
              return (
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "10px 14px", marginBottom: 18, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span style={{ color: "#5d6f80" }}>Total</span><span style={{ color: "#e8e2d5", fontWeight: 700 }}>{money(total)}</span>
                  <span style={{ color: "#5d6f80", marginLeft: 16 }}>Cash Paid</span><span style={{ color: "#c9a84c", fontWeight: 700 }}>{money(cashPaid)}</span>
                </div>
              );
            })()}

            {/* Actions */}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={commitPurchaseLog} style={{ ...redBtn, flex: 1, padding: "11px", fontSize: 14, fontWeight: 700 }}>
                Log Purchase
              </button>
              <button onClick={() => setPurchaseModal(null)}
                style={{ flex: 1, padding: "11px", fontSize: 14, fontWeight: 700, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, color: "#8a9bb0", cursor: "pointer" }}>
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, value, good, sub }) {
  const [tip, setTip] = useState(false);
  const accentColor = good === undefined ? "#c9a84c" : good ? "#5aa832" : "#ff8b8b";
  return (
    <div style={{
      ...panel, marginTop: 0, overflow: "hidden",
      minHeight: 88,
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      padding: "14px 16px",
      borderLeft: `3px solid ${accentColor}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
      <div style={{ position: "relative" }} onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
        <div style={{ fontSize: 22, fontWeight: 900, color: good === undefined ? "#e8e2d5" : good ? "#5aa832" : "#ff8b8b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "default", lineHeight: 1.1 }}>
          {value}
        </div>
        {tip && <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, zIndex: 50, background: "#0b1520", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 8, padding: "5px 10px", fontSize: 15, fontWeight: 700, color: "#e8e2d5", whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.5)", pointerEvents: "none" }}>{value}</div>}
      </div>
      <div style={{ fontSize: 11, color: "#3d4f60", minHeight: 14 }}>{sub || ""}</div>
    </div>
  );
}

const page = { background: "transparent", color: "#e8e2d5", minHeight: "100vh", padding: 22 };
const tabHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 8 };
const tabBar = { display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" };
const tabBtnStyle = { background: "none", border: "none", borderBottom: "2px solid transparent", color: "#5d6f80", padding: "8px 0 10px", fontWeight: 700, cursor: "pointer", fontSize: 14, lineHeight: 1 };
const activeTabStyle = { ...tabBtnStyle, color: "#e8e2d5", borderBottom: "2px solid #c9a84c" };
const addSetBtn = { background: "none", border: "1px solid rgba(90,168,50,0.3)", borderRadius: 8, color: "#5aa832", padding: "5px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const addSetBtnActive = { ...addSetBtn, background: "#1a3a1a", border: "1px solid #2d5a2d" };
const metricGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14, marginTop: 20 };
const overviewGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginTop: 14 };
const panel = { background: "rgba(20,31,48,0.82)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 20, marginTop: 18, boxShadow: "0 4px 24px rgba(0,0,0,0.35)" };
const formGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 };
const muted = { color: "#8a9bb0" };
const mutedSmall = { color: "#8a9bb0", fontSize: 13 };
const redBtn = { display: "inline-block", background: "#c9a84c", color: "#0d1623", border: "none", borderRadius: 10, padding: "10px 14px", fontWeight: 800, cursor: "pointer" };
const ghostBtn = { background: "transparent", color: "#8a9bb0", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", fontWeight: 800, cursor: "pointer" };
const th = {
  background: "#0b1520",
  color: "#8a9bb0",
  padding: "10px 10px 10px 10px",
  textAlign: "left",
  borderBottom: "1px solid rgba(255,255,255,0.07)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: 0.5,
  textTransform: "uppercase"
};
const thButton = { ...th, cursor: "pointer", userSelect: "none" };
const thRight = { ...th, textAlign: "right" };
const thRightButton = { ...thRight, cursor: "pointer", userSelect: "none" };
const editPanel = {
  background: "rgba(15,26,40,0.9)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14,
  padding: 18
};

const circleButton = {
  border: "none",
  background: "#1a2840",
  color: "#e8e2d5",
  borderRadius: 999,
  width: 32,
  height: 32,
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 16
};

const td = {
  padding: 10,
  borderTop: "1px solid rgba(255,255,255,0.05)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis"
};
const tdRight = { ...td, textAlign: "right", fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" };

const stickyCheckbox = {
  position: "sticky",
  left: 0,
  zIndex: 6,
  background: "#0b1520"
};

const thStyle = { color: "#8a9bb0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", whiteSpace: "nowrap" };
const tdStyle  = { padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
const tdStyleR = { ...tdStyle, textAlign: "right", fontWeight: 700 };

const hoverCtrlBtn = {
  background: "rgba(11,21,32,0.92)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 6,
  color: "#8a9bb0",
  fontSize: 13,
  cursor: "pointer",
  padding: "3px 8px",
  fontWeight: 700,
  lineHeight: 1.2
};
