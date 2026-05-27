import { useEffect, useMemo, useRef, useState } from "react";
import { searchInput, filterSelect, clearFilterButton, filterBar } from "./uiStyles";
import { DEFAULT_OWNED_COLUMNS } from "./utils/columnDefaults";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, AreaChart, Area, CartesianGrid } from "recharts";
import SetDetailPanel, { openSetDetail } from "./SetDetailPanel";
import { asNumber, money, setImageUrl, CONDITION_LABELS, conditionColor, priorityScore, recommendation, daysUntilRetirement, lineCashPaid } from "./utils/formatting";
import { fetchBrickLinkPriceGuide, hasBrickLinkAuth } from "./utils/bricklink-client";
import { searchBricksetCatalog } from "./utils/brickset";
import WatchDetailPanel from "./WatchDetailPanel";

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
  { key: "retailValue",  type: "card",  label: "Retail Value",     visible: false, width: "auto",  collapsed: false },
  { key: "newValue",     type: "card",  label: "New Sets Value",   visible: false, width: "auto",  collapsed: false },
  { key: "usedValue",    type: "card",  label: "Used Sets Value",  visible: false, width: "auto",  collapsed: false },
  { key: "watchList",    type: "card",  label: "Wanted List",      visible: false, width: "auto",  collapsed: false },
  { key: "retiringSoon", type: "card",  label: "Retiring Soon",    visible: false, width: "auto",  collapsed: false },
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
  paid:         82,
  value:        86,
  gain:         82,
  roi:          62,
  minifigs:     68,
  acquiredDate: 90,
  retiredDate:  90,
  releasedDate: 90,
  blSoldNew:    92,
  blSoldUsed:   92,
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
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const [chartTypes, setChartTypes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blCollChartTypes") || "{}"); } catch { return {}; }
  });
  const [collPillsCollapsed, setCollPillsCollapsed] = useState(false);
  const [collGearOpen, setCollGearOpen] = useState(false);
  const [hoveredCollItem, setHoveredCollItem] = useState(null);
  const [draggedCollItem, setDraggedCollItem] = useState(null);
  const [collectionItems, setCollectionItems] = useState(() => {
    const saved = localStorage.getItem("blCollectionItems");
    if (!saved) return DEFAULT_COLLECTION_ITEMS;
    const parsed = JSON.parse(saved);
    // Migration: remove retired keys, carry forward their visibility into replacement
    const legacyVisible = new Set(parsed.filter(c => c.visible).map(c => c.key));
    const REMOVED_KEYS = new Set(["newSets", "usedSets"]);
    const filtered = parsed.filter(c => !REMOVED_KEYS.has(c.key));
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
    const merged = parsed.map(c => ({ ...c, label: labelMap[c.key] ?? c.label }));
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
        beItems = JSON.parse(brickEconomySaved).map(item => {
          const entries = item.entries || [];
          const entryConditions = [...new Set(entries.map(e => e.condition).filter(Boolean))];
          const condition = entryConditions.length === 1 ? entryConditions[0] : entryConditions.length > 1 ? "mixed" : null;
          // Pull per-entry fields — same across copies for set attributes; pick latest acquired
          const acquiredDates = entries.map(e => e.aquired_date || e.acquired_date).filter(Boolean).sort();
          return {
            setNumber:    item.setNumber,
            name:         item.name,
            theme:        item.theme,
            qty:          item.quantity,
            paidPrice:    item.averagePaid,
            currentValue: item.totalValue,
            totalPaid:    item.totalPaid,
            totalValue:   item.totalValue,
            roiPct:       item.roiPct,
            retired:      item.retired,
            condition,
            entries,
            source:       "BrickEconomy",
            // Fields from BE entry data
            minifigs:     entries[0]?.minifigs_count ?? null,
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

    // Merge: append manual items whose set number isn't already in BE data
    const beSetNumbers = new Set(beItems.map(s => String(s.setNumber || "").replace(/-1$/, "")));
    const extraManual = manualItems.filter(m => {
      const num = String(m.setNumber || "").replace(/-1$/, "");
      return !beSetNumbers.has(num);
    });
    return [...beItems, ...extraManual];
  });

  // ── BE sync info (for pieces, minifigs and aggregate stats) ─────────────
  const [beSyncInfo] = useState(() => {
    try { return JSON.parse(localStorage.getItem("brickEconomyCollectionSyncInfo") || "{}"); } catch { return {}; }
  });

  // ── BrickLink price guide cache (6-month US sold) ────────────────────────
  const [blPriceCache] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blPriceGuideCache") || "{}"); } catch { return {}; }
  });

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
    currentValue: "",
    notes: ""
  });
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupMessage, setLookupMessage] = useState("");
  const [addDupeWarning, setAddDupeWarning] = useState(null); // "collection" | "watchlist" | null
  const [addCatalogMode, setAddCatalogMode]       = useState(false);
  const [addCatalogQuery, setAddCatalogQuery]     = useState("");
  const [addCatalogResults, setAddCatalogResults] = useState([]);
  const [addCatalogLoading, setAddCatalogLoading] = useState(false);
  const [addCatalogError, setAddCatalogError]     = useState("");

  useEffect(() => {
    // Only persist manually-added items; BE data lives in brickEconomyNormalizedCollection
    const manualItems = sets.filter(s => s.source !== "BrickEconomy");
    localStorage.setItem("blOwnedSets", JSON.stringify(manualItems));
  }, [sets]);

  useEffect(() => {
    localStorage.setItem("blCollectionItems", JSON.stringify(collectionItems));
  }, [collectionItems]);

  useEffect(() => {
    localStorage.setItem("blCollChartTypes", JSON.stringify(chartTypes));
  }, [chartTypes]);

  useEffect(() => {
    localStorage.setItem("blSoldSets", JSON.stringify(soldSets));
  }, [soldSets]);

  useEffect(() => {
    localStorage.setItem("blOwnedRetireDismissed", JSON.stringify(retireDismissed));
  }, [retireDismissed]);

  useEffect(() => {
    localStorage.setItem("blOwnedColumns", JSON.stringify(ownedColumns));
  }, [ownedColumns]);

  useEffect(() => {
    localStorage.setItem("blOwnedColWidths", JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    localStorage.setItem("blOwnedSort", sortColumn);
    localStorage.setItem("blOwnedSortDir", sortDirection);
  }, [sortColumn, sortDirection]);

  // ── Portfolio snapshot — record once per day ──────────────────────────────
  useEffect(() => {
    if (sets.length === 0) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const history = JSON.parse(localStorage.getItem("blPortfolioHistory") || "[]");
      if (history.some(h => h.date === today)) return;
      const totalValue = sets.reduce((s, x) => s + (asNumber(x.totalValue) || asNumber(x.currentValue) * (asNumber(x.qty) || 1)), 0);
      const totalPaid  = sets.reduce((s, x) => s + (asNumber(x.totalPaid)  || asNumber(x.paidPrice)    * (asNumber(x.qty) || 1)), 0);
      const next = [...history.filter(h => h.date !== today), { date: today, value: totalValue, paid: totalPaid }];
      localStorage.setItem("blPortfolioHistory", JSON.stringify(next.sort((a, b) => a.date.localeCompare(b.date)).slice(-365)));
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
    const costBasis = sets.reduce((sum, s) => sum + (asNumber(s.totalPaid) || asNumber(s.paidPrice) * (asNumber(s.qty) || 1)), 0);
    const value = sets.reduce((sum, s) => sum + (asNumber(s.totalValue) || asNumber(s.currentValue) * (asNumber(s.qty) || 1)), 0);
    const themes = new Set(sets.map(s => s.theme).filter(Boolean)).size;
    const duplicates = sets.filter(s => (asNumber(s.qty) || 1) > 1).length;
    const retiredSets = sets.filter(s => s.retired).length;
    const newSets     = sets.filter(s => !s.condition || s.condition === "new" || s.condition === "sealed").length;
    const usedSets    = sets.filter(s => s.condition && s.condition.startsWith("used")).length;
    const avgValue    = sets.length ? value / sets.length : 0;
    const avgPaid     = sets.length ? costBasis / sets.length : 0;

    // Stats sourced from normalized BE data (entries carry the raw fields)
    const pieces      = sets.reduce((sum, s) => sum + (s.pieces || 0) * (asNumber(s.qty) || 1), 0);
    const retailValue = sets.reduce((sum, s) => sum + (asNumber(s.totalRetailPrice) || asNumber(s.retailPrice) * (asNumber(s.qty) || 1)), 0);
    const minifigs    = sets.reduce((sum, s) => sum + (asNumber(s.minifigs) || 0) * (asNumber(s.qty) || 1), 0);

    // Entry-level counts — each copy counted individually, matching BE's method.
    // BE sets use the entries[] array; manually-added sets fall back to a single synthetic entry.
    const allEntries    = sets.flatMap(s => s.entries?.length ? s.entries : [{ condition: s.condition, current_value: asNumber(s.currentValue), retired: s.retired }]);
    const newEntries    = allEntries.filter(e => !e.condition || e.condition === "new" || e.condition === "sealed").length;
    const usedEntries   = allEntries.filter(e => e.condition && e.condition.startsWith("used")).length;
    const newSetsValue  = allEntries.filter(e => !e.condition || e.condition === "new" || e.condition === "sealed")
      .reduce((sum, e) => sum + (Number(e.current_value) || 0), 0);
    const usedSetsValue = allEntries.filter(e => e.condition && e.condition.startsWith("used"))
      .reduce((sum, e) => sum + (Number(e.current_value) || 0), 0);

    return {
      totalQty, costBasis, value, themes, duplicates,
      retiredSets, newSets, usedSets, avgValue, avgPaid,
      pieces, retailValue, minifigs, newEntries, usedEntries, newSetsValue, usedSetsValue,
      gainLoss: value - costBasis,
      roi: costBasis ? ((value - costBasis) / costBasis) * 100 : 0
    };
  }, [sets]);

  const themeChartData = useMemo(() => {
    const byTheme = {};
    sets.forEach(s => {
      const t = s.theme || "Other";
      if (!byTheme[t]) byTheme[t] = { qty: 0, value: 0 };
      byTheme[t].qty += asNumber(s.qty) || 1;
      // Use totalValue for BE items (already aggregated); fall back to per-unit × qty for manual
      byTheme[t].value += asNumber(s.totalValue) || asNumber(s.currentValue) * (asNumber(s.qty) || 1);
    });
    return Object.entries(byTheme)
      .sort((a, b) => b[1].value - a[1].value)
      .map(([name, d]) => ({ name, qty: d.qty, value: d.value }));
  }, [sets]);

  const topRoiSets = useMemo(() => {
    return [...sets]
      .filter(s => asNumber(s.paidPrice) > 0)
      .map(s => ({
        ...s,
        _roi: asNumber(s.roiPct) || ((asNumber(s.currentValue) - asNumber(s.paidPrice)) / asNumber(s.paidPrice)) * 100
      }))
      .sort((a, b) => b._roi - a._roi);
  }, [sets]);

  const topValueSets = useMemo(() => {
    return [...sets].sort((a, b) =>
      (asNumber(b.totalValue) || asNumber(b.currentValue) * (asNumber(b.qty) || 1)) -
      (asNumber(a.totalValue) || asNumber(a.currentValue) * (asNumber(a.qty) || 1))
    );
  }, [sets]);

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
    const byTheme = {};
    sets.forEach(s => {
      const t = s.theme || "Other";
      if (!byTheme[t]) byTheme[t] = { theme: t, sets: 0, paid: 0, value: 0 };
      byTheme[t].sets  += 1;
      byTheme[t].paid  += asNumber(s.totalPaid)  || asNumber(s.paidPrice)    * (asNumber(s.qty) || 1);
      byTheme[t].value += asNumber(s.totalValue) || asNumber(s.currentValue) * (asNumber(s.qty) || 1);
    });
    return Object.values(byTheme)
      .map(t => ({ ...t, gain: t.value - t.paid, roi: t.paid > 0 ? ((t.value - t.paid) / t.paid) * 100 : null }))
      .sort((a, b) => (b.roi ?? -999) - (a.roi ?? -999));
  }, [sets]);

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

  async function lookupBE() {
    const key = normalizeSetNum(form.setNumber);
    if (!key) return;
    setLookupLoading(true);
    setLookupMessage("");
    try {
      const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
      let d = cache[key]?.data;
      if (!d) {
        const res = await fetch(`/api/brickeconomy-set?number=${encodeURIComponent(key)}&currency=USD`);
        const json = await res.json();
        if (!res.ok || json.error) { setLookupMessage(json.message || json.error || "Lookup failed."); return; }
        d = json.data || json;
        cache[key] = { fetchedAt: new Date().toISOString(), data: d };
        localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
      }
      setForm(prev => ({
        ...prev,
        setNumber: d.set_number || key,
        name: d.name || prev.name,
        theme: d.theme || prev.theme,
        currentValue: d.current_value_new || d.retail_price_us || prev.currentValue,
      }));
      setLookupMessage(`Found: ${d.name || key}`);
    } catch {
      setLookupMessage("Could not reach BrickEconomy.");
    } finally {
      setLookupLoading(false);
    }
  }

  function addSet() {
    if (!form.setNumber && !form.name) return;

    setSets(prev => [
      ...prev,
      {
        ...form,
        qty: asNumber(form.qty) || 1,
        paidPrice: asNumber(form.paidPrice),
        currentValue: asNumber(form.currentValue)
      }
    ]);

    setForm({ setNumber: "", name: "", theme: "", condition: "new", qty: 1, paidPrice: "", currentValue: "", notes: "" });
    setLookupMessage("");
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
    const paid = asNumber(set.totalPaid) || asNumber(set.paidPrice) * qty;
    const value = asNumber(set.totalValue) || asNumber(set.currentValue) * qty;
    const gain = value - paid;
    const roi = paid > 0 ? ((gain / paid) * 100) : null;

    if (column.key === "setNumber") return set.setNumber || "—";
    if (column.key === "name") return set.name || "—";
    if (column.key === "theme") return set.theme || "—";
    if (column.key === "condition") return set.condition ? (CONDITION_LABELS[set.condition] || set.condition) : "—";
    if (column.key === "qty") return qty;
    if (column.key === "paid") return money(paid);
    if (column.key === "value") return money(value);
    if (column.key === "gain") return money(gain);
    if (column.key === "roi") return roi !== null ? `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%` : "—";
    if (column.key === "minifigs") return set.minifigs != null ? set.minifigs : "—";
    if (column.key === "acquiredDate") return fmtShortDate(set.acquiredDate);
    if (column.key === "retiredDate")  return fmtShortDate(set.retiredDate);
    if (column.key === "releasedDate") return fmtShortDate(set.releasedDate);
    if (column.key === "blSoldNew") {
      const blKey = String(set.setNumber || "").replace(/-1$/, "");
      const bl = blPriceCache[blKey]?.data;
      const v = bl?.qty_avg_price_new ?? bl?.avg_price_new;
      return v != null ? money(v) : "—";
    }
    if (column.key === "blSoldUsed") {
      const blKey = String(set.setNumber || "").replace(/-1$/, "");
      const bl = blPriceCache[blKey]?.data;
      const v = bl?.qty_avg_price_used ?? bl?.avg_price_used;
      return v != null ? money(v) : "—";
    }
    if (column.key === "notes") return set.notes || "";

    return "";
  }

  function isNumericOwnedColumn(key) {
    return ["qty", "paid", "value", "gain", "roi"].includes(key);
  }

  const themes = Array.from(new Set(sets.map(s => s.theme).filter(Boolean))).sort();
  const conditions = Array.from(new Set(sets.map(s => s.condition).filter(Boolean))).sort();

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
      const matchesCondition = !filterCondition || set.condition === filterCondition;
      return matchesTheme && matchesCondition;
    })
    .sort((a, b) => {
      let result = 0;

      if (sortColumn === "qty") {
        result = asNumber(a.qty) - asNumber(b.qty);
      } else if (sortColumn === "paid") {
        const aPaid = asNumber(a.totalPaid) || asNumber(a.paidPrice) * (asNumber(a.qty) || 1);
        const bPaid = asNumber(b.totalPaid) || asNumber(b.paidPrice) * (asNumber(b.qty) || 1);
        result = aPaid - bPaid;
      } else if (sortColumn === "value") {
        const aVal = asNumber(a.totalValue) || asNumber(a.currentValue) * (asNumber(a.qty) || 1);
        const bVal = asNumber(b.totalValue) || asNumber(b.currentValue) * (asNumber(b.qty) || 1);
        result = aVal - bVal;
      } else if (sortColumn === "gain") {
        const aVal = asNumber(a.totalValue) || asNumber(a.currentValue) * (asNumber(a.qty) || 1);
        const aPaid = asNumber(a.totalPaid) || asNumber(a.paidPrice) * (asNumber(a.qty) || 1);
        const bVal = asNumber(b.totalValue) || asNumber(b.currentValue) * (asNumber(b.qty) || 1);
        const bPaid = asNumber(b.totalPaid) || asNumber(b.paidPrice) * (asNumber(b.qty) || 1);
        result = (aVal - aPaid) - (bVal - bPaid);
      } else {
        result = String(a[sortColumn] || "").localeCompare(String(b[sortColumn] || ""));
      }

      return sortDirection === "asc" ? result : -result;
    });

  function updateSet(index, field, value) {
    setSets(prev => {
      const next = [...prev];

      next[index] = {
        ...next[index],
        [field]: field === "qty" || field === "paidPrice" || field === "currentValue"
          ? asNumber(value)
          : value
      };

      return next;
    });
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
            { key: "collection", label: "Browse" },
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
          <div style={{ fontWeight: 900, fontSize: 20, color: "#e8e2d5", marginBottom: 8 }}>Your collection is empty</div>
          <div style={{ color: "#8a9bb0", fontSize: 14, marginBottom: 24, maxWidth: 400, margin: "0 auto 24px", lineHeight: 1.6 }}>
            Add sets manually using the Collection tab, or sync your BrickEconomy collection in Settings to import everything at once.
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => setTab("collection")} style={{ background: "#c9a84c", color: "#0d1623", border: "none", borderRadius: 10, padding: "12px 24px", fontWeight: 900, fontSize: 14, cursor: "pointer" }}>
              Add a Set →
            </button>
            {onSwitchTab && (
              <button onClick={() => onSwitchTab("settings")} style={{ background: "transparent", border: "1px solid rgba(201,168,76,0.3)", color: "#c9a84c", borderRadius: 10, padding: "12px 24px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                Sync BrickEconomy
              </button>
            )}
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
                <button onClick={() => setCollGearOpen(prev => !prev)} style={{ ...hoverCtrlBtn, color: collGearOpen ? "#c9a84c" : "#8a9bb0" }} title="Show / hide stats">⚙</button>
                <button onClick={() => setCollPillsCollapsed(prev => !prev)} style={hoverCtrlBtn} title={collPillsCollapsed ? "Expand" : "Collapse"}>{collPillsCollapsed ? "▼" : "▲"}</button>
              </div>
            </div>

            {collGearOpen && (
              <div style={{ position: "absolute", top: 46, right: 10, zIndex: 30, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "12px 16px", minWidth: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                <div style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Stats</div>
                {collectionItems.filter(i => i.type === "card").map(item => (
                  <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: item.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                    <input type="checkbox" checked={item.visible} onChange={() => setCollectionItems(prev => prev.map(x => x.key === item.key ? { ...x, visible: !x.visible } : x))} style={{ accentColor: "#c9a84c" }} />
                    {item.label}
                  </label>
                ))}
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "10px 0 8px" }} />
                <div style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Panels</div>
                {collectionItems.filter(i => i.type === "panel").map(item => (
                  <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: item.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                    <input type="checkbox" checked={item.visible} onChange={() => setCollectionItems(prev => prev.map(x => x.key === item.key ? { ...x, visible: !x.visible } : x))} style={{ accentColor: "#c9a84c" }} />
                    {item.label}
                  </label>
                ))}
              </div>
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
                     item.key === "value"        ? <Card title="Collection Value" value={money(stats.value)} /> :
                     item.key === "cost"         ? <Card title="Cost Basis"       value={money(stats.costBasis)} /> :
                     item.key === "gain"         ? <Card title="Net Gain / Loss"  value={money(stats.gainLoss)} good={stats.gainLoss >= 0} /> :
                     item.key === "roi"          ? <Card title="ROI"              value={`${stats.roi.toFixed(1)}%`} good={stats.roi >= 0} /> :
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
                     item.key === "avgValue"     ? <Card title="Avg Set Value"    value={money(stats.avgValue)} /> :
                     item.key === "avgPaid"      ? <Card title="Avg Paid / Set"   value={money(stats.avgPaid)} /> :
                     item.key === "pieces"       ? <Card title="Total Pieces"     value={(stats.pieces || beSyncInfo.piecesCount || 0).toLocaleString()} /> :
                     item.key === "minifigs"     ? <Card title="Minifigs"         value={(stats.minifigs || beSyncInfo.minifsCount || 0).toLocaleString()} /> :
                     item.key === "retailValue"  ? <Card title="Retail Value"     value={money(stats.retailValue || beSyncInfo.retailValue)} /> :
                     item.key === "newValue"     ? <Card title="New Sets Value"   value={money(stats.newSetsValue)} sub={`${stats.newEntries} sets`} /> :
                     item.key === "usedValue"    ? <Card title="Used Sets Value"  value={money(stats.usedSetsValue)} sub={`${stats.usedEntries} sets`} /> :
                     item.key === "watchList"    ? <Card title="Wanted List"      value={watchListHighlights.total} /> :
                     item.key === "retiringSoon" ? <Card title="Retiring Soon"    value={watchListHighlights.retiringSoon} /> : null}
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
                                      <div style={{ fontSize: 20, fontWeight: 900, color: "#e8e2d5" }}>{money(stats.value)}</div>
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
                                  <div style={{ fontWeight: 900, fontSize: 13 }}>{money(d.value)}</div>
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
                                <div key={s.setNumber || i}
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
                              const val = asNumber(s.totalValue) || asNumber(s.currentValue) * (asNumber(s.qty) || 1);
                              return (
                                <div key={s.setNumber || i}
                                  onClick={() => { setDetailSet(openSetDetail(s.setNumber) || s); setDetailSetIndex(sets.indexOf(s)); }}
                                  onMouseEnter={e => { e.currentTarget.style.border = "1px solid rgba(255,255,255,0.18)"; setHoveredSet(s); }}
                                  onMouseLeave={e => { e.currentTarget.style.border = "1px solid rgba(255,255,255,0.06)"; setHoveredSet(null); }}
                                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0f1a28", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "9px 12px", cursor: "pointer" }}>
                                  <div>
                                    <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name || s.setNumber || "—"}</div>
                                    <div style={{ color: "#5d6f80", fontSize: 12 }}>{s.theme || "—"} · Qty {asNumber(s.qty) || 1}</div>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontWeight: 900, fontSize: 14 }}>{money(val)}</span>
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
                                  <div key={wlItem.setNumber || i}
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
                                    <td style={tdStyleR}>{money(t.value)}</td>
                                    <td style={{ ...tdStyleR, color: t.gain >= 0 ? "#5aa832" : "#ff8b8b" }}>{money(t.gain)}</td>
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Add Owned Set</h3>
          {(form.setNumber || form.name || form.theme || form.paidPrice || form.currentValue || form.notes) && (
            <button
              onClick={() => { setForm({ setNumber: "", name: "", theme: "", condition: "new", qty: 1, paidPrice: "", currentValue: "", notes: "" }); setLookupMessage(""); }}
              style={{ background: "transparent", color: "#5d6f80", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
              Reset
            </button>
          )}
        </div>

        {/* ── Mode toggle ── */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <button onClick={() => { setAddCatalogMode(false); setAddCatalogResults([]); setAddCatalogQuery(""); }}
            style={{ background: !addCatalogMode ? "#c9a84c" : "rgba(255,255,255,0.04)", color: !addCatalogMode ? "#0d1623" : "#8a9bb0", border: `1px solid ${!addCatalogMode ? "#c9a84c" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, padding: "6px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
            By Set Number
          </button>
          <button onClick={() => setAddCatalogMode(true)}
            style={{ background: addCatalogMode ? "#c9a84c" : "rgba(255,255,255,0.04)", color: addCatalogMode ? "#0d1623" : "#8a9bb0", border: `1px solid ${addCatalogMode ? "#c9a84c" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, padding: "6px 14px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
            Search Catalog
          </button>
        </div>

        {!addCatalogMode && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input
                placeholder="Set Number (e.g. 75192)"
                value={form.setNumber}
                onChange={e => setForm({ ...form, setNumber: e.target.value })}
                onKeyDown={e => e.key === "Enter" && lookupBE()}
                style={{ minWidth: 180 }}
              />
              <button onClick={lookupBE} disabled={lookupLoading} style={ghostBtn}>
                {lookupLoading ? "Searching..." : "Look Up"}
              </button>
            </div>
            {lookupMessage && <div style={{ fontSize: 13, color: lookupMessage.startsWith("Found") ? "#5aa832" : "#ff8b8b", marginBottom: 8 }}>{lookupMessage}</div>}
            {addDupeWarning === "collection" && (
              <div style={{ background: "#3b2500", border: "1px solid #92400e", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#fbbf24", marginBottom: 8 }}>
                ⚠ This set is already in your collection
              </div>
            )}
            {addDupeWarning === "watchlist" && (
              <div style={{ background: "#0f2035", border: "1px solid #1e40af", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#93c5fd", marginBottom: 8 }}>
                ℹ This set is on your Wanted List — adding it to your collection won't remove it from the list
              </div>
            )}
          </>
        )}

        {addCatalogMode && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
              <input placeholder="Search by set name or theme..." value={addCatalogQuery}
                onChange={e => setAddCatalogQuery(e.target.value)} style={{ flex: 1 }} autoFocus />
              {addCatalogLoading && <span style={{ color: "#8a9bb0", fontSize: 13 }}>Searching…</span>}
            </div>
            {addCatalogError && <div style={{ color: "#ff8b8b", fontSize: 13, marginBottom: 8 }}>{addCatalogError}</div>}
            {addCatalogResults.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, maxHeight: 380, overflowY: "auto" }}>
                {addCatalogResults.map(s => {
                  const clean = String(s.setNumber || "").replace(/-1$/, "");
                  const inColl = sets.some(x => String(x.setNumber || "").replace(/-1$/, "") === clean);
                  return (
                    <div key={s.setNumber}
                      onClick={() => {
                        setForm(prev => ({ ...prev, setNumber: clean, name: s.name || prev.name, theme: s.theme || prev.theme, currentValue: s.msrp ? String(s.msrp) : prev.currentValue }));
                        setAddCatalogMode(false); setAddCatalogResults([]); setAddCatalogQuery("");
                        setTimeout(() => lookupBE(), 50);
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

        <div style={formGrid}>
          <label>
            Set Name
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Theme
            <input value={form.theme} onChange={e => setForm({ ...form, theme: e.target.value })} />
          </label>
          <label>
            Condition
            <select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value })}>
              <option value="new">New</option>
              <option value="sealed">Sealed</option>
              <option value="used_as_new">Used — Like New</option>
              <option value="used_good">Used — Good</option>
              <option value="used_acceptable">Used — Acceptable</option>
            </select>
          </label>
          <label>
            Qty
            <input type="number" min="1" step="1" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
          </label>
          <label>
            Paid Price ($)
            <input type="number" min="0" step="0.01" value={form.paidPrice} onChange={e => setForm({ ...form, paidPrice: e.target.value })} />
          </label>
          <label>
            Current Value ($)
            <input type="number" min="0" step="0.01" value={form.currentValue} onChange={e => setForm({ ...form, currentValue: e.target.value })} />
          </label>
          <label>
            Notes
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>

        <button onClick={addSet} style={redBtn}>Add Set</button>
      </section>
      )}

      <SetDetailPanel
        item={detailSet}
        onClose={() => { setDetailSet(null); setDetailSetIndex(null); }}
        onEdit={detailSetIndex !== null ? () => { setDetailSet(null); setDetailSetIndex(null); setSelectedSetIndex(detailSetIndex); } : undefined}
      />
      <WatchDetailPanel
        item={detailWatchItem}
        onClose={() => setDetailWatchItem(null)}
        onBuyNow={onBuyNow ? () => { setDetailWatchItem(null); onBuyNow(detailWatchItem); } : undefined}
      />

      {hoveredSet && (
        <div style={{ position: "fixed", left: tipPos.x > window.innerWidth - 280 ? tipPos.x - 256 : tipPos.x + 16, top: tipPos.y > window.innerHeight - 230 ? tipPos.y - 215 : tipPos.y - 8, zIndex: 9999, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "10px 14px", pointerEvents: "none", boxShadow: "0 8px 32px rgba(0,0,0,0.55)", minWidth: 240 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <img src={setImageUrl(hoveredSet.setNumber)} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
              style={{ width: 72, height: 72, objectFit: "contain", borderRadius: 8, background: "#111d2e", border: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: "#e8e2d5", marginBottom: 6, fontSize: 13 }}>{hoveredSet.name || hoveredSet.setNumber || "Set"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: 12 }}>
                {hoveredSet.setNumber && <><span style={{ color: "#5d6f80" }}>Set #</span><span style={{ color: "#e8e2d5" }}>{hoveredSet.setNumber}</span></>}
                {hoveredSet.theme && <><span style={{ color: "#5d6f80" }}>Theme</span><span style={{ color: "#e8e2d5" }}>{hoveredSet.theme}</span></>}
                {hoveredSet.condition && <><span style={{ color: "#5d6f80" }}>Condition</span><span style={{ color: "#e8e2d5", textTransform: "capitalize" }}>{hoveredSet.condition}</span></>}
                <span style={{ color: "#5d6f80" }}>Qty</span><span style={{ color: "#e8e2d5" }}>{hoveredSet.qty || 1}</span>
                <span style={{ color: "#5d6f80" }}>Paid</span><span style={{ color: "#e8e2d5" }}>{money(hoveredSet.totalPaid || (asNumber(hoveredSet.paidPrice) * (hoveredSet.qty || 1)))}</span>
                <span style={{ color: "#5d6f80" }}>Value</span><span style={{ color: "#c9a84c", fontWeight: 700 }}>{money(hoveredSet.totalValue || (asNumber(hoveredSet.currentValue) * (hoveredSet.qty || 1)))}</span>
                {hoveredSet.roiPct != null && <><span style={{ color: "#5d6f80" }}>ROI</span><span style={{ color: hoveredSet.roiPct >= 0 ? "#5aa832" : "#ff8b8b", fontWeight: 700 }}>{hoveredSet.roiPct >= 0 ? "+" : ""}{Number(hoveredSet.roiPct).toFixed(1)}%</span></>}
                {hoveredSet.retired != null && <><span style={{ color: "#5d6f80" }}>Status</span><span style={{ color: hoveredSet.retired ? "#f59e0b" : "#5aa832" }}>{hoveredSet.retired ? "Retired" : "Active"}</span></>}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#5d6f80", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>click for details · double-click to edit</div>
        </div>
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
        <div style={{ background: "#3b1200", border: "1px solid #92400e", borderRadius: 12, padding: "12px 16px", marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, color: "#f59e0b", marginBottom: 4 }}>
              ⚠️ {retirementAlertsForOwned.length} owned {retirementAlertsForOwned.length === 1 ? "set" : "sets"} retiring soon — consider selling
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {retirementAlertsForOwned.slice(0, 5).map(s => (
                <span key={s.setNumber} style={{ background: "#451a03", border: "1px solid #92400e", borderRadius: 999, padding: "2px 10px", fontSize: 12, color: "#fdba74" }}>
                  {s.name || s.setNumber}{s.alertType === "lastchance" ? " 🚨" : ` (${s.days}d)`}
                </span>
              ))}
              {retirementAlertsForOwned.length > 5 && <span style={{ fontSize: 12, color: "#8a9bb0" }}>+{retirementAlertsForOwned.length - 5} more</span>}
            </div>
          </div>
          <button
            onClick={() => { const codes = retirementAlertsForOwned.map(s => String(s.setNumber || "").replace(/-1$/, "")); setRetireDismissed(prev => [...new Set([...prev, ...codes])]); }}
            style={{ background: "none", border: "none", color: "#8a9bb0", cursor: "pointer", fontSize: 18, fontWeight: 900, flexShrink: 0, padding: "0 4px" }}
          >×</button>
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
            {conditions.length > 0 && (
              <select value={filterCondition} onChange={e => setFilterCondition(e.target.value)} style={filterSelect}>
                <option value="">All Conditions</option>
                {conditions.map(c => <option key={c} value={c}>{CONDITION_LABELS[c] || c}</option>)}
              </select>
            )}
            {(searchText || filterTheme || filterCondition) && (
              <button onClick={() => { setSearchText(""); setFilterTheme(""); setFilterCondition(""); }} style={clearFilterButton}>
                Clear
              </button>
            )}
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.1)", alignSelf: "center", margin: "0 2px", flexShrink: 0 }} />
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
            <div style={{ overflowX: needsHScroll ? "auto" : "clip" }}>
            <div style={{ overflowY: "auto", maxHeight: 560 }}>
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
                      onDoubleClick={() => setSelectedSetIndex(index)}
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
                      <td style={{ ...td, ...stickyCheckbox }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checkedSets.includes(index)}
                          onChange={() => toggleChecked(index)}
                        />
                      </td>

                      {ownedColumns.filter(col => col.visible).map(col => {
                        // Thumbnail image column
                        if (col.key === "thumb") {
                          const imgUrl = setImageUrl(set.setNumber);
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

                        // Condition pill — click to cycle through conditions inline
                        if (col.key === "condition") {
                          const cond = set.condition || "new";
                          const color = conditionColor(cond);
                          const nextCond = CONDITION_CYCLE[(CONDITION_CYCLE.indexOf(cond) + 1) % CONDITION_CYCLE.length];
                          return (
                            <td key="condition" style={td} onClick={e => { e.stopPropagation(); updateSet(index, "condition", nextCond); }} title={`Click to cycle → ${CONDITION_LABELS[nextCond]}`}>
                              <span style={{ color, fontWeight: 700, fontSize: 11, padding: "2px 7px", borderRadius: 10, border: `1px solid ${color}50`, background: `${color}18`, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                                {CONDITION_LABELS[cond] || cond}
                              </span>
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
                            {renderOwnedCell(set, col)}
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>Edit Owned Set</h3>
                  <button onClick={() => setSelectedSetIndex(null)} style={circleButton}>×</button>
                </div>

                <div style={formGrid}>
                  <label>
                    Set Number
                    <input value={sets[selectedSetIndex].setNumber || ""} onChange={e => updateSet(selectedSetIndex, "setNumber", e.target.value)} />
                  </label>

                  <label>
                    Set Name
                    <input value={sets[selectedSetIndex].name || ""} onChange={e => updateSet(selectedSetIndex, "name", e.target.value)} />
                  </label>

                  <label>
                    Theme
                    <input value={sets[selectedSetIndex].theme || ""} onChange={e => updateSet(selectedSetIndex, "theme", e.target.value)} />
                  </label>

                  <label>
                    Condition
                    <select value={sets[selectedSetIndex].condition || "new"} onChange={e => updateSet(selectedSetIndex, "condition", e.target.value)}>
                      <option value="new">New</option>
                      <option value="sealed">Sealed</option>
                      <option value="used_as_new">Used — Like New</option>
                      <option value="used_good">Used — Good</option>
                      <option value="used_acceptable">Used — Acceptable</option>
                    </select>
                  </label>

                  <label>
                    Qty
                    <input type="number" min="1" value={sets[selectedSetIndex].qty || 1} onChange={e => updateSet(selectedSetIndex, "qty", e.target.value)} />
                  </label>

                  <label>
                    Paid Price
                    <input type="number" step="0.01" value={sets[selectedSetIndex].paidPrice || ""} onChange={e => updateSet(selectedSetIndex, "paidPrice", e.target.value)} />
                  </label>

                  <label>
                    Current Value
                    <input type="number" step="0.01" value={sets[selectedSetIndex].currentValue || ""} onChange={e => updateSet(selectedSetIndex, "currentValue", e.target.value)} />
                  </label>

                  <label>
                    Notes
                    <input value={sets[selectedSetIndex].notes || ""} onChange={e => updateSet(selectedSetIndex, "notes", e.target.value)} />
                  </label>
                </div>

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
    </div>
  );
}

function Card({ title, value, good, sub }) {
  const [tip, setTip] = useState(false);
  return (
    <div style={{
      ...panel, marginTop: 0, overflow: "hidden",
      minHeight: 88,
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      padding: "14px 16px",
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
  whiteSpace: "nowrap"
};
const tdRight = { ...td, textAlign: "right", fontWeight: 800 };

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
