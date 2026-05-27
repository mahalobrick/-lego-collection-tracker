import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import Fuse from "fuse.js";
import toast from "react-hot-toast";
import { searchInput, filterSelect, clearFilterButton } from "./uiStyles";
import { importBudgetExcel } from "./utils/importBudgetExcel";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { asNumber, money, setImageUrl, lineTotal, lineCashPaid } from "./utils/formatting";
import PurchaseDetailPanel from "./PurchaseDetailPanel";
import { fetchLegoThemes } from "./utils/brickset";

const PIE_COLORS = ["#c9a84c", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#5aa832"];

const DEFAULT_annualBudget = 10320;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const DEFAULT_STORES = ["Amazon", "Best Buy", "Bricklink", "LEGO", "Target", "Walmart"];

const DEFAULT_PURCHASE_COLUMNS = [
  { key: "date",       label: "Date",         visible: true  },
  { key: "store",      label: "Store",        visible: true  },
  { key: "orderLabel", label: "Order #",      visible: true  },
  { key: "setNumber",  label: "Set #",        visible: true  },
  { key: "name",       label: "Set Name",     visible: true  },
  { key: "theme",      label: "Theme",        visible: true  },
  { key: "qty",        label: "Qty",          visible: true  },
  { key: "faceValue",  label: "Unit Price",   visible: true  },
  { key: "tax",        label: "Tax / Fee",    visible: true  },
  { key: "shipping",   label: "Shipping",     visible: true  },
  { key: "gcApplied",  label: "GC / Rewards", visible: false },
  { key: "total",      label: "Paid",         visible: true  },
  { key: "notes",      label: "Notes",        visible: true  }
];

const DEFAULT_BUDGET_ITEMS = [
  { key: "spend",           type: "card",  label: "Year Spend",       visible: true,  width: "auto",  collapsed: false },
  { key: "remaining",       type: "card",  label: "Budget Remaining", visible: true,  width: "auto",  collapsed: false },
  { key: "avgMonth",        type: "card",  label: "Avg / Month",      visible: true,  width: "auto",  collapsed: false },
  { key: "purchases",       type: "card",  label: "Purchases",        visible: true,  width: "auto",  collapsed: false },
  { key: "projected",       type: "card",  label: "Projected Annual", visible: false, width: "auto",  collapsed: false },
  { key: "vsBudget",        type: "card",  label: "vs Annual Budget", visible: false, width: "auto",  collapsed: false },
  { key: "topStore",        type: "card",  label: "Top Store",        visible: false, width: "auto",  collapsed: false },
  { key: "months",          type: "card",  label: "Months Tracked",   visible: false, width: "auto",  collapsed: false },
  { key: "store-breakdown", type: "panel", label: "Spending by Store",visible: true,  width: "full",  collapsed: false },
  { key: "monthly-chart",   type: "panel", label: "Monthly Spend",    visible: true,  width: "full",  collapsed: false },
  { key: "growth-chart",    type: "panel", label: "Investment Curve", visible: true,  width: "full",  collapsed: false },
  { key: "store-pie",       type: "panel", label: "Store Pie Chart",  visible: true,  width: "half",  collapsed: false },
  { key: "theme-spend",     type: "panel", label: "Spending by Theme",visible: true,  width: "half",  collapsed: false },
];

// lineTotal and lineCashPaid imported from utils/formatting

function usDate(value) {
  if (!value) return "";
  const d = new Date(value + "T00:00:00");
  if (isNaN(d)) return value;
  return d.toLocaleDateString("en-US");
}

function csvDateToISO(value) {
  if (!value) return "";

  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parts = raw.split("/");
  if (parts.length === 3) {
    const [m, d, y] = parts;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  return raw;
}

function isoToCSVDate(value) {
  if (!value) return "";

  const d = new Date(value + "T00:00:00");
  if (isNaN(d)) return value;

  return d.toLocaleDateString("en-US");
}

function getMonthLabel(date) {
  const d = new Date(date + "T00:00:00");
  if (isNaN(d)) return "";
  return MONTHS[d.getMonth()] + " " + d.getFullYear();
}

const ORDER_LABEL_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0,1,I,L,O
const STORE_CODES = { Amazon: "AMZ", Target: "TGT", Walmart: "WMT", LEGO: "LGO", Bricklink: "BLK", "Best Buy": "BBY" };

function generateOrderLabel(store, date) {
  const d = new Date(date + "T00:00:00");
  if (!store || isNaN(d)) return "";
  const code = STORE_CODES[store] || store.replace(/[^A-Za-z]/g, "").substring(0, 3).toUpperCase().padEnd(3, "X");
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  let rand = "";
  for (let i = 0; i < 3; i++) rand += ORDER_LABEL_CHARS[Math.floor(Math.random() * ORDER_LABEL_CHARS.length)];
  return `${code}-${mm}${dd}-${rand}`;
}

export default function BudgetDashboard({ pendingPurchase, onPendingPurchaseConsumed, onNavigateToSettings }) {
  const [tab, setTab] = useState(pendingPurchase ? "log" : "dashboard");
  const [newStore, setNewStore] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [searchText, setSearchText] = useState("");
  const [sortColumn, setSortColumn] = useState("date");
  const [sortDirection, setSortDirection] = useState("desc");
  const [checkedRows, setCheckedRows] = useState([]);
  const [selectedPurchaseIndex, setSelectedPurchaseIndex] = useState(null);
  const [purchaseDetailIdx, setPurchaseDetailIdx] = useState(null);
  const [purchaseColumnsOpen, setPurchaseColumnsOpen] = useState(false);
  const [lineLoading, setLineLoading] = useState({});
  const [lineSearch, setLineSearch] = useState({}); // { [idx]: { results, loading, open } }
  const searchTimers = useRef({});
  const [purchaseMode, setPurchaseMode] = useState("single"); // "single" | "multi"
  const [orderTaxRate, setOrderTaxRate] = useState(""); // % rate, persists across resets
  const [orderBreakdownOpen, setOrderBreakdownOpen] = useState(false);
  const [draggedPurchaseColumn, setDraggedPurchaseColumn] = useState(null);
  const [showAllThemeSpend, setShowAllThemeSpend] = useState(false);
  const [hoveredPurchase, setHoveredPurchase] = useState(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const [budgetPillsCollapsed, setBudgetPillsCollapsed] = useState(false);
  const [budgetGearOpen, setBudgetGearOpen] = useState(false);
  const [hoveredBudgetItem, setHoveredBudgetItem] = useState(null);
  const [legoThemes, setLegoThemes] = useState([]);
  useEffect(() => { fetchLegoThemes().then(t => { if (t.length) setLegoThemes(t); }); }, []);
  const [inlineEdit, setInlineEdit] = useState(null); // { i, key, value }
  const [draggedBudgetItem, setDraggedBudgetItem] = useState(null);
  const [chartTypes, setChartTypes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blBudgetChartTypes") || "{}"); } catch { return {}; }
  });
  const [budgetItems, setBudgetItems] = useState(() => {
    const saved = localStorage.getItem("blBudgetItems");
    if (!saved) return DEFAULT_BUDGET_ITEMS;
    const parsed = JSON.parse(saved);
    const typeMap = Object.fromEntries(DEFAULT_BUDGET_ITEMS.map(c => [c.key, c.type]));
    const labelMap = Object.fromEntries(DEFAULT_BUDGET_ITEMS.map(c => [c.key, c.label]));
    const merged = parsed.map(c => ({ ...c, type: typeMap[c.key] ?? c.type, label: labelMap[c.key] ?? c.label }));
    const savedKeys = new Set(merged.map(c => c.key));
    const missing = DEFAULT_BUDGET_ITEMS.filter(c => !savedKeys.has(c.key));
    return [...merged, ...missing];
  });

  const currentYear = new Date().getFullYear();
  const [filterYear, setFilterYear] = useState(currentYear);

  const [purchaseColumns, setPurchaseColumns] = useState(() => {
    const saved = localStorage.getItem("blPurchaseColumns");
    if (!saved) return DEFAULT_PURCHASE_COLUMNS;
    const parsed = JSON.parse(saved);
    const labelMap = Object.fromEntries(DEFAULT_PURCHASE_COLUMNS.map(c => [c.key, c.label]));
    // Deduplicate by key (keep first occurrence), then update labels
    const seen = new Set();
    const merged = parsed
      .filter(c => { if (seen.has(c.key)) return false; seen.add(c.key); return true; })
      .map(c => ({ ...c, label: labelMap[c.key] ?? c.label }));
    const savedKeys = new Set(merged.map(c => c.key));
    const missing = DEFAULT_PURCHASE_COLUMNS.filter(c => !savedKeys.has(c.key));
    return missing.length ? [...merged, ...missing] : merged;
  });

  const [annualBudget, setAnnualBudget] = useState(() => {
    return Number(localStorage.getItem("blAnnualBudget")) || DEFAULT_annualBudget;
  });

  const [importMode, setImportMode] = useState("add");

  const [stores, setStores] = useState(() => {
    const saved = localStorage.getItem("blStores");
    return saved ? JSON.parse(saved) : DEFAULT_STORES;
  });

  const [form, setForm] = useState(() => {
    // Read stores from localStorage directly since `stores` state isn't available yet at init time
    const firstStore = (() => { try { const s = JSON.parse(localStorage.getItem("blStores") || "[]"); return s[0] || "LEGO"; } catch { return "LEGO"; } })();
    if (pendingPurchase) {
      return {
        lines: [{
          setNumber: pendingPurchase.setNumber || "",
          name: pendingPurchase.name || "",
          theme: pendingPurchase.theme || "",
          qty: 1,
          // storePrice = live deal; targetPrice = user's goal; msrp = fallback
          faceValue: asNumber(pendingPurchase.storePrice) || asNumber(pendingPurchase.targetPrice) || asNumber(pendingPurchase.msrp) || "",
          tax: "",
          shipping: "",
          gc: "",
          store: firstStore,
          date: new Date().toISOString().slice(0, 10),
          notes: "",
          _suggestedMsrp: asNumber(pendingPurchase.msrp) || null,
        }],
        orderTax: "", orderShipping: "", orderGC: "", orderLabel: "", orderNotes: "", _orderLabelAuto: true,
        _fromWantedId: pendingPurchase.id ?? null,
      };
    }
    return {
      lines: [{ setNumber: "", name: "", theme: "", qty: 1, faceValue: "", tax: "", shipping: "", gc: "", store: firstStore, date: "", notes: "" }],
      orderTax: "", orderShipping: "", orderGC: "", orderLabel: "", orderNotes: "", _orderLabelAuto: true
    };
  });

  const [purchases, setPurchases] = useState(() => {
    const saved = localStorage.getItem("blPurchases");
    if (!saved) return [];
    const list = JSON.parse(saved);
    // Migration: backfill stable id for records that predate this field
    let dirty = false;
    const migrated = list.map(p => {
      if (p.id) return p;
      dirty = true;
      return { ...p, id: `pur_${Date.now()}${Math.random().toString(36).slice(2, 9)}` };
    });
    if (dirty) localStorage.setItem("blPurchases", JSON.stringify(migrated));
    return migrated;
  });

  useEffect(() => {
    localStorage.setItem("blPurchases", JSON.stringify(purchases));
  }, [purchases]);

  // Clear the pending purchase from App state after we've consumed it into the form
  useEffect(() => {
    if (pendingPurchase) onPendingPurchaseConsumed?.();
  }, []);

  useEffect(() => {
    localStorage.setItem("blStores", JSON.stringify(stores));
  }, [stores]);

  // Keep stores in sync when another tab updates localStorage
  useEffect(() => {
    function onStorage(e) {
      if (e.key === "blStores") {
        try { setStores(e.newValue ? JSON.parse(e.newValue) : DEFAULT_STORES); } catch {}
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Clear month filter when year changes — stale month selections produce empty tables
  useEffect(() => {
    setFilterMonth("");
  }, [filterYear]);

  const availableYears = useMemo(() => {
    const years = Array.from(new Set(purchases.map(p => p.year).filter(Boolean))).sort((a, b) => b - a);
    if (!years.includes(currentYear)) years.unshift(currentYear);
    return years;
  }, [purchases, currentYear]);

  const yearPurchases = useMemo(
    () => filterYear !== null ? purchases.filter(p => p.year === filterYear) : purchases,
    [purchases, filterYear]
  );

  useEffect(() => {
    localStorage.setItem("blPurchaseColumns", JSON.stringify(purchaseColumns));
  }, [purchaseColumns]);

  useEffect(() => {
    localStorage.setItem("blBudgetItems", JSON.stringify(budgetItems));
  }, [budgetItems]);

  useEffect(() => {
    localStorage.setItem("blBudgetChartTypes", JSON.stringify(chartTypes));
  }, [chartTypes]);

  function cycleChartType(key) {
    setChartTypes(prev => {
      const cur = prev[key];
      let next;
      if (key === "monthly-chart")   next = !cur || cur === "bar"   ? "line"  : "bar";
      else if (key === "store-breakdown") next = !cur || cur === "cards" ? "donut" : cur === "donut" ? "pie" : "cards";
      else if (key === "growth-chart")    next = !cur || cur === "line"  ? "area"  : "line";
      else next = cur === "donut" ? "pie" : cur === "pie" ? "bar" : "donut";
      return { ...prev, [key]: next };
    });
  }

  const spent = yearPurchases.reduce((sum, p) => sum + lineCashPaid(p), 0);
  const remaining = annualBudget - spent;
  const monthlyTarget = annualBudget / 12;
  const monthsTracked = new Set(yearPurchases.map(p => p.month).filter(Boolean)).size || 1;
  const purchaseMonths = Array.from(new Set(yearPurchases.map(p => p.month).filter(Boolean))).sort((a, b) => new Date(a + " 1") - new Date(b + " 1"));
  const avgMonthly = spent / monthsTracked;
  const projected = avgMonthly * 12;

  const yearLabel = filterYear === null ? "All-time" : String(filterYear);

  // Aggregate directly from purchases so imported data with any store name shows up
  const storeTotals = (() => {
    const byStore = {};
    yearPurchases.forEach(p => {
      if (!p.store) return;
      byStore[p.store] = (byStore[p.store] || 0) + lineCashPaid(p);
    });
    return Object.entries(byStore)
      .map(([store, total]) => ({ store, total }))
      .sort((a, b) => b.total - a.total);
  })();
  const maxStoreTotal = storeTotals.length > 0 ? storeTotals[0].total : 1;

  const monthlyChartData = MONTHS.map(m => ({
    month: m,
    total: yearPurchases.filter(p => String(p.month || "").startsWith(m)).reduce((s, p) => s + lineCashPaid(p), 0)
  }));
  const maxMonthlySpend = Math.max(...monthlyChartData.map(d => d.total), 1);

  // storeTotals is already filtered (only purchase-backed stores) and sorted desc
  const storePieData = storeTotals.map(s => ({ name: s.store, value: s.total }));

  const themeSpendData = (() => {
    const byTheme = {};
    yearPurchases.forEach(p => {
      const t = p.theme || "Unknown";
      if (!byTheme[t]) byTheme[t] = 0;
      byTheme[t] += lineCashPaid(p);
    });
    return Object.entries(byTheme)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
  })();

  // Cumulative spend over all time (not filtered by year) for portfolio growth chart
  const cumulativeSpendData = useMemo(() => {
    const sorted = [...purchases]
      .filter(p => p.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const byMonth = {};
    let running = 0;
    sorted.forEach(p => {
      running += lineCashPaid(p);
      const month = p.month || getMonthLabel(p.date);
      if (month) byMonth[month] = running;
    });
    return Object.entries(byMonth).map(([month, total]) => ({ month, total }));
  }, [purchases]);

  function sortHeader(column) {
    if (sortColumn === column) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection(column === "date" || column === "total" ? "desc" : "asc");
    }
  }

  function sortLabel(label, column) {
    if (sortColumn !== column) return label;
    return label + (sortDirection === "asc" ? " ↑" : " ↓");
  }

  const fusePurchases = useMemo(() => new Fuse(yearPurchases, {
    keys: ["store", "setNumber", "name", "theme", "notes"],
    threshold: 0.3,
    distance: 100,
  }), [yearPurchases]);

  const visiblePurchases = useMemo(() => {
    let rows = searchText.trim()
      ? fusePurchases.search(searchText).map(r => r.item)
      : [...yearPurchases];

    if (filterStore) rows = rows.filter(p => p.store === filterStore);
    if (filterMonth) rows = rows.filter(p => p.month === filterMonth);

    rows.sort((a, b) => {
      let result = 0;

      if (sortColumn === "total") {
        result = lineCashPaid(a) - lineCashPaid(b);
      } else if (sortColumn === "faceValue" || sortColumn === "qty") {
        result = asNumber(a[sortColumn]) - asNumber(b[sortColumn]);
      } else {
        result = String(a[sortColumn] || "").localeCompare(String(b[sortColumn] || ""));
      }

      return sortDirection === "asc" ? result : -result;
    });

    return rows;
  }, [yearPurchases, filterStore, filterMonth, searchText, sortColumn, sortDirection, fusePurchases]);

  async function importAnyFile(file) {
    if (!file) return;

    const name = file.name.toLowerCase();

    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const fakeEvent = { target: { files: [file] } };
      return handleImport(fakeEvent);
    }

    if (name.endsWith(".csv")) {
      const fakeEvent = { target: { files: [file] } };
      return importCSV(fakeEvent);
    }

    if (name.endsWith(".json")) {
      const fakeEvent = { target: { files: [file] } };
      return importJSON(fakeEvent);
    }

    toast.error("Unsupported file type — use .xlsx, .csv, or .json.");
  }

  async function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    await importAnyFile(file);
  }

  function purchaseKey(p) {
    return [
      p.date || "",
      p.store || "",
      p.setNumber || p.item || "",
      asNumber(p.qty) || 1,
      asNumber(p.faceValue ?? p.amount)
    ].join("|").toLowerCase();
  }

  function applyImportedPurchases(imported) {
    const cleaned = (imported || []).map(p => ({
      ...p,
      id:       p.id || `pur_${Date.now()}${Math.random().toString(36).slice(2, 9)}`,
      setNumber: p.setNumber || p.item || "",
      name: p.name || "",
      theme: p.theme || "",
      qty: asNumber(p.qty) || 1,
      amount: asNumber(p.amount),
      faceValue: p.faceValue != null ? asNumber(p.faceValue) : (p.amount != null ? asNumber(p.amount) : null),
      msrp:     p.msrp != null ? asNumber(p.msrp) : null,
      tax:      p.tax      != null ? asNumber(p.tax)      : null,
      shipping: p.shipping != null ? asNumber(p.shipping) : null,
      total:    p.total    != null ? asNumber(p.total)    : null,
      month: p.month || getMonthLabel(p.date || ""),
      year: p.year || Number(String(p.date || "").slice(0, 4)) || new Date().getFullYear()
    }));

    if (importMode === "replace") {
      const ok = window.confirm("Replace all current purchases with this import?");
      if (!ok) return;

      setPurchases(cleaned);
      toast.success(`Replaced all purchases with ${cleaned.length} imported rows.`);
      return;
    }

    const existingKeys = new Set(purchases.map(purchaseKey));
    const newRows = cleaned.filter(p => !existingKeys.has(purchaseKey(p)));

    setPurchases(prev => [...prev, ...newRows]);

    const skipped = cleaned.length - newRows.length;
    toast.success(`Imported ${newRows.length} purchase${newRows.length !== 1 ? "s" : ""}${skipped ? " · " + skipped + " duplicate${skipped !== 1 ? \"s\" : \"\"} skipped" : ""}.`);
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const data = await importBudgetExcel(file);
      const cleaned = (data.purchases || []).map(p => ({
        ...p,
        id:        p.id || `pur_${Date.now()}${Math.random().toString(36).slice(2, 9)}`,
        setNumber: p.setNumber || p.item || "",
        name: p.name || "",
        theme: p.theme || "",
        qty: asNumber(p.qty) || 1,
        msrp: p.msrp != null ? asNumber(p.msrp) : null,
      }));

      applyImportedPurchases(cleaned);
    } catch (err) {
      toast.error(err.message);
    }
  }

  function dropPurchaseColumn(targetKey) {
    if (!draggedPurchaseColumn || draggedPurchaseColumn === targetKey) return;

    setPurchaseColumns(prev => {
      const next = [...prev];
      const fromIndex = next.findIndex(col => col.key === draggedPurchaseColumn);
      const toIndex = next.findIndex(col => col.key === targetKey);

      if (fromIndex < 0 || toIndex < 0) return prev;

      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      return next;
    });

    setDraggedPurchaseColumn(null);
  }

  function dropBudgetItem(targetKey) {
    if (!draggedBudgetItem || draggedBudgetItem === targetKey) return;
    setBudgetItems(prev => {
      const next = [...prev];
      const from = next.findIndex(i => i.key === draggedBudgetItem);
      const to   = next.findIndex(i => i.key === targetKey);
      if (from < 0 || to < 0) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDraggedBudgetItem(null);
  }

  function toggleBudgetWidth(key) {
    setBudgetItems(prev => prev.map(i => i.key === key ? { ...i, width: i.width === "full" ? "half" : "full" } : i));
  }

  function toggleBudgetCollapse(key) {
    setBudgetItems(prev => prev.map(i => i.key === key ? { ...i, collapsed: !i.collapsed } : i));
  }

  function togglePurchaseColumn(key) {
    setPurchaseColumns(prev =>
      prev.map(col => col.key === key ? { ...col, visible: !col.visible } : col)
    );
  }

  function movePurchaseColumn(key, direction) {
    setPurchaseColumns(prev => {
      const next = [...prev];
      const index = next.findIndex(col => col.key === key);
      const newIndex = index + direction;

      if (index < 0 || newIndex < 0 || newIndex >= next.length) return prev;

      const [item] = next.splice(index, 1);
      next.splice(newIndex, 0, item);

      return next;
    });
  }

  function renderPurchaseCell(p, column) {
    if (column.key === "date") return usDate(p.date);
    if (column.key === "store") return p.store || "—";
    if (column.key === "setNumber") return p.setNumber || p.item || "—";
    if (column.key === "name") return p.name || "—";
    if (column.key === "theme") return p.theme || "—";
    if (column.key === "qty") return p.qty || 1;
    if (column.key === "faceValue") return p.faceValue != null ? money(p.faceValue) : (p.amount != null ? money(p.amount) : "—");
    if (column.key === "tax")       return p.tax       != null ? money(p.tax)       : "—";
    if (column.key === "shipping")  return p.shipping  != null ? money(p.shipping)  : "—";
    if (column.key === "gcApplied") return p.gcApplied != null ? <span style={{ color: "#4caf7d" }}>−{money(p.gcApplied)}</span> : "—";
    if (column.key === "amount") return "—";
    if (column.key === "total") {
      const cash = lineCashPaid(p);
      const full = lineTotal(p);
      return p.gcApplied ? (
        <span>
          <span style={{ color: "#5d6f80", textDecoration: "line-through", fontSize: 11, marginRight: 4 }}>{money(full)}</span>
          <span style={{ color: "#4caf7d", fontWeight: 700 }}>{money(cash)}</span>
        </span>
      ) : money(cash);
    }
    if (column.key === "orderLabel") return p.orderLabel
      ? <span style={{ fontFamily: "monospace", fontSize: 11, color: "#c9a84c", fontWeight: 700, letterSpacing: 0.5 }}>{p.orderLabel}</span>
      : <span style={{ color: "#3a4f63" }}>—</span>;
    if (column.key === "notes") return p.notes || "";
    return "";
  }

  function isNumericPurchaseColumn(key) {
    return ["qty", "faceValue", "tax", "shipping", "gcApplied", "total"].includes(key);
  }

  function addStore() {
    const trimmed = newStore.trim();
    if (!trimmed || stores.includes(trimmed)) return;
    setStores(prev => [...prev, trimmed].sort());
    setNewStore("");
  }

  function deleteStore(store) {
    const used = purchases.some(p => p.store === store);

    if (used) {
      const ok = window.confirm(`${store} is used in purchases. Delete anyway?`);
      if (!ok) return;
    }

    setStores(prev => prev.filter(s => s !== store));
  }

  async function importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (Array.isArray(data.purchases)) applyImportedPurchases(data.purchases);
      if (Array.isArray(data.stores)) setStores(data.stores);

      toast.success("JSON backup imported.");
    } catch {
      toast.error("Invalid JSON backup.");
    }
  }

  function importCSV(e) {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        if (!data.length) { toast.error("Invalid CSV file."); return; }

        const numOrNull = v => (v != null && v !== "") ? Number(v) : null;

        const purchasesImported = data.map(item => {
          // "faceValue" is canonical; "price" / "amount" are legacy aliases
          const rawFv = item.faceValue || item.price || item.amount || "";
          const faceVal = rawFv !== "" ? Number(rawFv) : null;
          return {
            date:       csvDateToISO(item.date || ""),
            store:      item.store || "LEGO",
            orderLabel: item.orderLabel || null,
            orderNotes: item.orderNotes || null,
            setNumber:  item.setNumber || "",
            name:       item.name || "",
            theme:      item.theme || "",
            qty:        Number(item.qty || 1),
            amount:     Number(rawFv || 0),
            faceValue:  faceVal,
            tax:        numOrNull(item.tax),
            shipping:   numOrNull(item.shipping),
            gcApplied:  numOrNull(item.gcApplied),
            total:      numOrNull(item.total),
            cashPaid:   numOrNull(item.cashPaid),
            notes:      item.notes || "",
            month:      getMonthLabel(item.date || ""),
            year:       Number(String(item.date || "").slice(0, 4)) || new Date().getFullYear(),
          };
        });

        applyImportedPurchases(purchasesImported);
      },
      error: () => toast.error("Invalid CSV file."),
    });
  }

  function exportCSV() {
    const headers = [
      "date",
      "store",
      "orderLabel",
      "orderNotes",
      "setNumber",
      "name",
      "theme",
      "qty",
      "faceValue",
      "tax",
      "shipping",
      "gcApplied",
      "total",
      "cashPaid",
      "notes"
    ];

    const rows = purchases.map(p => [
      isoToCSVDate(p.date),
      p.store,
      p.orderLabel || "",
      p.orderNotes || "",
      p.setNumber || "",
      p.name || "",
      p.theme || "",
      p.qty || 1,
      p.faceValue ?? "",
      p.tax ?? "",
      p.shipping ?? "",
      p.gcApplied ?? "",
      p.total ?? lineTotal(p),
      p.cashPaid ?? lineCashPaid(p),
      p.notes || ""
    ]);

    const csv = [
      headers.join(","),
      ...rows.map(r =>
        r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
      )
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "brickledger-purchases.csv";
    a.click();

    URL.revokeObjectURL(url);
  }

  function downloadCSVTemplate() {
    const csv = [
      "date,store,setNumber,name,theme,qty,faceValue,tax,shipping,notes",
      "1/15/2026,LEGO,75313,AT-AT,Star Wars,1,849.99,72.25,0,UCS"
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "brickledger-purchases-template.csv";
    a.click();

    URL.revokeObjectURL(url);
  }

  function exportJSON() {
    const data = {
      purchases,
      stores,
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob(
      [JSON.stringify(data, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = "brickledger-budget-backup.json";
    a.click();

    URL.revokeObjectURL(url);
  }

  /**
   * Pure helper — redistributes order-level tax, shipping, and GC across lines.
   * Tax: proportional by subtotal (or by % rate if rateOverride > 0).
   * Shipping: even per-item count (shipping cost doesn't correlate with price).
   * GC: proportional by subtotal.
   */
  function reDistributeLines(lines, { orderTax, orderShipping, orderGC }, rateOverride) {
    const taxAmt  = asNumber(orderTax);
    const shipAmt = asNumber(orderShipping);
    const gcAmt   = asNumber(orderGC);
    const rate    = asNumber(rateOverride);
    if (!taxAmt && !shipAmt && !gcAmt && !rate) return lines;

    const orderSubtotal = lines.reduce((s, l) => s + asNumber(l.faceValue) * (asNumber(l.qty) || 1), 0);

    function propShares(total) {
      let allocated = 0;
      return lines.map((line, i) => {
        const lineSub = asNumber(line.faceValue) * (asNumber(line.qty) || 1);
        if (i === lines.length - 1) {
          const share = Math.round((total - allocated) * 100) / 100;
          allocated += share;
          return share;
        }
        const share = orderSubtotal > 0 ? Math.round((total * lineSub / orderSubtotal) * 100) / 100 : 0;
        allocated += share;
        return share;
      });
    }

    function evenShares(total) {
      const count = lines.length || 1;
      const even = Math.round(total / count * 100) / 100;
      let allocated = 0;
      return lines.map((_, i) => {
        const share = i === lines.length - 1 ? Math.round((total - allocated) * 100) / 100 : even;
        allocated += share;
        return share;
      });
    }

    let result = lines.map(l => ({ ...l }));

    // Tax — % rate beats dollar amount
    if (rate > 0) {
      result = result.map(line => {
        const sub = asNumber(line.faceValue) * (asNumber(line.qty) || 1);
        return { ...line, tax: sub > 0 ? String(Math.round(sub * rate / 100 * 100) / 100) : "" };
      });
    } else if (taxAmt > 0) {
      propShares(taxAmt).forEach((share, i) => {
        result[i].tax = share > 0 ? String(share) : "";
      });
    }

    // Shipping — even split
    if (shipAmt > 0) {
      evenShares(shipAmt).forEach((share, i) => {
        result[i].shipping = share > 0 ? String(share) : "";
      });
    }

    // GC — proportional
    if (gcAmt > 0) {
      propShares(gcAmt).forEach((share, i) => {
        result[i].gc = share > 0 ? String(share) : "";
      });
    }

    return result;
  }

  function addLine() {
    setForm(prev => {
      const ref = prev.lines[0];
      const newLine = {
        setNumber: "", name: "", theme: "", qty: 1, faceValue: "", tax: "", shipping: "", gc: "",
        // Multi: inherit global store/date. Single: start blank.
        store: purchaseMode === "multi" ? (ref?.store || stores[0] || "LEGO") : (stores[0] || "LEGO"),
        date:  purchaseMode === "multi" ? (ref?.date  || "")     : "",
        notes: ""
      };
      // Re-distribute any existing order-level amounts to include the new row
      const expanded = [...prev.lines, newLine];
      const lines = reDistributeLines(expanded, prev, orderTaxRate);
      return { ...prev, lines };
    });
  }

  function updateLine(index, field, value) {
    setForm(prev => {
      const lines = [...prev.lines];
      lines[index] = { ...lines[index], [field]: value };

      // When price or qty changes in Multi mode, re-distribute proportional amounts
      if (purchaseMode === "multi" && (field === "faceValue" || field === "qty")) {
        const redistributed = reDistributeLines(lines, prev, orderTaxRate);
        // Only overwrite tax/gc — leave shipping (even split) as-is since count didn't change
        redistributed.forEach((l, i) => {
          lines[i].tax = l.tax;
          lines[i].gc  = l.gc;
        });
      }

      // Auto-generate order label when store or date changes on row 0 in Multi mode
      let extra = {};
      if (purchaseMode === "multi" && index === 0 && (field === "store" || field === "date")) {
        const store = field === "store" ? value : lines[0].store;
        const date  = field === "date"  ? value : lines[0].date;
        if (store && date && prev._orderLabelAuto !== false) {
          extra = { orderLabel: generateOrderLabel(store, date), _orderLabelAuto: true };
        }
      }
      return { ...prev, lines, ...extra };
    });
  }

  function removeLine(index) {
    setForm(prev => {
      const trimmed = prev.lines.filter((_, i) => i !== index);
      // Re-distribute after removing a line
      const lines = reDistributeLines(trimmed, prev, orderTaxRate);
      return { ...prev, lines };
    });
  }

  // Dollar-amount tax distribution — clears % rate (mutually exclusive)
  function distributeOrderTax(value) {
    setOrderTaxRate("");
    setForm(prev => {
      const next = { ...prev, orderTax: value };
      return { ...next, lines: reDistributeLines(prev.lines, next, "") };
    });
  }

  // % rate distribution — clears dollar amount (mutually exclusive)
  function distributeByTaxRate(rateStr) {
    setOrderTaxRate(rateStr);
    setForm(prev => {
      const next = { ...prev, orderTax: "" };
      return { ...next, lines: reDistributeLines(prev.lines, next, rateStr) };
    });
  }

  function distributeOrderShipping(value) {
    setForm(prev => {
      const next = { ...prev, orderShipping: value };
      return { ...next, lines: reDistributeLines(prev.lines, next, orderTaxRate) };
    });
  }

  function distributeOrderGC(value) {
    setForm(prev => {
      const next = { ...prev, orderGC: value };
      return { ...next, lines: reDistributeLines(prev.lines, next, orderTaxRate) };
    });
  }

  // Updates store or date globally across all lines in Multi mode
  function updateGlobalField(field, value) {
    setForm(prev => {
      const lines = prev.lines.map(l => ({ ...l, [field]: value }));
      let extra = {};
      if (field === "store" || field === "date") {
        const store = field === "store" ? value : lines[0].store;
        const date  = field === "date"  ? value : lines[0].date;
        if (store && date && prev._orderLabelAuto !== false) {
          extra = { orderLabel: generateOrderLabel(store, date), _orderLabelAuto: true };
        }
      }
      return { ...prev, lines, ...extra };
    });
  }

  async function lookupLine(index) {
    const raw = String(form.lines[index]?.setNumber || "").trim();
    if (!raw) return;
    const key = raw.includes("-") ? raw : `${raw}-1`;
    setLineLoading(prev => ({ ...prev, [index]: true }));
    try {
      const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
      let d = cache[key]?.data;
      if (!d) {
        const res = await fetch(`/api/brickeconomy-set?number=${encodeURIComponent(key)}&currency=USD`);
        const json = await res.json();
        if (!res.ok || json.error) return;
        d = json.data || json;
        cache[key] = { fetchedAt: new Date().toISOString(), data: d };
        localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
      }
      setForm(prev => {
        const lines = [...prev.lines];
        const newSetNumber = d.set_number || key;
        const isNewSet = newSetNumber !== lines[index].setNumber;
        lines[index] = {
          ...lines[index],
          setNumber: newSetNumber,
          name:  d.name  || lines[index].name,
          theme: d.theme || lines[index].theme,
          // Clear price fields when switching to a different set number
          ...(isNewSet ? { faceValue: "", tax: "", shipping: "", gc: "", _suggestedMsrp: d.retail_price_us || null } : {}),
        };
        return { ...prev, lines };
      });
    } catch {}
    finally { setLineLoading(prev => ({ ...prev, [index]: false })); }
  }

  function triggerLineSearch(index, raw) {
    const val = raw.trim();
    clearTimeout(searchTimers.current[index]);
    if (val.length < 3) {
      setLineSearch(prev => ({ ...prev, [index]: { results: [], loading: false, open: false } }));
      return;
    }
    setLineSearch(prev => ({ ...prev, [index]: { ...(prev[index] || {}), loading: true, open: true } }));
    searchTimers.current[index] = setTimeout(async () => {
      try {
        // Use setNumber only for exact "12345-N" format; otherwise use q= which handles
        // partial numbers (e.g. "71052" returns all CMF variants) and name text search
        const isExact = /^\d+-\d+$/.test(val);
        const url = isExact
          ? `/api/brickset-search?setNumber=${encodeURIComponent(val)}`
          : `/api/brickset-search?q=${encodeURIComponent(val)}`;
        const res = await fetch(url);
        const json = await res.json();
        const results = (json.sets || []).slice(0, 10);
        setLineSearch(prev => ({ ...prev, [index]: { results, loading: false, open: results.length > 0 } }));
      } catch {
        setLineSearch(prev => ({ ...prev, [index]: { results: [], loading: false, open: false } }));
      }
    }, 350);
  }

  function selectSearchResult(index, result) {
    setForm(prev => {
      const lines = [...prev.lines];
      const old = lines[index];
      lines[index] = {
        ...old,
        setNumber: result.setNumber,
        name:  result.name  || "",
        theme: result.theme || "",
        // Clear price fields so the new set gets fresh entry; show MSRP hint instead
        faceValue: "",
        tax:       "",
        shipping:  "",
        gc:        "",
        _suggestedMsrp: result.msrp || null,
      };
      return { ...prev, lines };
    });
    setLineSearch(prev => ({ ...prev, [index]: { results: [], loading: false, open: false } }));
  }

  function addPurchase() {
    const valid = form.lines.filter(line => line.setNumber || line.name || line.theme || line.faceValue || line.date || line.notes);

    if (!valid.length) {
      toast.error("Add at least one purchase item.");
      return;
    }

    if (valid.some(line => !line.date || !line.store || (line.faceValue === "" || line.faceValue == null))) {
      toast.error("Each item needs a date, store, and price.");
      return;
    }

    const newPurchases = valid.map(line => {
      // Strip UI-only form fields before persisting
      const { gc: _gc, _suggestedMsrp, ...lineRest } = line;
      const faceValue  = asNumber(line.faceValue);
      const tax        = asNumber(line.tax)        || 0;
      const shipping   = asNumber(line.shipping)   || 0;
      const gcApplied  = asNumber(line.gc)         || 0;
      const qty        = asNumber(line.qty)        || 1;
      const total      = Math.round((faceValue * qty + tax + shipping) * 100) / 100;
      const cashPaid   = Math.max(0, Math.round((total - gcApplied) * 100) / 100);
      return {
        ...lineRest,
        id:         `pur_${Date.now()}${Math.random().toString(36).slice(2, 9)}`,
        qty,
        faceValue,
        msrp:       asNumber(_suggestedMsrp) || null,
        tax:        tax        || null,
        shipping:   shipping   || null,
        gcApplied:  gcApplied  || null,
        total,
        cashPaid,
        orderLabel: form.orderLabel || null,
        orderNotes: form.orderNotes || null,
        amount:     faceValue, // backward compat
        month: getMonthLabel(line.date),
        year:  Number(line.date.slice(0, 4)) || new Date().getFullYear()
      };
    });

    const totalCash = newPurchases.reduce((s, p) => s + lineCashPaid(p), 0);
    setPurchases(prev => [...prev, ...newPurchases]);

    // If this purchase came from the Wanted List, remove that item now
    let wantedRemoved = false;
    if (form._fromWantedId) {
      try {
        const wl = JSON.parse(localStorage.getItem("blWantedList") || "[]");
        const removed = wl.find(w => w.id === form._fromWantedId);
        localStorage.setItem("blWantedList", JSON.stringify(wl.filter(w => w.id !== form._fromWantedId)));
        wantedRemoved = removed?.name || removed?.setNumber || true;
      } catch {}
    }

    setForm({ lines: [{ setNumber: "", name: "", theme: "", qty: 1, faceValue: "", tax: "", shipping: "", gc: "", store: stores[0] || "LEGO", date: "", notes: "" }], orderTax: "", orderShipping: "", orderGC: "", orderLabel: "", orderNotes: "", _orderLabelAuto: true, _fromWantedId: null });
    setOrderTaxRate("");
    setOrderBreakdownOpen(false);
    const baseMsg = `Logged ${newPurchases.length} purchase${newPurchases.length > 1 ? "s" : ""} — cash paid ${money(totalCash)}.`;
    toast.success(wantedRemoved ? `${baseMsg} Removed "${wantedRemoved}" from Wanted List.` : baseMsg);
  }

  function toggleCheck(index) {
    setCheckedRows(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]);
  }

  function toggleCheckAll() {
    const indexes = visiblePurchases.map(p => purchases.indexOf(p));
    const allChecked = indexes.length && indexes.every(i => checkedRows.includes(i));
    setCheckedRows(allChecked ? checkedRows.filter(i => !indexes.includes(i)) : Array.from(new Set([...checkedRows, ...indexes])));
  }

  function collectionKey(item) {
    return [
      item.setNumber || "",
      item.name || ""
    ].join("|").toLowerCase();
  }

  function isInCollection(purchase) {
    if (purchase.inCollection) return true;
    if (!purchase.setNumber) return false;
    const pNum = String(purchase.setNumber).replace(/-1$/, "").toLowerCase().trim();
    const manual = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");
    const beNormalized = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]");
    return [...manual, ...beNormalized].some(item => {
      const iNum = String(item.setNumber || "").replace(/-1$/, "").toLowerCase().trim();
      return iNum && iNum === pNum;
    });
  }

  function updatePurchase(index, field, value) {
    setPurchases(prev => {
      const next = [...prev];
      const numFields = ["qty", "faceValue", "tax", "shipping", "total", "amount", "gcApplied", "cashPaid"];

      const updated = {
        ...next[index],
        [field]: numFields.includes(field) ? asNumber(value) : value
      };

      if (field === "date") {
        updated.month = getMonthLabel(value);
        updated.year = Number(String(value).slice(0, 4)) || new Date().getFullYear();
      }

      // Auto-recompute total and cashPaid when any price field changes
      if (["faceValue", "qty", "tax", "shipping", "gcApplied"].includes(field)) {
        const fv   = asNumber(updated.faceValue ?? updated.amount);
        const qty  = asNumber(updated.qty) || 1;
        const tax  = asNumber(updated.tax) || 0;
        const ship = asNumber(updated.shipping) || 0;
        const gc   = asNumber(updated.gcApplied) || 0;
        updated.total    = Math.round((fv * qty + tax + ship) * 100) / 100;
        updated.cashPaid = Math.max(0, Math.round((updated.total - gc) * 100) / 100);
      }

      next[index] = updated;
      return next;
    });
  }

  function makeCollectionEntry(purchase, qty, paidPerUnit) {
    return {
      setNumber:         purchase.setNumber || "",
      name:              purchase.name      || "",
      theme:             purchase.theme     || "",
      condition:         "new",
      qty,
      paidPrice:         paidPerUnit,
      currentValue:      paidPerUnit,
      notes:             purchase.notes     || "",
      sourcePurchaseKey: collectionKey(purchase),
    };
  }

  function addPurchaseToCollection(purchase, purchaseIndex) {
    const existing    = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");
    const qty         = asNumber(purchase.qty) || 1;
    const paidPerUnit = asNumber(purchase.faceValue ?? purchase.amount);
    const label       = purchase.setNumber
      ? `Set ${purchase.setNumber}${purchase.name ? " – " + purchase.name : ""}`
      : (purchase.name || "this purchase");

    // Find an existing collection entry with the same set number
    const pNum     = String(purchase.setNumber || "").replace(/-1$/, "").toLowerCase().trim();
    const matchIdx = pNum
      ? existing.findIndex(item => {
          const iNum = String(item.setNumber || "").replace(/-1$/, "").toLowerCase().trim();
          return iNum && iNum === pNum;
        })
      : -1;

    if (matchIdx >= 0) {
      const match      = existing[matchIdx];
      const currentQty = asNumber(match.qty) || 1;
      const copyWord   = qty === 1 ? "copy" : `${qty} copies`;
      const addMore    = window.confirm(
        `${label} is already in your collection (${currentQty} cop${currentQty === 1 ? "y" : "ies"}).\n\n` +
        `OK → add ${copyWord} to the existing entry (qty ${currentQty} → ${currentQty + qty})\n` +
        `Cancel → create a separate collection entry`
      );
      if (addMore) {
        existing[matchIdx] = { ...match, qty: currentQty + qty };
      } else {
        existing.push(makeCollectionEntry(purchase, qty, paidPerUnit));
      }
    } else {
      existing.push(makeCollectionEntry(purchase, qty, paidPerUnit));
    }

    localStorage.setItem("blOwnedSets", JSON.stringify(existing));

    // Persist inCollection flag on the purchase row
    if (purchaseIndex != null) {
      setPurchases(prev => {
        const next = [...prev];
        next[purchaseIndex] = { ...next[purchaseIndex], inCollection: true };
        return next;
      });
    }

    toast.success(`Added ${label} to My Collection.`);
  }

  function deleteCheckedPurchases() {
    if (!checkedRows.length) return;
    if (!window.confirm(`Delete ${checkedRows.length} selected purchase(s)?`)) return;
    setPurchases(prev => prev.filter((_, i) => !checkedRows.includes(i)));
    setCheckedRows([]);
  }

  function addCheckedToCollection() {
    if (!checkedRows.length) return;
    const existing = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");
    let added = 0, skipped = 0, merged = 0;

    const updatedPurchases = [...purchases];

    checkedRows.forEach(idx => {
      const purchase = purchases[idx];
      if (!purchase) return;
      if (isInCollection(purchase)) { skipped++; return; }

      const qty         = asNumber(purchase.qty) || 1;
      const paidPerUnit = asNumber(purchase.faceValue ?? purchase.amount);
      const pNum        = String(purchase.setNumber || "").replace(/-1$/, "").toLowerCase().trim();
      const matchIdx    = pNum
        ? existing.findIndex(item => String(item.setNumber || "").replace(/-1$/, "").toLowerCase().trim() === pNum)
        : -1;

      if (matchIdx >= 0) {
        existing[matchIdx].qty = (asNumber(existing[matchIdx].qty) || 1) + qty;
        merged++;
      } else {
        existing.push(makeCollectionEntry(purchase, qty, paidPerUnit));
        added++;
      }
      updatedPurchases[idx] = { ...updatedPurchases[idx], inCollection: true };
    });

    localStorage.setItem("blOwnedSets", JSON.stringify(existing));
    setPurchases(updatedPurchases);
    setCheckedRows([]);

    const parts = [];
    if (added)   parts.push(`${added} added`);
    if (merged)  parts.push(`${merged} merged into existing`);
    if (skipped) parts.push(`${skipped} already in collection`);
    toast.success(`→ Collection: ${parts.join(", ")}.`);
  }

  return (
    <div style={page} onMouseMove={e => setTipPos({ x: e.clientX, y: e.clientY })} onTouchStart={() => setHoveredPurchase(null)}>
      <div style={header}>
        <div>
          <h2 style={{ margin: 0 }}>Budget</h2>
          <p style={{ margin: "4px 0 0", color: "#8a9bb0" }}>Track spending and purchase history.</p>
        </div>
        <div style={tabs}>
          {[
            { key: "dashboard", label: "Overview" },
            { key: "purchases", label: "Purchases" },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={tab === t.key ? activeTab : tabBtn}>
              {t.label}
            </button>
          ))}
          <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.12)", alignSelf: "center" }} />
          <button onClick={() => setTab("log")} style={tab === "log" ? addPurchaseBtnActive : addPurchaseBtn}>
            + Add Purchase
          </button>
          <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.12)", alignSelf: "center" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Year</span>
            {availableYears.map(year => (
              <button key={year} onClick={() => setFilterYear(year)} style={filterYear === year ? yearBtnActive : yearBtn}>
                {year}
              </button>
            ))}
            <button onClick={() => setFilterYear(null)} style={filterYear === null ? yearBtnActive : yearBtn}>All</button>
          </div>
        </div>
      </div>

      {tab === "dashboard" && (
        <>
          {yearPurchases.length === 0 && (
            <div style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "20px 24px", marginTop: 6, color: "#5d6f80", fontSize: 14 }}>
              No purchases logged for <strong style={{ color: "#8a9bb0" }}>{yearLabel}</strong>. Switch to <strong style={{ color: "#8a9bb0" }}>Add Purchase</strong> to add entries.
            </div>
          )}

          {/* ── Stat pill container ─────────────────────────────────── */}
          <div style={{ background: "rgba(11,21,32,0.7)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "14px 16px", marginBottom: 14, marginTop: 8, position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: budgetPillsCollapsed ? 0 : 12 }}>
              <span style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Overview Stats</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setBudgetGearOpen(prev => !prev)} style={{ ...hoverCtrlBtn, color: budgetGearOpen ? "#c9a84c" : "#8a9bb0" }} title="Show / hide stats">⚙</button>
                <button onClick={() => setBudgetPillsCollapsed(prev => !prev)} style={hoverCtrlBtn} title={budgetPillsCollapsed ? "Expand" : "Collapse"}>{budgetPillsCollapsed ? "▼" : "▲"}</button>
              </div>
            </div>

            {budgetGearOpen && (
              <div style={{ position: "absolute", top: 46, right: 10, zIndex: 30, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "12px 16px", minWidth: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                <div style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Stats</div>
                {budgetItems.filter(i => i.type === "card").map(item => (
                  <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: item.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                    <input type="checkbox" checked={item.visible} onChange={() => setBudgetItems(prev => prev.map(x => x.key === item.key ? { ...x, visible: !x.visible } : x))} style={{ accentColor: "#c9a84c" }} />
                    {item.label}
                  </label>
                ))}
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "10px 0 8px" }} />
                <div style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Panels</div>
                {budgetItems.filter(i => i.type === "panel").map(item => (
                  <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: item.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                    <input type="checkbox" checked={item.visible} onChange={() => setBudgetItems(prev => prev.map(x => x.key === item.key ? { ...x, visible: !x.visible } : x))} style={{ accentColor: "#c9a84c" }} />
                    {item.label}
                  </label>
                ))}
              </div>
            )}

            {!budgetPillsCollapsed && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                {budgetItems.filter(i => i.type === "card" && i.visible).map(item => (
                  <div key={item.key} draggable
                    onDragStart={() => setDraggedBudgetItem(item.key)}
                    onDragEnd={() => setDraggedBudgetItem(null)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => dropBudgetItem(item.key)}
                    style={{ opacity: draggedBudgetItem === item.key ? 0.4 : 1, cursor: "grab" }}
                  >
                    {item.key === "spend"     ? <Metric title={`${yearLabel} spend`}   value={money(spent)}                   sub={`of ${money(annualBudget)} annual budget`} /> :
                     item.key === "remaining" ? <Metric title="Budget remaining"        value={money(remaining)}                sub={`${monthsTracked} months tracked`} good={remaining >= 0} /> :
                     item.key === "avgMonth"  ? <Metric title="Avg / month"             value={money(avgMonthly)}               sub={`target ${money(monthlyTarget)}/mo`} /> :
                     item.key === "purchases" ? <Metric title="Purchases"               value={yearPurchases.length}            sub="items logged" /> :
                     item.key === "projected" ? <Metric title="Projected annual"        value={money(projected)} /> :
                     item.key === "vsBudget"  ? <Metric title="vs annual budget"        value={money(projected - annualBudget)} good={projected < annualBudget} /> :
                     item.key === "topStore"  ? <Metric title="Top store"               value={storeTotals[0]?.store || "—"} /> :
                     item.key === "months"    ? <Metric title="Months tracked"          value={monthsTracked}                   sub="months with purchases" /> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Content panels ──────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14, alignItems: "start" }}>
            {budgetItems.filter(item => item.type === "panel" && item.visible).map(item => {
              const gridCol = item.width === "full" ? "1 / -1" : "span 2";
              return (
                <div key={item.key}
                  style={{ gridColumn: gridCol, position: "relative" }}
                  draggable
                  onDragStart={() => setDraggedBudgetItem(item.key)}
                  onDragEnd={() => setDraggedBudgetItem(null)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => dropBudgetItem(item.key)}
                  onMouseEnter={() => setHoveredBudgetItem(item.key)}
                  onMouseLeave={() => setHoveredBudgetItem(null)}
                >
                  {hoveredBudgetItem === item.key && (
                    <div style={{ position: "absolute", top: 10, right: 10, zIndex: 20, display: "flex", gap: 4 }}>
                      {["monthly-chart","store-breakdown","growth-chart"].includes(item.key) && (() => {
                        const ct = chartTypes[item.key] || (item.key === "monthly-chart" ? "bar" : item.key === "store-breakdown" ? "cards" : "line");
                        const icons = { bar: "▬", line: "〜", cards: "▦", donut: "◎", pie: "●", area: "◭" };
                        const nextLabel = item.key === "monthly-chart" ? (ct === "bar" ? "Line" : "Bar") : item.key === "store-breakdown" ? (ct === "cards" ? "Donut" : ct === "donut" ? "Pie" : "Cards") : (ct === "line" ? "Area" : "Line");
                        return (
                          <button onClick={e => { e.stopPropagation(); cycleChartType(item.key); }} style={hoverCtrlBtn} title={`Switch to ${nextLabel}`}>
                            {icons[ct] || "◎"}
                          </button>
                        );
                      })()}
                      <button onClick={e => { e.stopPropagation(); toggleBudgetWidth(item.key); }} style={hoverCtrlBtn} title={item.width === "full" ? "Half width" : "Full width"}>
                        {item.width === "full" ? "◧" : "▣"}
                      </button>
                      <button onClick={e => { e.stopPropagation(); toggleBudgetCollapse(item.key); }} style={hoverCtrlBtn} title={item.collapsed ? "Expand" : "Collapse"}>
                        {item.collapsed ? "▼" : "▲"}
                      </button>
                    </div>
                  )}

                  {item.collapsed ? (
                    <div style={{ ...card, marginBottom: 0, padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, color: "#8a9bb0", fontSize: 14 }}>{item.label}</span>
                      <button onClick={() => toggleBudgetCollapse(item.key)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "4px 10px", color: "#8a9bb0", fontSize: 12, cursor: "pointer" }}>▼</button>
                    </div>
                  ) : item.key === "store-breakdown" ? (
                    <div style={{ ...card, marginBottom: 0 }}>
                      <h4 style={{ margin: "0 0 14px", color: "#e8e2d5" }}>{yearLabel} Spending by Store</h4>
                      {storeTotals.length === 0 ? (
                        <div style={{ color: "#5d6f80", fontSize: 14, padding: "12px 0" }}>No purchases logged yet.</div>
                      ) : (() => {
                        const ct = chartTypes["store-breakdown"] || "cards";
                        if (ct === "cards") return (
                          <div style={storeGrid}>
                            {storeTotals.map(({ store, total }) => (
                              <div key={store} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 14 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                  <strong>{store}</strong>
                                  <span style={{ color: "#c9a84c", fontWeight: 900 }}>{money(total)}</span>
                                </div>
                                <div style={barTrack}><div style={{ ...bar, width: `${(total / maxStoreTotal) * 100}%` }} /></div>
                                <div style={{ color: "#5d6f80", fontSize: 13 }}>{spent > 0 ? `${((total / spent) * 100).toFixed(1)}% of total` : "—"}</div>
                              </div>
                            ))}
                          </div>
                        );
                        return (
                          <>
                            <ResponsiveContainer width="100%" height={220}>
                              <PieChart>
                                <Pie data={storePieData} cx="50%" cy="50%" innerRadius={ct === "donut" ? 60 : 0} outerRadius={95} dataKey="value" paddingAngle={ct === "donut" ? 2 : 1}>
                                  {storePieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                </Pie>
                                <Tooltip formatter={v => [money(v), "Spent"]} contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                              </PieChart>
                            </ResponsiveContainer>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", marginTop: 6 }}>
                              {storePieData.map((d, i) => (
                                <span key={d.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#8a9bb0" }}>
                                  <span style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], display: "inline-block", flexShrink: 0 }} />
                                  {d.name} <strong style={{ color: "#c9a84c" }}>{money(d.value)}</strong>
                                </span>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : item.key === "monthly-chart" ? (
                    <div style={{ ...card, marginBottom: 0, padding: "18px 18px 8px" }}>
                      <h4 style={{ margin: "0 0 14px", color: "#e8e2d5" }}>Monthly Spend</h4>
                      {monthlyChartData.every(d => d.total === 0) ? (
                        <div style={{ textAlign: "center", padding: "40px 20px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10 }}>
                          <div style={{ fontSize: 32, marginBottom: 10 }}>🧾</div>
                          <div style={{ fontWeight: 700, color: "#8a9bb0", marginBottom: 4 }}>No purchases logged yet</div>
                          <div style={{ fontSize: 13, color: "#5d6f80" }}>Add your first purchase using the <span style={{ color: "#c9a84c" }}>Add Purchase</span> tab to start tracking spending.</div>
                        </div>
                      ) : (() => {
                        const ct = chartTypes["monthly-chart"] || "bar";
                        const tooltipStyle = { background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" };
                        const axisProps = { stroke: "#5d6f80", tick: { fill: "#5d6f80", fontSize: 11 }, axisLine: false, tickLine: false };
                        return ct === "line" ? (
                          <ResponsiveContainer width="100%" height={260}>
                            <LineChart data={monthlyChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                              <XAxis dataKey="month" {...axisProps} />
                              <YAxis {...axisProps} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={44} />
                              <Tooltip formatter={v => [money(v), "Spend"]} labelStyle={{ color: "#8a9bb0" }} contentStyle={tooltipStyle} />
                              <Line type="monotone" dataKey="total" stroke="#c9a84c" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: "#c9a84c" }} name="Monthly Spend" />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <ResponsiveContainer width="100%" height={260}>
                            <BarChart data={monthlyChartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                              <XAxis dataKey="month" {...axisProps} />
                              <YAxis {...axisProps} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={44} />
                              <Tooltip formatter={v => [money(v), "Spend"]} labelStyle={{ color: "#8a9bb0" }} contentStyle={tooltipStyle} />
                              <Bar dataKey="total" fill="#c9a84c" radius={[4, 4, 0, 0]} name="Monthly Spend" />
                            </BarChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </div>
                  ) : item.key === "growth-chart" && cumulativeSpendData.length > 1 ? (
                    <div style={{ ...card, marginBottom: 0, padding: "18px 18px 8px" }}>
                      <h4 style={{ margin: "0 0 14px", color: "#e8e2d5" }}>Investment Curve</h4>
                      {(() => {
                        const ct = chartTypes["growth-chart"] || "line";
                        const commonProps = {
                          data: cumulativeSpendData,
                          margin: { top: 8, right: 16, left: 0, bottom: 0 }
                        };
                        const axisProps = { stroke: "#5d6f80", tick: { fill: "#5d6f80", fontSize: 11 } };
                        const tooltipStyle = { background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" };
                        return (
                          <ResponsiveContainer width="100%" height={220}>
                            {ct === "area" ? (
                              <AreaChart {...commonProps}>
                                <defs>
                                  <linearGradient id="investGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#c9a84c" stopOpacity={0.28} />
                                    <stop offset="95%" stopColor="#c9a84c" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="month" {...axisProps} interval="preserveStartEnd" />
                                <YAxis {...axisProps} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={48} />
                                <Tooltip formatter={v => money(v)} labelStyle={{ color: "#8a9bb0" }} contentStyle={tooltipStyle} />
                                <Area type="monotone" dataKey="total" stroke="#c9a84c" strokeWidth={2} fill="url(#investGrad)" dot={false} activeDot={{ r: 5, fill: "#c9a84c" }} name="Cumulative Spend" />
                              </AreaChart>
                            ) : (
                              <LineChart {...commonProps}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="month" {...axisProps} interval="preserveStartEnd" />
                                <YAxis {...axisProps} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={48} />
                                <Tooltip formatter={v => money(v)} labelStyle={{ color: "#8a9bb0" }} contentStyle={tooltipStyle} />
                                <Line type="monotone" dataKey="total" stroke="#c9a84c" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: "#c9a84c" }} name="Cumulative Spend" />
                              </LineChart>
                            )}
                          </ResponsiveContainer>
                        );
                      })()}
                    </div>
                  ) : item.key === "store-pie" && storePieData.length > 0 ? (
                    <div style={{ ...card, marginBottom: 0 }}>
                      <h4 style={{ margin: "0 0 14px", color: "#e8e2d5" }}>Spending by Store</h4>
                      <ResponsiveContainer width="100%" height={190}>
                        <PieChart>
                          <Pie data={storePieData} cx="50%" cy="50%" innerRadius={52} outerRadius={82} dataKey="value" paddingAngle={2}>
                            {storePieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={v => money(v)} contentStyle={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5" }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 6 }}>
                        {storePieData.map((d, i) => (
                          <span key={d.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#8a9bb0" }}>
                            <span style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], display: "inline-block", flexShrink: 0 }} />
                            {d.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : item.key === "theme-spend" ? (
                    <div style={{ ...card, marginBottom: 0 }}>
                      <h4 style={{ margin: "0 0 14px", color: "#e8e2d5" }}>Spending by Theme</h4>
                      {themeSpendData.length > 0 ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          {themeSpendData.slice(0, showAllThemeSpend ? 15 : 5).map(({ name, value }) => {
                            const maxVal = themeSpendData[0].value;
                            return (
                              <div key={name} style={{ display: "grid", gridTemplateColumns: "110px 1fr 72px", alignItems: "center", gap: 10 }}>
                                <span style={{ color: "#8a9bb0", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                                <div style={{ height: 8, background: "#0b1520", borderRadius: 999, overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${(value / maxVal) * 100}%`, background: "#c9a84c", borderRadius: 999 }} />
                                </div>
                                <span style={{ color: "#e8e2d5", fontWeight: 700, fontSize: 13, textAlign: "right" }}>{money(value)}</span>
                              </div>
                            );
                          })}
                          {themeSpendData.length > 5 && (
                            <button onClick={() => setShowAllThemeSpend(prev => !prev)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 12px", color: "#8a9bb0", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                              {showAllThemeSpend ? "▲ Show less" : `▾ ${Math.min(themeSpendData.length, 15) - 5} more themes`}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div style={{ textAlign: "center", padding: "24px 16px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10 }}>
                          <div style={{ fontWeight: 700, color: "#8a9bb0", marginBottom: 4 }}>No theme data yet</div>
                          <div style={{ fontSize: 13, color: "#5d6f80" }}>Log purchases with a set number to see spending by theme.</div>
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

      {tab === "log" && (
        <section style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h3 style={{ margin: 0 }}>Add Purchase</h3>
              {/* Single | Multi mode toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ display: "flex", background: "#0a1624", border: "1px solid #1a2d42", borderRadius: 8, overflow: "hidden" }}>
                  {["single", "multi"].map(m => (
                    <button
                      key={m}
                      onClick={() => setPurchaseMode(m)}
                      style={{
                        background: purchaseMode === m ? "#c9a84c" : "transparent",
                        color: purchaseMode === m ? "#0d1623" : "#5d6f80",
                        border: "none",
                        padding: "5px 13px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        textTransform: "capitalize",
                        letterSpacing: 0.3
                      }}
                    >{m === "single" ? "Single" : "Multi"}</button>
                  ))}
                </div>
                <InfoTip text={purchaseMode === "single" ? "Single: one set, one order. Tax, shipping, and gift card are entered per item." : "Multi: multiple sets in one order. Enter order-level tax, shipping, and gift cards — they distribute automatically across all items."} />
              </div>
            </div>
            {(form.orderTax || form.orderShipping || form.orderGC || form.orderNotes ||
              form.lines.some(l => l.setNumber || l.name || l.faceValue || l.tax || l.shipping || l.gc || l.date || l.notes)) && (
              <button
                onClick={() => {
                  setForm({ lines: [{ setNumber: "", name: "", theme: "", qty: 1, faceValue: "", tax: "", shipping: "", gc: "", store: stores[0] || "LEGO", date: "", notes: "" }], orderTax: "", orderShipping: "", orderGC: "", orderLabel: "", orderNotes: "", _orderLabelAuto: true });
                  setLineSearch({});
                  setOrderBreakdownOpen(false);
                }}
                style={{ background: "transparent", color: "#5d6f80", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                Reset
              </button>
            )}
          </div>

          {/* Multi panel — only visible in Multi mode */}
          {purchaseMode === "multi" && (
            <div style={{ background: "rgba(201,168,76,0.05)", border: "1px solid rgba(201,168,76,0.18)", borderRadius: 10, padding: "12px 16px", marginBottom: 14 }}>
              {/* Panel header row: title + Order Label */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                <span style={{ color: "#c9a84c", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 5 }}>
                  Multi-Item Order{form.lines.length > 1 ? ` — ${form.lines.length} items` : ""}
                  <InfoTip color="#c9a84c" text="Use Multi when you bought several sets in one order — one checkout, one receipt. Tax and shipping distribute automatically across all items. The Order Label links them together in your purchase history." />
                </span>
                {/* Order Label */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                    Order Label
                    <InfoTip text="Auto-generated ID that groups all items from this order. You can also paste your real order number here (e.g. from Amazon or LEGO.com). Hit ↺ to regenerate." />
                  </span>
                  <input
                    placeholder="auto · or paste real order #"
                    value={form.orderLabel}
                    onChange={e => setForm(prev => ({ ...prev, orderLabel: e.target.value, _orderLabelAuto: false }))}
                    style={{ width: 170, background: "#0a1624", border: `1px solid ${form.orderLabel ? "rgba(201,168,76,0.4)" : "#1a2d42"}`, borderRadius: 6, color: form.orderLabel ? "#c9a84c" : "#5d6f80", fontSize: 12, padding: "4px 8px", outline: "none", fontFamily: "monospace", fontWeight: form.orderLabel ? 700 : 400, letterSpacing: form.orderLabel ? 0.5 : 0 }}
                  />
                  {(form.lines[0]?.store && form.lines[0]?.date) && (
                    <button
                      onClick={() => setForm(prev => ({ ...prev, orderLabel: generateOrderLabel(prev.lines[0].store, prev.lines[0].date), _orderLabelAuto: true }))}
                      title="Generate new label"
                      style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.25)", borderRadius: 5, color: "#c9a84c", fontSize: 12, padding: "3px 7px", cursor: "pointer" }}
                    >↺</button>
                  )}
                </div>
              </div>

              {/* Global Store + Date + Order Notes */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid rgba(201,168,76,0.12)" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 10, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Store</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <select
                      value={form.lines[0]?.store || stores[0] || "LEGO"}
                      onChange={e => updateGlobalField("store", e.target.value)}
                      style={{ background: "#0a1624", border: "1px solid #1a2d42", borderRadius: 6, color: "#c9d6e3", fontSize: 13, padding: "5px 8px", outline: "none" }}
                    >{stores.map(s => <option key={s}>{s}</option>)}</select>
                    {onNavigateToSettings && <button onClick={onNavigateToSettings} title="Manage stores" style={{ background: "none", border: "none", color: "#3a4f63", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>⚙</button>}
                  </div>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 10, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Order Date</span>
                  <input
                    type="date"
                    value={form.lines[0]?.date || ""}
                    onChange={e => updateGlobalField("date", e.target.value)}
                    style={{ background: "#0a1624", border: "1px solid #1a2d42", borderRadius: 6, color: "#c9d6e3", fontSize: 13, padding: "5px 8px", outline: "none" }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: "1 1 200px" }}>
                  <span style={{ fontSize: 10, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Order Notes</span>
                  <input
                    placeholder="e.g. Prime Day deal, 4x points, GWP promo"
                    value={form.orderNotes}
                    onChange={e => setForm(prev => ({ ...prev, orderNotes: e.target.value }))}
                    style={{ background: "#0a1624", border: "1px solid #1a2d42", borderRadius: 6, color: "#c9d6e3", fontSize: 13, padding: "5px 8px", outline: "none" }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>

                {/* Tax / Fee Total */}
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 4 }}>
                    Tax / Fee Total ($)
                    <InfoTip text="Total tax or fee for the order from your receipt. Prorated to each item by price." />
                  </span>
                  <input type="number" step="0.01" min="0" placeholder=""
                    value={form.orderTax}
                    onChange={e => distributeOrderTax(e.target.value)}
                    style={{ width: 110, background: "#0a1624", border: `1px solid ${form.orderTax ? "rgba(201,168,76,0.45)" : "#1a2d42"}`, borderRadius: 6, color: form.orderTax ? "#c9a84c" : "#c9d6e3", fontSize: 13, padding: "6px 10px", outline: "none" }}
                  />
                </label>

                {/* Tax Rate % */}
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 4 }}>
                    Tax Rate %
                    <InfoTip text="Your local sales tax rate. Calculates each item's tax share automatically (Price × Qty × Rate%). Use instead of entering a total." />
                  </span>
                  <input type="number" step="0.01" min="0" max="100" placeholder="e.g. 8.5"
                    value={orderTaxRate}
                    onChange={e => distributeByTaxRate(e.target.value)}
                    style={{ width: 110, background: "#0a1624", border: `1px solid ${orderTaxRate ? "rgba(201,168,76,0.45)" : "#1a2d42"}`, borderRadius: 6, color: orderTaxRate ? "#c9a84c" : "#c9d6e3", fontSize: 13, padding: "6px 10px", outline: "none" }}
                  />
                </label>

                {/* Shipping */}
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "#5d6f80", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 4 }}>
                    Shipping ($)
                    <InfoTip text="Order shipping total. Split evenly across all items." />
                  </span>
                  <input type="number" step="0.01" min="0" placeholder=""
                    value={form.orderShipping}
                    onChange={e => distributeOrderShipping(e.target.value)}
                    style={{ width: 110, background: "#0a1624", border: `1px solid ${form.orderShipping ? "rgba(201,168,76,0.45)" : "#1a2d42"}`, borderRadius: 6, color: form.orderShipping ? "#c9a84c" : "#c9d6e3", fontSize: 13, padding: "6px 10px", outline: "none" }}
                  />
                </label>

                {/* Gift Card / Rewards — global for the order */}
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "#4caf7d", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, display: "flex", alignItems: "center", gap: 4 }}>
                    Gift Card / Rewards ($)
                    <InfoTip color="#4caf7d" text="Total gift card or rewards for this order. Prorated across items by price so each set shows its true net cost. Collection value stays at full price — only cash paid is reduced." />
                  </span>
                  <input type="number" step="0.01" min="0" placeholder=""
                    value={form.orderGC}
                    onChange={e => distributeOrderGC(e.target.value)}
                    style={{ width: 110, background: "#0a1624", border: `1px solid ${form.orderGC ? "rgba(76,175,61,0.4)" : "#1a2d42"}`, borderRadius: 6, color: form.orderGC ? "#4caf7d" : "#c9d6e3", fontSize: 13, padding: "6px 10px", outline: "none" }}
                  />
                </label>

                {/* Running totals — collapsible breakdown */}
                {(() => {
                  const sub  = form.lines.reduce((s, l) => s + asNumber(l.faceValue) * (asNumber(l.qty) || 1), 0);
                  const tax  = form.lines.reduce((s, l) => s + (asNumber(l.tax)      || 0), 0);
                  const ship = form.lines.reduce((s, l) => s + (asNumber(l.shipping) || 0), 0);
                  const gc   = asNumber(form.orderGC) || form.lines.reduce((s, l) => s + (asNumber(l.gc) || 0), 0);
                  const tot  = sub + tax + ship;
                  const cash = Math.max(0, tot - gc);
                  if (sub === 0) return null;
                  const hasBreakdown = form.lines.length > 1;
                  return (
                    <div style={{ flex: "1 1 100%", marginTop: 6 }}>
                      {/* Summary row */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {hasBreakdown && (
                          <button
                            onClick={() => setOrderBreakdownOpen(prev => !prev)}
                            style={{ background: "transparent", border: "none", color: "#5d6f80", cursor: "pointer", fontSize: 11, padding: "2px 4px", lineHeight: 1, userSelect: "none" }}
                            title={orderBreakdownOpen ? "Hide per-item breakdown" : "Show per-item breakdown"}
                          >{orderBreakdownOpen ? "▼" : "▶"}</button>
                        )}
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
                          <span><span style={{ color: "#5d6f80" }}>Price </span><span style={{ color: "#e8e2d5", fontWeight: 700 }}>{money(sub)}</span></span>
                          {tax  > 0 && <span><span style={{ color: "#5d6f80" }}>Tax </span><span style={{ color: "#e8e2d5", fontWeight: 700 }}>{money(tax)}</span></span>}
                          {ship > 0 && <span><span style={{ color: "#5d6f80" }}>Ship </span><span style={{ color: "#e8e2d5", fontWeight: 700 }}>{money(ship)}</span></span>}
                          {gc > 0
                            ? <>
                                <span><span style={{ color: "#4caf7d" }}>GC </span><span style={{ color: "#4caf7d", fontWeight: 700 }}>−{money(gc)}</span></span>
                                <span style={{ color: "#5d6f80", textDecoration: "line-through", fontSize: 11 }}>{money(tot)}</span>
                                <span><span style={{ color: "#5d6f80" }}>Cash </span><span style={{ color: "#4caf7d", fontWeight: 700, fontSize: 14 }}>{money(cash)}</span></span>
                              </>
                            : <span><span style={{ color: "#5d6f80" }}>Total </span><span style={{ color: "#c9a84c", fontWeight: 700, fontSize: 14 }}>{money(tot)}</span></span>
                          }
                        </div>
                      </div>
                      {/* Per-item breakdown */}
                      {hasBreakdown && orderBreakdownOpen && (
                        <div style={{ marginTop: 8, borderTop: "1px solid rgba(201,168,76,0.12)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                          {form.lines.map((l, i) => {
                            const lSub = asNumber(l.faceValue) * (asNumber(l.qty) || 1);
                            if (!lSub && !asNumber(l.tax) && !asNumber(l.shipping)) return null;
                            const lTax  = asNumber(l.tax)      || 0;
                            const lShip = asNumber(l.shipping)  || 0;
                            const lGC   = asNumber(l.gc)        || 0;
                            const lTot  = lSub + lTax + lShip;
                            const lCash = Math.max(0, lTot - lGC);
                            const label = l.name || l.setNumber || `Item ${i + 1}`;
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#8a9bb0", fontFamily: "inherit" }}>
                                <span style={{ minWidth: 0, flex: "0 0 150px", color: "#c9d6e3", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>{label}</span>
                                <span style={{ color: "#5d6f80" }}>{money(lSub)}</span>
                                {lTax  > 0 && <span><span style={{ color: "#3a4f63" }}>+tax </span><span>{money(lTax)}</span></span>}
                                {lShip > 0 && <span><span style={{ color: "#3a4f63" }}>+ship </span><span>{money(lShip)}</span></span>}
                                {lGC   > 0 && <span style={{ color: "#4caf7d" }}>−gc {money(lGC)}</span>}
                                <span style={{ color: lGC > 0 ? "#4caf7d" : "#c9a84c", fontWeight: 700 }}>= {money(lGC > 0 ? lCash : lTot)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {form.lines.map((line, index) => (
            <div key={index} style={logGrid}>
              <div style={{ position: "relative" }}>
                <input
                  placeholder="Set Number (e.g. 75192)"
                  value={line.setNumber}
                  onChange={e => { updateLine(index, "setNumber", e.target.value); triggerLineSearch(index, e.target.value); }}
                  onKeyDown={e => {
                    if (e.key === "Enter") { lookupLine(index); setLineSearch(prev => ({ ...prev, [index]: { ...prev[index], open: false } })); }
                    if (e.key === "Escape") setLineSearch(prev => ({ ...prev, [index]: { ...prev[index], open: false } }));
                  }}
                  onBlur={() => setTimeout(() => setLineSearch(prev => ({ ...prev, [index]: { ...prev[index], open: false } })), 180)}
                  style={{ width: "100%", paddingRight: (lineLoading[index] || lineSearch[index]?.loading) ? 28 : undefined }}
                />
                {(lineLoading[index] || lineSearch[index]?.loading) && (
                  <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#5d6f80" }}>…</span>
                )}
                {lineSearch[index]?.open && lineSearch[index]?.results?.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 50, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.7)", minWidth: 300, maxWidth: 480, marginTop: 2, overflow: "hidden" }}>
                    {lineSearch[index].results.map(r => (
                      <div
                        key={r.setNumber}
                        onMouseDown={() => selectSearchResult(index, r)}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(201,168,76,0.08)"}
                        onMouseLeave={e => e.currentTarget.style.background = ""}
                      >
                        {r.thumbnail && <img src={r.thumbnail} alt="" style={{ width: 32, height: 32, objectFit: "contain", flexShrink: 0, opacity: 0.9 }} />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#e8e2d5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                          <div style={{ fontSize: 11, color: "#5d6f80", display: "flex", gap: 8 }}>
                            <span>{r.setNumber}</span>
                            {r.theme && <span style={{ color: "#3a4f63" }}>·</span>}
                            {r.theme && <span>{r.theme}</span>}
                            {r.msrp && <span style={{ color: "#3a4f63" }}>·</span>}
                            {r.msrp && <span style={{ color: "#c9a84c" }}>${r.msrp.toFixed(2)}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <input placeholder="Set Name" value={line.name} onChange={e => updateLine(index, "name", e.target.value)} />
              <select value={line.theme} onChange={e => updateLine(index, "theme", e.target.value)}>
                <option value="">— Theme —</option>
                {(legoThemes.length
                  ? Array.from(new Set([...legoThemes, ...purchases.map(p => p.theme).filter(Boolean)])).sort()
                  : Array.from(new Set(purchases.map(p => p.theme).filter(Boolean))).sort()
                ).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input placeholder="Qty" type="number" step="1" min="1" value={line.qty} onChange={e => updateLine(index, "qty", e.target.value)} />
              <div style={{ position: "relative" }}>
                <input
                  placeholder="Price ($/unit)"
                  type="number" min="0" step="0.01"
                  value={line.faceValue}
                  onChange={e => { updateLine(index, "faceValue", e.target.value); updateLine(index, "_suggestedMsrp", null); }}
                  style={{ width: "100%" }}
                />
                {line._suggestedMsrp != null && !line.faceValue && (
                  <button
                    onMouseDown={() => updateLine(index, "faceValue", String(line._suggestedMsrp))}
                    style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "rgba(201,168,76,0.15)", border: "1px solid rgba(201,168,76,0.3)", borderRadius: 4, color: "#c9a84c", fontSize: 10, fontWeight: 700, padding: "2px 5px", cursor: "pointer", whiteSpace: "nowrap" }}
                    title="Use suggested MSRP"
                  >${line._suggestedMsrp.toFixed(2)}</button>
                )}
              </div>
              {purchaseMode === "single" && (
                <input
                  placeholder="Tax / Fee ($)"
                  type="number" min="0" step="0.01"
                  value={line.tax}
                  onChange={e => updateLine(index, "tax", e.target.value)}
                />
              )}
              {purchaseMode === "single" && (
                <input
                  placeholder="Shipping ($)"
                  type="number" min="0" step="0.01"
                  value={line.shipping}
                  onChange={e => updateLine(index, "shipping", e.target.value)}
                />
              )}
              {purchaseMode === "single" && (
                <div style={{ position: "relative" }}>
                  <input
                    placeholder="Gift Card / Rewards ($)"
                    type="number" min="0" step="0.01"
                    value={line.gc}
                    onChange={e => updateLine(index, "gc", e.target.value)}
                    style={{ width: "100%", paddingRight: 24, border: asNumber(line.gc) > 0 ? "1px solid rgba(76,175,61,0.4)" : undefined, color: asNumber(line.gc) > 0 ? "#4caf7d" : undefined }}
                  />
                  <span style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)" }}>
                    <InfoTip color="#4caf7d" size={14} text="Gift card or rewards applied to this purchase. Reduces cash paid while your collection value stays at full price — so your cost basis per set stays accurate." />
                  </span>
                </div>
              )}
              {(line.faceValue || line.tax || line.shipping) && (() => {
                const full = Math.round(((asNumber(line.faceValue) * (asNumber(line.qty) || 1)) + (asNumber(line.tax) || 0) + (asNumber(line.shipping) || 0)) * 100) / 100;
                const gc   = asNumber(line.gc) || 0;
                const cash = Math.max(0, Math.round((full - gc) * 100) / 100);
                return (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", padding: "0 4px", gap: 1 }}>
                    {gc > 0
                      ? <>
                          <span style={{ color: "#5d6f80", fontSize: 11, textDecoration: "line-through" }}>{money(full)}</span>
                          <span style={{ color: "#4caf7d", fontWeight: 700, fontSize: 13 }}>Cash {money(cash)}</span>
                        </>
                      : <span style={{ color: "#c9a84c", fontWeight: 700, fontSize: 13 }}>= {money(full)}</span>
                    }
                  </div>
                );
              })()}
              {purchaseMode === "single" && (
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <select value={line.store} onChange={e => updateLine(index, "store", e.target.value)}>{stores.map(s => <option key={s}>{s}</option>)}</select>
                  {index === 0 && onNavigateToSettings && <button onClick={onNavigateToSettings} title="Manage stores" style={{ background: "none", border: "none", color: "#3a4f63", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>⚙</button>}
                </div>
              )}
              {purchaseMode === "single" && (
                <input type="date" value={line.date} onChange={e => updateLine(index, "date", e.target.value)} />
              )}
              <input placeholder="Notes" value={line.notes} onChange={e => updateLine(index, "notes", e.target.value)} />
              {form.lines.length > 1 && (
                <button onClick={() => removeLine(index)} style={{ background: "#3b0a0a", color: "#ff8b8b", border: "1px solid #7f1d1d", borderRadius: 8, padding: "9px 12px", cursor: "pointer", fontWeight: 700 }}>×</button>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={addLine} style={ghostBtn}>+ Add Item</button>
            <button onClick={addPurchase} style={redBtn}>Save Purchase</button>
          </div>
        </section>
      )}

      {tab === "purchases" && (
        <section style={card}>
          <div style={row}>
            <h3>Purchases</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>

              <input
                placeholder="Search purchases..."
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                style={searchInput}
              />

              <select style={filterSelect} value={filterStore} onChange={e => setFilterStore(e.target.value)}>
                <option value="">All Stores</option>
                {stores.map(s => <option key={s}>{s}</option>)}
              </select>
              <select style={filterSelect} value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
                <option value="">All Months</option>
                {purchaseMonths.map(m => <option key={m}>{m}</option>)}
              </select>
              {(searchText || filterStore || filterMonth) && (
                <button onClick={() => { setSearchText(""); setFilterStore(""); setFilterMonth(""); }} style={clearFilterButton}>
                  Clear
                </button>
              )}

              <select
                value={`${sortColumn}:${sortDirection}`}
                onChange={e => {
                  const [col, dir] = e.target.value.split(":");
                  setSortColumn(col);
                  setSortDirection(dir);
                }}
                style={filterSelect}
              >
                <option value="date:desc">Recently Added</option>
                <option value="date:asc">Oldest First</option>
                <option value="total:desc">Total (↓)</option>
                <option value="total:asc">Total (↑)</option>
                <option value="store:asc">Store (A–Z)</option>
              </select>

              <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.1)", alignSelf: "center", margin: "0 2px", flexShrink: 0 }} />
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setPurchaseColumnsOpen(prev => !prev)}
                  style={{ ...hoverCtrlBtn, color: purchaseColumnsOpen ? "#c9a84c" : "#8a9bb0", padding: "5px 8px", display: "flex", alignItems: "center" }}
                  title={`Column visibility — ${purchaseColumns.filter(c => c.visible).length} of ${purchaseColumns.length} shown`}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    <rect x="0" y="0" width="14" height="3" rx="1"/>
                    <rect x="0" y="5" width="3.5" height="9" rx="1"/>
                    <rect x="5.25" y="5" width="3.5" height="9" rx="1"/>
                    <rect x="10.5" y="5" width="3.5" height="9" rx="1"/>
                  </svg>
                </button>
                {purchaseColumnsOpen && (
                  <div style={{ position: "absolute", top: 34, right: 0, zIndex: 30, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "12px 16px", minWidth: 180, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                    <div style={{ color: "#5d6f80", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Columns</div>
                    {purchaseColumns.map(col => (
                      <label key={col.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", color: col.visible ? "#e8e2d5" : "#5d6f80", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={col.visible}
                          onChange={() => setPurchaseColumns(prev => prev.map(c => c.key === col.key ? { ...c, visible: !c.visible } : c))}
                          style={{ accentColor: "#c9a84c" }}
                        />
                        {col.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {checkedRows.length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={addCheckedToCollection} style={{ background: "#0a2e1a", color: "#5aa832", border: "1px solid #166534", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontWeight: 800 }}>
                → Collection ({checkedRows.length})
              </button>
              <button onClick={deleteCheckedPurchases} style={{ background: "#7f1d1d", color: "white", border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontWeight: 800 }}>
                Delete Selected ({checkedRows.length})
              </button>
            </div>
          )}

          <div style={{
            display: "grid",
            gridTemplateColumns: selectedPurchaseIndex !== null ? "1fr 380px" : "1fr",
            gap: 16,
            alignItems: "start"
          }}>
            <div style={{ overflow: "auto", maxHeight: 560 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={{ ...th, ...stickyCheckbox, width: 44, minWidth: 44 }}><input type="checkbox" onChange={toggleCheckAll} /></th>
                  {purchaseColumns.filter(col => col.visible).map(col => (
                    <th
                      key={col.key}
                      draggable
                      onDragStart={() => setDraggedPurchaseColumn(col.key)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => dropPurchaseColumn(col.key)}
                      style={{
                        ...(isNumericPurchaseColumn(col.key) ? thRightButton : thButton),
                        opacity: draggedPurchaseColumn === col.key ? 0.45 : 1
                      }}
                      onClick={() => sortHeader(col.key)}
                      title="Drag to reorder. Click to sort."
                    >
                      ☰ {sortLabel(col.label, col.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Pre-compute order label groups for visual accent
                  const orderGroups = {};
                  visiblePurchases.forEach((p, idx) => {
                    if (p.orderLabel) {
                      if (!orderGroups[p.orderLabel]) orderGroups[p.orderLabel] = [];
                      orderGroups[p.orderLabel].push(idx);
                    }
                  });
                  return visiblePurchases.map((p, visIdx) => {
                  const i = purchases.indexOf(p);
                  const grp = p.orderLabel && orderGroups[p.orderLabel]?.length > 1 ? orderGroups[p.orderLabel] : null;
                  const isFirst = grp && grp[0] === visIdx;
                  const isLast  = grp && grp[grp.length - 1] === visIdx;
                  const accentColor = grp ? "rgba(201,168,76,0.55)" : "transparent";
                  return (
                    <tr
                      key={i}
                      onClick={() => setPurchaseDetailIdx(i)}
                      onMouseEnter={e => {
                        if (selectedPurchaseIndex !== i) e.currentTarget.style.background = grp ? "rgba(201,168,76,0.07)" : "rgba(255,255,255,0.04)";
                        setTipPos({ x: e.clientX, y: e.clientY });
                        setHoveredPurchase(p);
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = selectedPurchaseIndex === i ? "#332500" : grp ? "rgba(201,168,76,0.03)" : "transparent";
                        setHoveredPurchase(null);
                      }}
                      style={{
                        cursor: "pointer",
                        background: selectedPurchaseIndex === i ? "#332500" : grp ? "rgba(201,168,76,0.03)" : "transparent",
                        transition: "background 0.12s ease",
                        borderBottom: isLast ? "2px solid rgba(201,168,76,0.2)" : undefined,
                      }}
                    >
                      <td style={{ ...td, ...stickyCheckbox, width: 44, minWidth: 44, boxShadow: grp ? `inset 3px 0 0 ${accentColor}` : undefined }}>
                        <input type="checkbox" checked={checkedRows.includes(i)} onChange={() => toggleCheck(i)} />
                      </td>
                      {purchaseColumns.filter(col => col.visible).map(col => {
                        const isEditing = inlineEdit?.i === i && inlineEdit?.key === col.key;
                        const inpStyle = { background: "#0d1a2a", border: "1px solid rgba(201,168,76,0.5)", borderRadius: 6, color: "#e8e2d5", fontSize: 13, padding: "2px 6px", outline: "none" };

                        // Date — double-click to edit
                        if (col.key === "date") {
                          if (isEditing) return (
                            <td key="date" style={td} onClick={e => e.stopPropagation()}>
                              <input autoFocus type="date" value={inlineEdit.value}
                                onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))}
                                onBlur={() => { updatePurchase(i, "date", inlineEdit.value); setInlineEdit(null); }}
                                onKeyDown={e => { if (e.key === "Enter") { updatePurchase(i, "date", inlineEdit.value); setInlineEdit(null); } if (e.key === "Escape") setInlineEdit(null); }}
                                style={{ ...inpStyle, width: 130 }} />
                            </td>
                          );
                          return <td key="date" style={{ ...td, cursor: "default" }} onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); setInlineEdit({ i, key: "date", value: p.date || "" }); }}>{renderPurchaseCell(p, col)}</td>;
                        }

                        // Qty — double-click to edit
                        if (col.key === "qty") {
                          if (isEditing) return (
                            <td key="qty" style={tdRight} onClick={e => e.stopPropagation()}>
                              <input autoFocus type="number" min="1" value={inlineEdit.value}
                                onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))}
                                onBlur={() => { updatePurchase(i, "qty", inlineEdit.value); setInlineEdit(null); }}
                                onKeyDown={e => { if (e.key === "Enter") { updatePurchase(i, "qty", inlineEdit.value); setInlineEdit(null); } if (e.key === "Escape") setInlineEdit(null); }}
                                style={{ ...inpStyle, width: 50, textAlign: "right" }} />
                            </td>
                          );
                          return <td key="qty" style={{ ...tdRight, cursor: "default" }} onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); setInlineEdit({ i, key: "qty", value: String(p.qty || 1) }); }}>{renderPurchaseCell(p, col)}</td>;
                        }

                        // Store — double-click → dropdown
                        if (col.key === "store") {
                          if (isEditing) return (
                            <td key="store" style={td} onClick={e => e.stopPropagation()}>
                              <select autoFocus value={inlineEdit.value}
                                onChange={e => { updatePurchase(i, "store", e.target.value); setInlineEdit(null); }}
                                onBlur={() => setInlineEdit(null)}
                                onKeyDown={e => { if (e.key === "Escape") setInlineEdit(null); }}
                                style={{ ...inpStyle, minWidth: 100 }}>
                                {stores.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </td>
                          );
                          return <td key="store" style={{ ...td, cursor: "default" }} onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); setInlineEdit({ i, key: "store", value: p.store || stores[0] || "" }); }}>{renderPurchaseCell(p, col)}</td>;
                        }

                        // Unit Price — double-click to edit
                        if (col.key === "faceValue") {
                          if (isEditing) return (
                            <td key="faceValue" style={tdRight} onClick={e => e.stopPropagation()}>
                              <input autoFocus type="number" step="0.01" min="0" value={inlineEdit.value}
                                onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))}
                                onBlur={() => { updatePurchase(i, "faceValue", inlineEdit.value); setInlineEdit(null); }}
                                onKeyDown={e => { if (e.key === "Enter") { updatePurchase(i, "faceValue", inlineEdit.value); setInlineEdit(null); } if (e.key === "Escape") setInlineEdit(null); }}
                                style={{ ...inpStyle, width: 70, textAlign: "right" }} />
                            </td>
                          );
                          return <td key="faceValue" style={{ ...tdRight, cursor: "default" }} onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); setInlineEdit({ i, key: "faceValue", value: String(p.faceValue ?? p.amount ?? "") }); }}>{renderPurchaseCell(p, col)}</td>;
                        }

                        // Notes — double-click to edit
                        if (col.key === "notes") {
                          if (isEditing) return (
                            <td key="notes" style={td} onClick={e => e.stopPropagation()}>
                              <input autoFocus value={inlineEdit.value}
                                onChange={e => setInlineEdit(v => ({ ...v, value: e.target.value }))}
                                onBlur={() => { updatePurchase(i, "notes", inlineEdit.value); setInlineEdit(null); }}
                                onKeyDown={e => { if (e.key === "Enter") { updatePurchase(i, "notes", inlineEdit.value); setInlineEdit(null); } if (e.key === "Escape") setInlineEdit(null); }}
                                style={{ ...inpStyle, width: "100%", minWidth: 120 }} />
                            </td>
                          );
                          return <td key="notes" style={{ ...td, cursor: "default" }} onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); setInlineEdit({ i, key: "notes", value: p.notes || "" }); }}>{renderPurchaseCell(p, col)}</td>;
                        }

                        return (
                          <td key={col.key} style={isNumericPurchaseColumn(col.key) ? tdRight : td}>
                            {renderPurchaseCell(p, col)}
                          </td>
                        );
                      })}
                      <td style={td}>
                        <button
                          onClick={e => { e.stopPropagation(); addPurchaseToCollection(p, i); }}
                          disabled={isInCollection(p)}
                          style={{
                            border: `1px solid ${isInCollection(p) ? "rgba(255,255,255,0.07)" : "#166534"}`,
                            borderRadius: 8,
                            padding: "6px 10px",
                            background: isInCollection(p) ? "#0f1a28" : "#0a2e1a",
                            color: isInCollection(p) ? "#5d6f80" : "#5aa832",
                            cursor: isInCollection(p) ? "not-allowed" : "pointer",
                            fontWeight: 700,
                            whiteSpace: "nowrap"
                          }}
                        >
                          {isInCollection(p) ? "Added ✓" : "→ Collection"}
                        </button>
                      </td>
                    </tr>
                  );
                  });
                })()}
              </tbody>
              </table>
            </div>

            {selectedPurchaseIndex !== null && purchases[selectedPurchaseIndex] && (
              <div style={{ ...editPanel, position: "sticky", top: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#e8e2d5" }}>Edit Purchase</h3>
                  <button onClick={() => setSelectedPurchaseIndex(null)} style={circleButton}>×</button>
                </div>

                {(() => {
                  const p = purchases[selectedPurchaseIndex];
                  const lbl = { fontSize: 10, fontWeight: 700, color: "#5d6f80", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5, display: "block" };
                  const inp = { width: "100%", background: "#0d1a2a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5", fontSize: 13, padding: "7px 10px", outline: "none", boxSizing: "border-box" };
                  const row = { display: "grid", gap: 10, marginBottom: 10 };
                  const purchaseThemes = legoThemes.length
                    ? Array.from(new Set([...legoThemes, ...purchases.map(q => q.theme).filter(Boolean)])).sort()
                    : Array.from(new Set(purchases.map(q => q.theme).filter(Boolean))).sort();
                  return (
                    <div>
                      {/* Row 1: Set # + Set Name */}
                      <div style={{ ...row, gridTemplateColumns: "110px 1fr" }}>
                        <label><span style={lbl}>Set #</span><input style={inp} value={p.setNumber || ""} onChange={e => updatePurchase(selectedPurchaseIndex, "setNumber", e.target.value)} /></label>
                        <label><span style={lbl}>Set Name</span><input style={inp} value={p.name || ""} onChange={e => updatePurchase(selectedPurchaseIndex, "name", e.target.value)} /></label>
                      </div>

                      {/* Row 2: Theme + Store */}
                      <div style={{ ...row, gridTemplateColumns: "1fr 1fr" }}>
                        <label>
                          <span style={lbl}>Theme</span>
                          <select style={inp} value={p.theme || ""} onChange={e => updatePurchase(selectedPurchaseIndex, "theme", e.target.value)}>
                            <option value="">— select —</option>
                            {purchaseThemes.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </label>
                        <label>
                          <span style={lbl}>Store</span>
                          <select style={inp} value={p.store || ""} onChange={e => updatePurchase(selectedPurchaseIndex, "store", e.target.value)}>
                            {stores.map(s => <option key={s}>{s}</option>)}
                          </select>
                        </label>
                      </div>

                      {/* Row 3: Date + Qty + Price */}
                      <div style={{ ...row, gridTemplateColumns: "1fr 70px 1fr" }}>
                        <label><span style={lbl}>Date</span><input style={inp} type="date" value={p.date || ""} onChange={e => updatePurchase(selectedPurchaseIndex, "date", e.target.value)} /></label>
                        <label><span style={lbl}>Qty</span><input style={inp} type="number" min="1" value={p.qty || 1} onChange={e => updatePurchase(selectedPurchaseIndex, "qty", e.target.value)} /></label>
                        <label><span style={lbl}>Price</span><input style={inp} type="number" step="0.01" value={p.faceValue ?? p.amount ?? ""} onChange={e => updatePurchase(selectedPurchaseIndex, "faceValue", e.target.value)} /></label>
                      </div>

                      {/* Row 4: Tax + Shipping + GC/Rewards */}
                      <div style={{ ...row, gridTemplateColumns: "1fr 1fr 1fr" }}>
                        <label><span style={lbl}>Tax / Fee</span><input style={inp} type="number" step="0.01" placeholder="0.00" value={p.tax ?? ""} onChange={e => updatePurchase(selectedPurchaseIndex, "tax", e.target.value)} /></label>
                        <label><span style={lbl}>Shipping</span><input style={inp} type="number" step="0.01" placeholder="0.00" value={p.shipping ?? ""} onChange={e => updatePurchase(selectedPurchaseIndex, "shipping", e.target.value)} /></label>
                        <label>
                          <span style={{ ...lbl, color: "#4caf7d" }}>GC / Rewards</span>
                          <input style={{ ...inp, border: p.gcApplied ? "1px solid rgba(76,175,61,0.4)" : inp.border }} type="number" step="0.01" placeholder="0.00" value={p.gcApplied ?? ""} onChange={e => updatePurchase(selectedPurchaseIndex, "gcApplied", e.target.value)} />
                        </label>
                      </div>

                      {/* Row 5: Notes */}
                      <div style={{ ...row, gridTemplateColumns: "1fr" }}>
                        <label><span style={lbl}>Notes</span><input style={inp} value={p.notes || ""} onChange={e => updatePurchase(selectedPurchaseIndex, "notes", e.target.value)} /></label>
                      </div>

                      {/* Order info (read-only) */}
                      {p.orderLabel && (
                        <div style={{ marginTop: 4 }}>
                          <span style={lbl}>Order #</span>
                          <div style={{ fontFamily: "monospace", color: "#c9a84c", fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>{p.orderLabel}</div>
                        </div>
                      )}
                      {p.orderNotes && (
                        <div style={{ marginTop: 8 }}>
                          <span style={lbl}>Order Notes</span>
                          <div style={{ color: "#8a9bb0", fontSize: 12, lineHeight: 1.4 }}>{p.orderNotes}</div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button onClick={() => setSelectedPurchaseIndex(null)}>Done</button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <PurchaseDetailPanel
        item={purchaseDetailIdx !== null ? purchases[purchaseDetailIdx] : null}
        onClose={() => setPurchaseDetailIdx(null)}
        onEdit={purchaseDetailIdx !== null ? () => { setPurchaseDetailIdx(null); setSelectedPurchaseIndex(purchaseDetailIdx); } : undefined}
      />

      {hoveredPurchase && (
        <div style={{ position: "fixed", left: tipPos.x > window.innerWidth - 280 ? tipPos.x - 256 : tipPos.x + 16, top: tipPos.y > window.innerHeight - 230 ? tipPos.y - 215 : tipPos.y - 8, zIndex: 9999, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "10px 14px", pointerEvents: "none", boxShadow: "0 8px 32px rgba(0,0,0,0.55)", minWidth: 240 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            {(hoveredPurchase.setNumber || hoveredPurchase.item) && (
              <img src={setImageUrl(hoveredPurchase.setNumber || hoveredPurchase.item)} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
                style={{ width: 72, height: 72, objectFit: "contain", borderRadius: 8, background: "#111d2e", border: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: "#e8e2d5", marginBottom: 6, fontSize: 13 }}>{hoveredPurchase.name || hoveredPurchase.setNumber || "Purchase"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: 12 }}>
                {hoveredPurchase.setNumber && <><span style={{ color: "#5d6f80" }}>Set #</span><span style={{ color: "#e8e2d5" }}>{hoveredPurchase.setNumber}</span></>}
                {hoveredPurchase.orderLabel && <><span style={{ color: "#5d6f80" }}>Order #</span><span style={{ color: "#c9a84c", fontFamily: "monospace", fontWeight: 700, fontSize: 11 }}>{hoveredPurchase.orderLabel}</span></>}
                <span style={{ color: "#5d6f80" }}>Store</span><span style={{ color: "#e8e2d5" }}>{hoveredPurchase.store || "—"}</span>
                <span style={{ color: "#5d6f80" }}>Date</span><span style={{ color: "#e8e2d5" }}>{usDate(hoveredPurchase.date) || "—"}</span>
                {hoveredPurchase.orderNotes && <><span style={{ color: "#5d6f80" }}>Order Note</span><span style={{ color: "#8a9bb0" }}>{hoveredPurchase.orderNotes}</span></>}
                {hoveredPurchase.theme && <><span style={{ color: "#5d6f80" }}>Theme</span><span style={{ color: "#e8e2d5" }}>{hoveredPurchase.theme}</span></>}
                <span style={{ color: "#5d6f80" }}>Qty</span><span style={{ color: "#e8e2d5" }}>{hoveredPurchase.qty || 1}</span>
                {(hoveredPurchase.faceValue != null || hoveredPurchase.amount != null) && (
                  <><span style={{ color: "#5d6f80" }}>Price</span>
                  <span style={{ color: "#e8e2d5" }}>{money(hoveredPurchase.faceValue ?? hoveredPurchase.amount)}</span></>
                )}
                {hoveredPurchase.tax != null && (
                  <><span style={{ color: "#5d6f80" }}>Tax / Fee</span><span style={{ color: "#e8e2d5" }}>{money(hoveredPurchase.tax)}</span></>
                )}
                {hoveredPurchase.shipping != null && (
                  <><span style={{ color: "#5d6f80" }}>Shipping</span><span style={{ color: "#e8e2d5" }}>{money(hoveredPurchase.shipping)}</span></>
                )}
                {hoveredPurchase.gcApplied != null && (
                  <><span style={{ color: "#4caf7d" }}>GC / Rewards</span><span style={{ color: "#4caf7d" }}>−{money(hoveredPurchase.gcApplied)}</span></>
                )}
                {hoveredPurchase.gcApplied != null
                  ? <><span style={{ color: "#5d6f80" }}>Paid</span><span style={{ color: "#4caf7d", fontWeight: 700 }}>{money(lineCashPaid(hoveredPurchase))}</span></>
                  : <><span style={{ color: "#5d6f80" }}>Total</span><span style={{ color: "#c9a84c", fontWeight: 700 }}>{money(lineTotal(hoveredPurchase))}</span></>
                }
                {hoveredPurchase.notes && <><span style={{ color: "#5d6f80" }}>Notes</span><span style={{ color: "#8a9bb0", fontStyle: "italic" }}>{hoveredPurchase.notes}</span></>}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#5d6f80", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>click for details</div>
        </div>
      )}
    </div>
  );
}

function InfoTip({ text, color = "#5d6f80", size = 15 }) {
  const [show, setShow] = useState(false);
  const isBright = color === "#c9a84c";
  const bg     = isBright ? "rgba(201,168,76,0.18)"  : color === "#4caf7d" ? "rgba(76,175,61,0.15)"  : "rgba(255,255,255,0.08)";
  const border = isBright ? "rgba(201,168,76,0.4)"   : color === "#4caf7d" ? "rgba(76,175,61,0.3)"   : "rgba(255,255,255,0.14)";
  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: "50%", background: bg, border: `1px solid ${border}`, color, fontSize: size * 0.6, fontWeight: 800, cursor: "default", userSelect: "none", lineHeight: 1 }}>?</span>
      {show && (
        <div style={{ position: "absolute", bottom: "calc(100% + 7px)", left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: "#0b1520", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 9, padding: "8px 11px", fontSize: 11.5, color: "#c9d6e3", width: 230, boxShadow: "0 6px 24px rgba(0,0,0,0.65)", pointerEvents: "none", lineHeight: 1.5, whiteSpace: "normal" }}>
          {text}
        </div>
      )}
    </span>
  );
}

function Metric({ title, value, sub, good }) {
  const [tip, setTip] = useState(false);
  return (
    <div style={{ ...card, marginBottom: 0, overflow: "hidden" }}>
      <div style={{ ...muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
      <div style={{ position: "relative" }} onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
        <div style={{ fontSize: 24, fontWeight: 900, color: good === true ? "#5aa832" : good === false ? "#ff8b8b" : "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "default" }}>{value}</div>
        {tip && <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, zIndex: 50, background: "#0b1520", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 8, padding: "5px 10px", fontSize: 15, fontWeight: 700, color: "#e8e2d5", whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.5)", pointerEvents: "none" }}>{value}</div>}
      </div>
      {sub && <div style={{ ...muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

const page = { background: "transparent", color: "#e8e2d5", minHeight: "100vh", padding: 22 };
const header = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 12 };
const yearBar = { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 };
const tabs = { display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" };
const tabBtn = { background: "none", border: "none", borderBottom: "2px solid transparent", color: "#5d6f80", padding: "8px 0 10px", fontWeight: 700, cursor: "pointer", fontSize: 14, lineHeight: 1 };
const activeTab = { ...tabBtn, color: "#e8e2d5", borderBottom: "2px solid #c9a84c" };
const addPurchaseBtn = { background: "none", border: "1px solid rgba(90,168,50,0.3)", borderRadius: 8, color: "#5aa832", padding: "5px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const addPurchaseBtnActive = { ...addPurchaseBtn, background: "#1a3a1a", border: "1px solid #2d5a2d" };
const yearBtn = { background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "4px 11px", fontWeight: 700, cursor: "pointer", color: "#5d6f80", fontSize: 12 };
const yearBtnActive = { ...yearBtn, background: "#c9a84c", color: "#0d1623", border: "1px solid #c9a84c" };
const metricGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14, marginBottom: 28 };
const storeGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14, marginBottom: 28 };
const overviewGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginBottom: 18 };
const card = { background: "rgba(20,31,48,0.82)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 18, marginBottom: 18, boxShadow: "0 4px 24px rgba(0,0,0,0.35)" };
const muted = { color: "#8a9bb0" };
const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" };
const barTrack = { height: 7, background: "#0b1520", borderRadius: 999, margin: "12px 0", overflow: "hidden" };
const bar = { height: "100%", background: "#5aa832", borderRadius: 999 };
const chartCard = { ...card, height: 300, display: "flex", alignItems: "end", gap: 12, overflowX: "auto" };
const chartCol = { width: 60, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "#8a9bb0", flex: "0 0 60px" };
const chartBar = { width: 42, background: "#c9a84c", borderRadius: "6px 6px 0 0" };
const logGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 10 };
const redBtn = { display: "inline-block", background: "#c9a84c", color: "#0d1623", border: "none", borderRadius: 10, padding: "10px 14px", fontWeight: 800, cursor: "pointer" };
const ghostBtn = { background: "transparent", color: "#8a9bb0", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", fontWeight: 800, cursor: "pointer" };

const th = {
  position: "sticky",
  top: 0,
  background: "#0b1520",
  color: "#8a9bb0",
  padding: 10,
  textAlign: "left",
  borderBottom: "1px solid rgba(255,255,255,0.07)",
  zIndex: 5,
  whiteSpace: "nowrap",
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: 0.5,
  textTransform: "uppercase"
};

const thButton = {
  ...th,
  cursor: "pointer",
  userSelect: "none"
};

const thRight = { ...th, textAlign: "right" };
const thRightButton = {
  ...thRight,
  cursor: "pointer",
  userSelect: "none"
};

const td = {
  padding: 10,
  borderTop: "1px solid rgba(255,255,255,0.05)",
  whiteSpace: "nowrap"
};
const tdRight = { ...td, textAlign: "right", fontWeight: 900 };

const stickyCheckbox = {
  position: "sticky",
  left: 0,
  zIndex: 6,
  background: "#0b1520"
};

const editPanel = {
  background: "rgba(15,26,40,0.9)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14,
  padding: 18
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
const notice = { background: "#332500", color: "#ffdf74", padding: 12, borderRadius: 10, marginBottom: 16 };

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
