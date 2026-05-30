import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import Fuse from "fuse.js";
import toast from "react-hot-toast";
import { loadRebrickable, rbLookupSet, rbReady } from "./utils/rebrickable";
import { DEFAULT_WANTED_COLUMNS } from "./utils/columnDefaults";
import { fireOpenNotifications } from "./utils/notifications";
import { recordPriceSnapshot, getPriceTrend, getPriceHistory } from "./utils/priceHistory";
import { fetchBrickLinkPriceGuide, hasBrickLinkAuth } from "./utils/bricklink-client";
import { searchInput, filterSelect, clearFilterButton } from "./uiStyles";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, LineChart, Line } from "recharts";
import { asNumber, money, setImageUrl, priorityScore, recommendation, daysUntilRetirement, retirementWaveLabel, lineCashPaid } from "./utils/formatting";

import { fetchBricksetSet, searchBricksetCatalog, fetchLegoThemes } from "./utils/brickset";
import { getLastChanceCodes, isLastChanceSet, getCachedLastChanceCodes } from "./utils/legoLastChance";
import WatchDetailPanel from "./WatchDetailPanel";
import { apiFetch } from "./utils/apiFetch";
import { setItemSafe } from "./utils/safeStorage";

const PIE_COLORS = ["#c9a84c", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#5aa832"];

const DEFAULT_WL_ITEMS = [
  { key: "wantedCount",         type: "card",  label: "Wanted Sets",          visible: true,  width: "auto",  collapsed: false },
  { key: "retiringSoon",        type: "card",  label: "High Retirement Risk",  visible: true,  width: "auto",  collapsed: false },
  { key: "totalMsrp",          type: "card",  label: "Total MSRP",            visible: false, width: "auto",  collapsed: false },
  { key: "avgMsrp",            type: "card",  label: "Avg MSRP",              visible: false, width: "auto",  collapsed: false },
  { key: "ownedCount",         type: "card",  label: "Already Owned",         visible: false, width: "auto",  collapsed: false },
  { key: "watchCount",         type: "card",  label: "Buy Now",               visible: false, width: "auto",  collapsed: false },
  { key: "avgDiscount",        type: "card",  label: "Avg Discount",           visible: false, width: "auto",  collapsed: false },
  { key: "buyTotal",           type: "card",  label: "Tracking Cost",          visible: true,  width: "auto",  collapsed: false },
  { key: "budgetAfterBuy",     type: "card",  label: "Budget After Buy",       visible: false, width: "auto",  collapsed: false },
  { key: "targetSavings",      type: "card",  label: "Potential Savings",      visible: false, width: "auto",  collapsed: false },
  { key: "lastChanceCount",   type: "card",  label: "Last Chance",            visible: false, width: "auto",  collapsed: false },
  { key: "avgRoi",            type: "card",  label: "Avg Potential ROI",      visible: false, width: "auto",  collapsed: false },
  { key: "dealLogCount",      type: "card",  label: "Deals Tracked",          visible: false, width: "auto",  collapsed: false },
  { key: "dataCoverage",      type: "card",  label: "Data Coverage",          visible: false, width: "auto",  collapsed: false },
  { key: "retirement-timeline", type: "panel", label: "Retirement Timeline",   visible: true,  width: "full",  collapsed: false },
  { key: "urgency-chart",      type: "panel", label: "Urgency Breakdown",      visible: false, width: "half",  collapsed: false },
  { key: "msrp-vs-target",     type: "panel", label: "MSRP vs Target",         visible: false, width: "half",  collapsed: false },
  { key: "theme-breakdown",    type: "panel", label: "By Theme",               visible: false, width: "half",  collapsed: false },
  { key: "action-breakdown",   type: "panel", label: "Action Breakdown",       visible: false, width: "half",  collapsed: false },
  { key: "score-distribution", type: "panel", label: "Score Distribution",     visible: false, width: "half",  collapsed: false },
  { key: "price-trend",        type: "panel", label: "Avg BL Price Trend",     visible: false, width: "full",  collapsed: false },
];

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
    retiringSoon: false,
    retirementYear: "",
    bfRetirementDate: "",
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
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = e => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const [filterTheme, setFilterTheme] = useState("");

  const [lookupMessage, setLookupMessage] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastChanceCodes, setLastChanceCodes] = useState(() => getCachedLastChanceCodes());
  const [selectedWantedIndex, setSelectedWantedIndex] = useState(null);
  const [checkedWanted, setCheckedWanted] = useState([]);
  const [sortKey, setSortKey] = useState("retirementDate");
  const [sortDirection, setSortDirection] = useState("desc");
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [brickHoundCopied, setBrickHoundCopied] = useState(false);
  const [subTab, setSubTab] = useState("overview");
  const [detailItem, setDetailItem] = useState(null);
  const [detailItemIndex, setDetailItemIndex] = useState(null);
  const [hoveredWanted, setHoveredWanted] = useState(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const [chartTypes, setChartTypes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blWLChartTypes") || "{}"); } catch { return {}; }
  });
  const [wlPillsCollapsed, setWlPillsCollapsed] = useState(false);
  // ── Price deal log ───────────────────────────────────────────────────────
  const [dealLog, setDealLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blDealLog") || "[]"); } catch { return []; }
  });

  function logDeal(setNum, name, msrp, storePrice, discount) {
    const entry = {
      id: Date.now(),
      setNumber: setNum,
      name: name || setNum,
      msrp,
      storePrice,
      discount: parseFloat(discount.toFixed(1)),
      loggedAt: new Date().toISOString(),
    };
    setDealLog(prev => {
      const next = [entry, ...prev].slice(0, 100); // keep last 100
      setItemSafe("blDealLog", JSON.stringify(next));
      return next;
    });
  }

  function deleteDealEntry(id) {
    setDealLog(prev => {
      const next = prev.filter(d => d.id !== id);
      setItemSafe("blDealLog", JSON.stringify(next));
      return next;
    });
  }

  // ── Buy Now purchase modal ───────────────────────────────────────────────
  const [buyModal, setBuyModal] = useState(null); // null | wanted item
  const [buyForm, setBuyForm] = useState({ store: "", date: "", price: "", qty: 1, tax: "", shipping: "", gc: "", orderLabel: "" });
  const [buyAddToCollection, setBuyAddToCollection] = useState(true);
  const [savedStores] = useState(() => { try { return JSON.parse(localStorage.getItem("blStores") || "[]"); } catch { return []; } });

  function openBuyModal(item) {
    const today = new Date().toISOString().slice(0, 10);
    setBuyForm({
      store: savedStores[0] || "",
      date: today,
      price: item.targetPrice || item.storePrice || item.msrp || "",
      qty: 1,
      tax: "",
      shipping: "",
      gc: "",
      orderLabel: "",
    });
    setBuyAddToCollection(true);
    setBuyModal(item);
  }

  function commitBuy() {
    if (!buyModal) return;
    const qty       = asNumber(buyForm.qty) || 1;
    const faceValue = asNumber(buyForm.price) || 0;
    const tax       = asNumber(buyForm.tax) || 0;
    const shipping  = asNumber(buyForm.shipping) || 0;
    const gcApplied = asNumber(buyForm.gc) || 0;
    const total     = Math.round((faceValue * qty + tax + shipping) * 100) / 100;
    const cashPaid  = Math.max(0, Math.round((total - gcApplied) * 100) / 100);
    const date      = buyForm.date || new Date().toISOString().slice(0, 10);
    const d         = new Date(date + "T00:00:00");
    const month     = d.toLocaleString("en-US", { month: "long" }) + " " + d.getFullYear();

    // Write purchase record
    const purchase = {
      setNumber:  buyModal.setNumber,
      name:       buyModal.name,
      theme:      buyModal.theme,
      qty,
      faceValue,
      tax:        tax || null,
      shipping:   shipping || null,
      gcApplied:  gcApplied || null,
      total,
      cashPaid,
      amount:     faceValue,
      store:      buyForm.store || "",
      date,
      month,
      year:       d.getFullYear(),
      orderLabel: buyForm.orderLabel || null,
      orderNotes: null,
      _fromWanted: true,
    };
    const existing = JSON.parse(localStorage.getItem("blPurchases") || "[]");
    setItemSafe("blPurchases", JSON.stringify([...existing, purchase]));

    // Optionally add to My Collection
    if (buyAddToCollection) {
      const ownedSets = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");
      const newSet = {
        setNumber:   buyModal.setNumber,
        name:        buyModal.name,
        theme:       buyModal.theme,
        subtheme:    buyModal.subtheme || "",
        pieces:      buyModal.pieces || "",
        minifigs:    buyModal.minifigs || "",
        condition:   "new",
        qty,
        paidPrice:   faceValue,
        msrp:        asNumber(buyModal.msrp) || 0,
        retailPrice: asNumber(buyModal.msrp) || 0,
        currentValue: asNumber(buyModal.currentValue) || asNumber(buyModal.msrp) || 0,
        releasedDate: buyModal.releasedDate || "",
        retiredDate:  buyModal.retiredDate || "",
        notes:        buyModal.notes || "",
        addedAt:      new Date().toISOString(),
      };
      setItemSafe("blOwnedSets", JSON.stringify([...ownedSets, newSet]));
    }

    // Remove from Wanted List
    setWanted(prev => {
      const next = prev.filter(w => w !== buyModal);
      setItemSafe("blWantedList", JSON.stringify(next));
      return next;
    });

    setBuyModal(null);
    toast.success(`Purchased: ${buyModal.name || buyModal.setNumber}${buyAddToCollection ? " · added to collection" : ""}`);
  }

  // Custom fields schema: [{id, label, type}]
  const [customFieldsSchema, setCustomFieldsSchema] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blCustomFieldsSchema") || "[]"); } catch { return []; }
  });
  const [customFieldsGearOpen, setCustomFieldsGearOpen] = useState(false);
  const [newCfLabel, setNewCfLabel] = useState("");
  const [newCfType, setNewCfType] = useState("text");
  const [inlineEdit, setInlineEdit] = useState(null); // { index, key, value }

  useEffect(() => {
    setItemSafe("blCustomFieldsSchema", JSON.stringify(customFieldsSchema));
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
  const [priceDropDismissed, setPriceDropDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blPriceDropDismissed") || "[]"); } catch { return []; }
  });

  // ── Catalog search ────────────────────────────────────────────────────────
  const [catalogQuery, setCatalogQuery]     = useState("");
  const [catalogResults, setCatalogResults] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError]     = useState("");
  const [dupeWarning, setDupeWarning]       = useState(null); // "owned" | "watchlist" | null
  const [colGearOpen, setColGearOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [bfRetirement, setBfRetirement] = useState(null); // { retiring, retirementDate, theme, name } from Brick Fanatics
  const [hoveredWLItem, setHoveredWLItem] = useState(null);
  const [hoveredTimelineChip, setHoveredTimelineChip] = useState(null); // "waveLabel-index"
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

  // Pre-compute owned set numbers for badge display.
  // Depends on `wanted` as a proxy refresh trigger: any tab switch or item add
  // re-renders this component, keeping the Set in sync with localStorage.
  const ownedSetNumbers = useMemo(() => {
    try {
      const manual = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");
      const beOwned = JSON.parse(localStorage.getItem("brickEconomyOwnedSets") || "[]");
      const beNorm = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]");
      return new Set([...manual, ...beOwned, ...beNorm].map(s => String(s.setNumber || "").replace(/-1$/, "")));
    } catch { return new Set(); }
  // [] — reads fresh on every mount; WantedList remounts on tab switch so collection changes are always picked up
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Store Price Calculator (standalone widget) ────────────────
  const [calcOpen,     setCalcOpen]     = useState(false);
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
    setCalcLoading(true);
    setCalcMsg("");
    try {
      const cleanNum = raw.replace(/-1$/, "").trim();
      const bsData = await fetchBricksetSet(cleanNum);
      if (bsData?.retail_price_us) {
        setCalcMsrp(String(bsData.retail_price_us));
        setCalcMsg(`${bsData.name || cleanNum} · MSRP from Brickset`);
        return;
      }
      // Fallback: BE cache only (no fresh BE fetch for just MSRP)
      const key = raw.includes("-") ? raw : `${raw}-1`;
      const beCache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
      const beData  = (beCache[key] || beCache[raw])?.data;
      if (beData?.retail_price_us) {
        setCalcMsrp(String(beData.retail_price_us));
        setCalcMsg(`${beData.name || raw} · MSRP from cache`);
      } else {
        setCalcMsg("No retail price found — check the set number.");
      }
    } catch (err) {
      setCalcMsg(err.message || "Lookup failed.");
    } finally {
      setCalcLoading(false);
    }
  }

  useEffect(() => {
    setItemSafe("blWantedList", JSON.stringify(wanted));
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
            updates.retiringSoon         = exitYear <= currentYear + 1;
            updates.retirementSource     = "Auto";
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
          if (bsData.owned_by  != null) updates.ownedByCount  = bsData.owned_by;
          if (bsData.wanted_by != null) updates.wantedByCount = bsData.wanted_by;

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

  // ── Brick Fanatics bulk retirement sync ──────────────────────────────────
  // Fetches the full BF retiring-sets list (1 API call, CDN-cached 7 days in
  // localStorage), then cross-references every tracked item and updates
  // retiringSoon / retirementYear / retirementSource for any matches.
  const [bfSyncing, setBfSyncing] = useState(false);
  const [bfSyncResult, setBfSyncResult] = useState(null); // { updated, total, fetchedAt }

  async function syncBFRetirement(force = false) {
    setBfSyncing(true);
    setBfSyncResult(null);
    try {
      // ── 1. Fetch (or use cache) ──────────────────────────────────────────
      const CACHE_KEY = "blBFRetirementCache";
      const STALE_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days
      let bfSets = null;
      let fetchedAt = null;
      if (!force) {
        try {
          const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
          if (cached?.sets && cached.fetchedAt && (Date.now() - new Date(cached.fetchedAt).getTime()) < STALE_MS) {
            bfSets    = cached.sets;
            fetchedAt = cached.fetchedAt;
          }
        } catch { /* ignore */ }
      }
      if (!bfSets) {
        const res  = await apiFetch("/api/brickfanatics-retiring");
        const json = await res.json();
        if (!res.ok || json.error || !json.sets?.length) throw new Error(json.message || "BF fetch failed");
        bfSets    = json.sets;
        fetchedAt = json.fetchedAt || new Date().toISOString();
        setItemSafe(CACHE_KEY, JSON.stringify({ sets: bfSets, fetchedAt }));
      }

      // ── 2. Build lookup map: setNumber → { retirementDate, theme } ────────
      const bfMap = new Map();
      for (const s of bfSets) bfMap.set(String(s.setNumber).replace(/-1$/, ""), s);

      // ── 3. Cross-reference wanted list ────────────────────────────────────
      const currentYear = new Date().getFullYear();
      let updated = 0;
      setWanted(prev => {
        const next = prev.map(w => {
          // LEGO Last Chance is always authoritative — never overwrite it
          if (w.retirementSource === "LEGO Last Chance") return w;
          const cleanNum = String(w.setNumber || "").replace(/-1$/, "").trim();
          const bfMatch  = bfMap.get(cleanNum);
          if (!bfMatch) return w;
          const rawDate = bfMatch.retirementDate || "";
          const yrMatch = rawDate.match(/\b(20\d{2})\b/);
          const yr      = yrMatch ? Number(yrMatch[1]) : null;
          // Only update if BF gives us new/better data
          const newSource = "Brick Fanatics";
          if (
            w.retirementSource === newSource &&
            w.bfRetirementDate === rawDate
          ) return w; // already current
          updated++;
          return {
            ...w,
            retiringSoon:         yr ? yr <= currentYear + 1 : true,
            retirementYear:       yr ? String(yr) : w.retirementYear || "",
            bfRetirementDate:     rawDate,
            retirementSource:     newSource,
            lastRetirementUpdate: new Date().toISOString().slice(0, 10),
          };
        });
        setItemSafe("blWantedList", JSON.stringify(next));
        return next;
      });

      setBfSyncResult({ updated, total: bfSets.length, fetchedAt });
    } catch (err) {
      toast.error(`BF sync failed: ${err.message}`);
    } finally {
      setBfSyncing(false);
    }
  }

  // Auto-run once on mount if cache is stale
  useEffect(() => {
    const CACHE_KEY = "blBFRetirementCache";
    const STALE_MS  = 7 * 24 * 60 * 60 * 1000;
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached?.fetchedAt && (Date.now() - new Date(cached.fetchedAt).getTime()) < STALE_MS) return;
    } catch { /* ignore */ }
    syncBFRetirement(); // silent background refresh
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const KNOWN_COLUMN_KEYS = new Set(DEFAULT_WANTED_COLUMNS.map(c => c.key));

  const [columns, setColumns] = useState(() => {
    const saved = localStorage.getItem("blAcquisitionColumns");
    if (!saved) return DEFAULT_WANTED_COLUMNS;
    const parsed = JSON.parse(saved);
    const labelMap = Object.fromEntries(DEFAULT_WANTED_COLUMNS.map(c => [c.key, c.label]));
    const groupMap = Object.fromEntries(DEFAULT_WANTED_COLUMNS.map(c => [c.key, c.group]));
    // Only keep columns that still exist in the current defaults — removes any deleted columns automatically
    const merged = parsed
      .filter(c => KNOWN_COLUMN_KEYS.has(c.key))
      .map(c => ({ ...c, label: labelMap[c.key] ?? c.label, group: groupMap[c.key] ?? c.group }));
    const savedKeys = new Set(merged.map(c => c.key));
    const missing = DEFAULT_WANTED_COLUMNS.filter(c => !savedKeys.has(c.key));
    return missing.length ? [...merged, ...missing] : merged;
  });

  useEffect(() => {
    setItemSafe("blAcquisitionColumns", JSON.stringify(columns));
  }, [columns]);

  useEffect(() => {
    setItemSafe("blWLItems", JSON.stringify(wlItems));
  }, [wlItems]);

  useEffect(() => {
    setItemSafe("blWLChartTypes", JSON.stringify(chartTypes));
  }, [chartTypes]);

  function cycleChartType(key) {
    setChartTypes(prev => {
      const cur = prev[key] || "donut";
      const next = cur === "donut" ? "pie" : cur === "pie" ? "bar" : "donut";
      return { ...prev, [key]: next };
    });
  }

  const liveDiscount =
    asNumber(form.msrp) && asNumber(form.targetPrice)
      ? ((asNumber(form.msrp) - asNumber(form.targetPrice)) / asNumber(form.msrp)) * 100
      : 0;

  const targetDiscountValue =
    asNumber(form.targetDiscount) || 0;

  const targetHit =
    liveDiscount >= targetDiscountValue;

  const projectedSavings =
    asNumber(form.msrp) - asNumber(form.targetPrice);

  const localAcquisitionThemes = Array.from(
    new Set(wanted.map(item => item.theme).filter(Boolean))
  ).sort();
  const [legoThemes, setLegoThemes] = useState([]);
  useEffect(() => { fetchLegoThemes().then(t => { if (t.length) setLegoThemes(t); }); }, []);
  const acquisitionThemes = legoThemes.length
    ? Array.from(new Set([...legoThemes, ...localAcquisitionThemes])).sort()
    : localAcquisitionThemes;

  const fuseWanted = useMemo(() => new Fuse(wanted, {
    keys: ["setNumber", "name", "theme"],
    threshold: 0.3,
    distance: 100,
  }), [wanted]);

  // Convert a wanted item to a sortable retirement timestamp.
  // Items with no retirement data sort to the bottom (Infinity).
  function retirementSortKey(item) {
    if (item.exit_date) return new Date(item.exit_date).getTime();
    if (item.retirementYear) return new Date(`${item.retirementYear}-12-31`).getTime();
    return Infinity;
  }

  const visibleWanted = useMemo(() => {
    return (search.trim() ? fuseWanted.search(search).map(r => r.item) : wanted)
      .filter(item => !filterTheme || item.theme === filterTheme)
      .sort((a, b) => {
        const direction = sortDirection === "asc" ? 1 : -1;

        if (sortKey === "retirementDate") {
          const aT = retirementSortKey(a);
          const bT = retirementSortKey(b);
          // Always push no-date items to the bottom regardless of sort direction
          if (aT === Infinity && bT === Infinity) return 0;
          if (aT === Infinity) return 1;
          if (bT === Infinity) return -1;
          return (aT - bT) * direction;
        }

        if (sortKey === "daysLeft") {
          const aT = retirementSortKey(a);
          const bT = retirementSortKey(b);
          if (aT === Infinity && bT === Infinity) return 0;
          if (aT === Infinity) return 1;
          if (bT === Infinity) return -1;
          return (aT - bT) * direction;
        }

        if (sortKey === "discount") {
          return asNumber(a.msrp) && asNumber(a.targetPrice)
            ? (((asNumber(a.msrp) - asNumber(a.targetPrice)) / asNumber(a.msrp)) * 100 -
               ((asNumber(b.msrp) - asNumber(b.targetPrice)) / asNumber(b.msrp)) * 100) * direction
            : 0;
        }

        if (sortKey === "addedAt") {
          const aV = a.addedAt || (Number(String(a.id || "").split("_")[1]) ? new Date(Number(String(a.id || "").split("_")[1])).toISOString() : "");
          const bV = b.addedAt || (Number(String(b.id || "").split("_")[1]) ? new Date(Number(String(b.id || "").split("_")[1])).toISOString() : "");
          return String(aV).localeCompare(String(bV)) * direction;
        }

        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
        return String(av).localeCompare(String(bv)) * direction;
      });
  }, [wanted, search, filterTheme, sortKey, sortDirection]);

  // ── Keyboard shortcuts (declared after visibleWanted to avoid TDZ) ────────
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") {
        setDetailItem(null); setDetailItemIndex(null);
        setSelectedWantedIndex(null);
        setColGearOpen(false); setShortcutsOpen(false);
        return;
      }
      if (typing) return;
      if (e.key === "n" || e.key === "N") {
        setSubTab("research");
        setTimeout(() => document.querySelector('input[placeholder*="set number"]')?.focus(), 80);
      }
      if ((e.key === "e" || e.key === "E") && detailItem && detailItemIndex !== null) {
        setDetailItem(null); setDetailItemIndex(null); setSelectedWantedIndex(detailItemIndex);
      }
      if (e.key === "ArrowDown" && subTab === "queue") {
        const sorted = visibleWanted;
        const cur = detailItem ? sorted.indexOf(detailItem) : -1;
        const next = sorted[Math.min(cur + 1, sorted.length - 1)];
        if (next) { setDetailItem(next); setDetailItemIndex(wanted.indexOf(next)); }
        e.preventDefault();
      }
      if (e.key === "ArrowUp" && subTab === "queue") {
        const sorted = visibleWanted;
        const cur = detailItem ? sorted.indexOf(detailItem) : sorted.length;
        const prev = sorted[Math.max(cur - 1, 0)];
        if (prev) { setDetailItem(prev); setDetailItemIndex(wanted.indexOf(prev)); }
        e.preventDefault();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailItem, subTab, wanted, visibleWanted]);

  // ── Price drop alerts: wanted sets that have hit their target price ───────
  const priceDropAlerts = useMemo(() => {
    return wanted.filter(w => {
      const sp = asNumber(w.storePrice);
      const tp = asNumber(w.targetPrice);
      if (sp <= 0 || tp <= 0) return false; // no valid price data — skip, don't alert
      if (sp > tp) return false;             // store price above target — not a deal
      return !priceDropDismissed.includes(String(w.setNumber));
    });
  }, [wanted, priceDropDismissed]);

  // ── Browser notifications on app open ────────────────────────────────────
  // Fires at most once per calendar day (throttled inside fireOpenNotifications).
  useEffect(() => {
    const drops = wanted.filter(w => {
      const sp = asNumber(w.storePrice);
      const tp = asNumber(w.targetPrice);
      return sp > 0 && tp > 0 && sp <= tp && !priceDropDismissed.includes(String(w.setNumber));
    });
    const lastChance = wanted.filter(w =>
      w.isLastChance && !lcAlertDismissed.includes(String(w.setNumber))
    );
    fireOpenNotifications(drops, lastChance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // ── Catalog search debounce ───────────────────────────────────────────────
  useEffect(() => {
    if (catalogQuery.trim().length < 2) { setCatalogResults([]); return; }
    const t = setTimeout(async () => {
      setCatalogLoading(true); setCatalogError("");
      const result = await searchBricksetCatalog(catalogQuery.trim());
      setCatalogLoading(false);
      if (result.noKey) { setCatalogError("Brickset API key not configured — set BRICKSET_API_KEY in .env.local"); setCatalogResults([]); }
      else if (result.error) { setCatalogError(result.error); setCatalogResults([]); }
      else setCatalogResults(result.sets || []);
    }, 420);
    return () => clearTimeout(t);
  }, [catalogQuery]);

  // ── Rebrickable — load catalog in background when Research tab opens ────────
  useEffect(() => {
    if (subTab === "research") loadRebrickable();
  }, [subTab]);

  // ── Duplicate detection ───────────────────────────────────────────────────
  useEffect(() => {
    const num = String(form.setNumber || "").replace(/-1$/, "").trim();
    if (!num) { setDupeWarning(null); return; }
    if (ownedSetNumbers.has(num)) { setDupeWarning("owned"); return; }
    const onList = wanted.some(w => String(w.setNumber || "").replace(/-1$/, "") === num);
    setDupeWarning(onList ? "watchlist" : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.setNumber, wanted]);

  function isNumericColumn(key) {
    return ["msrp", "targetPrice", "discount", "daysLeft"].includes(key);
  }

  function renderCell(item, key, realIndex, discount) {
    if (key === "recommendation") {
      return (
        <span style={recommendationChip(priorityScore(item))}>
          {recommendation(priorityScore(item))}
        </span>
      );
    }

    if (key === "retirementDate") {
      if (item.exit_date) {
        const d = new Date(item.exit_date);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      }
      if (item.bfRetirementDate) return item.bfRetirementDate;
      if (item.retirementYear) return item.retirementYear;
      return "—";
    }

    if (key === "daysLeft") {
      if (item.exit_date) {
        const days = daysUntilRetirement(item.exit_date);
        const color = days <= 0 ? "#ef4444" : days <= 60 ? "#ef4444" : days <= 180 ? "#f59e0b" : "#5aa832";
        return <span style={{ color, fontWeight: 700 }}>{days <= 0 ? "Retired" : `${days}d`}</span>;
      }
      if (item.retirementYear) {
        const approxDays = (Number(item.retirementYear) - new Date().getFullYear()) * 365;
        const color = approxDays <= 0 ? "#ef4444" : approxDays <= 365 ? "#f59e0b" : "#5d6f80";
        return <span style={{ color, fontStyle: "italic" }}>~{approxDays <= 0 ? "past" : `${Math.round(approxDays / 30)}mo`}</span>;
      }
      return "—";
    }

    if (key === "retiringSoon") {
      const active = !!item.retiringSoon;
      return (
        <span
          onClick={e => { e.stopPropagation(); updateWanted(realIndex, "retiringSoon", !active); }}
          title={active ? "Click to clear retirement flag" : "Click to flag as retiring soon"}
          style={{
            display: "inline-block",
            background: active ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.04)",
            color: active ? "#f59e0b" : "#3d4f63",
            border: `1px solid ${active ? "rgba(245,158,11,0.35)" : "rgba(255,255,255,0.07)"}`,
            borderRadius: 999,
            padding: "3px 9px",
            fontSize: 11,
            fontWeight: 700,
            whiteSpace: "nowrap",
            cursor: "pointer",
            userSelect: "none",
            transition: "all 0.12s ease",
          }}
        >
          {active ? "⚠ Soon" : "—"}
        </span>
      );
    }

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
    if (key === "currentValue") {
      if (!item.currentValue) return "—";
      const trend = getPriceTrend(item.setNumber, "value");
      const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : trend === "flat" ? "→" : null;
      const arrowColor = trend === "up" ? "#5aa832" : trend === "down" ? "#ef4444" : "#5d6f80";
      return (
        <span>
          {money(item.currentValue)}
          {arrow && <span style={{ marginLeft: 4, fontSize: 11, color: arrowColor, fontWeight: 700 }}>{arrow}</span>}
        </span>
      );
    }
    if (key === "retirementYear") {
      if (!item.retirementYear) return "—";
      return item.retirementYear;
    }
    if (key === "retirementSource") return item.retirementSource || "—";
    if (key === "lastRetirementUpdate") return item.lastRetirementUpdate || "—";
    if (key === "msrp") return money(item.msrp);
    // storePrice column removed — field still lives in data for deal-log / calculator writes
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
    if (key === "blPriceNew") {
      if (!item.blPriceNew) return "—";
      const trend = getPriceTrend(item.setNumber, "blPriceNew");
      const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : trend === "flat" ? "→" : null;
      const arrowColor = trend === "up" ? "#5aa832" : trend === "down" ? "#ef4444" : "#5d6f80";
      return (
        <span>
          {money(item.blPriceNew)}
          {arrow && <span style={{ marginLeft: 4, fontSize: 11, color: arrowColor, fontWeight: 700 }}>{arrow}</span>}
        </span>
      );
    }
    if (key === "blPriceUsed") {
      if (!item.blPriceUsed) return "—";
      const trend = getPriceTrend(item.setNumber, "blPriceUsed");
      const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : trend === "flat" ? "→" : null;
      const arrowColor = trend === "up" ? "#5aa832" : trend === "down" ? "#ef4444" : "#5d6f80";
      return (
        <span>
          {money(item.blPriceUsed)}
          {arrow && <span style={{ marginLeft: 4, fontSize: 11, color: arrowColor, fontWeight: 700 }}>{arrow}</span>}
        </span>
      );
    }
    if (key === "owned") {
      const isOwned = ownedSetNumbers.has(String(item.setNumber || "").replace(/-1$/, ""));
      return isOwned
        ? <span style={{ fontSize: 11, background: "#0a2e1a", border: "1px solid #166534", color: "#5aa832", borderRadius: 999, padding: "2px 7px", fontWeight: 700 }}>✓ Yes</span>
        : <span style={{ color: "#5d6f80", fontSize: 12 }}>—</span>;
    }
    if (key === "ageMonths") {
      const yr = item.releaseYear
        ? Number(item.releaseYear)
        : (() => {
            try {
              const c = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
              const e = c[item.setNumber] || c[String(item.setNumber || "").replace(/-1$/, "")];
              return e?.data?.year || Number(String(e?.data?.released_date || "").slice(0, 4)) || null;
            } catch { return null; }
          })();
      if (!yr) return "—";
      const months = Math.floor((Date.now() - new Date(`${yr}-07-01`).getTime()) / (1000 * 60 * 60 * 24 * 30.44));
      if (months < 0) return "—";
      const y = Math.floor(months / 12);
      const m = months % 12;
      return y > 0 ? `${y}yr ${m}mo` : `${m}mo`;
    }

    if (key === "thumb") {
      const url = setImageUrl(item.setNumber);
      return url
        ? <img src={url} alt={item.setNumber} style={{ height: 36, width: "auto", borderRadius: 4, display: "block" }} onError={e => { e.target.style.display = "none"; }} />
        : "—";
    }
    if (key === "ownedByCount")  return item.ownedByCount  != null ? Number(item.ownedByCount).toLocaleString()  : "—";
    if (key === "wantedByCount") return item.wantedByCount != null ? Number(item.wantedByCount).toLocaleString() : "—";
    if (key === "blPriceNewRange") {
      const mn = asNumber(item.blPriceNewMin), mx = asNumber(item.blPriceNewMax);
      return (mn && mx) ? `${money(mn)} – ${money(mx)}` : (item.blPriceNew ? money(item.blPriceNew) : "—");
    }
    if (key === "blPriceUsedRange") {
      const mn = asNumber(item.blPriceUsedMin), mx = asNumber(item.blPriceUsedMax);
      return (mn && mx) ? `${money(mn)} – ${money(mx)}` : (item.blPriceUsed ? money(item.blPriceUsed) : "—");
    }

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

  // Soonest-retiring items for the "top" panel — sorted by retirement date
  const topRetiringSoon = useMemo(() => {
    return [...wanted]
      .filter(w => w.exit_date || w.retirementYear)
      .sort((a, b) => retirementSortKey(a) - retirementSortKey(b));
  }, [wanted]);

  // Extra card metrics
  const wlTotalMsrp = wanted.reduce((s, w) => s + asNumber(w.msrp), 0);
  const wlAvgMsrp = wanted.length ? wlTotalMsrp / wanted.length : 0;
  const wlOwnedCount = wanted.filter(w => ownedSetNumbers.has(String(w.setNumber || "").replace(/-1$/, ""))).length;
  const wlBuyTotal = wanted.reduce((s, w) => {
    const tp = asNumber(w.targetPrice);
    return s + (tp > 0 ? tp : asNumber(w.msrp));
  }, 0);
  // Potential savings: sum of (MSRP - targetPrice) for items where targetPrice < MSRP
  const wlTargetSavings = wanted.reduce((s, w) => {
    const msrp = asNumber(w.msrp);
    const tp   = asNumber(w.targetPrice);
    return s + (msrp > 0 && tp > 0 && tp < msrp ? msrp - tp : 0);
  }, 0);
  // Theme breakdown for wanted panel
  const wlThemeData = (() => {
    const byTheme = {};
    wanted.forEach(w => {
      const t = w.theme || "Unknown";
      byTheme[t] = (byTheme[t] || 0) + 1;
    });
    return Object.entries(byTheme).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  })();
  // MSRP vs target comparison data
  const wlMsrpVsTargetData = wanted
    .filter(w => asNumber(w.msrp) > 0)
    .map(w => ({ name: w.name || w.setNumber, msrp: asNumber(w.msrp), target: asNumber(w.targetPrice) || asNumber(w.msrp) }))
    .sort((a, b) => b.msrp - a.msrp)
    .slice(0, 10);
  const wlBudgetAfterBuy = (() => {
    try {
      const annual  = asNumber(localStorage.getItem("blAnnualBudget")) || 0;
      if (!annual) return null;
      const purchases = JSON.parse(localStorage.getItem("blPurchases") || "[]");
      const spent = purchases.reduce((s, p) => s + lineCashPaid(p), 0);
      return annual - spent - wlBuyTotal;
    } catch { return null; }
  })();
  // Buy Now count — items whose priority score qualifies as "Buy Now"
  const wlBuyNowCount = wanted.filter(w => recommendation(priorityScore(w)) === "Buy Now").length;
  const wlWatchCount  = wanted.filter(w => recommendation(priorityScore(w)) === "Watch Closely").length;
  const wlWaitCount   = wanted.length - wlBuyNowCount - wlWatchCount;
  // Average discount % at target price across items with both MSRP and target set
  const wlAvgDiscount = (() => {
    const items = wanted.filter(w => asNumber(w.msrp) > 0 && asNumber(w.targetPrice) > 0);
    if (!items.length) return null;
    return items.reduce((s, w) => s + ((asNumber(w.msrp) - asNumber(w.targetPrice)) / asNumber(w.msrp) * 100), 0) / items.length;
  })();
  // Last Chance count — sets flagged by LEGO's own "Last Chance to Buy" page
  const wlLastChanceCount = wanted.filter(w => w.isLastChance).length;
  // Average potential ROI — (currentValue − targetOrMsrp) / targetOrMsrp for items with market data
  const wlAvgRoi = (() => {
    const items = wanted.filter(w => {
      const basis = asNumber(w.targetPrice) > 0 ? asNumber(w.targetPrice) : asNumber(w.msrp);
      return asNumber(w.currentValue) > 0 && basis > 0;
    });
    if (!items.length) return null;
    return items.reduce((s, w) => {
      const basis = asNumber(w.targetPrice) > 0 ? asNumber(w.targetPrice) : asNumber(w.msrp);
      return s + ((asNumber(w.currentValue) - basis) / basis) * 100;
    }, 0) / items.length;
  })();
  // Deals tracked — sets where a specific sale/target price below MSRP has been set
  const wlDealLogCount = wanted.filter(w => asNumber(w.storePrice) > 0 || (asNumber(w.targetPrice) > 0 && asNumber(w.msrp) > 0 && asNumber(w.targetPrice) < asNumber(w.msrp))).length;
  // Data coverage — sets with at least one market price (currentValue or BL price)
  const wlCoveredCount = wanted.filter(w => asNumber(w.currentValue) > 0 || asNumber(w.blPriceNew) > 0).length;
  const wlCoveragePct  = wanted.length ? Math.round((wlCoveredCount / wanted.length) * 100) : 0;
  // Score distribution across 5 buckets (0-100 scale, 20pt bands)
  const wlScoreBuckets = (() => {
    const buckets = [
      { label: "0–19",   color: "#5aa832", count: 0 },
      { label: "20–39",  color: "#3b82f6", count: 0 },
      { label: "40–59",  color: "#c9a84c", count: 0 },
      { label: "60–79",  color: "#f59e0b", count: 0 },
      { label: "80–100", color: "#ef4444", count: 0 },
    ];
    wanted.forEach(w => {
      const s = priorityScore(w);
      const idx = Math.min(Math.floor(s / 20), 4);
      buckets[idx].count++;
    });
    return buckets;
  })();
  // Aggregate BL price trend — daily avg across all sets (only dates with ≥3 entries)
  const wlPriceTrendData = (() => {
    const byDate = {};
    wanted.forEach(w => {
      if (!w.setNumber) return;
      getPriceHistory(w.setNumber).forEach(snap => {
        const v = asNumber(snap.blPriceNew);
        if (!v) return;
        if (!byDate[snap.date]) byDate[snap.date] = [];
        byDate[snap.date].push(v);
      });
    });
    return Object.entries(byDate)
      .filter(([, vals]) => vals.length >= 3)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, avgBlNew: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 }));
  })();

  // ── Bulk price refresh ────────────────────────────────────────────────────
  // Re-fetches BrickEconomy data for every tracked set (rate-limited 1/500ms).
  // Updates currentValue, forecast fields, and records a price history snapshot.
  async function bulkRefreshPrices() {
    if (refreshing) return;
    const items = wanted.filter(w => w.setNumber);
    if (!items.length) return;

    setRefreshing(true);
    let updated = 0;

    for (const item of items) {
      const key = normalizeSetNumber(item.setNumber);
      try {
        const res  = await apiFetch(`/api/brickeconomy-set?number=${encodeURIComponent(key)}&currency=USD`);
        if (!res.ok) { await new Promise(r => setTimeout(r, 500)); continue; }
        const json = await res.json();
        if (json.error) { await new Promise(r => setTimeout(r, 500)); continue; }
        const data = json.data || json;

        // Update BrickEconomy cache
        try {
          const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
          cache[key] = { fetchedAt: new Date().toISOString(), data };
          setItemSafe("brickEconomySetCache", JSON.stringify(cache));
        } catch {}

        // Record price snapshot
        recordPriceSnapshot(key, {
          msrp:       data.retail_price_us,
          value:      data.current_value_new,
        });

        // Patch the matching wanted item
        setWanted(prev => prev.map(w => {
          const wKey = normalizeSetNumber(w.setNumber);
          if (wKey !== key) return w;
          const updates = {};
          if (data.retail_price_us)             updates.msrp        = data.retail_price_us;
          if (data.current_value_new)            updates.currentValue = data.current_value_new;
          if (data.forecast_value_new_2_years)   updates.forecast2yr  = data.forecast_value_new_2_years;
          if (data.forecast_value_new_5_years)   updates.forecast5yr  = data.forecast_value_new_5_years;
          return Object.keys(updates).length ? { ...w, ...updates } : w;
        }));

        updated++;
      } catch {}

      await new Promise(r => setTimeout(r, 500)); // ~2 items/second
    }

    setRefreshing(false);
    if (updated > 0) {
      toast.success(`Refreshed ${updated} of ${items.length} sets.`);
    } else {
      toast.error("Could not refresh prices — check your connection.");
    }
  }

  async function lookupBrickEconomy(setNumOverride) {
    const lookupKey = normalizeSetNumber(setNumOverride ?? form.setNumber);
    if (!lookupKey) { setLookupMessage("Enter a set number first."); return; }

    setLookupLoading(true);
    setLookupMessage("");
    setBfRetirement(null);

    // Pre-fill instantly from local Rebrickable catalog (no network needed)
    const rb = rbLookupSet(lookupKey);
    if (rb) {
      setForm(prev => ({
        ...prev,
        name:        prev.name        || rb.name,
        theme:       prev.theme       || rb.theme,
        releaseYear: prev.releaseYear || String(rb.year    || ""),
        pieces:      prev.pieces      || String(rb.numParts || ""),
      }));
    }

    try {
      // ── 1. Brickset (primary — metadata + MSRP + retirement) ──────────────
      const bsData = await fetchBricksetSet(lookupKey);

      if (!bsData && !rb) {
        setLookupMessage("Set not found — check the number.");
        return;
      }

      if (bsData) {
        const currentYear = new Date().getFullYear();
        setForm(prev => {
          const updates = {
            setNumber:     String(lookupKey).replace(/-1$/, ""),
            name:          bsData.name          || prev.name,
            theme:         bsData.theme         || prev.theme,
            subtheme:      bsData.subtheme      || prev.subtheme      || "",
            pieces:        bsData.pieces        || prev.pieces        || "",
            minifigs:      bsData.minifigs      || prev.minifigs      || "",
            releaseYear:   bsData.year          || prev.releaseYear   || "",
            availability:  bsData.availability  || prev.availability  || "",
            weight:        bsData.weight        || prev.weight        || "",
            rating:        bsData.rating        || prev.rating        || "",
            packagingType: bsData.packaging_type || prev.packagingType || "",
            ageMin:        bsData.age_min       || prev.ageMin        || "",
            ownedByCount:  bsData.owned_by  != null ? bsData.owned_by  : (prev.ownedByCount  ?? ""),
            wantedByCount: bsData.wanted_by != null ? bsData.wanted_by : (prev.wantedByCount ?? ""),
          };
          if (bsData.retail_price_us) {
            updates.msrp = bsData.retail_price_us;
            if (asNumber(prev.targetDiscount) > 0) {
              updates.targetPrice = (bsData.retail_price_us * (1 - asNumber(prev.targetDiscount) / 100)).toFixed(2);
            }
          }
          if (bsData.exit_date) {
            const exitYear = new Date(bsData.exit_date).getFullYear();
            updates.exit_date            = bsData.exit_date;
            updates.retirementYear       = String(exitYear);
            updates.retiringSoon         = exitYear <= currentYear + 1;
            updates.retirementSource     = "Brickset";
            updates.lastRetirementUpdate = new Date().toISOString().slice(0, 10);
          }
          return { ...prev, ...updates };
        });
      }

      setLookupMessage(`Found: ${bsData?.name || lookupKey}`);

      // ── 2. BrickEconomy (value only — currentValue + forecasts) ───────────
      ;(async () => {
        try {
          const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
          let beData = cache[lookupKey]?.data;
          if (!beData) {
            const res  = await apiFetch(`/api/brickeconomy-set?number=${encodeURIComponent(lookupKey)}&currency=USD`);
            const json = await res.json();
            if (res.ok && !json.error) {
              beData = json.data || json;
              cache[lookupKey] = { fetchedAt: new Date().toISOString(), data: beData };
              setItemSafe("brickEconomySetCache", JSON.stringify(cache));
            }
          }
          if (beData) {
            setForm(prev => {
              const updates = {};
              if (beData.current_value_new)          updates.currentValue = beData.current_value_new;
              if (beData.forecast_value_new_2_years) updates.forecast2yr  = beData.forecast_value_new_2_years;
              if (beData.forecast_value_new_5_years) updates.forecast5yr  = beData.forecast_value_new_5_years;
              // Only use BE MSRP if Brickset didn't provide one
              if (!bsData?.retail_price_us && beData.retail_price_us) {
                updates.msrp = beData.retail_price_us;
                if (asNumber(prev.targetDiscount) > 0) {
                  updates.targetPrice = (beData.retail_price_us * (1 - asNumber(prev.targetDiscount) / 100)).toFixed(2);
                }
              }
              return Object.keys(updates).length ? { ...prev, ...updates } : prev;
            });
            recordPriceSnapshot(lookupKey, {
              msrp:  bsData?.retail_price_us || beData.retail_price_us,
              value: beData.current_value_new,
            });
            if (beData.current_value_new) {
              setLookupMessage(m => m + ` · Value: $${Number(beData.current_value_new).toFixed(0)}`);
            }
          }
        } catch { /* BE failures are non-critical */ }
      })();

      // ── 3. BrickLink price guide (non-blocking, only if authenticated) ────
      if (hasBrickLinkAuth()) {
        fetchBrickLinkPriceGuide(lookupKey).then(blData => {
          if (!blData) return;
          setForm(prev => ({
            ...prev,
            blPriceNew:     blData.avg_price_new  || prev.blPriceNew,
            blPriceUsed:    blData.avg_price_used || prev.blPriceUsed,
            blPriceNewMin:  blData.min_price_new  || prev.blPriceNewMin,
            blPriceNewMax:  blData.max_price_new  || prev.blPriceNewMax,
            blPriceUsedMin: blData.min_price_used || prev.blPriceUsedMin,
            blPriceUsedMax: blData.max_price_used || prev.blPriceUsedMax,
          }));
          if (blData.avg_price_new || blData.avg_price_used) {
            setLookupMessage(m => m + " · BL prices loaded.");
          }
        }).catch(() => {});
      }

      // ── 4. Brick Fanatics retirement (non-blocking) ────────────────────────
      const bfNum = String(lookupKey).replace(/-1$/, "");
      apiFetch(`/api/brickfanatics-retiring?number=${encodeURIComponent(bfNum)}`)
        .then(r => r.json())
        .then(bfData => {
          if (!bfData || bfData.error) return;
          setBfRetirement(bfData);
          if (bfData.retiring && bfData.retirementDate) {
            setForm(prev => {
              if (prev.retirementSource === "LEGO Last Chance") return prev; // LC is authoritative
              const yrMatch = bfData.retirementDate.match(/\b(20\d{2})\b/);
              const yr = yrMatch ? Number(yrMatch[1]) : null;
              return {
                ...prev,
                retirementYear:       yr ? String(yr) : prev.retirementYear,
                bfRetirementDate:     bfData.retirementDate,
                retirementSource:     "Brick Fanatics",
                retiringSoon:         yr ? yr <= new Date().getFullYear() + 1 : prev.retiringSoon,
                lastRetirementUpdate: new Date().toISOString().slice(0, 10),
              };
            });
            setLookupMessage(m => m + ` · BF: ${bfData.retirementDate}.`);
          }
        })
        .catch(() => {});

    } catch (err) {
      setLookupMessage(err.message || "Lookup failed — check your connection.");
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
    if (!window.confirm(`Delete ${checkedWanted.length} tracked item(s)?`)) return;

    setWanted(prev => prev.filter((_, i) => !checkedWanted.includes(i)));
    setCheckedWanted([]);
    setSelectedWantedIndex(null);
  }

  function addWanted() {
    if (!form.setNumber && !form.name) return;
    if (dupeWarning === "watchlist") return; // already on list — block silently (warning already visible)

    setWanted(prev => [
      ...prev,
      {
        ...form,
        id: `wl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        addedAt: new Date().toISOString(),
        msrp: asNumber(form.msrp),
        targetDiscount: asNumber(form.targetDiscount),
        targetPrice: asNumber(form.targetPrice) || (
          asNumber(form.msrp)
            ? asNumber(form.msrp) * (1 - asNumber(form.targetDiscount) / 100)
            : 0
        ),
      }
    ]);

    setForm({
      setNumber: "", name: "", theme: "", msrp: "", targetDiscount: "", targetPrice: "",
      retiringSoon: false, retirementYear: "", bfRetirementDate: "",
      notes: "", subtheme: "", minifigs: "",
      weight: "", rating: "", packagingType: "", ageMin: "",
      exit_date: "", isLastChance: false, forecast2yr: "", forecast5yr: "",
    });
    setBfRetirement(null);
  }

  function updateWanted(index, field, value) {
    setWanted(prev => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: ["msrp", "targetPrice"].includes(field)
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
        <div style={{ ...acTabBar, position: "relative" }}>
          {[
            { key: "overview", label: "Overview" },
            { key: "queue", label: "Tracking" },
            { key: "research", label: "Research" }
          ].map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)} style={subTab === t.key ? acActiveTab : acTabBtn}>
              {t.label}
            </button>
          ))}
          <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.12)", alignSelf: "center" }} />
          <button
            onClick={() => setShortcutsOpen(v => !v)}
            style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#5d6f80", cursor: "pointer", fontSize: 13, padding: "6px 10px", lineHeight: 1, display: "flex", alignItems: "center", gap: 5 }}
            title="Keyboard shortcuts (N, E, ↑↓, Esc)"
          >⌨ <span style={{ fontSize: 11 }}>Keys</span></button>
          {shortcutsOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12, padding: "14px 18px", minWidth: 260, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, color: "#e8e2d5", fontSize: 13 }}>Keyboard Shortcuts</span>
                <button onClick={() => setShortcutsOpen(false)} style={{ background: "none", border: "none", color: "#5d6f80", cursor: "pointer", fontSize: 16, fontWeight: 900 }}>×</button>
              </div>
              {[
                { key: "N", desc: "Jump to Research tab & focus search" },
                { key: "E", desc: "Edit selected set" },
                { key: "↑ / ↓", desc: "Navigate Tracking rows" },
                { key: "Esc", desc: "Close panels / clear selection" },
              ].map(({ key, desc }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                  <kbd style={{ background: "#1a2840", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 5, padding: "2px 7px", fontSize: 12, fontWeight: 700, color: "#c9a84c", whiteSpace: "nowrap" }}>{key}</kbd>
                  <span style={{ color: "#8a9bb0", fontSize: 13 }}>{desc}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {subTab === "overview" && wanted.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🧱</div>
          <div style={{ fontWeight: 900, fontSize: 20, color: "#e8e2d5", marginBottom: 8 }}>Your tracking list is empty</div>
          <div style={{ color: "#8a9bb0", fontSize: 14, marginBottom: 24, maxWidth: 360, margin: "0 auto 24px" }}>
            Head to the Research tab to look up a set, check retirement dates, and add it to your queue.
          </div>
          <button onClick={() => setSubTab("research")} style={{ background: "#c9a84c", color: "#0d1623", border: "none", borderRadius: 10, padding: "12px 28px", fontWeight: 900, fontSize: 15, cursor: "pointer" }}>
            Research a Set →
          </button>
        </div>
      )}

      {subTab === "overview" && wanted.length > 0 && (
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
              <>
                <div onClick={() => setWlGearOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 29 }} />
                <div style={{ position: "absolute", top: 46, right: 10, zIndex: 30, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "12px 16px", minWidth: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                  <div style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Stats</div>
                  {wlItems.filter(i => i.type === "card").sort((a, b) => a.label.localeCompare(b.label)).map(item => (
                    <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: item.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                      <input type="checkbox" checked={item.visible} onChange={() => setWlItems(prev => prev.map(x => x.key === item.key ? { ...x, visible: !x.visible } : x))} style={{ accentColor: "#c9a84c" }} />
                      {item.label}
                    </label>
                  ))}
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "10px 0 8px" }} />
                  <div style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Panels</div>
                  {wlItems.filter(i => i.type === "panel").sort((a, b) => a.label.localeCompare(b.label)).map(item => (
                    <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: item.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                      <input type="checkbox" checked={item.visible} onChange={() => setWlItems(prev => prev.map(x => x.key === item.key ? { ...x, visible: !x.visible } : x))} style={{ accentColor: "#c9a84c" }} />
                      {item.label}
                    </label>
                  ))}
                </div>
              </>
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
                    {item.key === "wantedCount"    ? <Metric title="Wanted Sets"          value={wanted.length} /> :
                     item.key === "retiringSoon"    ? <Metric title="Retiring This Year"   value={wanted.filter(w => w.retiringSoon || (w.retirementYear && Number(w.retirementYear) <= new Date().getFullYear() + 1)).length} /> :
                     item.key === "totalMsrp"       ? <Metric title="Total MSRP"           value={money(wlTotalMsrp)} /> :
                     item.key === "avgMsrp"         ? <Metric title="Avg MSRP"             value={money(wlAvgMsrp)} /> :
                     item.key === "ownedCount"      ? <Metric title="Already Owned"        value={wlOwnedCount} /> :
                     item.key === "watchCount"      ? <Metric title="Buy Now"              value={wlBuyNowCount} sub={`${wlWatchCount} watching · ${wlWaitCount} waiting`} good={wlBuyNowCount > 0} /> :
                     item.key === "avgDiscount"     ? <Metric title="Avg Discount"         value={wlAvgDiscount !== null ? `${wlAvgDiscount.toFixed(1)}%` : "—"} sub="at target vs MSRP" good={wlAvgDiscount !== null && wlAvgDiscount > 0} /> :
                     item.key === "buyTotal"        ? <Metric title="Tracking Cost"        value={money(wlBuyTotal)} /> :
                     item.key === "budgetAfterBuy"  ? <Metric title="Budget After Buy"     value={wlBudgetAfterBuy !== null ? money(wlBudgetAfterBuy) : "No budget set"} good={wlBudgetAfterBuy !== null ? wlBudgetAfterBuy >= 0 : undefined} /> :
                     item.key === "targetSavings"   ? <Metric title="Potential Savings"    value={money(wlTargetSavings)} sub="MSRP vs target price" good={wlTargetSavings > 0} /> :
                     item.key === "lastChanceCount" ? <Metric title="Last Chance"          value={wlLastChanceCount} sub="on LEGO.com Last Chance" good={wlLastChanceCount > 0} /> :
                     item.key === "avgRoi"          ? <Metric title="Avg Potential ROI"    value={wlAvgRoi !== null ? `${wlAvgRoi.toFixed(1)}%` : "—"} sub="at target vs current value" good={wlAvgRoi !== null && wlAvgRoi > 0} /> :
                     item.key === "dealLogCount"    ? <Metric title="Deals Tracked"        value={wlDealLogCount} sub="sets with target below MSRP" good={wlDealLogCount > 0} /> :
                     item.key === "dataCoverage"    ? <Metric title="Data Coverage"        value={`${wlCoveragePct}%`} sub={`${wlCoveredCount} of ${wanted.length} have market data`} good={wlCoveragePct >= 50} /> : null}
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
                      {(item.key === "urgency-chart" || item.key === "theme-breakdown") && (() => {
                        const ct = chartTypes[item.key] || (item.key === "theme-breakdown" ? "bar" : "donut");
                        const nextLabel = ct === "donut" ? "Pie" : ct === "pie" ? "Bar" : ct === "bar" ? "Donut" : "Bar";
                        return (
                          <button onClick={e => { e.stopPropagation(); cycleChartType(item.key); }} style={hoverCtrlBtn}
                            title={`Switch to ${nextLabel}`}>
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
                    ) : item.key === "retirement-timeline" && retirementWaves.length > 0 ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <style>{`.tl-chip { transition: filter 0.12s, transform 0.12s; } .tl-chip:hover { filter: brightness(1.35) !important; transform: translateY(-2px) !important; cursor: pointer; }`}</style>
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
                                    const days = w.exit_date ? daysUntilRetirement(w.exit_date) : null;
                                    const urgent = w.isLastChance || (days !== null && days <= 60);
                                    const soon   = days !== null && days <= 180;
                                    const chipBg     = urgent ? "#3b0a0a" : soon ? "#1a0a00" : "#0f1a28";
                                    const chipBorder = urgent ? "#7f1d1d" : soon ? "rgba(245,158,11,0.35)" : "rgba(255,255,255,0.07)";
                                    const chipColor  = urgent ? "#ef4444" : soon ? "#f59e0b" : "#e8e2d5";
                                    return (
                                      <div
                                        key={i}
                                        className="tl-chip"
                                        onClick={() => { setDetailItem(w); setDetailItemIndex(wanted.indexOf(w)); }}
                                        onMouseEnter={() => setHoveredWanted(w)}
                                        onMouseLeave={() => setHoveredWanted(null)}
                                        style={{ background: chipBg, border: `1px solid ${chipBorder}`, borderRadius: 10, padding: "8px 12px", minWidth: 140 }}
                                      >
                                        <div style={{ fontSize: 11, color: "#8a9bb0", marginBottom: 3 }}>#{w.setNumber}</div>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: chipColor, marginBottom: 4, lineHeight: 1.3 }}>
                                          {w.name || w.setNumber}
                                        </div>
                                        {days !== null && (
                                          <span style={{ fontSize: 11, color: chipColor }}>
                                            {days <= 0 ? "past date" : `${days}d left`}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : item.key === "urgency-chart" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 14px" }}>Urgency Breakdown</h4>
                        {(() => {
                          const now = new Date();
                          const buckets = [
                            { label: "Last Chance", count: wanted.filter(w => w.isLastChance).length, color: "#ef4444" },
                            { label: "< 60 days",   count: wanted.filter(w => !w.isLastChance && w.exit_date && (new Date(w.exit_date) - now) / 86400000 <= 60 && (new Date(w.exit_date) - now) / 86400000 > 0).length, color: "#f87171" },
                            { label: "< 180 days",  count: wanted.filter(w => !w.isLastChance && w.exit_date && (new Date(w.exit_date) - now) / 86400000 <= 180 && (new Date(w.exit_date) - now) / 86400000 > 60).length, color: "#f59e0b" },
                            { label: "< 1 year",    count: wanted.filter(w => !w.isLastChance && w.exit_date && (new Date(w.exit_date) - now) / 86400000 <= 365 && (new Date(w.exit_date) - now) / 86400000 > 180).length, color: "#c9a84c" },
                            { label: "No date",     count: wanted.filter(w => !w.exit_date && !w.retiringSoon).length, color: "#5d6f80" },
                          ].filter(b => b.count > 0);
                          if (buckets.length === 0) return <div style={{ color: "#5d6f80", fontSize: 13 }}>No retirement data yet.</div>;
                          const ct = chartTypes["urgency-chart"] || "donut";
                          if (ct === "bar") return (
                            <ResponsiveContainer width="100%" height={160}>
                              <BarChart data={buckets} layout="vertical" margin={{ left: 10, right: 30, top: 4, bottom: 4 }}>
                                <XAxis type="number" tick={{ fill: "#5d6f80", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                <YAxis type="category" dataKey="label" tick={{ fill: "#8a9bb0", fontSize: 12 }} width={80} axisLine={false} tickLine={false} />
                                <Tooltip formatter={v => [v, "Sets"]} contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                                  {buckets.map((b, i) => <Cell key={i} fill={b.color} />)}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          );
                          return (
                            <>
                              <ResponsiveContainer width="100%" height={160}>
                                <PieChart>
                                  <Pie data={buckets} cx="50%" cy="50%" innerRadius={ct === "donut" ? 48 : 0} outerRadius={72} dataKey="count" paddingAngle={ct === "donut" ? 2 : 1}>
                                    {buckets.map((b, i) => <Cell key={i} fill={b.color} />)}
                                  </Pie>
                                  <Tooltip formatter={v => [v, "Sets"]} contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                                </PieChart>
                              </ResponsiveContainer>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 4 }}>
                                {buckets.map(b => (
                                  <span key={b.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8a9bb0" }}>
                                    <span style={{ width: 10, height: 10, borderRadius: 2, background: b.color, display: "inline-block", flexShrink: 0 }} />
                                    {b.label} <strong style={{ color: b.color }}>{b.count}</strong>
                                  </span>
                                ))}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    ) : item.key === "msrp-vs-target" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 6px" }}>MSRP vs Target Price</h4>
                        <div style={{ fontSize: 12, color: "#5d6f80", marginBottom: 14 }}>Top sets — amber = MSRP, green overlay = target</div>
                        {wlMsrpVsTargetData.length === 0 ? (
                          <div style={{ color: "#5d6f80", fontSize: 13 }}>Add MSRP and target prices to see this chart.</div>
                        ) : (
                          <div style={{ display: "grid", gap: 8 }}>
                            {wlMsrpVsTargetData.map(({ name, msrp, target }) => {
                              const maxMsrp = wlMsrpVsTargetData[0].msrp;
                              const savings = msrp - target;
                              const savingsPct = msrp > 0 ? (savings / msrp * 100).toFixed(0) : 0;
                              return (
                                <div key={name} style={{ display: "grid", gridTemplateColumns: "1fr 56px", gap: 10, alignItems: "center" }}>
                                  <div>
                                    <div style={{ fontSize: 12, color: "#8a9bb0", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                                    <div style={{ position: "relative", height: 8, background: "#0b1520", borderRadius: 999, overflow: "hidden" }}>
                                      <div style={{ position: "absolute", height: "100%", width: `${(msrp / maxMsrp) * 100}%`, background: "#c9a84c44", borderRadius: 999 }} />
                                      <div style={{ position: "absolute", height: "100%", width: `${(target / maxMsrp) * 100}%`, background: "#5aa832", borderRadius: 999 }} />
                                    </div>
                                  </div>
                                  <div style={{ textAlign: "right" }}>
                                    <div style={{ fontSize: 12, color: "#e8e2d5", fontWeight: 700 }}>{money(target)}</div>
                                    {savings > 0 && <div style={{ fontSize: 11, color: "#5aa832" }}>−{savingsPct}%</div>}
                                  </div>
                                </div>
                              );
                            })}
                            <div style={{ marginTop: 6, display: "flex", gap: 16 }}>
                              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8a9bb0" }}>
                                <span style={{ width: 10, height: 10, borderRadius: 2, background: "#c9a84c44", border: "1px solid #c9a84c", display: "inline-block" }} /> MSRP
                              </span>
                              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8a9bb0" }}>
                                <span style={{ width: 10, height: 10, borderRadius: 2, background: "#5aa832", display: "inline-block" }} /> Target
                              </span>
                              <span style={{ fontSize: 12, color: "#5aa832", fontWeight: 700 }}>Total savings: {money(wlTargetSavings)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : item.key === "action-breakdown" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 14px" }}>Action Breakdown</h4>
                        {wanted.length === 0 ? (
                          <div style={{ color: "#5d6f80", fontSize: 13 }}>No sets tracked yet.</div>
                        ) : (() => {
                          const rows = [
                            { label: "Buy Now",       count: wlBuyNowCount, color: "#ef4444" },
                            { label: "Watch Closely", count: wlWatchCount,  color: "#f59e0b" },
                            { label: "Wait",          count: wlWaitCount,   color: "#5aa832" },
                          ];
                          const max = Math.max(...rows.map(r => r.count), 1);
                          return (
                            <div style={{ display: "grid", gap: 12 }}>
                              {rows.map(({ label, count, color }) => (
                                <div key={label}>
                                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                                    <span style={{ fontSize: 13, color: "#8a9bb0" }}>{label}</span>
                                    <span style={{ fontSize: 13, fontWeight: 700, color }}>{count}</span>
                                  </div>
                                  <div style={{ height: 8, background: "#0b1520", borderRadius: 999, overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${(count / max) * 100}%`, background: color, borderRadius: 999, transition: "width 0.4s ease" }} />
                                  </div>
                                </div>
                              ))}
                              <div style={{ marginTop: 4, fontSize: 11, color: "#5d6f80" }}>{wanted.length} sets total</div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : item.key === "score-distribution" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 4px" }}>Priority Score Distribution</h4>
                        <div style={{ fontSize: 12, color: "#5d6f80", marginBottom: 14 }}>How urgent are your tracked sets?</div>
                        {wanted.length === 0 ? (
                          <div style={{ color: "#5d6f80", fontSize: 13 }}>No sets tracked yet.</div>
                        ) : (
                          <ResponsiveContainer width="100%" height={160}>
                            <BarChart data={wlScoreBuckets} layout="vertical" margin={{ left: 10, right: 30, top: 4, bottom: 4 }}>
                              <XAxis type="number" tick={{ fill: "#5d6f80", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                              <YAxis type="category" dataKey="label" tick={{ fill: "#8a9bb0", fontSize: 12 }} width={56} axisLine={false} tickLine={false} />
                              <Tooltip formatter={v => [v, "Sets"]} contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                                {wlScoreBuckets.map((b, i) => <Cell key={i} fill={b.color} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    ) : item.key === "price-trend" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 4px" }}>Avg BL Price Trend</h4>
                        <div style={{ fontSize: 12, color: "#5d6f80", marginBottom: 14 }}>Average BrickLink new price across all tracked sets</div>
                        {wlPriceTrendData.length < 5 ? (
                          <div style={{ color: "#5d6f80", fontSize: 13 }}>Not enough data yet — prices are recorded each time you look up a set. Come back after a few days of use.</div>
                        ) : (
                          <ResponsiveContainer width="100%" height={160}>
                            <LineChart data={wlPriceTrendData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                              <XAxis dataKey="date" tick={{ fill: "#5d6f80", fontSize: 10 }} axisLine={false} tickLine={false}
                                tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
                              <YAxis tick={{ fill: "#5d6f80", fontSize: 11 }} axisLine={false} tickLine={false}
                                tickFormatter={v => `$${v}`} width={48} />
                              <Tooltip formatter={v => [money(v), "Avg BL New"]} labelFormatter={l => `Date: ${l}`}
                                contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                              <Line type="monotone" dataKey="avgBlNew" stroke="#3b82f6" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    ) : item.key === "theme-breakdown" ? (
                      <div style={{ ...panel, marginTop: 0 }}>
                        <h4 style={{ margin: "0 0 14px" }}>Wanted Sets by Theme</h4>
                        {wlThemeData.length === 0 ? (
                          <div style={{ color: "#5d6f80", fontSize: 13 }}>No theme data yet.</div>
                        ) : (() => {
                          const ct = chartTypes["theme-breakdown"] || "bar";
                          if (ct === "donut" || ct === "pie") return (
                            <>
                              <ResponsiveContainer width="100%" height={180}>
                                <PieChart>
                                  <Pie data={wlThemeData.slice(0, 8)} cx="50%" cy="50%" innerRadius={ct === "donut" ? 48 : 0} outerRadius={76} dataKey="value" paddingAngle={ct === "donut" ? 2 : 1}>
                                    {wlThemeData.slice(0, 8).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                  </Pie>
                                  <Tooltip formatter={v => [v, "Sets"]} contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                                </PieChart>
                              </ResponsiveContainer>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                                {wlThemeData.slice(0, 8).map((d, i) => (
                                  <span key={d.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#8a9bb0" }}>
                                    <span style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], display: "inline-block" }} />
                                    {d.name} <strong style={{ color: "#e8e2d5" }}>{d.value}</strong>
                                  </span>
                                ))}
                              </div>
                            </>
                          );
                          const maxCount = wlThemeData[0].value;
                          return (
                            <div style={{ display: "grid", gap: 8 }}>
                              {wlThemeData.slice(0, 8).map(({ name, value }, i) => (
                                <div key={name} style={{ display: "grid", gridTemplateColumns: "110px 1fr 36px", alignItems: "center", gap: 10 }}>
                                  <span style={{ color: "#8a9bb0", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                                  <div style={{ height: 8, background: "#0b1520", borderRadius: 999, overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${(value / maxCount) * 100}%`, background: PIE_COLORS[i % PIE_COLORS.length], borderRadius: 999 }} />
                                  </div>
                                  <span style={{ color: "#e8e2d5", fontWeight: 700, fontSize: 13, textAlign: "right" }}>{value}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
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

      {/* ── Store Price Calculator (collapsible) ── */}
      <section style={{ ...panel, padding: "14px 18px" }}>
        <div
          onClick={() => setCalcOpen(v => !v)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>💰</span>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#e8e2d5" }}>In Store Deal Calculator</div>
            {!calcOpen && (calcSetNum || calcMsrp || calcStore) && (
              <span style={{ fontSize: 11, background: "#1a3a1a", border: "1px solid #2d5a2d", color: "#5aa832", borderRadius: 999, padding: "2px 8px", fontWeight: 700 }}>active</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {calcOpen && (calcSetNum || calcMsrp || calcStore) && (
              <button
                onClick={e => { e.stopPropagation(); setCalcSetNum(""); setCalcMsrp(""); setCalcStore(""); setCalcMsg(""); }}
                style={{ background: "transparent", color: "#5d6f80", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >Reset</button>
            )}
            <span style={{ color: "#5d6f80", fontSize: 13, fontWeight: 700 }}>{calcOpen ? "▲" : "▼"}</span>
          </div>
        </div>

        {calcOpen && (<>
        <div style={{ color: "#8a9bb0", fontSize: 13, margin: "10px 0 16px" }}>
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
              style={{ ...inputStyle, border: calcStore ? "1px solid rgba(201,168,76,0.4)" : inputStyle.border }} />
          </div>
        </div>

        {calcMsg && <div style={{ fontSize: 13, color: "#8a9bb0", marginBottom: 12 }}>{calcMsg}</div>}

        {calcDiscount !== null ? (
          <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
            <div style={{ ...calcCard, border: `1px solid ${calcDiscountColor()}40` }}>
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
          {calcDiscount >= 10 && (
            <button
              onClick={() => logDeal(calcSetNum, "", calcMsrpVal, calcStoreVal, calcDiscount)}
              style={{ marginTop: 10, background: "#0a2e1a", border: "1px solid #166534", color: "#5aa832", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}
            >
              📌 Log this deal
            </button>
          )}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "20px 16px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10, color: "#5d6f80", fontSize: 13 }}>
            Enter MSRP and store price to calculate the discount.
          </div>
        )}

        {/* ── Deal log ─────────────────────────────────────────────── */}
        {dealLog.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#e8e2d5" }}>📌 Deal Log</div>
              <button onClick={() => { setDealLog([]); localStorage.removeItem("blDealLog"); }}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.08)", color: "#5d6f80", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
                Clear all
              </button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {dealLog.map(d => (
                <div key={d.id} style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#e8e2d5", marginBottom: 2 }}>
                      {d.setNumber ? `#${d.setNumber}` : ""}{d.name && d.name !== d.setNumber ? ` — ${d.name}` : ""}
                    </div>
                    <div style={{ fontSize: 12, color: "#8a9bb0" }}>
                      {money(d.storePrice)} <span style={{ color: "#5aa832", fontWeight: 700 }}>{d.discount}% off</span>
                      {d.msrp ? ` MSRP ${money(d.msrp)}` : ""}
                      <span style={{ marginLeft: 8, color: "#5d6f80" }}>{new Date(d.loggedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <button onClick={() => deleteDealEntry(d.id)}
                    style={{ background: "transparent", border: "none", color: "#5d6f80", cursor: "pointer", fontSize: 16, padding: "0 4px", flexShrink: 0 }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        </>)}
      </section>

      {/* ── Research & Add Set ── */}
      <section style={panel}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>
            Research &amp; Add Set
            <span
              title="Look up a set by number or search the catalog. BrickEconomy and Brickset data are merged automatically. Fill in a target discount, then click 'Add to Tracking' to add it to your Wanted List."
              style={{ marginLeft: 6, fontSize: 12, color: "#5d6f80", cursor: "default", fontWeight: 400, border: "1px solid #5d6f80", borderRadius: "50%", padding: "0 4px", lineHeight: "16px", display: "inline-block", verticalAlign: "middle" }}
            >?</span>
          </h3>
          {(form.setNumber || form.name || form.theme || form.msrp || form.targetPrice || form.notes) && (
            <button
              onClick={() => {
                setForm({ setNumber: "", name: "", theme: "", msrp: "", targetDiscount: "", targetPrice: "", retiringSoon: false, retirementYear: "", bfRetirementDate: "", releaseYear: "", pieces: "", currentValue: "", availability: "", retirementSource: "Brick Fanatics", lastRetirementUpdate: "", notes: "", subtheme: "", minifigs: "", weight: "", rating: "", packagingType: "", ageMin: "", exit_date: "", isLastChance: false, forecast2yr: "", forecast5yr: "" });
                setLookupMessage("");
              }}
              style={{ background: "transparent", color: "#5d6f80", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
              Reset
            </button>
          )}
        </div>

        {/* ── Unified search input ── */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
          <input
            placeholder="Set number or name…"
            value={form.setNumber || catalogQuery}
            onChange={e => {
              const val = e.target.value;
              if (!val || /^\d/.test(val)) {
                // Numeric → set number mode
                setCatalogQuery("");
                setCatalogResults([]);
                setForm(prev => {
                  const next = { ...prev, setNumber: val };
                  if (rbReady() && val.length >= 4) {
                    const rb = rbLookupSet(val);
                    if (rb) {
                      if (!prev.name)        next.name        = rb.name;
                      if (!prev.theme)       next.theme       = rb.theme;
                      if (!prev.releaseYear) next.releaseYear = String(rb.year     || "");
                      if (!prev.pieces)      next.pieces      = String(rb.numParts || "");
                    }
                  }
                  return next;
                });
              } else {
                // Text → catalog search mode
                setForm(prev => ({ ...prev, setNumber: "" }));
                setCatalogQuery(val);
              }
            }}
            onKeyDown={e => e.key === "Enter" && form.setNumber && lookupBrickEconomy()}
            style={{ flex: 1, minWidth: 180 }}
          />
          {form.setNumber && (
            <button onClick={() => lookupBrickEconomy()} style={{ ...redBtn, marginTop: 0 }} disabled={lookupLoading}>
              {lookupLoading ? "Searching..." : "Look Up"}
            </button>
          )}
          {catalogLoading && <span style={mutedSmall}>Searching…</span>}
          {lookupMessage && <span style={mutedSmall}>{lookupMessage}</span>}
        </div>
        {dupeWarning === "owned" && (
          <div style={{ background: "#3b2500", border: "1px solid #92400e", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#fbbf24", marginBottom: 8 }}>
            ⚠ You already own this set — it's in your collection
          </div>
        )}
        {dupeWarning === "watchlist" && (
          <div style={{ background: "#0f2035", border: "1px solid #1e40af", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#93c5fd", marginBottom: 8 }}>
            ℹ This set is already on your Wanted List
          </div>
        )}
        {catalogError && <div style={{ color: "#ff8b8b", fontSize: 13, marginBottom: 8 }}>{catalogError}</div>}
        {catalogResults.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, maxHeight: 420, overflowY: "auto" }}>
                {catalogResults.map(s => {
                  const clean = String(s.setNumber || "").replace(/-1$/, "");
                  const owned = ownedSetNumbers.has(clean);
                  const onList = wanted.some(w => String(w.setNumber || "").replace(/-1$/, "") === clean);
                  return (
                    <div key={s.setNumber}
                      onClick={() => {
                        setForm(prev => ({
                          ...prev,
                          setNumber: clean,
                          name:      s.name   || prev.name,
                          theme:     s.theme  || prev.theme,
                          msrp:      s.msrp   ? String(s.msrp) : prev.msrp,
                          pieces:    s.pieces ? String(s.pieces) : prev.pieces,
                          minifigs:  s.minifigs != null ? String(s.minifigs) : prev.minifigs,
                          releaseYear: s.year ? String(s.year) : prev.releaseYear,
                          exit_date:   s.exitDate || prev.exit_date,
                        }));
                        setCatalogResults([]);
                        setCatalogQuery("");
                        // Auto-trigger enrichment lookup — pass clean directly to avoid stale closure
                        lookupBrickEconomy(clean);
                      }}
                      style={{ background: "#0f1a28", border: `1px solid ${onList ? "rgba(59,130,246,0.4)" : owned ? "rgba(234,179,8,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: 10, padding: 10, cursor: "pointer", transition: "border-color 0.12s" }}
                      onMouseEnter={e => { e.currentTarget.style.border = "1px solid rgba(201,168,76,0.5)"; }}
                      onMouseLeave={e => { e.currentTarget.style.border = onList ? "1px solid rgba(59,130,246,0.4)" : owned ? "1px solid rgba(234,179,8,0.4)" : "1px solid rgba(255,255,255,0.07)"; }}
                    >
                      {s.thumbnail ? (
                        <img src={s.thumbnail} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
                          style={{ width: "100%", height: 80, objectFit: "contain", borderRadius: 6, background: "#0b1520", marginBottom: 6 }} />
                      ) : (
                        <div style={{ width: "100%", height: 80, borderRadius: 6, background: "#0b1520", marginBottom: 6 }} />
                      )}
                      <div style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.3, marginBottom: 4 }}>{s.name}</div>
                      <div style={{ color: "#5d6f80", fontSize: 11 }}>#{clean} · {s.theme}</div>
                      <div style={{ color: "#5d6f80", fontSize: 11 }}>{s.year}{s.pieces ? ` · ${s.pieces.toLocaleString()} pcs` : ""}</div>
                      {s.msrp && <div style={{ color: "#c9a84c", fontWeight: 700, fontSize: 12, marginTop: 4 }}>{money(s.msrp)}</div>}
                      {owned && <div style={{ color: "#fbbf24", fontSize: 11, marginTop: 2 }}>✓ Owned</div>}
                      {onList && <div style={{ color: "#93c5fd", fontSize: 11, marginTop: 2 }}>✓ On list</div>}
                    </div>
                  );
                })}
              </div>
            )}
        {catalogQuery.length >= 2 && !catalogLoading && catalogResults.length === 0 && !catalogError && (
          <div style={{ color: "#5d6f80", fontSize: 13, padding: "20px 0" }}>No results — try a different name or theme.</div>
        )}

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

              {form.msrp && form.targetPrice && (
                <div style={analysisPanel}>
                  <div style={analysisGrid}>
                    <div style={analysisStat}>
                      <div style={analysisLabel}>Target Price</div>
                      <div style={analysisValue}>{money(form.targetPrice)}</div>
                    </div>

                    <div style={analysisStat}>
                      <div style={analysisLabel}>Discount</div>
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
                      <div style={analysisLabel}>vs Target %</div>
                      <div style={{
                        ...analysisValue,
                        color: targetHit ? "#4ade80" : "#f87171"
                      }}>
                        {targetHit ? "✓ HIT" : "ABOVE"}
                      </div>
                    </div>
                  </div>
                </div>
              )}

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

              {/* Brick Fanatics retirement date */}
              <div style={{ background: "#0b1520", border: `1px solid ${bfRetirement?.retiring ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.06)"}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Brick Fanatics</div>
                {bfRetirement === null
                  ? <div style={{ color: "#5d6f80", fontSize: 13 }}>—</div>
                  : bfRetirement.retiring
                    ? <>
                        <div style={{ color: "#c9a84c", fontWeight: 800, fontSize: 13 }}>{bfRetirement.retirementDate || "Retiring"}</div>
                        {bfRetirement.theme && <div style={{ color: "#5d6f80", fontSize: 11, marginTop: 2 }}>{bfRetirement.theme}</div>}
                      </>
                    : <div style={{ color: "#5d6f80", fontSize: 13 }}>Not listed</div>
                }
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
                const links = [
                  { label: "Brick Fanatics ↗", url: "https://www.brickfanatics.com/every-lego-set-retiring-this-year-and-beyond", color: "#c9a84c" },
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
            <select style={inputStyle} value={form.theme} onChange={e => setForm({ ...form, theme: e.target.value })}>
              <option value="">— Theme —</option>
              {acquisitionThemes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div style={fieldGroup}>
            <div style={groupTitle}>Deal Target</div>

            <input style={inputStyle} placeholder="MSRP" type="number" step="0.01" value={form.msrp} onChange={e => setForm({ ...form, msrp: e.target.value })} />

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

            <input style={inputStyle} placeholder="Target Price" type="number" step="0.01" value={form.targetPrice} onChange={e => setForm({ ...form, targetPrice: e.target.value })} />
          </div>

          <div style={fieldGroup}>
            <input style={inputStyle} placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        {form.msrp && form.targetPrice && (
          <div style={analysisPanel}>
            <div style={analysisGrid}>
              <div style={analysisCard}>
                <div style={analysisLabel}>Target Price</div>
                <div style={analysisValue}>{money(form.targetPrice)}</div>
              </div>

              <div style={analysisCard}>
                <div style={analysisLabel}>Discount</div>
                <div style={{ ...analysisValue, color: targetHit ? "#4ade80" : "#f87171" }}>
                  {liveDiscount.toFixed(1)}%
                </div>
              </div>

              <div style={analysisCard}>
                <div style={analysisLabel}>Savings</div>
                <div style={analysisValue}>{money(projectedSavings)}</div>
              </div>

              <div style={analysisCard}>
                <div style={analysisLabel}>vs Target %</div>
                <div style={{ ...analysisValue, color: targetHit ? "#4ade80" : "#f87171" }}>
                  {targetHit ? "✓ HIT" : "ABOVE"}
                </div>
              </div>
            </div>
          </div>
        )}

        <button onClick={addWanted} disabled={dupeWarning === "watchlist"} style={{ ...redBtn, ...(dupeWarning === "watchlist" ? { opacity: 0.4, cursor: "not-allowed" } : {}) }}>Add to Tracking</button>
      </section>

      {/* ── Brickset CSV Import ─────────────────────────────────────────── */}
      <section style={panel}>
        <h3 style={{ margin: "0 0 6px" }}>Import from Brickset</h3>
        <p style={{ color: "#8a9bb0", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
          Export your Brickset wanted list as CSV (brickset.com → My Sets → Wanted → Export), then import it here to bulk-add sets.
        </p>
        <input
          type="file"
          accept=".csv"
          onChange={e => {
            const file = e.target.files?.[0];
            if (!file) return;
            Papa.parse(file, {
              header: true,
              skipEmptyLines: true,
              complete: ({ data }) => {
                if (!data.length) { toast.error("No data found in CSV."); return; }
                // Normalize all header keys to lowercase for flexible column matching
                const rows = data.map(row => Object.fromEntries(
                  Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), String(v ?? "").trim()])
                ));
                const sample = rows[0];
                const setNumKey = Object.keys(sample).find(k =>
                  (k.includes("set") && k.includes("number")) || k === "setnumber" || k === "set number"
                );
                if (!setNumKey) { toast.error("Couldn't find a Set Number column in this CSV."); return; }
                let added = 0, skipped = 0;
                const existingNums = new Set(wanted.map(w => String(w.setNumber || "").replace(/-1$/, "")));
                const newItems = [];
                for (const row of rows) {
                  const raw = row[setNumKey] || "";
                  const setNum = raw.replace(/-1$/, "").replace(/^0+/, "") || raw;
                  if (!setNum || existingNums.has(setNum)) { skipped++; continue; }
                  existingNums.add(setNum);
                  newItems.push({
                    id: `wl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    addedAt: new Date().toISOString(),
                    setNumber: setNum,
                    name:       row.name || row["set name"] || "",
                    theme:      row.theme || "",
                    releaseYear: row.year || "",
                    pieces:     row.pieces || "",
                    msrp: "", targetPrice: "", targetDiscount: "", storePrice: "",
                    retiringSoon: false, retirementYear: "", bfRetirementDate: "",
                    retirementSource: "", lastRetirementUpdate: "",
                    exit_date: "", isLastChance: false, forecast2yr: "", forecast5yr: "",
                    currentValue: "", notes: "", subtheme: "", minifigs: "",
                    weight: "", rating: "", packagingType: "", ageMin: "",
                  });
                  added++;
                }
                if (newItems.length > 0) setWanted(prev => [...prev, ...newItems]);
                toast.success(`Imported ${added} set${added !== 1 ? "s" : ""}${skipped ? ` · ${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped` : ""}.`);
                e.target.value = "";
              },
              error: () => toast.error("Failed to parse CSV."),
            });
          }}
          style={{ display: "block", color: "#8a9bb0", fontSize: 13, marginBottom: 8 }}
        />
        <div style={{ fontSize: 12, color: "#5d6f80" }}>
          Duplicate set numbers are skipped automatically. You can enrich each set via the Research lookup afterward.
        </div>
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
                    onMouseEnter={() => setHoveredWanted(w)}
                    onMouseLeave={() => setHoveredWanted(null)}
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
                setItemSafe("blLCAlertDismissed", JSON.stringify(newDismissed));
              }}
              style={{ background: "transparent", border: "1px solid #7f1d1d", color: "#8a9bb0", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12, flexShrink: 0 }}
            >
              Dismiss
            </button>
          </div>
        )}

        {priceDropAlerts.length > 0 && (
          <div style={{ background: "#132a1a", border: "1px solid #166534", borderRadius: 12, padding: "12px 18px", marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 14 }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>💰</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#5aa832", fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
                Price Drop — {priceDropAlerts.length} {priceDropAlerts.length === 1 ? "set is" : "sets are"} at or below your target price
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {priceDropAlerts.map(w => {
                  const sp = asNumber(w.storePrice), tp = asNumber(w.targetPrice);
                  const pct = tp > 0 ? ((tp - sp) / tp * 100).toFixed(0) : 0;
                  return (
                    <span key={w.setNumber}
                      onClick={() => { setDetailItem(w); setDetailItemIndex(wanted.indexOf(w)); }}
                      onMouseEnter={() => setHoveredWanted(w)}
                      onMouseLeave={() => setHoveredWanted(null)}
                      style={{ background: "#0a2e1a", border: "1px solid #166534", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "#86efac", cursor: "pointer", fontWeight: 700 }}
                    >
                      #{w.setNumber} {w.name ? `— ${w.name}` : ""} {pct > 0 ? `(${pct}% off target)` : "(at target)"}
                    </span>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => {
                const next = [...priceDropDismissed, ...priceDropAlerts.map(w => String(w.setNumber))];
                setPriceDropDismissed(next);
                setItemSafe("blPriceDropDismissed", JSON.stringify(next));
              }}
              style={{ background: "transparent", border: "1px solid #166534", color: "#8a9bb0", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12, flexShrink: 0 }}
            >
              Dismiss
            </button>
          </div>
        )}
      <section style={panel}>
        <div style={row}>
          <h3>Tracking</h3>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Search tracking..."
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

          {(search || filterTheme) && (
            <button
              onClick={() => { setSearch(""); setFilterTheme(""); }}
              style={clearFilterButton}
            >
              Clear
            </button>
          )}

          <select
            value={`${sortKey}:${sortDirection}`}
            onChange={e => {
              const [key, dir] = e.target.value.split(":");
              setSortKey(key);
              setSortDirection(dir);
            }}
            style={filterSelect}
          >
            <option value="retirementDate:asc">Retires Soonest</option>
            <option value="addedAt:desc">Recently Added</option>
            <option value="name:asc">Name (A–Z)</option>
            <option value="msrp:desc">MSRP (↓)</option>
            <option value="discount:desc">Discount (↓)</option>
          </select>

          {/* Bulk price refresh */}
          <button
            onClick={bulkRefreshPrices}
            disabled={refreshing}
            title={refreshing ? "Refreshing prices…" : `Refresh BrickEconomy prices for all ${wanted.length} tracked sets`}
            style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
              color: refreshing ? "#5d6f80" : "#8a9bb0", borderRadius: 8, padding: "7px 11px",
              cursor: refreshing ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
            }}
          >
            {refreshing ? (
              <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>↻</span>
            ) : "↻"}{" "}
            {refreshing ? "Refreshing…" : "Refresh Prices"}
          </button>

          {/* BF retirement sync */}
          <button
            onClick={() => syncBFRetirement(true)}
            disabled={bfSyncing}
            title={
              bfSyncResult
                ? `Last sync: ${bfSyncResult.updated} updated · ${bfSyncResult.total} sets on BF list — click to re-sync`
                : "Check all tracked sets against Brick Fanatics retiring list"
            }
            style={{
              background: bfSyncResult ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${bfSyncResult ? "rgba(245,158,11,0.25)" : "rgba(255,255,255,0.12)"}`,
              color: bfSyncing ? "#5d6f80" : bfSyncResult ? "#f59e0b" : "#8a9bb0",
              borderRadius: 8, padding: "7px 11px",
              cursor: bfSyncing ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
            }}
          >
            {bfSyncing
              ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>↻</span> Syncing…</>
              : bfSyncResult
              ? `✓ BF Sync (${bfSyncResult.updated} updated)`
              : "⚠ BF Retirement"}
          </button>

          {/* Column visibility gear */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setColGearOpen(o => !o)}
              title={`Column visibility — ${columns.filter(c => c.visible).length} of ${columns.length} shown`}
              style={{
                background: colGearOpen ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: colGearOpen ? "#c9a84c" : "#8a9bb0", borderRadius: 8, padding: "7px 9px",
                cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center"
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <rect x="0" y="0" width="14" height="3" rx="1"/>
                <rect x="0" y="5" width="3.5" height="9" rx="1"/>
                <rect x="5.25" y="5" width="3.5" height="9" rx="1"/>
                <rect x="10.5" y="5" width="3.5" height="9" rx="1"/>
              </svg>
            </button>
            {colGearOpen && (
              <>
                <div onClick={() => setColGearOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 199 }} />
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
                  { id: "intelligence", label: "Intelligence" },
                  { id: "core",         label: "Core" },
                  { id: "retirement",   label: "Retirement" },
                  { id: "pricing",      label: "Pricing" },
                  { id: "details",      label: "Details" },
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
                    Custom Fields
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
              </>
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

        {/* ── Mobile card stack (< 640 px) ─────────────────────────── */}
        {isMobile && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            {visibleWanted.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 16px", color: "#5d6f80", fontSize: 14 }}>No sets match your filters.</div>
            )}
            {visibleWanted.map(item => {
              const realIndex = wanted.indexOf(item);
              const discount = asNumber(item.msrp) && asNumber(item.targetPrice)
                ? ((asNumber(item.msrp) - asNumber(item.targetPrice)) / asNumber(item.msrp)) * 100 : 0;
              const sc = priorityScore(item);
              const rec = recommendation(sc);
              const recColor = rec === "Buy Now" ? "#ef4444" : rec === "Watch Closely" ? "#f59e0b" : "#5aa832";
              const isOwned = ownedSetNumbers.has(String(item.setNumber || "").replace(/-1$/, ""));
              return (
                <div key={`${item.setNumber}-${realIndex}`}
                  onClick={() => { setDetailItem(item); setDetailItemIndex(realIndex); }}
                  style={{ background: "rgba(15,26,40,0.9)", border: `1px solid ${item.isLastChance ? "#7f1d1d" : "rgba(255,255,255,0.08)"}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: "#8a9bb0", marginBottom: 2 }}>#{item.setNumber} · {item.theme || "—"}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: item.isLastChance ? "#ef4444" : "#e8e2d5", lineHeight: 1.3 }}>
                        {item.isLastChance && "🚨 "}{item.name || item.setNumber}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      <span style={{ background: recColor + "22", color: recColor, border: `1px solid ${recColor}44`, borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{rec}</span>
                      {isOwned && <span style={{ fontSize: 10, background: "#0a2e1a", border: "1px solid #166534", color: "#5aa832", borderRadius: 999, padding: "2px 7px", fontWeight: 700 }}>✓ Owned</span>}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <div><div style={{ fontSize: 10, color: "#5d6f80" }}>MSRP</div><div style={{ fontSize: 13, fontWeight: 700, color: "#e8e2d5" }}>{money(item.msrp) || "—"}</div></div>
                    <div><div style={{ fontSize: 10, color: "#5d6f80" }}>Target</div><div style={{ fontSize: 13, fontWeight: 700, color: "#c9a84c" }}>{money(item.targetPrice) || "—"}</div></div>
                    <div><div style={{ fontSize: 10, color: "#5d6f80" }}>Discount</div><div style={{ fontSize: 13, fontWeight: 700, color: discount >= 20 ? "#5aa832" : discount >= 10 ? "#f59e0b" : "#8a9bb0" }}>{discount > 0 ? `${discount.toFixed(0)}%` : "—"}</div></div>
                  </div>
                  {(item.retirementYear || item.exit_date || item.retiringSoon) && (
                    <div style={{ marginTop: 8, fontSize: 11, color: item.retiringSoon ? "#f59e0b" : "#8a9bb0" }}>
                      {item.exit_date ? `Retires: ${new Date(item.exit_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : item.retirementYear ? `Est. retirement: ${item.retirementYear}` : "⚠ Retiring soon"}
                    </div>
                  )}
                  <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                    <button onClick={e => { e.stopPropagation(); setSelectedWantedIndex(realIndex); }}
                      style={{ background: "#1a2840", border: "1px solid rgba(255,255,255,0.08)", color: "#c9a84c", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      Edit
                    </button>
                    <button onClick={e => { e.stopPropagation(); openBuyModal(item); }}
                      style={{ background: "#0a2e1a", border: "1px solid #166534", color: "#5aa832", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      Purchase
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Desktop table ────────────────────────────────────────── */}
        {!isMobile && <div style={{
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

                    {columns.filter(col => col.visible).map(col => {
                      const inpStyle = { background: "#0d1a2a", border: "1px solid rgba(201,168,76,0.5)", borderRadius: 6, color: "#e8e2d5", fontSize: 13, padding: "2px 6px", outline: "none" };

                      // MSRP — double-click to edit inline
                      if (col.key === "msrp") {
                        const isEditing = inlineEdit?.index === realIndex && inlineEdit?.key === "msrp";
                        if (isEditing) return (
                          <td key="msrp" style={tdRight} onClick={e => e.stopPropagation()}>
                            <input autoFocus type="number" step="0.01" value={inlineEdit.value}
                              onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))}
                              onBlur={() => { updateWanted(realIndex, "msrp", inlineEdit.value); setInlineEdit(null); }}
                              onKeyDown={e => { if (e.key === "Enter") { updateWanted(realIndex, "msrp", inlineEdit.value); setInlineEdit(null); } if (e.key === "Escape") setInlineEdit(null); }}
                              style={{ ...inpStyle, width: 70, textAlign: "right" }} />
                          </td>
                        );
                        return (
                          <td key="msrp" style={tdRight} onClick={e => e.stopPropagation()}
                            onDoubleClick={e => { e.stopPropagation(); setInlineEdit({ index: realIndex, key: "msrp", value: item.msrp ? String(item.msrp) : "" }); }}>
                            <span title="Double-click to edit">{money(item.msrp)}</span>
                          </td>
                        );
                      }

                      // Target Price — double-click to edit inline
                      if (col.key === "targetPrice") {
                        const isEditing = inlineEdit?.index === realIndex && inlineEdit?.key === "targetPrice";
                        if (isEditing) return (
                          <td key="targetPrice" style={tdRight} onClick={e => e.stopPropagation()}>
                            <input autoFocus type="number" step="0.01" value={inlineEdit.value}
                              onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))}
                              onBlur={() => { updateWanted(realIndex, "targetPrice", inlineEdit.value); setInlineEdit(null); }}
                              onKeyDown={e => { if (e.key === "Enter") { updateWanted(realIndex, "targetPrice", inlineEdit.value); setInlineEdit(null); } if (e.key === "Escape") setInlineEdit(null); }}
                              style={{ ...inpStyle, width: 70, textAlign: "right" }} />
                          </td>
                        );
                        return (
                          <td key="targetPrice" style={tdRight} onClick={e => e.stopPropagation()}
                            onDoubleClick={e => { e.stopPropagation(); setInlineEdit({ index: realIndex, key: "targetPrice", value: item.targetPrice ? String(item.targetPrice) : "" }); }}>
                            <span title="Double-click to edit">{money(item.targetPrice)}</span>
                          </td>
                        );
                      }

                      // Notes — double-click to edit inline
                      if (col.key === "notes") {
                        const isEditing = inlineEdit?.index === realIndex && inlineEdit?.key === "notes";
                        if (isEditing) return (
                          <td key="notes" style={td} onClick={e => e.stopPropagation()}>
                            <input autoFocus value={inlineEdit.value}
                              onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))}
                              onBlur={() => { updateWanted(realIndex, "notes", inlineEdit.value); setInlineEdit(null); }}
                              onKeyDown={e => { if (e.key === "Enter") { updateWanted(realIndex, "notes", inlineEdit.value); setInlineEdit(null); } if (e.key === "Escape") setInlineEdit(null); }}
                              style={{ ...inpStyle, width: 140 }} />
                          </td>
                        );
                        return (
                          <td key="notes" style={{ ...td, cursor: "default" }} onClick={e => e.stopPropagation()}
                            onDoubleClick={e => { e.stopPropagation(); setInlineEdit({ index: realIndex, key: "notes", value: item.notes || "" }); }}>
                            <span title="Double-click to edit">{item.notes || <span style={{ color: "#3a4f63" }}>—</span>}</span>
                          </td>
                        );
                      }

                      return (
                        <td
                          key={col.key}
                          style={isNumericColumn(col.key) ? tdRight : td}
                          onClick={col.key === "retiringSoon" ? e => e.stopPropagation() : undefined}
                        >
                          {renderCell(item, col.key, realIndex, discount)}
                        </td>
                      );
                    })}


                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>

          {selectedWantedIndex !== null && wanted[selectedWantedIndex] && (
            <div style={{ ...editPanel, position: "sticky", top: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#e8e2d5" }}>Edit Tracked Item</h3>
                <button onClick={() => setSelectedWantedIndex(null)} style={circleButton}>×</button>
              </div>

              {(() => {
                const w = wanted[selectedWantedIndex];
                const lbl = { fontSize: 10, fontWeight: 700, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5, display: "block" };
                const inp = { width: "100%", background: "#0d1a2a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5", fontSize: 13, padding: "7px 10px", outline: "none", boxSizing: "border-box" };
                const row = { display: "grid", gap: 10, marginBottom: 10 };
                return (
                  <div>
                    {/* Row 1: Set # + Set Name */}
                    <div style={{ ...row, gridTemplateColumns: "110px 1fr" }}>
                      <label><span style={lbl}>Set #</span><input style={inp} value={w.setNumber || ""} onChange={e => updateWanted(selectedWantedIndex, "setNumber", e.target.value)} /></label>
                      <label><span style={lbl}>Set Name</span><input style={inp} value={w.name || ""} onChange={e => updateWanted(selectedWantedIndex, "name", e.target.value)} /></label>
                    </div>

                    {/* Row 2: Theme */}
                    <div style={{ ...row, gridTemplateColumns: "1fr" }}>
                      <label>
                        <span style={lbl}>Theme</span>
                        <select style={inp} value={w.theme || ""} onChange={e => updateWanted(selectedWantedIndex, "theme", e.target.value)}>
                          <option value="">— select —</option>
                          {acquisitionThemes.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                    </div>

                    {/* Row 3: MSRP + Target Price */}
                    <div style={{ ...row, gridTemplateColumns: "1fr 1fr" }}>
                      <label><span style={lbl}>MSRP</span><input style={inp} type="number" step="0.01" value={w.msrp || ""} onChange={e => updateWanted(selectedWantedIndex, "msrp", e.target.value)} /></label>
                      <label><span style={lbl}>Target Price</span><input style={inp} type="number" step="0.01" value={w.targetPrice || ""} onChange={e => updateWanted(selectedWantedIndex, "targetPrice", e.target.value)} /></label>
                    </div>

                    {/* Row 4: Exit Date + Retirement Year */}
                    <div style={{ ...row, gridTemplateColumns: "1fr 1fr" }}>
                      <label>
                        <span style={lbl}>Exit Date</span>
                        <input style={inp} type="date" value={w.exit_date ? w.exit_date.slice(0, 10) : ""}
                          onChange={e => updateWanted(selectedWantedIndex, "exit_date", e.target.value ? new Date(e.target.value).toISOString() : "")} />
                      </label>
                      <label><span style={lbl}>Retire Year <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(fallback)</span></span><input style={inp} type="number" min="2020" max="2040" step="1" value={w.retirementYear || ""} onChange={e => updateWanted(selectedWantedIndex, "retirementYear", e.target.value)} /></label>
                    </div>

                    {/* Row 5: Retirement Source + Last Updated */}
                    <div style={{ ...row, gridTemplateColumns: "1fr 1fr" }}>
                      <label>
                        <span style={lbl}>Retirement Source</span>
                        <select style={inp} value={w.retirementSource || "Brick Fanatics"} onChange={e => updateWanted(selectedWantedIndex, "retirementSource", e.target.value)}>
                          <option>Brick Fanatics</option>
                          <option>Brickset</option>
                          <option>LEGO Last Chance</option>
                          <option>StoneWars</option>
                          <option>BrickEconomy</option>
                          <option>Manual</option>
                        </select>
                      </label>
                      <label><span style={lbl}>Last Updated</span><input style={inp} type="date" value={w.lastRetirementUpdate || ""} onChange={e => updateWanted(selectedWantedIndex, "lastRetirementUpdate", e.target.value)} /></label>
                    </div>

                    {/* Row 6: Flags */}
                    <div style={{ ...row, gridTemplateColumns: "1fr", marginBottom: 10 }}>
                      {[
                        { field: "retiringSoon", label: "⚠️ Retiring Soon", activeColor: "#f59e0b" },
                      ].map(({ field, label, activeColor }) => {
                        const on = !!w[field];
                        return (
                          <button key={field} onClick={() => updateWanted(selectedWantedIndex, field, !on)}
                            style={{ border: `1px solid ${on ? activeColor : "rgba(255,255,255,0.1)"}`, borderRadius: 8, padding: "7px 10px", fontWeight: 700, fontSize: 12, cursor: "pointer", background: on ? `${activeColor}22` : "transparent", color: on ? activeColor : "#5d6f80", transition: "all 0.12s", textAlign: "center" }}>
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Row 7: Notes */}
                    <div style={{ ...row, gridTemplateColumns: "1fr" }}>
                      <label><span style={lbl}>Notes</span><input style={inp} value={w.notes || ""} onChange={e => updateWanted(selectedWantedIndex, "notes", e.target.value)} /></label>
                    </div>
                  </div>
                );
              })()}

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
        </div>}
      </section>
      </>
      );
      })()}

      <WatchDetailPanel
        item={detailItem}
        onClose={() => { setDetailItem(null); setDetailItemIndex(null); }}
        onEdit={detailItemIndex !== null ? () => { setDetailItem(null); setDetailItemIndex(null); setSelectedWantedIndex(detailItemIndex); setSubTab("queue"); } : undefined}
        onBuyNow={detailItem ? () => { setDetailItem(null); setDetailItemIndex(null); openBuyModal(detailItem); } : undefined}
      />

      {/* ── Buy Now purchase modal ─────────────────────────────────────── */}
      {buyModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setBuyModal(null); }}>
          <div style={{ background: "#0d1623", border: "1px solid rgba(201,168,76,0.3)", borderRadius: 16, padding: "28px 28px 24px", width: "100%", maxWidth: 440, boxShadow: "0 24px 64px rgba(0,0,0,0.7)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, color: "#5d6f80", marginBottom: 4 }}>Log Purchase</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#e8e2d5" }}>{buyModal.name || buyModal.setNumber}</div>
                {buyModal.setNumber && <div style={{ fontSize: 12, color: "#8a9bb0", marginTop: 2 }}>#{buyModal.setNumber} · {buyModal.theme || ""}</div>}
              </div>
              <button onClick={() => setBuyModal(null)} style={{ background: "transparent", border: "none", color: "#5d6f80", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 0 }}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1/-1" }}>
                <label style={{ fontSize: 11, color: "#8a9bb0", display: "block", marginBottom: 4 }}>Store</label>
                <input list="wl-buy-stores" value={buyForm.store} onChange={e => setBuyForm(p => ({ ...p, store: e.target.value }))}
                  placeholder="e.g. LEGO Shop, Amazon…"
                  style={{ width: "100%", background: "#111d2e", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e2d5", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
                <datalist id="wl-buy-stores">{savedStores.map(s => <option key={s} value={s} />)}</datalist>
              </div>

              <div>
                <label style={{ fontSize: 11, color: "#8a9bb0", display: "block", marginBottom: 4 }}>Date</label>
                <input type="date" value={buyForm.date} onChange={e => setBuyForm(p => ({ ...p, date: e.target.value }))}
                  style={{ width: "100%", background: "#111d2e", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e2d5", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "#8a9bb0", display: "block", marginBottom: 4 }}>Unit Price ($)</label>
                <input type="number" min="0" step="0.01" value={buyForm.price} onChange={e => setBuyForm(p => ({ ...p, price: e.target.value }))}
                  placeholder={buyModal.msrp ? String(buyModal.msrp) : "0.00"}
                  style={{ width: "100%", background: "#111d2e", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e2d5", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "#8a9bb0", display: "block", marginBottom: 4 }}>Qty</label>
                <input type="number" min="1" value={buyForm.qty} onChange={e => setBuyForm(p => ({ ...p, qty: e.target.value }))}
                  style={{ width: "100%", background: "#111d2e", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e2d5", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "#8a9bb0", display: "block", marginBottom: 4 }}>Tax ($)</label>
                <input type="number" min="0" step="0.01" value={buyForm.tax} onChange={e => setBuyForm(p => ({ ...p, tax: e.target.value }))}
                  placeholder="0.00"
                  style={{ width: "100%", background: "#111d2e", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e2d5", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "#8a9bb0", display: "block", marginBottom: 4 }}>Shipping ($)</label>
                <input type="number" min="0" step="0.01" value={buyForm.shipping} onChange={e => setBuyForm(p => ({ ...p, shipping: e.target.value }))}
                  placeholder="0.00"
                  style={{ width: "100%", background: "#111d2e", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e2d5", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "#8a9bb0", display: "block", marginBottom: 4 }}>Gift Card / Discount ($)</label>
                <input type="number" min="0" step="0.01" value={buyForm.gc} onChange={e => setBuyForm(p => ({ ...p, gc: e.target.value }))}
                  placeholder="0.00"
                  style={{ width: "100%", background: "#111d2e", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e2d5", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "#8a9bb0", display: "block", marginBottom: 4 }}>Order # / Label</label>
                <input type="text" value={buyForm.orderLabel} onChange={e => setBuyForm(p => ({ ...p, orderLabel: e.target.value }))}
                  placeholder="Optional"
                  style={{ width: "100%", background: "#111d2e", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e2d5", borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
              </div>
            </div>

            {/* Total preview */}
            {(() => {
              const qty      = asNumber(buyForm.qty) || 1;
              const price    = asNumber(buyForm.price) || 0;
              const tax      = asNumber(buyForm.tax) || 0;
              const shipping = asNumber(buyForm.shipping) || 0;
              const gc       = asNumber(buyForm.gc) || 0;
              const total    = Math.round((price * qty + tax + shipping) * 100) / 100;
              const cashPaid = Math.max(0, Math.round((total - gc) * 100) / 100);
              return price > 0 ? (
                <div style={{ marginTop: 14, background: "rgba(201,168,76,0.07)", border: "1px solid rgba(201,168,76,0.18)", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#8a9bb0", marginBottom: 2 }}>
                    <span>{qty} × {money(price)}{tax ? ` + ${money(tax)} tax` : ""}{shipping ? ` + ${money(shipping)} ship` : ""}</span>
                    <span style={{ color: "#e8e2d5" }}>= {money(total)}</span>
                  </div>
                  {gc > 0 && <div style={{ display: "flex", justifyContent: "space-between", color: "#5aa832" }}>
                    <span>Gift card / discount</span><span>− {money(gc)}</span>
                  </div>}
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#c9a84c", marginTop: gc > 0 ? 4 : 0 }}>
                    <span>Cash paid</span><span>{money(cashPaid)}</span>
                  </div>
                </div>
              ) : null;
            })()}

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, cursor: "pointer", fontSize: 13, color: "#e8e2d5" }}>
              <input type="checkbox" checked={buyAddToCollection} onChange={e => setBuyAddToCollection(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: "#c9a84c" }} />
              Also add to My Collection
            </label>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setBuyModal(null)}
                style={{ flex: 1, background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "#8a9bb0", borderRadius: 8, padding: "10px 0", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                Cancel
              </button>
              <button onClick={commitBuy}
                style={{ flex: 2, background: "#5aa832", border: "none", color: "#fff", borderRadius: 8, padding: "10px 0", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                Log Purchase & Remove from List
              </button>
            </div>
          </div>
        </div>
      )}

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
                {(hoveredWanted.exit_date || hoveredWanted.bfRetirementDate || hoveredWanted.retirementYear) && (
                  <><span style={{ color: "#5d6f80" }}>Retires</span><span style={{ color: hoveredWanted.retiringSoon ? "#f59e0b" : "#e8e2d5" }}>
                    {hoveredWanted.exit_date
                      ? new Date(hoveredWanted.exit_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })
                      : hoveredWanted.bfRetirementDate || hoveredWanted.retirementYear}
                  </span></>
                )}
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
const acTabBar = { display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" };
const acTabBtn = { background: "none", border: "none", borderBottom: "2px solid transparent", color: "#5d6f80", padding: "8px 0 10px", fontWeight: 700, cursor: "pointer", fontSize: 14, lineHeight: 1 };
const acActiveTab = { ...acTabBtn, color: "#e8e2d5", borderBottom: "2px solid #c9a84c" };
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
