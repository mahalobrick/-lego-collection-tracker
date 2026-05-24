import { useEffect, useMemo, useState } from "react";
import { searchInput, filterSelect, clearFilterButton } from "./uiStyles";
import { importBudgetExcel } from "./utils/importBudgetExcel";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { asNumber, money, setImageUrl } from "./utils/formatting";
import PurchaseDetailPanel from "./PurchaseDetailPanel";

const PIE_COLORS = ["#c9a84c", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#5aa832"];

const DEFAULT_annualBudget = 10320;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const DEFAULT_STORES = ["Amazon", "Best Buy", "Bricklink", "LEGO", "Target", "Walmart"];

const DEFAULT_PURCHASE_COLUMNS = [
  { key: "date", label: "Date", visible: true },
  { key: "store", label: "Store", visible: true },
  { key: "setNumber", label: "Set #", visible: true },
  { key: "name", label: "Set Name", visible: true },
  { key: "theme", label: "Theme", visible: true },
  { key: "qty", label: "Qty", visible: true },
  { key: "amount", label: "Unit Price", visible: true },
  { key: "total", label: "Total", visible: true },
  { key: "notes", label: "Notes", visible: false }
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

function lineTotal(p) {
  return asNumber(p.amount) * (asNumber(p.qty) || 1);
}

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

export default function BudgetDashboard({ pendingPurchase, onPendingPurchaseConsumed }) {
  const [tab, setTab] = useState(pendingPurchase ? "log" : "dashboard");
  const [message, setMessage] = useState("");
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
  const [draggedPurchaseColumn, setDraggedPurchaseColumn] = useState(null);
  const [showAllThemeSpend, setShowAllThemeSpend] = useState(false);
  const [hoveredPurchase, setHoveredPurchase] = useState(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const [budgetPillsCollapsed, setBudgetPillsCollapsed] = useState(false);
  const [budgetGearOpen, setBudgetGearOpen] = useState(false);
  const [hoveredBudgetItem, setHoveredBudgetItem] = useState(null);
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
    const merged = parsed.map(c => ({ ...c, label: labelMap[c.key] ?? c.label }));
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
    if (pendingPurchase) {
      return {
        lines: [{
          setNumber: pendingPurchase.setNumber || "",
          name: pendingPurchase.name || "",
          theme: pendingPurchase.theme || "",
          qty: 1,
          amount: asNumber(pendingPurchase.targetPrice) || asNumber(pendingPurchase.msrp) || "",
          store: "LEGO",
          date: new Date().toISOString().slice(0, 10),
          notes: ""
        }]
      };
    }
    return {
      lines: [{ setNumber: "", name: "", theme: "", qty: 1, amount: "", store: "LEGO", date: "", notes: "" }]
    };
  });

  const [purchases, setPurchases] = useState(() => {
    const saved = localStorage.getItem("blPurchases");
    return saved ? JSON.parse(saved) : [];
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

  const spent = yearPurchases.reduce((sum, p) => sum + lineTotal(p), 0);
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
      byStore[p.store] = (byStore[p.store] || 0) + lineTotal(p);
    });
    return Object.entries(byStore)
      .map(([store, total]) => ({ store, total }))
      .sort((a, b) => b.total - a.total);
  })();
  const maxStoreTotal = storeTotals.length > 0 ? storeTotals[0].total : 1;

  const monthlyChartData = MONTHS.map(m => ({
    month: m,
    total: yearPurchases.filter(p => String(p.month || "").startsWith(m)).reduce((s, p) => s + lineTotal(p), 0)
  }));
  const maxMonthlySpend = Math.max(...monthlyChartData.map(d => d.total), 1);

  // storeTotals is already filtered (only purchase-backed stores) and sorted desc
  const storePieData = storeTotals.map(s => ({ name: s.store, value: s.total }));

  const themeSpendData = (() => {
    const byTheme = {};
    yearPurchases.forEach(p => {
      const t = p.theme || "Unknown";
      if (!byTheme[t]) byTheme[t] = 0;
      byTheme[t] += lineTotal(p);
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
      running += lineTotal(p);
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

  const visiblePurchases = useMemo(() => {
    let rows = [...yearPurchases];

    if (filterStore) {
      rows = rows.filter(p => p.store === filterStore);
    }

    if (filterMonth) {
      rows = rows.filter(p => p.month === filterMonth);
    }

    if (searchText.trim()) {
      const q = searchText.toLowerCase();

      rows = rows.filter(p =>
        String(p.store || "").toLowerCase().includes(q) ||
        String(p.setNumber || "").toLowerCase().includes(q) ||
        String(p.name || "").toLowerCase().includes(q) ||
        String(p.theme || "").toLowerCase().includes(q) ||
        String(p.notes || "").toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => {
      let result = 0;

      if (sortColumn === "total") {
        result = lineTotal(a) - lineTotal(b);
      } else if (sortColumn === "amount" || sortColumn === "qty") {
        result = asNumber(a[sortColumn]) - asNumber(b[sortColumn]);
      } else {
        result = String(a[sortColumn] || "").localeCompare(String(b[sortColumn] || ""));
      }

      return sortDirection === "asc" ? result : -result;
    });

    return rows;
  }, [yearPurchases, filterStore, filterMonth, searchText, sortColumn, sortDirection]);

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

    setMessage("Unsupported file type. Use .xlsx, .csv, or .json.");
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
      asNumber(p.amount)
    ].join("|").toLowerCase();
  }

  function applyImportedPurchases(imported) {
    const cleaned = (imported || []).map(p => ({
      ...p,
      setNumber: p.setNumber || p.item || "",
      name: p.name || "",
      theme: p.theme || "",
        qty: asNumber(p.qty) || 1,
      amount: asNumber(p.amount),
      month: p.month || getMonthLabel(p.date || ""),
      year: p.year || Number(String(p.date || "").slice(0, 4)) || new Date().getFullYear()
    }));

    if (importMode === "replace") {
      const ok = window.confirm("Replace all current purchases with this import?");
      if (!ok) return;

      setPurchases(cleaned);
      setMessage(`Replaced purchases with ${cleaned.length} imported rows.`);
      return;
    }

    const existingKeys = new Set(purchases.map(purchaseKey));
    const newRows = cleaned.filter(p => !existingKeys.has(purchaseKey(p)));

    setPurchases(prev => [...prev, ...newRows]);

    const skipped = cleaned.length - newRows.length;
    setMessage(`Imported ${newRows.length} new purchases. Skipped ${skipped} duplicate(s).`);
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const data = await importBudgetExcel(file);
      const cleaned = (data.purchases || []).map(p => ({
        ...p,
        setNumber: p.setNumber || p.item || "",
        name: p.name || "",
        theme: p.theme || "",
        qty: asNumber(p.qty) || 1
      }));

      applyImportedPurchases(cleaned);
    } catch (err) {
      setMessage(err.message);
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
    if (column.key === "amount") return money(p.amount);
    if (column.key === "total") return money(lineTotal(p));
    if (column.key === "notes") return p.notes || "";
    return "";
  }

  function isNumericPurchaseColumn(key) {
    return ["qty", "amount", "total"].includes(key);
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

      setMessage("JSON backup imported.");
    } catch {
      setMessage("Invalid JSON backup.");
    }
  }

  async function importCSV(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();

      const rows = text
        .split(/\r?\n/)
        .filter(Boolean)
        .map(r => r.split(",").map(v => v.replace(/^"|"$/g, "").trim()));

      const headers = rows.shift();

      const purchasesImported = rows.map(row => {
        const item = {};

        headers.forEach((h, i) => {
          item[h] = row[i] || "";
        });

        return {
          date: csvDateToISO(item.date || ""),
          store: item.store || "LEGO",
          setNumber: item.setNumber || "",
          name: item.name || "",
          theme: item.theme || "",
          qty: Number(item.qty || 1),
          amount: Number(item.amount || 0),
          notes: item.notes || "",
          month: getMonthLabel(item.date || ""),
          year: Number(String(item.date || "").slice(0,4)) || new Date().getFullYear()
        };
      });

      applyImportedPurchases(purchasesImported);
    } catch {
      setMessage("Invalid CSV file.");
    }
  }

  function exportCSV() {
    const headers = [
      "date",
      "store",
      "setNumber",
      "name",
      "theme",
      "qty",
      "amount",
      "notes"
    ];

    const rows = purchases.map(p => [
      isoToCSVDate(p.date),
      p.store,
      p.setNumber || "",
      p.name || "",
      p.theme || "",
      p.qty || 1,
      p.amount || "",
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
      "date,store,setNumber,name,theme,qty,amount,notes",
      "1/15/2026,LEGO,75313,AT-AT,Star Wars,1,849.99,UCS"
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

  function addLine() {
    setForm(prev => ({
      lines: [...prev.lines, { setNumber: "", name: "", theme: "", qty: 1, amount: "", store: "LEGO", date: "", notes: "" }]
    }));
  }

  function updateLine(index, field, value) {
    setForm(prev => {
      const lines = [...prev.lines];
      lines[index] = { ...lines[index], [field]: value };
      return { lines };
    });
  }

  function removeLine(index) {
    setForm(prev => ({ lines: prev.lines.filter((_, i) => i !== index) }));
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
        lines[index] = {
          ...lines[index],
          setNumber: d.set_number || key,
          name: d.name || lines[index].name,
          theme: d.theme || lines[index].theme,
        };
        return { lines };
      });
    } catch {}
    finally { setLineLoading(prev => ({ ...prev, [index]: false })); }
  }

  function addPurchase() {
    const valid = form.lines.filter(line => line.setNumber || line.name || line.theme || line.amount || line.date || line.notes);

    if (!valid.length) {
      setMessage("Add at least one purchase item.");
      return;
    }

    if (valid.some(line => !line.date || !line.store || !line.amount)) {
      setMessage("Each item needs date, store, and amount.");
      return;
    }

    const newPurchases = valid.map(line => ({
      ...line,
      qty: asNumber(line.qty) || 1,
      amount: asNumber(line.amount),
      month: getMonthLabel(line.date),
      year: Number(line.date.slice(0, 4)) || new Date().getFullYear()
    }));

    setPurchases(prev => [...prev, ...newPurchases]);
    setForm({ lines: [{ setNumber: "", name: "", theme: "", qty: 1, amount: "", store: "LEGO", date: "", notes: "" }] });
    setMessage(`Added ${newPurchases.length} purchase item(s) totaling ${money(newPurchases.reduce((s, p) => s + lineTotal(p), 0))}.`);
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
    const manual = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");
    const beNormalized = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]");
    return [...manual, ...beNormalized].some(item =>
      collectionKey(item) === collectionKey(purchase)
    );
  }

  function updatePurchase(index, field, value) {
    setPurchases(prev => {
      const next = [...prev];

      const updated = {
        ...next[index],
        [field]: field === "qty" || field === "amount"
          ? asNumber(value)
          : value
      };

      if (field === "date") {
        updated.month = getMonthLabel(value);
        updated.year = Number(String(value).slice(0, 4)) || new Date().getFullYear();
      }

      next[index] = updated;
      return next;
    });
  }

  function addPurchaseToCollection(purchase) {
    const existing = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");

    if (isInCollection(purchase)) {
      setMessage("That purchase is already in My Collection.");
      return;
    }

    existing.push({
      setNumber: purchase.setNumber || "",
      name: purchase.name || "",
      theme: purchase.theme || "",
      qty: purchase.qty || 1,
      paidPrice: purchase.amount || 0,
      currentValue: purchase.amount || 0,
      notes: purchase.notes || "",
      sourcePurchaseKey: collectionKey(purchase)
    });

    localStorage.setItem("blOwnedSets", JSON.stringify(existing));
    setMessage(`Added ${purchase.setNumber || purchase.name || "purchase"} to My Collection.`);
  }

  function deleteCheckedPurchases() {
    if (!checkedRows.length) return;
    if (!window.confirm(`Delete ${checkedRows.length} selected purchase(s)?`)) return;
    setPurchases(prev => prev.filter((_, i) => !checkedRows.includes(i)));
    setCheckedRows([]);
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
            { key: "log",       label: "Add Purchase" }
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={tab === t.key ? activeTab : tabBtn}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={yearBar}>
        {availableYears.map(year => (
          <button key={year} onClick={() => setFilterYear(year)}
            style={{ ...tabBtn, padding: "6px 14px", fontSize: 13, ...(filterYear === year ? { background: "#c9a84c", color: "#0d1623", borderColor: "#c9a84c" } : {}) }}>
            {year}
          </button>
        ))}
        <button onClick={() => setFilterYear(null)}
          style={{ ...tabBtn, padding: "6px 14px", fontSize: 13, ...(filterYear === null ? { background: "#c9a84c", color: "#0d1623", borderColor: "#c9a84c" } : {}) }}>
          All
        </button>
      </div>

      {message && <div style={notice}>{message}</div>}

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
                      {(() => {
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
            <h3 style={{ margin: 0 }}>Add Purchase</h3>
            {form.lines.some(l => l.setNumber || l.name || l.amount || l.date || l.notes) && (
              <button
                onClick={() => setForm({ lines: [{ setNumber: "", name: "", theme: "", qty: 1, amount: "", store: "LEGO", date: "", notes: "" }] })}
                style={{ background: "transparent", color: "#5d6f80", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                Reset
              </button>
            )}
          </div>
          {form.lines.map((line, index) => (
            <div key={index} style={logGrid}>
              <div style={{ position: "relative" }}>
                <input
                  placeholder="Set Number (e.g. 75192)"
                  value={line.setNumber}
                  onChange={e => updateLine(index, "setNumber", e.target.value)}
                  onKeyDown={e => e.key === "Enter" && lookupLine(index)}
                  style={{ width: "100%", paddingRight: lineLoading[index] ? 28 : undefined }}
                />
                {lineLoading[index] && <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#5d6f80" }}>…</span>}
              </div>
              <input placeholder="Set Name" value={line.name} onChange={e => updateLine(index, "name", e.target.value)} />
              <input placeholder="Theme" value={line.theme} onChange={e => updateLine(index, "theme", e.target.value)} />
              <input placeholder="Qty" type="number" step="1" min="1" value={line.qty} onChange={e => updateLine(index, "qty", e.target.value)} />
              <input placeholder="Unit Price ($)" type="number" min="0" step="0.01" value={line.amount} onChange={e => updateLine(index, "amount", e.target.value)} />
              <select value={line.store} onChange={e => updateLine(index, "store", e.target.value)}>{stores.map(s => <option key={s}>{s}</option>)}</select>
              <input type="date" value={line.date} onChange={e => updateLine(index, "date", e.target.value)} />
              <input placeholder="Notes" value={line.notes} onChange={e => updateLine(index, "notes", e.target.value)} />
              <button onClick={() => removeLine(index)} disabled={form.lines.length === 1} style={{ background: "#3b0a0a", color: "#ff8b8b", border: "1px solid #7f1d1d", borderRadius: 8, padding: "9px 12px", cursor: form.lines.length === 1 ? "not-allowed" : "pointer", fontWeight: 700, opacity: form.lines.length === 1 ? 0.35 : 1 }}>×</button>
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
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>

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
            </div>
          </div>

          {checkedRows.length > 0 && (
            <button onClick={deleteCheckedPurchases} style={{ background: "#7f1d1d", color: "white", border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontWeight: 800 }}>
              Delete Selected ({checkedRows.length})
            </button>
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
                {visiblePurchases.map(p => {
                  const i = purchases.indexOf(p);
                  return (
                    <tr
                      key={i}
                      onClick={() => setPurchaseDetailIdx(i)}
                      onDoubleClick={() => { setPurchaseDetailIdx(null); setSelectedPurchaseIndex(i); }}
                      onMouseEnter={e => {
                        if (selectedPurchaseIndex !== i) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                        setHoveredPurchase(p);
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = selectedPurchaseIndex === i ? "#332500" : "transparent";
                        setHoveredPurchase(null);
                      }}
                      style={{
                        cursor: "pointer",
                        background: selectedPurchaseIndex === i ? "#332500" : "transparent",
                        transition: "background 0.12s ease"
                      }}
                    >
                      <td style={{ ...td, ...stickyCheckbox, width: 44, minWidth: 44 }}><input type="checkbox" checked={checkedRows.includes(i)} onChange={() => toggleCheck(i)} /></td>
                      {purchaseColumns.filter(col => col.visible).map(col => (
                        <td
                          key={col.key}
                          style={isNumericPurchaseColumn(col.key) ? tdRight : td}
                        >
                          {renderPurchaseCell(p, col)}
                        </td>
                      ))}
                      <td style={td}>
                        <button
                          onClick={() => addPurchaseToCollection(p)}
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
                })}
              </tbody>
              </table>
            </div>

            {selectedPurchaseIndex !== null && purchases[selectedPurchaseIndex] && (
              <div style={{ ...editPanel, position: "sticky", top: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>Edit Purchase</h3>
                  <button onClick={() => setSelectedPurchaseIndex(null)} style={circleButton}>×</button>
                </div>

                <div style={editGrid}>
                  <label>
                    Set Number
                    <input
                      value={purchases[selectedPurchaseIndex].setNumber || ""}
                      onChange={e => updatePurchase(selectedPurchaseIndex, "setNumber", e.target.value)}
                    />
                  </label>

                  <label>
                    Set Name
                    <input
                      value={purchases[selectedPurchaseIndex].name || ""}
                      onChange={e => updatePurchase(selectedPurchaseIndex, "name", e.target.value)}
                    />
                  </label>

                  <label>
                    Theme
                    <input
                      value={purchases[selectedPurchaseIndex].theme || ""}
                      onChange={e => updatePurchase(selectedPurchaseIndex, "theme", e.target.value)}
                    />
                  </label>

                  <label>
                    Qty
                    <input
                      type="number"
                      min="1"
                      value={purchases[selectedPurchaseIndex].qty || 1}
                      onChange={e => updatePurchase(selectedPurchaseIndex, "qty", e.target.value)}
                    />
                  </label>

                  <label>
                    Unit Price
                    <input
                      type="number"
                      step="0.01"
                      value={purchases[selectedPurchaseIndex].amount || ""}
                      onChange={e => updatePurchase(selectedPurchaseIndex, "amount", e.target.value)}
                    />
                  </label>

                  <label>
                    Store
                    <select
                      value={purchases[selectedPurchaseIndex].store || ""}
                      onChange={e => updatePurchase(selectedPurchaseIndex, "store", e.target.value)}
                    >
                      {stores.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </label>

                  <label>
                    Date
                    <input
                      type="date"
                      value={purchases[selectedPurchaseIndex].date || ""}
                      onChange={e => updatePurchase(selectedPurchaseIndex, "date", e.target.value)}
                    />
                  </label>

                  <label>
                    Notes
                    <input
                      value={purchases[selectedPurchaseIndex].notes || ""}
                      onChange={e => updatePurchase(selectedPurchaseIndex, "notes", e.target.value)}
                    />
                  </label>
                </div>

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
            {hoveredPurchase.setNumber && (
              <img src={setImageUrl(hoveredPurchase.setNumber)} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
                style={{ width: 72, height: 72, objectFit: "contain", borderRadius: 8, background: "#111d2e", border: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: "#e8e2d5", marginBottom: 6, fontSize: 13 }}>{hoveredPurchase.name || hoveredPurchase.setNumber || "Purchase"}</div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: 12 }}>
                {hoveredPurchase.setNumber && <><span style={{ color: "#5d6f80" }}>Set #</span><span style={{ color: "#e8e2d5" }}>{hoveredPurchase.setNumber}</span></>}
                <span style={{ color: "#5d6f80" }}>Store</span><span style={{ color: "#e8e2d5" }}>{hoveredPurchase.store || "—"}</span>
                <span style={{ color: "#5d6f80" }}>Date</span><span style={{ color: "#e8e2d5" }}>{usDate(hoveredPurchase.date) || "—"}</span>
                {hoveredPurchase.theme && <><span style={{ color: "#5d6f80" }}>Theme</span><span style={{ color: "#e8e2d5" }}>{hoveredPurchase.theme}</span></>}
                <span style={{ color: "#5d6f80" }}>Qty</span><span style={{ color: "#e8e2d5" }}>{hoveredPurchase.qty || 1}</span>
                <span style={{ color: "#5d6f80" }}>Unit</span><span style={{ color: "#e8e2d5" }}>{money(hoveredPurchase.amount)}</span>
                <span style={{ color: "#5d6f80" }}>Total</span><span style={{ color: "#c9a84c", fontWeight: 700 }}>{money(lineTotal(hoveredPurchase))}</span>
                {hoveredPurchase.notes && <><span style={{ color: "#5d6f80" }}>Notes</span><span style={{ color: "#8a9bb0", fontStyle: "italic" }}>{hoveredPurchase.notes}</span></>}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#5d6f80", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>click for details · double-click to edit</div>
        </div>
      )}
    </div>
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
const tabs = { display: "flex", gap: 8, flexWrap: "wrap" };
const tabBtn = { background: "transparent", color: "#8a9bb0", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "12px 20px", fontWeight: 800, cursor: "pointer" };
const activeTab = { ...tabBtn, background: "#c9a84c", color: "#0d1623", borderColor: "#c9a84c" };
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
const logGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 10 };
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
