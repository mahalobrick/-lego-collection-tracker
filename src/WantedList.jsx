import { useEffect, useMemo, useState } from "react";
import { searchInput, filterSelect, clearFilterButton } from "./uiStyles";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts";
import { asNumber, money, setImageUrl, priorityScore, recommendation, daysUntilRetirement, retirementWaveLabel } from "./utils/formatting";

// Source → default confidence level
const SOURCE_CONFIDENCE = {
  "LEGO Last Chance": "High",
  "Brickset":         "High",
  "BrickEconomy":     "High",
  "Brick Fanatics":   "Medium",
  "StoneWars":        "Medium",
  "Manual":           "Low",
};
import { fetchBricksetSet } from "./utils/brickset";
import { getLastChanceCodes, isLastChanceSet, getCachedLastChanceCodes } from "./utils/legoLastChance";
import WatchDetailPanel from "./WatchDetailPanel";

const PIE_COLORS = ["#c9a84c", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#5aa832"];

const THEME_RETIREMENT_LIFESPAN = {
  "Star Wars": 2.5,
  "Icons": 3.5,
  "Ideas": 3,
  "Marvel": 2,
  "Harry Potter": 2.5,
  "Ninjago": 2,
  "Technic": 3,
  "Architecture": 2.5,
  "Speed Champions": 2,
  "City": 2
};

const DEFAULT_WL_ITEMS = [
  { key: "wantedCount",         type: "card",  label: "Wanted Sets",          visible: true,  width: "auto",  collapsed: false },
  { key: "retiringSoon",        type: "card",  label: "High Retirement Risk",  visible: true,  width: "auto",  collapsed: false },
  { key: "critical",            type: "card",  label: "Critical / Buy Soon",   visible: true,  width: "auto",  collapsed: false },
  { key: "avgScore",            type: "card",  label: "Buy Readiness",         visible: true,  width: "auto",  collapsed: false },
  { key: "totalMsrp",          type: "card",  label: "Total MSRP",            visible: false, width: "auto",  collapsed: false },
  { key: "avgMsrp",            type: "card",  label: "Avg MSRP",              visible: false, width: "auto",  collapsed: false },
  { key: "ownedCount",         type: "card",  label: "Already Owned",         visible: false, width: "auto",  collapsed: false },
  { key: "watchCount",         type: "card",  label: "Watch Status",          visible: false, width: "auto",  collapsed: false },
  { key: "urgency-chart",       type: "panel", label: "Queue Urgency",         visible: true,  width: "half",  collapsed: false },
  { key: "top-priority",        type: "panel", label: "Top Priority Items",    visible: true,  width: "half",  collapsed: false },
  { key: "retirement-timeline", type: "panel", label: "Retirement Timeline",   visible: true,  width: "full",  collapsed: false },
];

function estimateRetirementFromSet(setData) {
  const currentYear = new Date().getFullYear();
  const releaseYear =
    Number(setData.year) ||
    Number(String(setData.released_date || "").slice(0, 4));

  if (!releaseYear) {
    return {
      retirementYear: "",
      retirementConfidence: "Low",
      retiringSoon: false,
      retirementSource: "Unknown",
      lastRetirementUpdate: new Date().toISOString().slice(0, 10)
    };
  }

  const theme = setData.theme || "";
  const lifespan = THEME_RETIREMENT_LIFESPAN[theme] || 2.5;
  const projectedYear = Math.round(releaseYear + lifespan);

  let confidence = "Medium";

  if (setData.availability === "exclusive" || setData.pieces_count >= 2000) {
    confidence = "High";
  }

  if (projectedYear < currentYear) {
    confidence = "High";
  }

  return {
    retirementYear: String(projectedYear),
    retirementConfidence: confidence,
    retiringSoon: projectedYear <= currentYear + 1,
    retirementSource: "Brick Fanatics",
    lastRetirementUpdate: new Date().toISOString().slice(0, 10)
  };
}


export default function WantedList({ onBuyNow }) {
  const [wanted, setWanted] = useState(() => {
    const saved = localStorage.getItem("blWantedList");
    return saved ? JSON.parse(saved) : [];
  });

  const [form, setForm] = useState({
    setNumber: "",
    name: "",
    theme: "",
    msrp: "",
    targetDiscount: "",
    targetPrice: "",
    storePrice: "",
    priority: 3,
    retiringSoon: false,
    status: "Watch",
    retirementYear: "",
    retirementConfidence: "Medium",
    releaseYear: "",
    pieces: "",
    currentValue: "",
    availability: "",
    retirementSource: "Brick Fanatics",
    lastRetirementUpdate: "",
    exit_date: "",
    isLastChance: false,
    forecast2yr: "",
    forecast5yr: "",
    notes: "",
    subtheme: "",
    minifigs: "",
    weight: "",
    rating: "",
    packagingType: "",
    ageMin: ""
  });

  const [search, setSearch] = useState("");
  const [filterTheme, setFilterTheme] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [lookupMessage, setLookupMessage] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lastChanceCodes, setLastChanceCodes] = useState(() => getCachedLastChanceCodes());
  const [selectedWantedIndex, setSelectedWantedIndex] = useState(null);
  const [checkedWanted, setCheckedWanted] = useState([]);
  const [sortKey, setSortKey] = useState("score");
  const [sortDirection, setSortDirection] = useState("desc");
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [brickHoundCopied, setBrickHoundCopied] = useState(false);
  const [subTab, setSubTab] = useState("overview");
  const [detailItem, setDetailItem] = useState(null);
  const [detailItemIndex, setDetailItemIndex] = useState(null);
  const [showAllTopPriority, setShowAllTopPriority] = useState(false);
  const [hoveredWanted, setHoveredWanted] = useState(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const [chartTypes, setChartTypes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blWLChartTypes") || "{}"); } catch { return {}; }
  });
  const [wlPillsCollapsed, setWlPillsCollapsed] = useState(false);
  // Custom fields schema: [{id, label, type}]
  const [customFieldsSchema, setCustomFieldsSchema] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blCustomFieldsSchema") || "[]"); } catch { return []; }
  });
  const [customFieldsGearOpen, setCustomFieldsGearOpen] = useState(false);
  const [newCfLabel, setNewCfLabel] = useState("");
  const [newCfType, setNewCfType] = useState("text");

  useEffect(() => {
    localStorage.setItem("blCustomFieldsSchema", JSON.stringify(customFieldsSchema));
  }, [customFieldsSchema]);

  function addCustomField() {
    const label = newCfLabel.trim();
    if (!label) return;
    const id = `cf_${Date.now()}`;
    setCustomFieldsSchema(prev => [...prev, { id, label, type: newCfType }]);
    setNewCfLabel("");
    setNewCfType("text");
  }

  function removeCustomField(id) {
    setCustomFieldsSchema(prev => prev.filter(f => f.id !== id));
  }

  const [wlGearOpen, setWlGearOpen] = useState(false);
  const [lcAlertDismissed, setLcAlertDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blLCAlertDismissed") || "[]"); } catch { return []; }
  });
  const [colGearOpen, setColGearOpen] = useState(false);
  const [bulkThemeOpen, setBulkThemeOpen] = useState(false);
  const [bulkTheme, setBulkTheme] = useState("");
  const [bulkYear, setBulkYear] = useState("");
  const [bulkConfidence, setBulkConfidence] = useState("Medium");
  const [bulkSource, setBulkSource] = useState("Brick Fanatics");
  const [hoveredWLItem, setHoveredWLItem] = useState(null);
  const [draggedWLItem, setDraggedWLItem] = useState(null);
  const [wlItems, setWlItems] = useState(() => {
    const saved = localStorage.getItem("blWLItems");
    if (!saved) return DEFAULT_WL_ITEMS;
    const parsed = JSON.parse(saved);
    const typeMap = Object.fromEntries(DEFAULT_WL_ITEMS.map(c => [c.key, c.type]));
    const labelMap = Object.fromEntries(DEFAULT_WL_ITEMS.map(c => [c.key, c.label]));
    const merged = parsed.map(c => ({ ...c, type: typeMap[c.key] ?? c.type, label: labelMap[c.key] ?? c.label }));
    const savedKeys = new Set(merged.map(c => c.key));
    const missing = DEFAULT_WL_ITEMS.filter(c => !savedKeys.has(c.key));
    return [...merged, ...missing];
  });

  // Pre-compute owned set numbers for badge display
  const ownedSetNumbers = useMemo(() => {
    try {
      const manual = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");
      const beNorm = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]");
      return new Set([...manual, ...beNorm].map(s => String(s.setNumber || "").replace(/-1$/, "")));
    } catch { return new Set(); }
  }, []);

  // ── Store Price Calculator (standalone widget) ────────────────
  const [calcSetNum,   setCalcSetNum]   = useState("");
  const [calcMsrp,     setCalcMsrp]     = useState("");
  const [calcStore,    setCalcStore]    = useState("");
  const [calcMsg,      setCalcMsg]      = useState("");
  const [calcLoading,  setCalcLoading]  = useState(false);

  const calcMsrpVal  = parseFloat(calcMsrp)  || 0;
  const calcStoreVal = parseFloat(calcStore) || 0;
  const calcDiscount = calcMsrpVal > 0 && calcStoreVal > 0
    ? ((calcMsrpVal - calcStoreVal) / calcMsrpVal) * 100 : null;
  const calcSavings  = calcMsrpVal > 0 && calcStoreVal > 0
    ? calcMsrpVal - calcStoreVal : null;

  function calcDiscountColor() {
    if (calcDiscount === null) return "#e8e2d5";
    if (calcDiscount >= 30) return "#5aa832";
    if (calcDiscount >= 20) return "#c9a84c";
    if (calcDiscount >= 10) return "#f59e0b";
    return "#ff8b8b";
  }
  function calcDiscountLabel() {
    if (calcDiscount === null) return null;
    if (calcDiscount >= 35) return "Exceptional deal";
    if (calcDiscount >= 30) return "Great deal";
    if (calcDiscount >= 20) return "Good deal";
    if (calcDiscount >= 10) return "Modest discount";
    if (calcDiscount > 0)   return "Minimal discount";
    return "No discount";
  }

  async function lookupCalcSet() {
    const raw = calcSetNum.trim();
    if (!raw) { setCalcMsg("Enter a set number first."); return; }
    try {
      const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
      const key = raw.includes("-") ? raw : `${raw}-1`;
      const cached = (cache[key] || cache[raw])?.data;
      if (cached?.retail_price_us) {
        setCalcMsrp(String(cached.retail_price_us));
        setCalcMsg(`MSRP loaded from cache — ${cached.name || raw}`);
        return;
      }
      setCalcLoading(true);
      setCalcMsg("");
      const res  = await fetch(`/api/brickeconomy-set?number=${encodeURIComponent(key)}&currency=USD`);
      const json = await res.json();
      if (!res.ok || json.error) { setCalcMsg(json.message || json.error || "Lookup failed."); return; }
      const data = json.data || json;
      try {
        cache[key] = { fetchedAt: new Date().toISOString(), data };
        localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
      } catch {}
      if (data.retail_price_us) {
        setCalcMsrp(String(data.retail_price_us));
        setCalcMsg(`MSRP loaded — ${data.name || key}`);
      } else {
        setCalcMsg("No retail price found for this set.");
      }
    } catch (err) {
      setCalcMsg(err.message || "Lookup failed.");
    } finally {
      setCalcLoading(false);
    }
  }

  useEffect(() => {
    localStorage.setItem("blWantedList", JSON.stringify(wanted));
  }, [wanted]);

  // ── Retroactive Brickset refresh ─────────────────────────────────────────
  // Silently enriches existing Buy List items that are missing exit_date or msrp.
  // Runs once on mount, rate-limited to 1 fetch per 400ms to avoid hammering the API.
  useEffect(() => {
    const stale = wanted.filter(w =>
      w.setNumber && !w.exit_date && w.retirementSource !== "LEGO Last Chance"
    );
    if (stale.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const item of stale) {
        if (cancelled) break;
        const bsData = await fetchBricksetSet(item.setNumber);
        if (!bsData || cancelled) { await new Promise(r => setTimeout(r, 400)); continue; }

        setWanted(prev => prev.map(w => {
          if (w.setNumber !== item.setNumber) return w;
          const updates = {};

          if (bsData.exit_date && !w.exit_date) {
            const exitYear   = new Date(bsData.exit_date).getFullYear();
            const currentYear = new Date().getFullYear();
            updates.exit_date            = bsData.exit_date;
            updates.retirementYear       = String(exitYear);
            updates.retirementConfidence = "High";
            updates.retiringSoon         = exitYear <= currentYear + 1;
            updates.retirementSource     = "Brickset";
            updates.lastRetirementUpdate = new Date().toISOString().slice(0, 10);
          }
          if (bsData.retail_price_us && !w.msrp) {
            updates.msrp = bsData.retail_price_us;
          }
          if (bsData.minifigs  && !w.minifigs)  updates.minifigs  = bsData.minifigs;
          if (bsData.subtheme  && !w.subtheme)  updates.subtheme  = bsData.subtheme;
          if (bsData.age_min   && !w.ageMin)    updates.ageMin    = bsData.age_min;
          if (bsData.rating    && !w.rating)    updates.rating    = bsData.rating;
          if (bsData.packaging_type && !w.packagingType) updates.packagingType = bsData.packaging_type;

          return Object.keys(updates).length ? { ...w, ...updates } : w;
        }));

        await new Promise(r => setTimeout(r, 400));
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // ── LEGO Last Chance auto-detection ──────────────────────────────────────
  // Fetches the official LEGO "Last Chance to Buy" list (CDN-cached 24hr)
  // and auto-flags any matching wanted items as isLastChance.
  useEffect(() => {
    getLastChanceCodes().then(codes => {
      if (codes.size === 0) return;
      setLastChanceCodes(codes);
      setWanted(prev => prev.map(w => {
        const shouldFlag = isLastChanceSet(w.setNumber, codes);
        if (shouldFlag === w.isLastChance) return w;
        return { ...w, isLastChance: shouldFlag };
      }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  const DEFAULT_WANTED_COLUMNS = [
    // ── Intelligence ─────────────────────────────────────────────
    { key: "score",               label: "Score",        visible: false, group: "intelligence" },
    { key: "recommendation",      label: "Rec.",         visible: true,  group: "intelligence" },
    // ── Core ─────────────────────────────────────────────────────
    { key: "priority",            label: "Priority",     visible: true,  group: "core" },
    { key: "status",              label: "Status",       visible: true,  group: "core" },
    { key: "setNumber",           label: "Set #",        visible: true,  group: "core" },
    { key: "name",                label: "Name",         visible: true,  group: "core" },
    // ── Retirement ───────────────────────────────────────────────
    { key: "retiringSoon",        label: "Retiring",     visible: true,  group: "retirement" },
    { key: "retirementYear",      label: "Projected",    visible: true,  group: "retirement" },
    { key: "retirementConfidence",label: "Confidence",   visible: true,  group: "retirement" },
    { key: "retirementSource",    label: "Source",       visible: true,  group: "retirement" },
    { key: "lastRetirementUpdate",label: "Updated",      visible: false, group: "retirement" },
    // ── Pricing ──────────────────────────────────────────────────
    { key: "msrp",                label: "MSRP",         visible: true,  group: "pricing" },
    { key: "targetPrice",         label: "Target",       visible: true,  group: "pricing" },
    { key: "discount",            label: "Discount",     visible: true,  group: "pricing" },
    { key: "currentValue",        label: "Mkt Value",    visible: false, group: "pricing" },
    { key: "forecast2yr",         label: "2yr Forecast", visible: false, group: "pricing" },
    { key: "forecast5yr",         label: "5yr Forecast", visible: false, group: "pricing" },
    // ── Details ──────────────────────────────────────────────────
    { key: "theme",               label: "Theme",        visible: true,  group: "details" },
    { key: "pieces",              label: "Pieces",       visible: false, group: "details" },
    { key: "subtheme",            label: "Subtheme",     visible: false, group: "details" },
    { key: "minifigs",            label: "Minifigs",     visible: false, group: "details" },
    { key: "rating",              label: "Rating",       visible: false, group: "details" },
    { key: "packagingType",       label: "Packaging",    visible: false, group: "details" },
    { key: "ageMin",              label: "Min Age",      visible: false, group: "details" },
    { key: "weight",              label: "Weight (kg)",  visible: false, group: "details" },
    { key: "notes",               label: "Notes",        visible: true,  group: "details" },
  ];

  const [columns, setColumns] = useState(() => {
    const saved = localStorage.getItem("blAcquisitionColumns");
    if (!saved) return DEFAULT_WANTED_COLUMNS;
    const parsed = JSON.parse(saved);
    const labelMap = Object.fromEntries(DEFAULT_WANTED_COLUMNS.map(c => [c.key, c.label]));
    const groupMap = Object.fromEntries(DEFAULT_WANTED_COLUMNS.map(c => [c.key, c.group]));
    const merged = parsed.map(c => ({ ...c, label: labelMap[c.key] ?? c.label, group: groupMap[c.key] ?? c.group }));
    const savedKeys = new Set(merged.map(c => c.key));
    const missing = DEFAULT_WANTED_COLUMNS.filter(c => !savedKeys.has(c.key));
    return missing.length ? [...merged, ...missing] : merged;
  });

  useEffect(() => {
    localStorage.setItem("blAcquisitionColumns", JSON.stringify(columns));
  }, [columns]);

  useEffect(() => {
    localStorage.setItem("blWLItems", JSON.stringify(wlItems));
  }, [wlItems]);

  useEffect(() => {
    localStorage.setItem("blWLChartTypes", JSON.stringify(chartTypes));
  }, [chartTypes]);

  function cycleChartType(key) {
    setChartTypes(prev => {
      const cur = prev[key] || "donut";
      const next = cur === "donut" ? "pie" : cur === "pie" ? "bar" : "donut";
      return { ...prev, [key]: next };
    });
  }

  const liveDiscount =
    asNumber(form.msrp) && asNumber(form.storePrice)
      ? ((asNumber(form.msrp) - asNumber(form.storePrice)) / asNumber(form.msrp)) * 100
      : 0;

  const targetDiscountValue =
    asNumber(form.targetDiscount) || 0;

  const targetHit =
    liveDiscount >= targetDiscountValue;

  const projectedSavings =
    asNumber(form.msrp) - asNumber(form.storePrice);

  const acquisitionThemes = Array.from(
    new Set(wanted.map(item => item.theme).filter(Boolean))
  ).sort();

  const acquisitionStatuses = Array.from(
    new Set(wanted.map(item => item.status).filter(Boolean))
  ).sort();

  const visibleWanted = useMemo(() => {
    const q = search.toLowerCase();

    return wanted
      .filter(item => {
        const matchesSearch =
          !q ||
          String(item.setNumber || "").toLowerCase().includes(q) ||
          String(item.name || "").toLowerCase().includes(q) ||
          String(item.theme || "").toLowerCase().includes(q) ||
          String(item.status || "").toLowerCase().includes(q);

        const matchesTheme = !filterTheme || item.theme === filterTheme;
        const matchesStatus = !filterStatus || item.status === filterStatus;

        return matchesSearch && matchesTheme && matchesStatus;
      })
      .sort((a, b) => {
        const direction = sortDirection === "asc" ? 1 : -1;

        const getValue = item => {
          if (sortKey === "score") return priorityScore(item);
          if (sortKey === "discount") {
            return asNumber(item.msrp)
              ? ((asNumber(item.msrp) - asNumber(item.targetPrice)) / asNumber(item.msrp)) * 100
              : 0;
          }

          return item[sortKey] ?? "";
        };

        const av = getValue(a);
        const bv = getValue(b);

        if (typeof av === "number" && typeof bv === "number") {
          return (av - bv) * direction;
        }

        return String(av).localeCompare(String(bv)) * direction;
      });
  }, [wanted, search, filterTheme, filterStatus, sortKey, sortDirection]);

  function isNumericColumn(key) {
    return ["score", "msrp", "targetPrice", "discount"].includes(key);
  }

  function renderCell(item, key, realIndex, discount) {
    if (key === "score") {
      return <span style={scoreChip(priorityScore(item))}>{priorityScore(item)}</span>;
    }

    if (key === "recommendation") {
      return (
        <span style={recommendationChip(priorityScore(item))}>
          {recommendation(priorityScore(item))}
        </span>
      );
    }

    if (key === "status") {
      return (
        <select value={item.status} onChange={e => updateWanted(realIndex, "status", e.target.value)}>
          <option>Watch</option>
          <option>Buy Soon</option>
          <option>Critical</option>
          <option>Owned</option>
        </select>
      );
    }

    if (key === "retiringSoon") {
      return (
        <input
          type="checkbox"
          checked={!!item.retiringSoon}
          onChange={e => updateWanted(realIndex, "retiringSoon", e.target.checked)}
        />
      );
    }

    if (key === "priority") return item.priority ?? "—";
    if (key === "setNumber") return item.setNumber || "—";
    if (key === "name") {
      const isOwned = ownedSetNumbers.has(String(item.setNumber || "").replace(/-1$/, ""));
      return isOwned
        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>{item.name || "—"}</span>
            <span style={{ fontSize: 11, background: "#0a2e1a", border: "1px solid #166534", color: "#5aa832", borderRadius: 999, padding: "2px 7px", fontWeight: 700, whiteSpace: "nowrap" }}>✓ Owned</span>
          </span>
        : (item.name || "—");
    }
    if (key === "theme") return item.theme || "—";
    if (key === "pieces") return item.pieces ? item.pieces.toLocaleString() : "—";
    if (key === "currentValue") return item.currentValue ? money(item.currentValue) : "—";
    if (key === "retirementYear") return item.retirementYear || "—";
    if (key === "retirementConfidence") return item.retirementConfidence || "—";
    if (key === "retirementSource") return item.retirementSource || "—";
    if (key === "lastRetirementUpdate") return item.lastRetirementUpdate || "—";
    if (key === "msrp") return money(item.msrp);
    if (key === "targetPrice") return money(item.targetPrice);
    if (key === "discount") return discount ? `${discount.toFixed(1)}%` : "—";
    if (key === "notes") return item.notes || "";
    if (key === "subtheme") return item.subtheme || "—";
    if (key === "minifigs") return item.minifigs ? item.minifigs : "—";
    if (key === "weight") return item.weight ? `${item.weight} kg` : "—";
    if (key === "rating") return item.rating ? `★ ${Number(item.rating).toFixed(1)}` : "—";
    if (key === "packagingType") return item.packagingType || "—";
    if (key === "ageMin") return item.ageMin ? `${item.ageMin}+` : "—";
    if (key === "forecast2yr") return item.forecast2yr ? money(item.forecast2yr) : "—";
    if (key === "forecast5yr") return item.forecast5yr ? money(item.forecast5yr) : "—";

    // Custom fields
    const cf = customFieldsSchema.find(f => f.key === key || f.id === key);
    if (cf) {
      const val = (item.customFields || {})[cf.id];
      if (cf.type === "checkbox") return (
        <input type="checkbox" checked={!!val}
          onChange={e => updateWanted(realIndex, "customFields", { ...(item.customFields || {}), [cf.id]: e.target.checked })} />
      );
      return val != null && val !== "" ? String(val) : "—";
    }

    return "";
  }

  function dropWLItem(targetKey) {
    if (!draggedWLItem || draggedWLItem === targetKey) return;
    setWlItems(prev => {
      const next = [...prev];
      const from = next.findIndex(i => i.key === draggedWLItem);
      const to   = next.findIndex(i => i.key === targetKey);
      if (from < 0 || to < 0) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDraggedWLItem(null);
  }

  function toggleWLWidth(key) {
    setWlItems(prev => prev.map(i => i.key === key ? { ...i, width: i.width === "full" ? "half" : "full" } : i));
  }

  function toggleWLCollapse(key) {
    setWlItems(prev => prev.map(i => i.key === key ? { ...i, collapsed: !i.collapsed } : i));
  }

  function dropColumn(targetKey) {
    if (!draggedColumn || draggedColumn === targetKey) return;

    setColumns(prev => {
      const next = [...prev];

      const fromIndex = next.findIndex(col => col.key === draggedColumn);
      const toIndex = next.findIndex(col => col.key === targetKey);

      if (fromIndex < 0 || toIndex < 0) return prev;

      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      return next;
    });

    setDraggedColumn(null);
  }

  function applyBulkThemeRetirement() {
    if (!bulkTheme) return;
    const today = new Date().toISOString().slice(0, 10);
    setWanted(prev => prev.map(w => {
      if (String(w.theme || "").toLowerCase() !== String(bulkTheme).toLowerCase()) return w;
      return {
        ...w,
        ...(bulkYear ? { retirementYear: bulkYear } : {}),
        retirementConfidence: bulkConfidence,
        retirementSource: bulkSource,
        retiringSoon: bulkYear
          ? Number(bulkYear) <= new Date().getFullYear() + 1
          : w.retiringSoon,
        lastRetirementUpdate: today,
      };
    }));
    setBulkThemeOpen(false);
    setBulkTheme("");
    setBulkYear("");
  }

  function sortHeader(key) {
    if (sortKey === key) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection(key === "score" ? "desc" : "asc");
    }
  }

  function sortLabel(label, key) {
    if (sortKey !== key) return label;
    return `${label} ${sortDirection === "asc" ? "↑" : "↓"}`;
  }

  function copyBrickHound() {
    const cleanNum = String(form.setNumber || "").replace("-1", "").trim();
    const discount = form.targetDiscount || 20;
    navigator.clipboard.writeText(`@Brick Hound ${cleanNum} ${discount}%`);
    setBrickHoundCopied(true);
    setTimeout(() => setBrickHoundCopied(false), 1500);
  }

  function normalizeSetNumber(value) {
    const clean = String(value || "").trim().replace(/\s+/g, "");
    if (!clean) return "";
    return clean.includes("-") ? clean : `${clean}-1`;
  }

  const recBreakdown = useMemo(() => {
    const counts = { "Buy Now": 0, "Watch Closely": 0, "Safe to Wait": 0 };
    wanted.forEach(w => {
      const r = recommendation(priorityScore(w));
      counts[r] = (counts[r] || 0) + 1;
    });
    return [
      { name: "Buy Now", value: counts["Buy Now"], color: "#d01012" },
      { name: "Watch Closely", value: counts["Watch Closely"], color: "#f59e0b" },
      { name: "Safe to Wait", value: counts["Safe to Wait"], color: "#5aa832" },
    ].filter(d => d.value > 0);
  }, [wanted]);

  const recCounts = useMemo(() => {
    const counts = { "Buy Now": 0, "Watch Closely": 0, "Safe to Wait": 0 };
    wanted.forEach(w => { const r = recommendation(priorityScore(w)); counts[r] = (counts[r] || 0) + 1; });
    return counts;
  }, [wanted]);

  const retirementByYear = useMemo(() => {
    const cy = new Date().getFullYear();
    const counts = {};
    wanted.forEach(w => {
      const yr = Number(w.retirementYear);
      if (!yr) return;
      const key = yr <= cy ? "Overdue" : String(yr);
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => {
        if (a[0] === "Overdue") return -1;
        if (b[0] === "Overdue") return 1;
        return Number(a[0]) - Number(b[0]);
      })
      .map(([name, value]) => ({ name, value }));
  }, [wanted]);

  // Wave-aware timeline: groups sets into Jul/Dec waves using exit_date if present,
  // otherwise estimates from retirementYear (Jul wave for that year as default)
  const retirementWaves = useMemo(() => {
    const now = new Date();
    const cy = now.getFullYear();
    const waveMap = {};

    wanted.forEach(w => {
      let waveKey, waveSort;
      if (w.isLastChance) {
        waveKey = "🚨 Last Chance Now";
        waveSort = 0;
      } else if (w.exit_date) {
        const d = new Date(w.exit_date);
        const m = d.getMonth() + 1;
        const y = d.getFullYear();
        const isJul = m >= 5 && m <= 8;
        const isDec = m >= 10 || m <= 1;
        if (y < cy || (y === cy && d < now)) {
          waveKey = "⚠ Overdue";
          waveSort = 1;
        } else {
          waveKey = isJul ? `☀ Jul ${y}` : isDec ? `❄ Dec ${y}` : `${y}`;
          waveSort = y * 100 + (isJul ? 7 : 12);
        }
      } else if (w.retirementYear) {
        const yr = Number(w.retirementYear);
        if (!yr) return;
        if (yr < cy) {
          waveKey = "⚠ Overdue";
          waveSort = 1;
        } else {
          waveKey = `☀ Jul ${yr}`;  // best-guess wave
          waveSort = yr * 100 + 7;
        }
      } else {
        return; // no retirement data — skip
      }

      if (!waveMap[waveKey]) waveMap[waveKey] = { sort: waveSort, sets: [] };
      waveMap[waveKey].sets.push(w);
    });

    return Object.entries(waveMap)
      .sort((a, b) => a[1].sort - b[1].sort)
      .map(([label, { sets }]) => ({ label, sets }));
  }, [wanted]);

  const topPriorityItems = useMemo(() => {
    return [...wanted]
      .map(w => ({ ...w, _score: priorityScore(w) }))
      .sort((a, b) => b._score - a._score);
  }, [wanted]);

  // Extra card metrics
  const wlTotalMsrp = wanted.reduce((s, w) => s + asNumber(w.msrp), 0);
  const wlAvgMsrp = wanted.length ? wlTotalMsrp / wanted.length : 0;
  const wlOwnedCount = wanted.filter(w => ownedSetNumbers.has(String(w.setNumber || "").replace(/-1$/, ""))).length;
  const wlWatchCount = wanted.filter(w => w.status === "Watch").length;

  async function lookupBrickEconomy() {
    const lookupKey = normalizeSetNumber(form.setNumber);

    if (!lookupKey) {
      setLookupMessage("Enter a set number first.");
      return;
    }

    setLookupLoading(true);
    setLookupMessage("");

    try {
      const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");

      let setData = cache[lookupKey]?.data;

      if (!setData) {
        const res = await fetch(`/api/brickeconomy-set?number=${encodeURIComponent(lookupKey)}&currency=USD`);
        const data = await res.json();

        if (!res.ok || data.error) {
          setLookupMessage(data.message || data.error || "BrickEconomy lookup failed.");
          return;
        }

        setData = data.data || data;

        cache[lookupKey] = {
          fetchedAt: new Date().toISOString(),
          data: setData
        };

        localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
      }

      const retirementEstimate = estimateRetirementFromSet(setData);

      setForm(prev => ({
        ...prev,
        setNumber: setData.set_number || lookupKey,
        name: setData.name || prev.name,
        theme: setData.theme || prev.theme,
        msrp: setData.retail_price_us || prev.msrp,
        currentValue: setData.current_value_new || prev.currentValue,
        releaseYear: setData.year || Number(String(setData.released_date || "").slice(0, 4)) || prev.releaseYear,
        pieces: setData.pieces_count || prev.pieces,
        availability: setData.availability || prev.availability,
        retirementYear: prev.retirementYear,
        retirementConfidence: prev.retirementConfidence || retirementEstimate.retirementConfidence,
        retiringSoon: prev.retiringSoon,
        retirementSource: prev.retirementSource || "Manual",
        lastRetirementUpdate: prev.lastRetirementUpdate,
        forecast2yr: setData.forecast_value_new_2_years || prev.forecast2yr,
        forecast5yr: setData.forecast_value_new_5_years || prev.forecast5yr,
        targetPrice: setData.retail_price_us
          ? (Number(setData.retail_price_us) * (1 - Number(prev.targetDiscount || 0) / 100)).toFixed(2)
          : prev.targetPrice
      }));

      setLookupMessage(`Loaded ${setData.set_number || lookupKey} from ${cache[lookupKey] ? "cache/API" : "BrickEconomy"}.`);

      // Also fetch Brickset data and merge additional fields
      const bsData = await fetchBricksetSet(lookupKey);
      if (bsData) {
        const bsExtras = [];
        setForm(prev => {
          const updates = {
            subtheme:      prev.subtheme      || bsData.subtheme      || "",
            minifigs:      prev.minifigs      || bsData.minifigs      || "",
            weight:        prev.weight        || bsData.weight        || "",
            rating:        prev.rating        || bsData.rating        || "",
            packagingType: prev.packagingType || bsData.packaging_type || "",
            ageMin:        prev.ageMin        || bsData.age_min       || "",
          };

          // Official MSRP from Brickset overrides BrickEconomy (more reliable)
          if (bsData.retail_price_us) {
            updates.msrp = bsData.retail_price_us;
            if (asNumber(prev.targetDiscount) > 0) {
              updates.targetPrice = (bsData.retail_price_us * (1 - asNumber(prev.targetDiscount) / 100)).toFixed(2);
            }
            bsExtras.push("MSRP");
          }

          // Real retirement date from LEGO via Brickset — replaces estimate
          if (bsData.exit_date) {
            const exitDate = new Date(bsData.exit_date);
            const exitYear = exitDate.getFullYear();
            const currentYear = new Date().getFullYear();
            updates.exit_date            = bsData.exit_date;
            updates.retirementYear       = String(exitYear);
            updates.retirementConfidence = "High";
            updates.retiringSoon         = exitYear <= currentYear + 1;
            updates.retirementSource     = "Brickset";
            updates.lastRetirementUpdate = new Date().toISOString().slice(0, 10);
            bsExtras.push("retirement date");
          }

          return { ...prev, ...updates };
        });

        if (bsExtras.length > 0) {
          setLookupMessage(m => m + ` · Brickset: ${bsExtras.join(", ")}.`);
        }
      }
    } catch (err) {
      setLookupMessage(err.message || "Could not reach BrickEconomy.");
    } finally {
      setLookupLoading(false);
    }
  }

  function toggleChecked(index) {
    setCheckedWanted(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  }

  function toggleAllVisible() {
    const visibleIndexes = visibleWanted.map(item => wanted.indexOf(item));
    const allChecked = visibleIndexes.length > 0 && visibleIndexes.every(i => checkedWanted.includes(i));

    if (allChecked) {
      setCheckedWanted(prev => prev.filter(i => !visibleIndexes.includes(i)));
    } else {
      setCheckedWanted(prev => Array.from(new Set([...prev, ...visibleIndexes])));
    }
  }

  function deleteCheckedWanted() {
    if (checkedWanted.length === 0) return;
    if (!window.confirm(`Delete ${checkedWanted.length} buy list item(s)?`)) return;

    setWanted(prev => prev.filter((_, i) => !checkedWanted.includes(i)));
    setCheckedWanted([]);
    setSelectedWantedIndex(null);
  }

  function addWanted() {
    if (!form.setNumber && !form.name) return;

    setWanted(prev => [
      ...prev,
      {
        ...form,
        msrp: asNumber(form.msrp),
        targetDiscount: asNumber(form.targetDiscount),
        targetPrice: asNumber(form.targetPrice) || (
          asNumber(form.msrp)
            ? asNumber(form.msrp) * (1 - asNumber(form.targetDiscount) / 100)
            : 0
        ),
        priority: asNumber(form.priority) || 1
      }
    ]);

    setForm({
      setNumber: "", name: "", theme: "", msrp: "", targetDiscount: "", targetPrice: "",
      priority: 3, retiringSoon: false, status: "Watch", retirementYear: "",
      retirementConfidence: "Medium", notes: "", subtheme: "", minifigs: "",
      weight: "", rating: "", packagingType: "", ageMin: "",
      exit_date: "", isLastChance: false, forecast2yr: "", forecast5yr: "",
    });
  }

  function updateWanted(index, field, value) {
    setWanted(prev => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: ["msrp", "targetPrice", "priority"].includes(field)
          ? asNumber(value)
          : value
      };
      return next;
    });
  }

  function deleteWanted(index) {
    setWanted(prev => prev.filter((_, i) => i !== index));
  }

  return (
    <div style={page} onMouseMove={e => setTipPos({ x: e.clientX, y: e.clientY })} onTouchStart={() => setHoveredWanted(null)}>
      <div style={acTabHeader}>
        <div>
          <h2 style={{ margin: 0 }}>Wanted List</h2>
          <p style={{ ...muted, margin: "4px 0 0" }}>Sets on your radar — retirement alerts, target prices, and buy priorities.</p>
        </div>
        <div style={acTabBar}>
          {[
            { key: "overview", label: "Overview" },
            { key: "queue", label: "Buy List" },
            { key: "research", label: "Research" }
          ].map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)} style={subTab === t.key ? acActiveTab : acTabBtn}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {subTab === "overview" && (
        <>
          {/* ── Stat pill container ─────────────────────────────────── */}
          <div style={{ background: "rgba(11,21,32,0.7)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "14px 16px", marginBottom: 14, marginTop: 8, position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: wlPillsCollapsed ? 0 : 12 }}>
              <span style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Wanted List Stats</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setWlGearOpen(prev => !prev)} style={{ ...hoverCtrlBtn, color: wlGearOpen ? "#c9a84c" : "#8a9bb0" }} title="Show / hide stats">⚙</button>
                <button onClick={() => setWlPillsCollapsed(prev => !prev)} style={hoverCtrlBtn} title={wlPillsCollapsed ? "Expand" : "Collapse"}>{wlPillsCollapsed ? "▼" : "▲"}</button>
              </div>
            </div>

            {wlGearOpen && (
              <div style={{ position: "absolute", top: 46, right: 10, zIndex: 30, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "12px 16px", minWidth: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                <div style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Stats</div>
                {wlItems.filter(i => i.type === "card").map(item => (
                  <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: item.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                    <input type="checkbox" checked={item.visible} onChange={() => setWlItems(prev => prev.map(x => x.key === item.key ? { ...x, visible: !x.visible } : x))} style={{ accentColor: "#c9a84c" }} />
                    {item.label}
                  </label>
                ))}
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "10px 0 8px" }} />
                <div style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Panels</div>
                {wlItems.filter(i => i.type === "panel").map(item => (
                  <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: item.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                    <input type="checkbox" checked={item.visible} onChange={() => setWlItems(prev => prev.map(x => x.key === item.key ? { ...x, visible: !x.visible } : x))} style={{ accentColor: "#c9a84c" }} />
                    {item.label}
                  </label>
                ))}
              </div>
            )}

            {!wlPillsCollapsed && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                {wlItems.filter(i => i.type === "card" && i.visible).map(item => (
                  <div key={item.key} draggable
                    onDragStart={() => setDraggedWLItem(item.key)}
                    onDragEnd={() => setDraggedWLItem(null)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => dropWLItem(item.key)}
                    style={{ opacity: draggedWLItem === item.key ? 0.4 : 1, cursor: "grab" }}
                  >
                    {item.key === "wantedCount"  ? <Metric title="Wanted Sets"          value={wanted.length} /> :
                     item.key === "retiringSoon"  ? <Metric title="High Retirement Risk" value={wanted.filter(w => w.retiringSoon).length} /> :
                     item.key === "critical"      ? <Metric title="Critical / Buy Soon"  value={wanted.filter(w => ["Buy Soon", "Critical"].includes(w.status)).length} /> :
                     item.key === "avgScore"      ? (
                       <div style={{ ...panel, marginTop: 0, overflow: "hidden" }}>
                         <div style={{ ...mutedSmall, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 8 }}>Buy Readiness</div>
                         <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                           {[{ label: "Buy Now", color: "#ef4444" }, { label: "Watch Closely", color: "#f59e0b" }, { label: "Safe to Wait", color: "#5aa832" }].map(({ label, color }) => (
                             <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                               <span style={{ fontSize: 11, color, fontWeight: 700 }}>{label}</span>
                               <span style={{ fontSize: 18, fontWeight: 900, color: "#e8e2d5" }}>{recCounts[label]}</span>
                             </div>
                           ))}
                         </div>
                       </div>
                     ) :
                     item.key === "totalMsrp"     ? <Metric title="Total MSRP"           value={money(wlTotalMsrp)} /> :
                     item.key === "avgMsrp"       ? <Metric title="Avg MSRP"             value={money(wlAvgMsrp)} /> :
                     item.key === "ownedCount"    ? <Metric title="Already Owned"        value={wlOwnedCount} /> :
                     item.key === "watchCount"    ? <Metric title="Watch Status"         value={wlWatchCount} /> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Content panels ──────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14, alignItems: "start" }}>
            {wlItems.filter(item => item.type === "panel" && item.visible).map(item => {
              const gridCol = item.width === "full" ? "1 / -1" : "span 2";
              return (
                <div key={item.key}
                  style={{ gridColumn: gridCol, position: "relative" }}
                  draggable
                  onDragStart={() => setDraggedWLItem(item.key)}
                  onDragEnd={() => setDraggedWLItem(null)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => dropWLItem(item.key)}
                  onMouseEnter={() => setHoveredWLItem(item.key)}
                  onMouseLeave={() => setHoveredWLItem(null)}
                >
                  {hoveredWLItem === item.key && (
                    <div style={{ position: "absolute", top: 10, right: 10, zIndex: 20, display: "flex", gap: 4 }}>
                      {item.key === "urgency-chart" && (() => {
                        const ct = chartTypes["urgency-chart"] || "donut";
                        return (
                          <button onClick={e => { e.stopPropagation(); cycleChartType("urgency-chart"); }} style={hoverCtrlBtn}
                            title={`Chart: ${ct} — click to switch to ${ct === "donut" ? "Pie" : ct === "pie" ? "Bar" : "Donut"}`}>
                            {ct === "donut" ? "◎" : ct === "pie" ? "●" : "▬"}
                          </button>
                        );
                      })()}
                      <button onClick={e => { e.stopPropagation(); toggleWLWidth(item.key); }} style={hoverCtrlBtn} title={item.width === "full" ? "Half width" : "Full width"}>
                        {item.width === "full" ? "◧" : "▣"}
                      </button>
                      <button onClick={e => { e.stopPropagation(); toggleWLCollapse(item.key); }} style={hoverCtrlBtn} title={item.collapsed ? "Expand" : "Collapse"}>
                        {item.collapsed ? "▼" : "▲"}
                      </button>
                    </div>
                  )}

                  {item.collapsed ? (
                      <div style={{ ...panel, marginTop: 0, padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: "#8a9bb0", fontSize: 14 }}>{item.label}</span>
                        <button onClick={() => toggleWLCollapse(item.key)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "4px 10px", color: "#8a9bb0", fontSize: 12, cursor: "pointer" }}>▼</button>
                      </div>
                    ) : item.key === "urgency-chart" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 14px" }}>Queue Urgency</h4>
                        {recBreakdown.length > 0 ? (
                          <>
                            {(() => {
                              const ct = chartTypes["urgency-chart"] || "donut";
                              return ct === "bar" ? (
                                <ResponsiveContainer width="100%" height={190}>
                                  <BarChart data={recBreakdown} margin={{ left: 10, right: 10, top: 5, bottom: 24 }}>
                                    <XAxis dataKey="name" tick={{ fill: "#8a9bb0", fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: "#8a9bb0", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                    <Tooltip contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                      {recBreakdown.map((d, i) => <Cell key={i} fill={d.color} />)}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              ) : (
                                <ResponsiveContainer width="100%" height={190}>
                                  <PieChart>
                                    <Pie data={recBreakdown} cx="50%" cy="50%" innerRadius={ct === "donut" ? 52 : 0} outerRadius={82} dataKey="value" paddingAngle={ct === "donut" ? 2 : 1}>
                                      {recBreakdown.map((d, i) => <Cell key={i} fill={d.color} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                                  </PieChart>
                                </ResponsiveContainer>
                              );
                            })()}
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 6 }}>
                              {recBreakdown.map(d => (
                                <span key={d.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#8a9bb0" }}>
                                  <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, display: "inline-block", flexShrink: 0 }} />
                                  {d.name} <strong style={{ color: "#e8e2d5" }}>({d.value})</strong>
                                </span>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div style={{ textAlign: "center", padding: "28px 20px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10 }}>
                            <div style={{ fontWeight: 700, color: "#8a9bb0", marginBottom: 4 }}>No urgency data yet</div>
                            <div style={{ fontSize: 13, color: "#5d6f80" }}>Add sets and set statuses to see queue urgency.</div>
                          </div>
                        )}
                      </div>
                    ) : item.key === "top-priority" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 14px" }}>Top Priority Items</h4>
                        {topPriorityItems.length > 0 ? (
                          <div style={{ display: "grid", gap: 8 }}>
                            {topPriorityItems.slice(0, showAllTopPriority ? 15 : 5).map((wlItem, i) => {
                              const rec = recommendation(wlItem._score);
                              const recColor = rec === "Buy Now" ? "#ef4444" : rec === "Watch Closely" ? "#f59e0b" : "#5aa832";
                              const realIndex = wanted.findIndex(w => w.setNumber === wlItem.setNumber && w.name === wlItem.name);
                              const isOwned = ownedSetNumbers.has(String(wlItem.setNumber || "").replace(/-1$/, ""));
                              return (
                                <div key={wlItem.setNumber || i}
                                  onClick={() => { setDetailItem(wlItem); setDetailItemIndex(realIndex); }}
                                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; setHoveredWanted(wlItem); }}
                                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; setHoveredWanted(null); }}
                                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0f1a28", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "9px 12px", cursor: "pointer" }}>
                                  <div>
                                    <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                                      {wlItem.name || wlItem.setNumber || "—"}
                                      {isOwned && <span style={{ fontSize: 11, background: "#0a2e1a", border: "1px solid #166534", color: "#5aa832", borderRadius: 999, padding: "2px 7px", fontWeight: 700 }}>✓ Owned</span>}
                                    </div>
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
                            {topPriorityItems.length > 5 && (
                              <button onClick={() => setShowAllTopPriority(prev => !prev)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 12px", color: "#8a9bb0", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                                {showAllTopPriority ? "▲ Show less" : `▾ ${Math.min(topPriorityItems.length, 15) - 5} more`}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ textAlign: "center", padding: "28px 20px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10 }}>
                            <div style={{ fontWeight: 700, color: "#8a9bb0", marginBottom: 4 }}>Watch list is empty</div>
                            <div style={{ fontSize: 13, color: "#5d6f80" }}>Add a set using Research to start tracking prices and retirement dates.</div>
                          </div>
                        )}
                      </div>
                    ) : item.key === "retirement-timeline" && retirementWaves.length > 0 ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 16px" }}>Retirement Wave Timeline</h4>
                        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                          {retirementWaves.map(({ label, sets }) => {
                            const isUrgent = label.startsWith("🚨") || label.startsWith("⚠");
                            const borderColor = isUrgent ? "#7f1d1d" : "rgba(255,255,255,0.08)";
                            const labelColor = isUrgent ? "#ef4444" : "#c9a84c";
                            return (
                              <div key={label}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                                  <span style={{ color: labelColor, fontWeight: 800, fontSize: 14 }}>{label}</span>
                                  <span style={{ color: "#8a9bb0", fontSize: 12 }}>— {sets.length} {sets.length === 1 ? "set" : "sets"}</span>
                                  <div style={{ flex: 1, height: 1, background: borderColor }} />
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                  {sets.map((w, i) => {
                                    const sc = priorityScore(w);
                                    const chipBg = w.isLastChance ? "#3b0a0a"
                                      : sc >= 70 ? "#1a0a00"
                                      : "#0f1a28";
                                    const chipBorder = w.isLastChance ? "#7f1d1d"
                                      : sc >= 70 ? "rgba(245,158,11,0.35)"
                                      : "rgba(255,255,255,0.07)";
                                    const chipColor = w.isLastChance ? "#ef4444"
                                      : sc >= 70 ? "#f59e0b"
                                      : "#e8e2d5";
                                    return (
                                      <div
                                        key={i}
                                        onClick={() => { setDetailItem(w); setDetailItemIndex(wanted.indexOf(w)); }}
                                        style={{ background: chipBg, border: `1px solid ${chipBorder}`, borderRadius: 10, padding: "8px 12px", cursor: "pointer", minWidth: 140 }}
                                      >
                                        <div style={{ fontSize: 11, color: "#8a9bb0", marginBottom: 3 }}>#{w.setNumber}</div>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: chipColor, marginBottom: 4, lineHeight: 1.3 }}>
                                          {w.name || w.setNumber}
                                        </div>
                                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                          {w.exit_date && (() => {
                                            const days = daysUntilRetirement(w.exit_date);
                                            return <span style={{ fontSize: 11, color: days <= 60 ? "#ef4444" : days <= 180 ? "#f59e0b" : "#5aa832" }}>{days <= 0 ? "past date" : `${days}d`}</span>;
                                          })()}
                                          <span style={{ fontSize: 11, color: "#8a9bb0" }}>Score: {sc}</span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}

      {subTab === "research" && (
      <>

      {/* ── Store Price Calculator ── */}
      <section style={panel}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: "#e8e2d5" }}>Store Price Calculator</div>
          {(calcSetNum || calcMsrp || calcStore) && (
            <button
              onClick={() => { setCalcSetNum(""); setCalcMsrp(""); setCalcStore(""); setCalcMsg(""); }}
              style={{ background: "transparent", color: "#5d6f80", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
              Reset
            </button>
          )}
        </div>
        <div style={{ color: "#8a9bb0", fontSize: 13, marginBottom: 18 }}>
          Spotted a deal? Enter the store price to instantly see your real discount.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={calcLabel}>Set # <span style={{ color: "#5d6f80", fontWeight: 400 }}>(optional)</span></div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={calcSetNum}
                onChange={e => setCalcSetNum(e.target.value)}
                onKeyDown={e => e.key === "Enter" && lookupCalcSet()}
                placeholder="e.g. 75313"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button onClick={lookupCalcSet} disabled={calcLoading} style={calcLookupBtn}>
                {calcLoading ? "…" : "↓"}
              </button>
            </div>
          </div>
          <div>
            <div style={calcLabel}>MSRP</div>
            <input value={calcMsrp} onChange={e => setCalcMsrp(e.target.value)} placeholder="e.g. 849.99" type="number" step="0.01" style={inputStyle} />
          </div>
          <div>
            <div style={calcLabel}>Store Price</div>
            <input value={calcStore} onChange={e => setCalcStore(e.target.value)} placeholder="e.g. 599.99" type="number" step="0.01"
              style={{ ...inputStyle, borderColor: calcStore ? "rgba(201,168,76,0.4)" : undefined }} />
          </div>
        </div>

        {calcMsg && <div style={{ fontSize: 13, color: "#8a9bb0", marginBottom: 12 }}>{calcMsg}</div>}

        {calcDiscount !== null ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
            <div style={{ ...calcCard, borderColor: `${calcDiscountColor()}40` }}>
              <div style={calcCardLabel}>Discount</div>
              <div style={{ fontWeight: 900, fontSize: 28, color: calcDiscountColor() }}>{calcDiscount.toFixed(1)}%</div>
              {calcDiscountLabel() && <div style={{ fontSize: 12, color: calcDiscountColor(), fontWeight: 700, marginTop: 4 }}>{calcDiscountLabel()}</div>}
            </div>
            <div style={calcCard}>
              <div style={calcCardLabel}>You Save</div>
              <div style={{ fontWeight: 900, fontSize: 20, color: "#e8e2d5" }}>{money(Math.max(calcSavings, 0))}</div>
            </div>
            <div style={calcCard}>
              <div style={calcCardLabel}>You Pay</div>
              <div style={{ fontWeight: 900, fontSize: 20, color: "#e8e2d5" }}>{money(calcStoreVal)}</div>
            </div>
            <div style={calcCard}>
              <div style={calcCardLabel}>MSRP</div>
              <div style={{ fontWeight: 900, fontSize: 20, color: "#5d6f80" }}>{money(calcMsrpVal)}</div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "20px 16px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10, color: "#5d6f80", fontSize: 13 }}>
            Enter MSRP and store price to calculate the discount.
          </div>
        )}

      </section>

      {/* ── Research & Add Set ── */}
      <section style={panel}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Research & Add Set</h3>
          {(form.setNumber || form.name || form.theme || form.msrp || form.storePrice || form.notes) && (
            <button
              onClick={() => {
                setForm({ setNumber: "", name: "", theme: "", msrp: "", targetDiscount: "", targetPrice: "", storePrice: "", priority: 3, retiringSoon: false, status: "Watch", retirementYear: "", retirementConfidence: "Medium", releaseYear: "", pieces: "", currentValue: "", availability: "", retirementSource: "Brick Fanatics", lastRetirementUpdate: "", notes: "", subtheme: "", minifigs: "", weight: "", rating: "", packagingType: "", ageMin: "", exit_date: "", isLastChance: false, forecast2yr: "", forecast5yr: "" });
                setLookupMessage("");
              }}
              style={{ background: "transparent", color: "#5d6f80", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
              Reset
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
          <input
            placeholder="Set Number (e.g. 75192)"
            value={form.setNumber}
            onChange={e => setForm({ ...form, setNumber: e.target.value })}
            onKeyDown={e => e.key === "Enter" && lookupBrickEconomy()}
            style={{ minWidth: 180 }}
          />

          <button onClick={lookupBrickEconomy} style={{ ...redBtn, marginTop: 0 }} disabled={lookupLoading}>
            {lookupLoading ? "Searching..." : "Search"}
          </button>

          {lookupMessage && <span style={mutedSmall}>{lookupMessage}</span>}
        </div>

        {(form.name || form.theme || form.msrp) && (
          <div style={intelligenceCard}>
            <img
              src={setImageUrl(form.setNumber)}
              alt=""
              style={setPreview}
              onError={e => {
                e.currentTarget.style.display = "none";
              }}
            />

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 900 }}>
                {form.setNumber || "—"} {form.name || ""}
              </div>

              <div style={mutedSmall}>
                {form.theme || "—"} • Released {form.releaseYear || "—"} • {form.pieces || "—"} pieces
              </div>

              <div style={statGrid}>
                <div style={miniStat}>
                  <div style={miniLabel}>MSRP</div>
                  <div style={miniValue}>{money(form.msrp)}</div>
                </div>

                <div style={miniStat}>
                  <div style={miniLabel}>Current Value</div>
                  <div style={miniValue}>{form.currentValue ? money(form.currentValue) : "—"}</div>
                </div>

                <div style={miniStat}>
                  <div style={miniLabel}>Target</div>
                  <div style={miniValue}>{form.targetPrice ? money(form.targetPrice) : "—"}</div>
                </div>

                <div style={miniStat}>
                  <div style={miniLabel}>Availability</div>
                  <div style={miniValue}>{form.availability || "—"}</div>
                </div>
                {form.forecast2yr && (
                  <div style={miniStat}>
                    <div style={miniLabel}>2yr Forecast</div>
                    <div style={{ ...miniValue, color: "#5aa832" }}>{money(form.forecast2yr)}</div>
                  </div>
                )}
                {form.forecast5yr && (
                  <div style={miniStat}>
                    <div style={miniLabel}>5yr Forecast</div>
                    <div style={{ ...miniValue, color: "#5aa832" }}>{money(form.forecast5yr)}</div>
                  </div>
                )}
              </div>

              {/* ── Retirement banner ── */}
              {(form.isLastChance || form.exit_date || form.retirementYear) && (() => {
                const days  = form.exit_date ? daysUntilRetirement(form.exit_date) : null;
                const wave  = form.exit_date ? retirementWaveLabel(form.exit_date) : null;
                const label = form.isLastChance
                  ? "🚨 LAST CHANCE TO BUY"
                  : wave || (form.retirementYear ? `Retires ${form.retirementYear}` : null);
                const urgentColor = (form.isLastChance || (days !== null && days <= 60)) ? "#ef4444" : "#f59e0b";
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, padding: "8px 12px", background: `${urgentColor}12`, border: `1px solid ${urgentColor}35`, borderRadius: 8 }}>
                    <span style={{ color: urgentColor, fontSize: 16 }}>⏱</span>
                    <div>
                      <span style={{ color: urgentColor, fontWeight: 800, fontSize: 13 }}>{label}</span>
                      {days !== null && !form.isLastChance && (
                        <span style={{ color: "#8a9bb0", fontSize: 12, marginLeft: 8 }}>
                          {days <= 0 ? "past exit date" : `${days} days remaining`}
                        </span>
                      )}
                      {form.retirementSource && form.retirementSource !== "Brick Fanatics" && (
                        <span style={{ color: "#5d6f80", fontSize: 11, marginLeft: 8 }}>via {form.retirementSource}</span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {form.storePrice && (
                <div style={analysisPanel}>
                  <div style={analysisGrid}>
                    <div style={analysisStat}>
                      <div style={analysisLabel}>Store Price</div>
                      <div style={analysisValue}>{money(form.storePrice)}</div>
                    </div>

                    <div style={analysisStat}>
                      <div style={analysisLabel}>Live Discount</div>
                      <div style={analysisValue}>
                        {liveDiscount.toFixed(1)}%
                      </div>
                    </div>

                    <div style={analysisStat}>
                      <div style={analysisLabel}>Savings</div>
                      <div style={analysisValue}>
                        {money(projectedSavings)}
                      </div>
                    </div>

                    <div style={analysisStat}>
                      <div style={analysisLabel}>Target Goal</div>
                      <div style={{
                        ...analysisValue,
                        color: targetHit ? "#4ade80" : "#f87171"
                      }}>
                        {targetHit ? "TARGET HIT" : "ABOVE TARGET"}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <span style={scoreChip(priorityScore(form))}>
                  Score {priorityScore(form)}
                </span>

                <span style={recommendationChip(priorityScore(form))}>
                  {recommendation(priorityScore(form))}
                </span>
</div>
            </div>
          </div>
        )}

        {/* ── Retirement Intel panel ────────────────────────────────────────── */}
        {form.setNumber && (
          <div style={{ background: "rgba(11,21,32,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Retirement Intel</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>

              {/* LEGO Official Last Chance */}
              <div style={{ background: "#0b1520", border: `1px solid ${isLastChanceSet(form.setNumber, lastChanceCodes) ? "#ef444440" : "rgba(255,255,255,0.06)"}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>LEGO Official</div>
                {isLastChanceSet(form.setNumber, lastChanceCodes)
                  ? <div style={{ color: "#ef4444", fontWeight: 800, fontSize: 13 }}>🚨 Last Chance to Buy</div>
                  : <div style={{ color: "#5d6f80", fontSize: 13 }}>Not on Last Chance list</div>}
              </div>

              {/* Brickset exit date */}
              <div style={{ background: "#0b1520", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Brickset</div>
                {form.exit_date
                  ? (() => {
                      const days = daysUntilRetirement(form.exit_date);
                      const wave = retirementWaveLabel(form.exit_date);
                      const color = days <= 60 ? "#ef4444" : days <= 180 ? "#f59e0b" : "#5aa832";
                      return (
                        <>
                          <div style={{ color, fontWeight: 800, fontSize: 13 }}>{wave || `Retires ${form.retirementYear}`}</div>
                          <div style={{ color: "#5d6f80", fontSize: 11, marginTop: 2 }}>
                            {days <= 0 ? "Past exit date" : `${days} days`}
                          </div>
                        </>
                      );
                    })()
                  : <div style={{ color: "#5d6f80", fontSize: 13 }}>{form.retirementYear ? `Est. ${form.retirementYear}` : "No exit date"}</div>}
              </div>

              {/* Source */}
              <div style={{ background: "#0b1520", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Source</div>
                <div style={{ color: "#e8e2d5", fontSize: 13, fontWeight: 700 }}>{form.retirementSource || "—"}</div>
                <div style={{ color: "#5d6f80", fontSize: 11, marginTop: 2 }}>{form.retirementConfidence ? `${form.retirementConfidence} confidence` : ""}</div>
              </div>

              {/* BrickEconomy Investment Forecast */}
              {(form.currentValue || form.forecast2yr || form.forecast5yr) && (
                <div style={{ background: "#0b1520", border: "1px solid rgba(90,168,50,0.15)", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Investment</div>
                  {form.currentValue && (
                    <div style={{ fontSize: 12, color: "#e8e2d5", marginBottom: 2 }}>
                      <span style={{ color: "#5d6f80" }}>Mkt: </span>{money(form.currentValue)}
                      {form.msrp && asNumber(form.msrp) > 0 && (
                        <span style={{ marginLeft: 6, color: asNumber(form.currentValue) >= asNumber(form.msrp) ? "#5aa832" : "#ff8b8b", fontWeight: 700, fontSize: 11 }}>
                          ({asNumber(form.currentValue) >= asNumber(form.msrp) ? "+" : ""}{(((asNumber(form.currentValue) - asNumber(form.msrp)) / asNumber(form.msrp)) * 100).toFixed(0)}%)
                        </span>
                      )}
                    </div>
                  )}
                  {form.forecast2yr && <div style={{ fontSize: 12, color: "#5aa832", marginBottom: 2 }}><span style={{ color: "#5d6f80" }}>2yr: </span>{money(form.forecast2yr)}</div>}
                  {form.forecast5yr && <div style={{ fontSize: 12, color: "#5aa832" }}><span style={{ color: "#5d6f80" }}>5yr: </span>{money(form.forecast5yr)}</div>}
                </div>
              )}
            </div>

            {/* External links */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(() => {
                const clean = String(form.setNumber || "").replace(/-1$/, "");
                const theme = encodeURIComponent((form.theme || "") + " retiring");
                const links = [
                  { label: "Brick Fanatics ↗", url: `https://www.brickfanatics.com/?s=${theme}`, color: "#c9a84c" },
                  { label: "Brickset ↗", url: form.brickset_url || `https://brickset.com/sets/${clean}-1`, color: "#3b82f6" },
                  { label: "BrickEconomy ↗", url: `https://www.brickeconomy.com/set/${clean}-1`, color: "#10b981" },
                  { label: "LEGO Last Chance ↗", url: "https://www.lego.com/en-us/categories/last-chance-to-buy", color: "#ef4444" },
                ];
                return links.map(({ label, url, color }) => (
                  <a key={label} href={url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color, fontWeight: 700, padding: "5px 10px", borderRadius: 6, border: `1px solid ${color}30`, background: `${color}10`, textDecoration: "none", whiteSpace: "nowrap" }}>
                    {label}
                  </a>
                ));
              })()}
            </div>
          </div>
        )}

        {form.setNumber && (
          <div style={brickHoundBar}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={mutedSmall}>Discord:</span>
              <code style={brickHoundCode}>
                @Brick Hound {String(form.setNumber).replace("-1", "")} {form.targetDiscount || 20}%
              </code>
              <button onClick={copyBrickHound} style={copyBtn}>
                {brickHoundCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <div style={workflowGrid}>
          <div style={fieldGroup}>
            <div style={groupTitle}>Set Details</div>

            <input style={inputStyle} placeholder="Set Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input style={inputStyle} placeholder="Theme" value={form.theme} onChange={e => setForm({ ...form, theme: e.target.value })} />
            <input style={inputStyle} placeholder="MSRP" type="number" step="0.01" value={form.msrp} onChange={e => setForm({ ...form, msrp: e.target.value })} />
          </div>

          <div style={fieldGroup}>
            <div style={groupTitle}>Deal Target</div>

            <input
              style={inputStyle}
              placeholder="Target Discount %"
              type="number"
              step="1"
              value={form.targetDiscount}
              onChange={e => {
                const discount = e.target.value;
                const msrp = asNumber(form.msrp);
                setForm({
                  ...form,
                  targetDiscount: discount,
                  targetPrice: msrp && discount !== "" ? (msrp * (1 - asNumber(discount) / 100)).toFixed(2) : ""
                });
              }}
            />

            <input style={inputStyle} placeholder="Generated Target Price" type="number" step="0.01" value={form.targetPrice} onChange={e => setForm({ ...form, targetPrice: e.target.value })} />
            <input style={inputStyle} placeholder="Store Price" type="number" step="0.01" value={form.storePrice || ""} onChange={e => setForm({ ...form, storePrice: e.target.value })} />
          </div>

          <div style={fieldGroup}>
            <div style={groupTitle}>Buying Plan</div>

            <select style={inputStyle} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
              <option value="1">Priority 1</option>
              <option value="2">Priority 2</option>
              <option value="3">Priority 3</option>
              <option value="4">Priority 4</option>
              <option value="5">Priority 5</option>
            </select>

            <select style={inputStyle} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option>Watch</option>
              <option>Buy Soon</option>
              <option>Critical</option>
              <option>Owned</option>
            </select>

            <label style={{ ...checkLabel, marginTop: 4 }}>
              <input type="checkbox" checked={!!form.isLastChance}
                onChange={e => setForm({ ...form, isLastChance: e.target.checked })} />
              🚨 On LEGO Last Chance to Buy
            </label>

            <input style={inputStyle} placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        {form.storePrice && (
          <div style={analysisPanel}>
            <div style={analysisGrid}>
              <div style={analysisCard}>
                <div style={analysisLabel}>Store Price</div>
                <div style={analysisValue}>{money(form.storePrice)}</div>
              </div>

              <div style={analysisCard}>
                <div style={analysisLabel}>Live Discount</div>
                <div style={{ ...analysisValue, color: targetHit ? "#4ade80" : "#f87171" }}>
                  {liveDiscount.toFixed(1)}%
                </div>
              </div>

              <div style={analysisCard}>
                <div style={analysisLabel}>Savings</div>
                <div style={analysisValue}>{money(projectedSavings)}</div>
              </div>

              <div style={analysisCard}>
                <div style={analysisLabel}>Target Goal</div>
                <div style={{ ...analysisValue, color: targetHit ? "#4ade80" : "#f87171" }}>
                  {targetHit ? "TARGET HIT" : "MISS"}
                </div>
              </div>
            </div>
          </div>
        )}

        <button onClick={addWanted} style={redBtn}>Add to Buy List</button>
      </section>
      </>
      )}

      {subTab === "queue" && (() => {
        const lcSets = wanted.filter(w => w.isLastChance && w.setNumber && !lcAlertDismissed.includes(String(w.setNumber)));
        return (
        <>
        {lcSets.length > 0 && (
          <div style={{ background: "#3b0a0a", border: "1px solid #7f1d1d", borderRadius: 12, padding: "14px 18px", marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 14 }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>🚨</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#ef4444", fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
                Last Chance Alert — {lcSets.length} {lcSets.length === 1 ? "set" : "sets"} confirmed retiring
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {lcSets.map(w => (
                  <span key={w.setNumber}
                    onClick={() => { setDetailItem(w); setDetailItemIndex(wanted.indexOf(w)); }}
                    style={{ background: "#4a0a0a", border: "1px solid #991b1b", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#fca5a5", cursor: "pointer", fontWeight: 700 }}
                  >
                    #{w.setNumber} {w.name ? `— ${w.name}` : ""}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => {
                const newDismissed = [...lcAlertDismissed, ...lcSets.map(w => String(w.setNumber))];
                setLcAlertDismissed(newDismissed);
                localStorage.setItem("blLCAlertDismissed", JSON.stringify(newDismissed));
              }}
              style={{ background: "transparent", border: "1px solid #7f1d1d", color: "#8a9bb0", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12, flexShrink: 0 }}
            >
              Dismiss
            </button>
          </div>
        )}
      <section style={panel}>
        <div style={row}>
          <h3>Buy List</h3>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Search buy list..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={searchInput}
          />

          <select value={filterTheme} onChange={e => setFilterTheme(e.target.value)} style={filterSelect}>
            <option value="">All Themes</option>
            {acquisitionThemes.map(theme => (
              <option key={theme} value={theme}>{theme}</option>
            ))}
          </select>

          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={filterSelect}>
            <option value="">All Statuses</option>
            {acquisitionStatuses.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>

          {(search || filterTheme || filterStatus) && (
            <button
              onClick={() => {
                setSearch("");
                setFilterTheme("");
                setFilterStatus("");
              }}
              style={clearFilterButton}
            >
              Clear
            </button>
          )}

          {/* Column visibility gear */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => { setColGearOpen(o => !o); setBulkThemeOpen(false); }}
              title="Show/hide columns"
              style={{
                background: colGearOpen ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#c9a84c", borderRadius: 8, padding: "7px 12px",
                cursor: "pointer", fontWeight: 700, fontSize: 14, lineHeight: 1
              }}
            >
              ⚙ Columns
            </button>
            {colGearOpen && (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200,
                  background: "#0d1623", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 12, padding: "14px 16px", minWidth: 240,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", gap: 12
                }}
              >
                {[
                  { id: "intelligence", label: "🧠 Intelligence" },
                  { id: "core",         label: "📋 Core" },
                  { id: "retirement",   label: "🔥 Retirement" },
                  { id: "pricing",      label: "💰 Pricing" },
                  { id: "details",      label: "📦 Details" },
                ].map(grp => (
                  <div key={grp.id}>
                    <div style={{ color: "#8a9bb0", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                      {grp.label}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {columns.filter(c => c.group === grp.id).map(col => (
                        <label key={col.key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "#e8e2d5" }}>
                          <input
                            type="checkbox"
                            checked={col.visible}
                            onChange={() => setColumns(prev => prev.map(c => c.key === col.key ? { ...c, visible: !c.visible } : c))}
                          />
                          {col.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setColumns(DEFAULT_WANTED_COLUMNS)}
                  style={{ marginTop: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#8a9bb0", borderRadius: 7, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}
                >
                  Reset to defaults
                </button>

                {/* Custom fields section inside column gear */}
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12, marginTop: 4 }}>
                  <div style={{ color: "#8a9bb0", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                    ✦ Custom Fields
                  </div>
                  {customFieldsSchema.map(cf => (
                    <div key={cf.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <input
                        type="checkbox"
                        checked={columns.some(c => c.key === cf.id && c.visible)}
                        onChange={e => {
                          setColumns(prev => {
                            const exists = prev.find(c => c.key === cf.id);
                            if (exists) return prev.map(c => c.key === cf.id ? { ...c, visible: e.target.checked } : c);
                            return [...prev, { key: cf.id, label: cf.label, visible: e.target.checked, group: "custom" }];
                          });
                        }}
                      />
                      <span style={{ fontSize: 13, color: "#e8e2d5", flex: 1 }}>{cf.label}</span>
                      <span style={{ fontSize: 11, color: "#5d6f80", background: "rgba(255,255,255,0.04)", borderRadius: 4, padding: "1px 5px" }}>{cf.type}</span>
                      <button onClick={() => removeCustomField(cf.id)} style={{ background: "transparent", border: "none", color: "#7f1d1d", cursor: "pointer", fontSize: 14, padding: "0 2px" }}>✕</button>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <input
                      value={newCfLabel}
                      onChange={e => setNewCfLabel(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addCustomField()}
                      placeholder="Field name…"
                      style={{ flex: 1, background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "5px 8px", color: "#e8e2d5", fontSize: 12 }}
                    />
                    <select value={newCfType} onChange={e => setNewCfType(e.target.value)}
                      style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "5px 6px", color: "#8a9bb0", fontSize: 12 }}>
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="checkbox">Check</option>
                      <option value="date">Date</option>
                    </select>
                    <button onClick={addCustomField} style={{ background: "#1a3a1a", border: "1px solid #166534", color: "#5aa832", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>+</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bulk theme retirement update */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => { setBulkThemeOpen(o => !o); setColGearOpen(false); }}
              title="Apply retirement data to all sets of a theme"
              style={{
                background: bulkThemeOpen ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#c9a84c", borderRadius: 8, padding: "7px 12px",
                cursor: "pointer", fontWeight: 700, fontSize: 14, lineHeight: 1
              }}
            >
              🔥 Bulk Retire
            </button>
            {bulkThemeOpen && (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200,
                  background: "#0d1623", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 12, padding: "16px", minWidth: 280,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", gap: 12
                }}
              >
                <div style={{ color: "#c9a84c", fontWeight: 800, fontSize: 13 }}>Bulk Theme Retirement Update</div>
                <div style={{ color: "#8a9bb0", fontSize: 12, lineHeight: 1.4 }}>
                  Apply retirement data to all Buy List items matching a theme.
                </div>
                <label style={{ fontSize: 12, color: "#e8e2d5" }}>
                  Theme
                  <select
                    value={bulkTheme}
                    onChange={e => setBulkTheme(e.target.value)}
                    style={{ ...filterSelect, display: "block", width: "100%", marginTop: 4 }}
                  >
                    <option value="">— pick a theme —</option>
                    {acquisitionThemes.map(t => (
                      <option key={t} value={t}>{t} ({wanted.filter(w => w.theme === t).length})</option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 12, color: "#e8e2d5" }}>
                  Retirement Year <span style={{ color: "#8a9bb0" }}>(leave blank to keep existing)</span>
                  <input
                    type="number"
                    value={bulkYear}
                    onChange={e => setBulkYear(e.target.value)}
                    placeholder="e.g. 2026"
                    style={{ display: "block", width: "100%", marginTop: 4, background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7, padding: "6px 10px", color: "#e8e2d5", fontSize: 13 }}
                  />
                </label>
                <label style={{ fontSize: 12, color: "#e8e2d5" }}>
                  Confidence
                  <select
                    value={bulkConfidence}
                    onChange={e => setBulkConfidence(e.target.value)}
                    style={{ ...filterSelect, display: "block", width: "100%", marginTop: 4 }}
                  >
                    <option>High</option>
                    <option>Medium</option>
                    <option>Low</option>
                  </select>
                </label>
                <label style={{ fontSize: 12, color: "#e8e2d5" }}>
                  Source
                  <select
                    value={bulkSource}
                    onChange={e => setBulkSource(e.target.value)}
                    style={{ ...filterSelect, display: "block", width: "100%", marginTop: 4 }}
                  >
                    <option>LEGO Last Chance</option>
                    <option>Brickset</option>
                    <option>BrickEconomy</option>
                    <option>Brick Fanatics</option>
                    <option>StoneWars</option>
                    <option>Manual</option>
                  </select>
                </label>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button
                    onClick={applyBulkThemeRetirement}
                    disabled={!bulkTheme}
                    style={{
                      flex: 1, background: bulkTheme ? "#1a3a1a" : "#1a2028",
                      border: `1px solid ${bulkTheme ? "#166534" : "rgba(255,255,255,0.08)"}`,
                      color: bulkTheme ? "#5aa832" : "#4a5568",
                      borderRadius: 8, padding: "8px 14px", cursor: bulkTheme ? "pointer" : "not-allowed",
                      fontWeight: 800, fontSize: 13
                    }}
                  >
                    Apply to {bulkTheme ? wanted.filter(w => w.theme === bulkTheme).length : 0} sets
                  </button>
                  <button
                    onClick={() => setBulkThemeOpen(false)}
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#8a9bb0", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13 }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          </div>
        </div>

        {wanted.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={visibleWanted.length > 0 && visibleWanted.every(item => checkedWanted.includes(wanted.indexOf(item)))}
              onChange={toggleAllVisible}
            />
            Check All
          </label>

          {checkedWanted.length > 0 && (
            <button
              onClick={deleteCheckedWanted}
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
              Delete Selected ({checkedWanted.length})
            </button>
          )}
        </div>
        )}

        <div style={{
          display: "grid",
          gridTemplateColumns: selectedWantedIndex !== null ? "1fr 380px" : "1fr",
          gap: 16,
          alignItems: "start"
        }}>
          <div style={{ overflow: "auto", maxHeight: 620, marginTop: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={{ ...th, ...stickyCheckbox }}></th>

                {columns.filter(col => col.visible).map(col => (
                  <th
                    key={col.key}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", col.key);
                      setDraggedColumn(col.key);
                    }}
                    onDragEnd={() => setDraggedColumn(null)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      dropColumn(col.key);
                    }}
                    style={{
                      ...(isNumericColumn(col.key) ? thRightButton : thButton),
                      opacity: draggedColumn === col.key ? 0.45 : 1
                    }}
                    onClick={() => sortHeader(col.key === "recommendation" ? "score" : col.key)}
                    title="Drag to reorder. Click to sort."
                  >
                    ☰ {sortLabel(col.label, col.key === "recommendation" ? "score" : col.key)}
                  </th>
                ))}

              </tr>
            </thead>

            <tbody>
              {visibleWanted.map(item => {
                const realIndex = wanted.indexOf(item);
                const discount = asNumber(item.msrp)
                  ? ((asNumber(item.msrp) - asNumber(item.targetPrice)) / asNumber(item.msrp)) * 100
                  : 0;

                return (
                  <tr
                    key={`${item.setNumber}-${realIndex}`}
                    onClick={() => { setDetailItem(item); setDetailItemIndex(realIndex); }}
                    onDoubleClick={() => setSelectedWantedIndex(realIndex)}
                    onMouseEnter={e => {
                      if (selectedWantedIndex !== realIndex) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                      setHoveredWanted(item);
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = selectedWantedIndex === realIndex ? "#332500" : "transparent";
                      setHoveredWanted(null);
                    }}
                    style={{
                      cursor: "pointer",
                      background: selectedWantedIndex === realIndex ? "#332500" : "transparent",
                      transition: "background 0.12s ease"
                    }}
                  >
                    <td style={{ ...td, ...stickyCheckbox }} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checkedWanted.includes(realIndex)}
                        onChange={() => toggleChecked(realIndex)}
                      />
                    </td>

                    {columns.filter(col => col.visible).map(col => (
                      <td
                        key={col.key}
                        style={isNumericColumn(col.key) ? tdRight : td}
                        onClick={["status", "retiringSoon"].includes(col.key) ? e => e.stopPropagation() : undefined}
                      >
                        {renderCell(item, col.key, realIndex, discount)}
                      </td>
                    ))}


                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>

          {selectedWantedIndex !== null && wanted[selectedWantedIndex] && (
            <div style={{ ...editPanel, position: "sticky", top: 16 }}>
              <div style={editHeader}>
                <h3 style={{ margin: 0 }}>Edit Buy List Item</h3>
                <button onClick={() => setSelectedWantedIndex(null)} style={circleButton}>×</button>
              </div>

              <div style={editGrid}>
                <label>
                  Set Number
                  <input value={wanted[selectedWantedIndex].setNumber || ""} onChange={e => updateWanted(selectedWantedIndex, "setNumber", e.target.value)} />
                </label>

                <label>
                  Set Name
                  <input value={wanted[selectedWantedIndex].name || ""} onChange={e => updateWanted(selectedWantedIndex, "name", e.target.value)} />
                </label>

                <label>
                  Theme
                  <input value={wanted[selectedWantedIndex].theme || ""} onChange={e => updateWanted(selectedWantedIndex, "theme", e.target.value)} />
                </label>

                <label>
                  MSRP
                  <input type="number" step="0.01" value={wanted[selectedWantedIndex].msrp || ""} onChange={e => updateWanted(selectedWantedIndex, "msrp", e.target.value)} />
                </label>

                <label>
                  Target Price
                  <input type="number" step="0.01" value={wanted[selectedWantedIndex].targetPrice || ""} onChange={e => updateWanted(selectedWantedIndex, "targetPrice", e.target.value)} />
                </label>

                <label>
                  Priority
                  <select value={wanted[selectedWantedIndex].priority || 3} onChange={e => updateWanted(selectedWantedIndex, "priority", e.target.value)}>
                    <option value="1">Priority 1</option>
                    <option value="2">Priority 2</option>
                    <option value="3">Priority 3</option>
                    <option value="4">Priority 4</option>
                    <option value="5">Priority 5</option>
                  </select>
                </label>

                <label>
                  Status
                  <select value={wanted[selectedWantedIndex].status || "Watch"} onChange={e => updateWanted(selectedWantedIndex, "status", e.target.value)}>
                    <option>Watch</option>
                    <option>Buy Soon</option>
                    <option>Critical</option>
                    <option>Owned</option>
                  </select>
                </label>

                <label>
                  Exit Date (Brickset)
                  <input type="date" value={wanted[selectedWantedIndex].exit_date ? wanted[selectedWantedIndex].exit_date.slice(0, 10) : ""}
                    onChange={e => updateWanted(selectedWantedIndex, "exit_date", e.target.value ? new Date(e.target.value).toISOString() : "")} />
                </label>

                <label>
                  Retirement Year <span style={{ color: "#5d6f80", fontWeight: 400, fontSize: 11 }}>(fallback)</span>
                  <input type="number" min="2020" max="2040" step="1" value={wanted[selectedWantedIndex].retirementYear || ""} onChange={e => updateWanted(selectedWantedIndex, "retirementYear", e.target.value)} />
                </label>

                <label>
                  Retirement Source
                  <select
                    value={wanted[selectedWantedIndex].retirementSource || "Brick Fanatics"}
                    onChange={e => {
                      const src = e.target.value;
                      updateWanted(selectedWantedIndex, "retirementSource", src);
                      if (SOURCE_CONFIDENCE[src]) {
                        updateWanted(selectedWantedIndex, "retirementConfidence", SOURCE_CONFIDENCE[src]);
                      }
                    }}
                  >
                    <option>LEGO Last Chance</option>
                    <option>Brickset</option>
                    <option>BrickEconomy</option>
                    <option>Brick Fanatics</option>
                    <option>StoneWars</option>
                    <option>Manual</option>
                  </select>
                </label>

                <label>
                  Confidence
                  <select value={wanted[selectedWantedIndex].retirementConfidence || "Medium"} onChange={e => updateWanted(selectedWantedIndex, "retirementConfidence", e.target.value)}>
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                  </select>
                </label>

                <label>
                  Last Retirement Update
                  <input type="date" value={wanted[selectedWantedIndex].lastRetirementUpdate || ""} onChange={e => updateWanted(selectedWantedIndex, "lastRetirementUpdate", e.target.value)} />
                </label>

                <label style={checkLabel}>
                  <input type="checkbox" checked={!!wanted[selectedWantedIndex].isLastChance}
                    onChange={e => updateWanted(selectedWantedIndex, "isLastChance", e.target.checked)} />
                  🚨 On LEGO Last Chance to Buy
                </label>

                <label style={checkLabel}>
                  <input type="checkbox" checked={!!wanted[selectedWantedIndex].retiringSoon} onChange={e => updateWanted(selectedWantedIndex, "retiringSoon", e.target.checked)} />
                  High Retirement Risk <span style={{ color: "#5d6f80", fontWeight: 400, fontSize: 11 }}>(legacy)</span>
                </label>

                <label>
                  Notes
                  <input value={wanted[selectedWantedIndex].notes || ""} onChange={e => updateWanted(selectedWantedIndex, "notes", e.target.value)} />
                </label>
              </div>

              {customFieldsSchema.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ color: "#8a9bb0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>✦ Custom Fields</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {customFieldsSchema.map(cf => {
                      const val = (wanted[selectedWantedIndex].customFields || {})[cf.id] ?? "";
                      const update = v => updateWanted(selectedWantedIndex, "customFields", {
                        ...(wanted[selectedWantedIndex].customFields || {}),
                        [cf.id]: v
                      });
                      return (
                        <label key={cf.id}>
                          {cf.label}
                          {cf.type === "checkbox"
                            ? <input type="checkbox" checked={!!val} onChange={e => update(e.target.checked)} style={{ marginLeft: 8 }} />
                            : <input
                                type={cf.type === "number" ? "number" : cf.type === "date" ? "date" : "text"}
                                value={val}
                                onChange={e => update(e.target.value)}
                              />
                          }
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <button onClick={() => setSelectedWantedIndex(null)}>Done</button>
              </div>
            </div>
          )}
        </div>
      </section>
      </>
      );
      })()}

      <WatchDetailPanel
        item={detailItem}
        onClose={() => { setDetailItem(null); setDetailItemIndex(null); }}
        onEdit={detailItemIndex !== null ? () => { setDetailItem(null); setDetailItemIndex(null); setSelectedWantedIndex(detailItemIndex); } : undefined}
        onBuyNow={detailItem && onBuyNow ? () => { setDetailItem(null); setDetailItemIndex(null); onBuyNow(detailItem); } : undefined}
      />

      {hoveredWanted && (
        <div style={{ position: "fixed", left: tipPos.x > window.innerWidth - 280 ? tipPos.x - 256 : tipPos.x + 16, top: tipPos.y > window.innerHeight - 230 ? tipPos.y - 215 : tipPos.y - 8, zIndex: 9999, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "10px 14px", pointerEvents: "none", boxShadow: "0 8px 32px rgba(0,0,0,0.55)", minWidth: 240 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <img src={setImageUrl(hoveredWanted.setNumber)} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
              style={{ width: 72, height: 72, objectFit: "contain", borderRadius: 8, background: "#111d2e", border: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: "#e8e2d5", marginBottom: 6, fontSize: 13 }}>{hoveredWanted.name || hoveredWanted.setNumber || "Set"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: 12 }}>
                {hoveredWanted.setNumber && <><span style={{ color: "#5d6f80" }}>Set #</span><span style={{ color: "#e8e2d5" }}>{hoveredWanted.setNumber}</span></>}
                {hoveredWanted.theme && <><span style={{ color: "#5d6f80" }}>Theme</span><span style={{ color: "#e8e2d5" }}>{hoveredWanted.theme}</span></>}
                {hoveredWanted.msrp && <><span style={{ color: "#5d6f80" }}>MSRP</span><span style={{ color: "#c9a84c", fontWeight: 700 }}>{money(hoveredWanted.msrp)}</span></>}
                {hoveredWanted.targetPrice && <><span style={{ color: "#5d6f80" }}>Target</span><span style={{ color: "#e8e2d5" }}>{money(hoveredWanted.targetPrice)}</span></>}
                {hoveredWanted.status && <><span style={{ color: "#5d6f80" }}>Status</span><span style={{ color: hoveredWanted.status === "Critical" ? "#ef4444" : hoveredWanted.status === "Buy Soon" ? "#f59e0b" : "#e8e2d5" }}>{hoveredWanted.status}</span></>}
                <span style={{ color: "#5d6f80" }}>Priority</span><span style={{ color: "#e8e2d5", fontWeight: 700 }}>{priorityScore(hoveredWanted)}</span>
                {hoveredWanted.retiringSoon && <><span style={{ color: "#5d6f80" }}>Retiring</span><span style={{ color: "#f59e0b" }}>⚠ Soon</span></>}
                {hoveredWanted.notes && <><span style={{ color: "#5d6f80" }}>Notes</span><span style={{ color: "#8a9bb0", fontStyle: "italic" }}>{hoveredWanted.notes}</span></>}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#5d6f80", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>click for details · double-click to edit</div>
        </div>
      )}
    </div>
  );
}

function Metric({ title, value }) {
  const [tip, setTip] = useState(false);
  return (
    <div style={{ ...panel, marginTop: 0, overflow: "hidden" }}>
      <div style={{ ...mutedSmall, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
      <div style={{ position: "relative" }} onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
        <div style={{ fontSize: 24, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "default" }}>{value}</div>
        {tip && <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, zIndex: 50, background: "#0b1520", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 8, padding: "5px 10px", fontSize: 15, fontWeight: 700, color: "#e8e2d5", whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.5)", pointerEvents: "none" }}>{value}</div>}
      </div>
    </div>
  );
}

const page = { background: "transparent", color: "#e8e2d5", minHeight: "100vh", padding: 22 };
const acTabHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 8 };
const acTabBar = { display: "flex", gap: 8, flexWrap: "wrap" };
const acTabBtn = { background: "transparent", color: "#8a9bb0", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 18px", fontWeight: 800, cursor: "pointer", fontSize: 14 };
const acActiveTab = { ...acTabBtn, background: "#c9a84c", color: "#0d1623", borderColor: "#c9a84c" };
const panel = { background: "rgba(20,31,48,0.82)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 20, marginTop: 18, boxShadow: "0 4px 24px rgba(0,0,0,0.35)" };
const metricGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14, marginTop: 20 };
const acOverviewGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginTop: 14 };
const workflowGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
  gap: 14,
  marginTop: 14
};

const fieldGroup = {
  background: "#0f1a28",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 12,
  padding: 14,
  display: "grid",
  gap: 10
};

const groupTitle = {
  color: "#8a9bb0",
  fontSize: 12,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: 0.5
};

const analysisPanel = {
  marginTop: 14,
  background: "#0b1520",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 12,
  padding: 12
};

const analysisGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
  gap: 10
};

const analysisCard = {
  background: "#0f1a28",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10,
  padding: 10
};

const analysisLabel = {
  color: "#8a9bb0",
  fontSize: 11,
  fontWeight: 800
};

const analysisValue = {
  color: "#e8e2d5",
  fontSize: 22,
  fontWeight: 900,
  marginTop: 4
};
const row = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap"
};
const muted = { color: "#8a9bb0" };
const mutedSmall = { color: "#8a9bb0", fontSize: 13 };
const redBtn = { background: "#c9a84c", color: "#0d1623", border: "none", borderRadius: 10, padding: "10px 14px", fontWeight: 800, cursor: "pointer" };


const checkLabel = { display: "flex", alignItems: "center", gap: 8, color: "#8a9bb0" };

const inputStyle = {
  color: "#e8e2d5",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: "9px 10px",
  outline: "none",
  width: "100%"
};
const stickyCheckbox = {
  position: "sticky",
  left: 0,
  zIndex: 7,
  background: "#0b1520",
  width: 44,
  minWidth: 44
};

const th = { position: "sticky", top: 0, background: "#0b1520", color: "#8a9bb0", padding: 10, textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.07)", zIndex: 5, whiteSpace: "nowrap", fontWeight: 700, fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" };
const thButton = { ...th, cursor: "pointer", userSelect: "none" };
const thRight = { ...th, textAlign: "right" };
const thRightButton = { ...thRight, cursor: "pointer", userSelect: "none" };
const td = { padding: 10, borderTop: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
const tdRight = { ...td, textAlign: "right", fontWeight: 800 };
const recommendationChip = score => ({
  display: "inline-block",
  borderRadius: 999,
  padding: "5px 10px",
  fontWeight: 900,
  background: score >= 80 ? "#7f1d1d" : score >= 60 ? "#92400e" : "#0f1a28",
  color: "#e8e2d5",
  border: "1px solid rgba(255,255,255,0.08)"
});



const analysisStat = {
  background: "#0f1a28",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10,
  padding: 10
};

// Store Price Calculator styles
const calcLabel = { fontSize: 12, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 };
const calcLookupBtn = { background: "#1a2840", color: "#c9a84c", border: "1px solid rgba(201,168,76,0.3)", borderRadius: 8, padding: "9px 12px", cursor: "pointer", fontWeight: 900, fontSize: 15, flexShrink: 0 };
const calcCard = { background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 16px" };
const calcCardLabel = { fontSize: 11, fontWeight: 700, color: "#8a9bb0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 };



const statGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))",
  gap: 8,
  marginTop: 12
};

const miniStat = {
  background: "#0b1520",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10,
  padding: "8px 10px"
};

const miniLabel = {
  color: "#8a9bb0",
  fontSize: 11,
  fontWeight: 800
};

const miniValue = {
  color: "#e8e2d5",
  fontSize: 15,
  fontWeight: 900,
  marginTop: 3
};

const intelligenceCard = {
  display: "flex",
  gap: 16,
  alignItems: "center",
  background: "#0f1a28",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14,
  padding: 16,
  marginBottom: 14
};

const setPreview = {
  width: 120,
  height: 90,
  objectFit: "contain",
  background: "#0b1520",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10,
  padding: 8,
  flex: "0 0 auto"
};

const scoreChip = score => ({
  display: "inline-block",
  minWidth: 36,
  textAlign: "center",
  borderRadius: 999,
  padding: "5px 9px",
  fontWeight: 900,
  background: score >= 80 ? "#7f1d1d" : score >= 60 ? "#92400e" : "#0f1a28",
  color: "#e8e2d5",
  border: "1px solid rgba(255,255,255,0.08)"
});


const editPanel = {
  background: "rgba(15,26,40,0.9)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14,
  padding: 18
};

const editHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12
};

const editGrid = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 10
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

const brickHoundBar = {
  background: "#0b1520",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10,
  padding: "10px 14px",
  marginBottom: 14
};

const brickHoundCode = {
  background: "#0f1a28",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 8,
  padding: "6px 10px",
  fontFamily: "monospace",
  fontSize: 15,
  color: "#e8e2d5"
};

const copyBtn = {
  background: "#c9a84c",
  color: "#0d1623",
  border: "none",
  borderRadius: 8,
  padding: "7px 12px",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 13
};

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
