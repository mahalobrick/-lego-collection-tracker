import { useEffect, useState } from "react";
import { importBudgetExcel, parseExcelFirstSheet } from "./utils/importBudgetExcel";
import { asNumber } from "./utils/formatting";
import { exportFullBackup as runExportBackup } from "./utils/exportBackup";
import { getBrickLinkAccessToken, hasBrickLinkAuth } from "./utils/bricklink-client";

const DEFAULT_STORES = ["Amazon", "Best Buy", "Bricklink", "LEGO", "Target", "Walmart"];
const DEFAULT_ANNUAL_BUDGET = 10320;

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

const DEFAULT_OWNED_COLUMNS = [
  { key: "setNumber", label: "Set #", visible: true },
  { key: "name", label: "Set Name", visible: true },
  { key: "theme", label: "Theme", visible: true },
  { key: "condition", label: "Condition", visible: true },
  { key: "qty", label: "Qty", visible: true },
  { key: "paid", label: "Paid", visible: true },
  { key: "value", label: "Value", visible: true },
  { key: "gain", label: "Gain/Loss", visible: true },
  { key: "roi", label: "ROI %", visible: true },
  { key: "notes", label: "Notes", visible: true }
];

const DEFAULT_ACQUISITION_COLUMNS = [
  { key: "score", label: "Score", visible: true },
  { key: "recommendation", label: "Recommendation", visible: true },
  { key: "priority", label: "Priority", visible: true },
  { key: "status", label: "Status", visible: true },
  { key: "retiringSoon", label: "Retiring", visible: true },
  { key: "setNumber", label: "Set #", visible: true },
  { key: "name", label: "Name", visible: true },
  { key: "theme", label: "Theme", visible: true },
  { key: "pieces", label: "Pieces", visible: false },
  { key: "currentValue", label: "Mkt Value", visible: false },
  { key: "retirementYear", label: "Projected", visible: true },
  { key: "retirementConfidence", label: "Confidence", visible: true },
  { key: "retirementSource", label: "Source", visible: true },
  { key: "lastRetirementUpdate", label: "Updated", visible: true },
  { key: "msrp", label: "MSRP", visible: true },
  { key: "targetPrice", label: "Target", visible: true },
  { key: "discount", label: "Discount", visible: true },
  { key: "notes", label: "Notes", visible: true }
];


// ── Portfolio history snapshot (call after any sync / import) ────────────
function recordPortfolioSnapshot(totalValue, totalPaid) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const history = JSON.parse(localStorage.getItem("blPortfolioHistory") || "[]");
    const filtered = history.filter(h => h.date !== today);
    filtered.push({ date: today, value: Number(totalValue) || 0, paid: Number(totalPaid) || 0 });
    localStorage.setItem("blPortfolioHistory", JSON.stringify(
      filtered.sort((a, b) => a.date.localeCompare(b.date)).slice(-365)
    ));
  } catch {}
}

// ── BrickEconomy CSV export parser ───────────────────────────────────────
// Handles the CSV format exported from brickeconomy.com/user/collection
function parseBECollectionCSV(text) {
  const splitCSVRow = row => {
    const out = []; let cur = ""; let inQ = false;
    for (const ch of row) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    out.push(cur.trim());
    return out;
  };
  const rows = text.split(/\r?\n/).filter(Boolean).map(splitCSVRow);
  const headers = rows.shift();
  const setNumIdx = headers.findIndex(h => /number|set.?num/i.test(h));
  if (setNumIdx < 0) return null; // unrecognised format

  return rows.filter(r => r.length > 1 && r[setNumIdx]).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ""; });
    const stripMoney = v => Number(String(v || "0").replace(/[^0-9.]/g, "")) || 0;
    return {
      set_number: obj.Number || obj["Set Number"] || obj.number || "",
      name:        obj.Name   || obj.name   || "",
      theme:       obj.Theme  || obj.theme  || "",
      condition:   (obj.Condition || obj.condition || "new").toLowerCase().replace(/\s+/g, "_"),
      paid_price:  stripMoney(obj.Paid  || obj.paid  || obj.paid_price),
      current_value: stripMoney(obj.Value || obj.value || obj.current_value),
      retired:     /yes|true|1/i.test(obj.Retired || obj.retired || ""),
    };
  }).filter(r => r.set_number);
}

// ── Brickset "My Sets" CSV parser ────────────────────────────────────────
function parseBricksetMySetCSV(text) {
  const splitCSVRow = row => {
    const out = []; let cur = ""; let inQ = false;
    for (const ch of row) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    out.push(cur.trim());
    return out;
  };
  const rows = text.split(/\r?\n/).filter(Boolean).map(splitCSVRow);
  const headers = rows.shift();

  return rows.filter(r => r.length > 1).flatMap(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ""; });
    const setNumber = (obj["Set number"] || obj.SetNumber || obj.set_number || obj.Number || "").replace(/-1$/, "");
    if (!setNumber) return [];
    const qty = Number(obj.QtyOwned || obj["Qty owned"] || obj.quantity || 1) || 1;
    const rrp = Number(String(obj.RRP || obj.rrp || "0").replace(/[^0-9.]/g, "")) || 0;
    return [{
      setNumber,
      name:  obj.Name || obj.name || "",
      theme: obj.Theme || obj.theme || "",
      qty,
      paidPrice: 0,
      currentValue: rrp,
      source: "Brickset"
    }];
  });
}

function normalizeBrickEconomyCollection(collection) {
  const bySet = {};

  collection.forEach(item => {
    const setNumber = item.set_number || item.Number || item.number;
    if (!setNumber) return;

    if (!bySet[setNumber]) {
      bySet[setNumber] = {
        setNumber,
        name: item.name || item.Name || "",
        theme: item.theme || item.Theme || "",
        quantity: 0,
        totalPaid: 0,
        totalValue: 0,
        retired: !!item.retired,
        entries: []
      };
    }

    const paid = Number(item.paid_price ?? item.Paid ?? item.paid ?? 0) || 0;
    const value = Number(item.current_value ?? item.Value ?? item.value ?? 0) || 0;

    bySet[setNumber].quantity += 1;
    bySet[setNumber].totalPaid += paid;
    bySet[setNumber].totalValue += value;
    bySet[setNumber].entries.push(item);
  });

  const normalized = Object.values(bySet).map(item => ({
    ...item,
    averagePaid: item.quantity ? item.totalPaid / item.quantity : 0,
    unrealizedGain: item.totalValue - item.totalPaid,
    roiPct: item.totalPaid ? ((item.totalValue - item.totalPaid) / item.totalPaid) * 100 : null
  }));

  return normalized;
}


function getMonthLabel(date) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const d = new Date(date + "T00:00:00");
  if (isNaN(d)) return "";
  return months[d.getMonth()] + " " + d.getFullYear();
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

export default function AppSettings() {
  const [message, setMessage] = useState("");
  const [collectionSyncing, setCollectionSyncing] = useState(false);
  const [collectionSyncInfo, setCollectionSyncInfo] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("brickEconomyCollectionSyncInfo") || "{}");
    } catch {
      return {};
    }
  });
  const [openColumnSections, setOpenColumnSections] = useState({});

  const [settingsTab, setSettingsTab] = useState("general");

  // ── BrickLink auth state ─────────────────────────────────────
  const [blAccessTokenInput, setBlAccessTokenInput] = useState("");
  const [blConnected, setBlConnected] = useState(() => hasBrickLinkAuth());
  const [newStore, setNewStore] = useState("");

  const [autoExportDays, setAutoExportDays] = useState(() =>
    Number(localStorage.getItem("blAutoExportDays") || "0")
  );
  const [lastExportAt, setLastExportAt] = useState(
    () => localStorage.getItem("blLastAutoExport") || ""
  );

  const [importMode, setImportMode] = useState("add");

  const [displayCurrency, setDisplayCurrency] = useState(() =>
    localStorage.getItem("blDisplayCurrency") || "USD"
  );

  const [annualBudget, setAnnualBudget] = useState(() => {
    return Number(localStorage.getItem("blAnnualBudget")) || DEFAULT_ANNUAL_BUDGET;
  });

  const [stores, setStores] = useState(() => {
    const saved = localStorage.getItem("blStores");
    return saved ? JSON.parse(saved) : DEFAULT_STORES;
  });

  const [purchaseColumns, setPurchaseColumns] = useState(() => {
    const saved = localStorage.getItem("blPurchaseColumns");
    return saved ? JSON.parse(saved) : DEFAULT_PURCHASE_COLUMNS;
  });

  const [ownedColumns, setOwnedColumns] = useState(() => {
    const saved = localStorage.getItem("blOwnedColumns");
    return saved ? JSON.parse(saved) : DEFAULT_OWNED_COLUMNS;
  });

  const [acquisitionColumns, setAcquisitionColumns] = useState(() => {
    const saved = localStorage.getItem("blAcquisitionColumns");
    return saved ? JSON.parse(saved) : DEFAULT_ACQUISITION_COLUMNS;
  });

  useEffect(() => localStorage.setItem("blAutoExportDays", String(autoExportDays)), [autoExportDays]);
  useEffect(() => localStorage.setItem("blAnnualBudget", annualBudget), [annualBudget]);
  useEffect(() => localStorage.setItem("blStores", JSON.stringify(stores)), [stores]);
  useEffect(() => localStorage.setItem("blPurchaseColumns", JSON.stringify(purchaseColumns)), [purchaseColumns]);
  useEffect(() => localStorage.setItem("blOwnedColumns", JSON.stringify(ownedColumns)), [ownedColumns]);
  useEffect(() => localStorage.setItem("blAcquisitionColumns", JSON.stringify(acquisitionColumns)), [acquisitionColumns]);

  function getPurchases() {
    return JSON.parse(localStorage.getItem("blPurchases") || "[]");
  }

  function setPurchases(rows) {
    localStorage.setItem("blPurchases", JSON.stringify(rows));
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

    const existing = getPurchases();
    const existingKeys = new Set(existing.map(purchaseKey));
    const newRows = cleaned.filter(p => !existingKeys.has(purchaseKey(p)));
    setPurchases([...existing, ...newRows]);

    setMessage(`Imported ${newRows.length} new purchases. Skipped ${cleaned.length - newRows.length} duplicate(s).`);
  }

  async function importAnyFile(file) {
    if (!file) return;

    const name = file.name.toLowerCase();
    const fakeEvent = { target: { files: [file] } };

    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return handleExcelImport(fakeEvent);
    if (name.endsWith(".csv")) return importCSV(fakeEvent);
    if (name.endsWith(".json")) return importJSON(fakeEvent);

    setMessage("Unsupported file type. Use Excel, CSV, or JSON.");
  }

  async function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    await importAnyFile(file);
  }

  async function handleExcelImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const data = await importBudgetExcel(file);
    applyImportedPurchases(data.purchases || []);
  }

  async function importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const data = JSON.parse(await file.text());
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
      const rows = text.split(/\r?\n/).filter(Boolean).map(r => r.split(",").map(v => v.replace(/^"|"$/g, "").trim()));
      const headers = rows.shift();

      const purchases = rows.map(row => {
        const item = {};
        headers.forEach((h, i) => item[h] = row[i] || "");

        return {
          date: csvDateToISO(item.date || ""),
          store: item.store || "LEGO",
          setNumber: item.setNumber || "",
          name: item.name || "",
          theme: item.theme || "",
          qty: Number(item.qty || 1),
          amount: Number(item.amount || 0),
          notes: item.notes || "",
          month: getMonthLabel(csvDateToISO(item.date || "")),
          year: Number(String(csvDateToISO(item.date || "")).slice(0,4)) || new Date().getFullYear()
        };
      });

      applyImportedPurchases(purchases);
    } catch {
      setMessage("Invalid CSV file.");
    }
  }

  function exportJSON() {
    const data = {
      purchases: getPurchases(),
      stores,
      annualBudget,
      exportedAt: new Date().toISOString()
    };

    downloadFile("brickledger-budget-backup.json", JSON.stringify(data, null, 2), "application/json");
  }

  function exportCSV() {
    const headers = ["date", "store", "setNumber", "name", "theme", "qty", "amount", "notes"];
    const rows = getPurchases().map(p => [
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
      ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    downloadFile("brickledger-purchases.csv", csv, "text/csv");
  }

  function downloadCSVTemplate() {
    const csv = [
      "date,store,setNumber,name,theme,qty,amount,notes",
      "1/15/2026,LEGO,75313,AT-AT,Star Wars,1,849.99,UCS"
    ].join("\n");

    downloadFile("brickledger-purchases-template.csv", csv, "text/csv");
  }

  function downloadCollectionTemplate() {
    const csv = [
      "setNumber,name,theme,qty,paidPrice,currentValue,notes",
      "75313,AT-AT,Star Wars,1,679.99,950.00,UCS display"
    ].join("\n");
    downloadFile("brickledger-collection-template.csv", csv, "text/csv");
  }

  function downloadWatchListTemplate() {
    const csv = [
      WATCH_CSV_HEADERS.join(","),
      "10307,Eiffel Tower,Icons,629.99,550.00,High,2026,true,Anniversary gift"
    ].join("\n");
    downloadFile("brickledger-watchlist-template.csv", csv, "text/csv");
  }

  // ── Full App Backup ──────────────────────────────────────────
  async function exportFullBackup() {
    const date = await runExportBackup();
    if (date) {
      setLastExportAt(new Date().toISOString());
      setMessage("Backup downloaded.");
    }
  }

  async function importFullBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    try {
      const data = JSON.parse(await file.text());
      const ok = window.confirm(
        "Restore full backup? This will replace ALL data — collection, wanted list, budget, and settings. Cannot be undone."
      );
      if (!ok) return;
      if (Array.isArray(data.ownedSets)) localStorage.setItem("blOwnedSets", JSON.stringify(data.ownedSets));
      if (Array.isArray(data.brickEconomyNormalized)) localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(data.brickEconomyNormalized));
      if (data.brickEconomySetCache && typeof data.brickEconomySetCache === "object") localStorage.setItem("brickEconomySetCache", JSON.stringify(data.brickEconomySetCache));
      if (Array.isArray(data.wantedList)) localStorage.setItem("blWantedList", JSON.stringify(data.wantedList));
      if (Array.isArray(data.budgetPurchases)) localStorage.setItem("blPurchases", JSON.stringify(data.budgetPurchases));
      if (Array.isArray(data.stores)) localStorage.setItem("blStores", JSON.stringify(data.stores));
      if (data.storeBudgets && typeof data.storeBudgets === "object") localStorage.setItem("blStoreBudgets", JSON.stringify(data.storeBudgets));
      if (data.annualBudget) localStorage.setItem("blAnnualBudget", data.annualBudget);
      if (data.settings) {
        if (data.settings.ownedColumns) localStorage.setItem("blOwnedColumns", JSON.stringify(data.settings.ownedColumns));
        if (data.settings.acquisitionColumns) localStorage.setItem("blAcquisitionColumns", JSON.stringify(data.settings.acquisitionColumns));
        if (data.settings.purchaseColumns) localStorage.setItem("blPurchaseColumns", JSON.stringify(data.settings.purchaseColumns));
      }
      setMessage("Backup restored. Reloading…");
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setMessage("Could not read backup file — make sure it's a valid BrickLedger JSON backup.");
    }
  }

  // ── My Collection ────────────────────────────────────────────
  function collectionSetsForExport() {
    const beItems = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]");
    const manualItems = JSON.parse(localStorage.getItem("blOwnedSets") || "[]")
      .filter(m => m.source !== "BrickEconomy");
    if (beItems.length === 0) return manualItems;
    const beSetNumbers = new Set(beItems.map(s => String(s.setNumber || "").replace(/-1$/, "")));
    const extraManual = manualItems.filter(m =>
      !beSetNumbers.has(String(m.setNumber || "").replace(/-1$/, ""))
    );
    return [...beItems, ...extraManual];
  }

  function rowsToCollectionSets(rows) {
    return rows.map(item => ({
      setNumber: item.setNumber || item["Set #"] || item["set_number"] || "",
      name: item.name || item.Name || "",
      theme: item.theme || item.Theme || "",
      qty: Number(item.qty || item.Qty || item.quantity || 1),
      paidPrice: Number(item.paidPrice || item["Paid"] || item.paid_price || 0),
      currentValue: Number(item.currentValue || item["Value"] || item.current_value || 0),
      notes: item.notes || item.Notes || ""
    })).filter(s => s.setNumber);
  }

  function exportCollectionCSV() {
    const sets = collectionSetsForExport();
    const headers = ["setNumber", "name", "theme", "qty", "paidPrice", "currentValue", "notes"];
    const rows = sets.map(s => [s.setNumber || "", s.name || "", s.theme || "", s.quantity || s.qty || 1, s.averagePaid ?? s.paidPrice ?? "", s.totalValue ?? s.currentValue ?? "", s.notes || ""]);
    const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    downloadFile("brickledger-collection.csv", csv, "text/csv");
  }

  function exportCollectionJSON() {
    downloadFile("brickledger-collection.json", JSON.stringify(collectionSetsForExport(), null, 2), "application/json");
  }

  async function applyCollectionImport(sets) {
    const ok = window.confirm(`Import ${sets.length} sets into My Collection? Existing manual entries will be replaced.`);
    if (!ok) return;
    localStorage.setItem("blOwnedSets", JSON.stringify(sets));
    setMessage(`Imported ${sets.length} sets. Refresh to see changes.`);
  }

  async function importCollectionCSV(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try {
      const text = await file.text();
      const rows = text.split(/\r?\n/).filter(Boolean).map(r => r.split(",").map(v => v.replace(/^"|"$/g, "").trim()));
      const headers = rows.shift();
      const objs = rows.map(row => { const o = {}; headers.forEach((h, i) => { o[h] = row[i] || ""; }); return o; });
      await applyCollectionImport(rowsToCollectionSets(objs));
    } catch { setMessage("Invalid collection CSV."); }
  }

  async function importCollectionJSON(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error();
      await applyCollectionImport(rowsToCollectionSets(data));
    } catch { setMessage("Invalid collection JSON — expected an array of sets."); }
  }

  async function importCollectionExcel(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try {
      const rows = await parseExcelFirstSheet(file);
      await applyCollectionImport(rowsToCollectionSets(rows));
    } catch (err) { setMessage(err.message || "Could not read Excel file."); }
  }

  // ── BrickEconomy CSV export import ───────────────────────────────────────
  async function importBrickEconomyExportCSV(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try {
      const text = await file.text();
      const items = parseBECollectionCSV(text);
      if (!items) { setMessage("Unrecognised format — use the CSV export from brickeconomy.com/user/collection."); return; }
      if (items.length === 0) { setMessage("No sets found in this CSV."); return; }
      const ok = window.confirm(`Import ${items.length} entries from BrickEconomy CSV? Replaces existing BrickEconomy data.`);
      if (!ok) return;
      const normalized = normalizeBrickEconomyCollection(items);
      const totalPaid  = normalized.reduce((s, i) => s + i.totalPaid,  0);
      const totalValue = normalized.reduce((s, i) => s + i.totalValue, 0);
      recordPortfolioSnapshot(totalValue, totalPaid);
      const syncInfo = {
        lastSync: new Date().toISOString(),
        setsCount: items.length,
        uniqueSets: normalized.length,
        duplicateGroups: normalized.filter(i => i.quantity > 1).length,
        totalPaid, portfolioValue: totalValue,
        unrealizedGain: totalValue - totalPaid,
        valueSource: "BrickEconomy CSV export",
        costBasisSource: "BrickEconomy CSV export",
        inventorySource: "BrickEconomy CSV import"
      };
      localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(normalized));
      localStorage.setItem("brickEconomyCollectionSyncInfo", JSON.stringify(syncInfo));
      setCollectionSyncInfo(syncInfo);
      setMessage(`Imported ${normalized.length} unique sets (${items.length} entries) from BrickEconomy CSV. Refresh My Collection to see changes.`);
    } catch (err) { setMessage("Could not parse BrickEconomy CSV: " + (err.message || err)); }
  }

  // ── Brickset "My Sets" CSV import ────────────────────────────────────────
  async function importBricksetMySetCSV(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try {
      const text = await file.text();
      const items = parseBricksetMySetCSV(text);
      if (items.length === 0) { setMessage("No sets found — make sure this is a Brickset 'My Sets' CSV export."); return; }
      const ok = window.confirm(`Import ${items.length} sets from Brickset? They'll be added as manual items with $0 paid price (update later).`);
      if (!ok) return;
      const existing = JSON.parse(localStorage.getItem("blOwnedSets") || "[]").filter(s => s.source !== "Brickset");
      localStorage.setItem("blOwnedSets", JSON.stringify([...existing, ...items]));
      setMessage(`Imported ${items.length} sets from Brickset. Open My Collection → Collection to review.`);
    } catch (err) { setMessage("Could not parse Brickset CSV: " + (err.message || err)); }
  }

  // ── Enriched collection export ───────────────────────────────────────────
  function exportEnrichedCSV() {
    const sets = collectionSetsForExport();
    const bsCache = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}");
    const beCache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");

    const headers = ["setNumber","name","theme","qty","avgPaid","avgValue","totalPaid","totalValue","gain","roi","condition","retired","exitDate","pieces","subtheme","minifigs","rating","forecast2yr","forecast5yr"];
    const rows = sets.map(s => {
      const clean = String(s.setNumber || "").replace(/-1$/, "");
      const bs = (bsCache[clean] || bsCache[`${clean}-1`] || {}).data || {};
      const be = (beCache[clean] || beCache[`${clean}-1`] || {}).data || {};
      const qty   = Number(s.quantity || s.qty || 1);
      const paid  = Number(s.totalPaid)  || (asNumber(s.paidPrice)   * qty);
      const value = Number(s.totalValue) || (asNumber(s.currentValue) * qty);
      const gain  = value - paid;
      const roi   = paid > 0 ? ((gain / paid) * 100).toFixed(1) : "";
      return [
        s.setNumber || "", s.name || "", s.theme || "", qty,
        (paid  / qty).toFixed(2), (value / qty).toFixed(2),
        paid.toFixed(2), value.toFixed(2), gain.toFixed(2), roi,
        s.condition || "", s.retired ? "Yes" : "No",
        bs.exit_date || "",
        be.pieces_count || bs.pieces || "",
        bs.subtheme || "",
        bs.minifigs != null ? bs.minifigs : "",
        bs.rating || "",
        be.forecast_value_new_2_years || "",
        be.forecast_value_new_5_years || ""
      ];
    });
    const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    downloadFile("brickledger-collection-enriched.csv", csv, "text/csv");
  }

  async function handleDropCollection(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return importCollectionExcel({ target: { files: [file] } });
    if (name.endsWith(".csv")) return importCollectionCSV({ target: { files: [file] } });
    if (name.endsWith(".json")) return importCollectionJSON({ target: { files: [file] } });
    setMessage("Drop an Excel, CSV, or JSON file for My Collection.");
  }

  // ── Watch List ───────────────────────────────────────────────
  const WATCH_CSV_HEADERS = ["setNumber", "name", "theme", "msrp", "targetPrice", "priority", "retirementYear", "retiringSoon", "notes"];

  function exportWantedListJSON() {
    downloadFile("brickledger-watchlist.json", JSON.stringify(JSON.parse(localStorage.getItem("blWantedList") || "[]"), null, 2), "application/json");
  }

  function exportWantedListCSV() {
    const list = JSON.parse(localStorage.getItem("blWantedList") || "[]");
    const rows = list.map(item => WATCH_CSV_HEADERS.map(h => item[h] ?? ""));
    const csv = [WATCH_CSV_HEADERS.join(","), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    downloadFile("brickledger-watchlist.csv", csv, "text/csv");
  }

  async function applyWatchListImport(data) {
    if (!Array.isArray(data)) throw new Error("Expected an array");
    const ok = window.confirm(`Import ${data.length} watch list items? Current list will be replaced.`);
    if (!ok) return;
    localStorage.setItem("blWantedList", JSON.stringify(data));
    setMessage(`Watch list restored with ${data.length} items. Refresh to see changes.`);
  }

  async function importWantedListJSON(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try { await applyWatchListImport(JSON.parse(await file.text())); }
    catch { setMessage("Invalid watch list JSON — expected an array."); }
  }

  async function importWantedListCSV(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try {
      const text = await file.text();
      const rows = text.split(/\r?\n/).filter(Boolean).map(r => r.split(",").map(v => v.replace(/^"|"$/g, "").trim()));
      const headers = rows.shift();
      const items = rows.map(row => { const o = {}; headers.forEach((h, i) => { o[h] = row[i] || ""; }); return o; }).filter(o => o.setNumber);
      await applyWatchListImport(items);
    } catch { setMessage("Invalid watch list CSV."); }
  }

  async function handleDropWatchList(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv")) return importWantedListCSV({ target: { files: [file] } });
    if (name.endsWith(".json")) return importWantedListJSON({ target: { files: [file] } });
    setMessage("Drop a CSV or JSON file for Watch List.");
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function addStore() {
    const trimmed = newStore.trim();
    if (!trimmed || stores.includes(trimmed)) return;
    setStores(prev => [...prev, trimmed].sort());
    setNewStore("");
  }

  function deleteStore(store) {
    const used = getPurchases().some(p => p.store === store);
    if (used && !window.confirm(`${store} is used in purchases. Delete anyway?`)) return;
    setStores(prev => prev.filter(s => s !== store));
  }

  function toggleColumn(type, key) {
    const setter =
      type === "purchase"
        ? setPurchaseColumns
        : type === "owned"
          ? setOwnedColumns
          : setAcquisitionColumns;
    setter(prev => prev.map(col => col.key === key ? { ...col, visible: !col.visible } : col));
  }

  function resetColumns(type) {
    if (type === "purchase") setPurchaseColumns(DEFAULT_PURCHASE_COLUMNS);
    if (type === "owned") setOwnedColumns(DEFAULT_OWNED_COLUMNS);
    if (type === "acquisition") setAcquisitionColumns(DEFAULT_ACQUISITION_COLUMNS);
  }

  async function syncBrickEconomyCollection() {
    setCollectionSyncing(true);
    setMessage("");

    try {
      const res = await fetch("/api/brickeconomy-collection");
      const text = await res.text();

      if (!text) {
        setMessage(`API returned an empty response (HTTP ${res.status}). Make sure the app is running via: npm run dev`);
        return;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        setMessage(`API returned unexpected content (HTTP ${res.status}): ${text.slice(0, 120)}`);
        return;
      }

      if (!res.ok || data.error) {
        setMessage(data.message || data.error || "Collection sync failed.");
        return;
      }

      const collection = data.data?.sets || data.sets || data.data || [];
      const periods = data.data?.periods || data.periods || [];

      const normalizedCollection = Array.isArray(collection)
        ? normalizeBrickEconomyCollection(collection)
        : [];

      const totalPaid = normalizedCollection.reduce((sum, item) => sum + item.totalPaid, 0);
      const totalValue = normalizedCollection.reduce((sum, item) => sum + item.totalValue, 0);
      const duplicateGroups = normalizedCollection.filter(item => item.quantity > 1).length;

      const syncInfo = {
        lastSync: new Date().toISOString(),
        setsCount: Array.isArray(collection) ? collection.length : 0,
        uniqueSets: normalizedCollection.length,
        duplicateGroups,
        totalPaid,
        portfolioValue: periods?.[0]?.value || totalValue,
        unrealizedGain: totalValue - totalPaid,
        valueSource: "BrickEconomy current_value",
        costBasisSource: "BrickEconomy paid_price",
        inventorySource: "BrickEconomy collection sync",
        currency: data.data?.currency || data.currency || "USD"
      };

      localStorage.setItem("brickEconomyCollectionCache", JSON.stringify({
        fetchedAt: syncInfo.lastSync,
        data
      }));

      localStorage.setItem("brickEconomyOwnedSets", JSON.stringify(collection));
      localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(normalizedCollection));
      localStorage.setItem("brickEconomyCollectionSyncInfo", JSON.stringify(syncInfo));

      recordPortfolioSnapshot(syncInfo.portfolioValue, syncInfo.totalPaid);
      setCollectionSyncInfo(syncInfo);
      setMessage(`BrickEconomy collection synced: ${syncInfo.setsCount} sets.`);
    } catch (err) {
      setMessage(err.message || "Could not sync BrickEconomy collection.");
    } finally {
      setCollectionSyncing(false);
    }
  }

  function clearApiCache() {
    localStorage.removeItem("brickEconomySetCache");
    localStorage.removeItem("brickEconomyCollectionCache");
    setMessage("BrickEconomy API cache cleared.");
  }

  // ── BrickLink auth handlers ──────────────────────────────────
  function saveBrickLinkToken() {
    const trimmed = blAccessTokenInput.trim();
    if (!trimmed) return;
    localStorage.setItem("blBrickLinkAccessToken", trimmed);
    setBlConnected(true);
    setBlAccessTokenInput("");
    setMessage("BrickLink access token saved.");
  }

  function disconnectBrickLink() {
    localStorage.removeItem("blBrickLinkAccessToken");
    localStorage.removeItem("blSessionToken");
    localStorage.removeItem("blPriceGuideCache");
    setBlConnected(false);
    setMessage("BrickLink disconnected and session cache cleared.");
  }

  return (
    <div style={page}>
      <div style={stTabHeader}>
        <div>
          <h2 style={{ margin: 0 }}>Settings</h2>
          <p style={{ ...muted, margin: "4px 0 0" }}>App-wide configuration, data, and columns.</p>
        </div>
        <div style={stTabBar}>
          {[
            { key: "general", label: "General" },
            { key: "data", label: "Data" },
            { key: "columns", label: "Columns" }
          ].map(t => (
            <button key={t.key} onClick={() => setSettingsTab(t.key)} style={settingsTab === t.key ? stActiveTab : stTabBtn}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {message && <div style={notice}>{message}</div>}

      {settingsTab === "general" && (
      <section style={panel}>
        <h3 style={{ margin: "0 0 4px" }}>Display Currency</h3>
        <p style={{ ...mutedSmall, margin: "0 0 14px" }}>
          Choose the currency symbol used throughout the app. Data is stored in USD — this only affects display.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { code: "USD", label: "$ USD" },
            { code: "GBP", label: "£ GBP" },
            { code: "EUR", label: "€ EUR" },
            { code: "CAD", label: "CA$ CAD" },
          ].map(({ code, label }) => (
            <button
              key={code}
              onClick={() => { setDisplayCurrency(code); localStorage.setItem("blDisplayCurrency", code); }}
              style={{
                background: displayCurrency === code ? "#c9a84c" : "rgba(255,255,255,0.04)",
                color: displayCurrency === code ? "#0d1623" : "#8a9bb0",
                border: `1px solid ${displayCurrency === code ? "#c9a84c" : "rgba(255,255,255,0.1)"}`,
                borderRadius: 8, padding: "8px 18px", fontWeight: 800, cursor: "pointer", fontSize: 13
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      )}

      {settingsTab === "general" && (
      <section style={panel}>
        <h3>Budget Settings</h3>
        <label>
          <div style={{ marginBottom: 6 }}>Annual Budget (USD)</div>
          <input
            type="number"
            step="0.01"
            value={annualBudget}
            onChange={e => setAnnualBudget(Number(e.target.value) || 0)}
            style={{ width: 180 }}
          />
        </label>
      </section>
      )}

      {settingsTab === "general" && (
      <section style={panel}>
        <h3 style={{ margin: "0 0 4px" }}>Auto-Export</h3>
        <p style={{ ...mutedSmall, margin: "0 0 14px" }}>
          Automatically download a full backup when the app opens, if it's been longer than the chosen interval since the last export.
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {[
            { label: "Off", value: 0 },
            { label: "Daily", value: 1 },
            { label: "Weekly", value: 7 },
            { label: "Monthly", value: 30 },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setAutoExportDays(opt.value)}
              style={autoExportDays === opt.value ? stActiveTab : stTabBtn}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {autoExportDays > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: "#5d6f80" }}>
              Last export:{" "}
              <span style={{ color: "#8a9bb0" }}>
                {lastExportAt
                  ? new Date(lastExportAt).toLocaleString()
                  : "Never — will run next app open"}
              </span>
            </div>
            <button onClick={exportFullBackup} style={smallButton}>Export Now</button>
          </div>
        )}
      </section>
      )}

      {settingsTab === "data" && (
      <section style={panel}>
        <h3 style={{ margin: "0 0 4px" }}>Data Management</h3>
        <p style={{ ...muted, margin: "0 0 20px", fontSize: 13 }}>Export or import data by category, or use a full backup to move everything at once.</p>

        {/* ── Full App Backup ── */}
        <div style={dataBlock}>
          <div style={dataBlockHeader}>
            <div>
              <div style={dataBlockTitle}>Full App Backup</div>
              <div style={dataBlockDesc}>Collection · Watch List · Budget · Settings — everything in one file</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={exportFullBackup} style={redBtn}>Export Backup</button>
              <label style={ghostBtn}>Restore Backup<input type="file" accept=".json" onChange={importFullBackup} style={{ display: "none" }} /></label>
            </div>
          </div>
        </div>

        <div style={dataDivider} />

        {/* ── My Collection ── */}
        <div style={dataBlock}>
          <div style={dataBlockHeader}>
            <div>
              <div style={dataBlockTitle}>My Collection</div>
              <div style={dataBlockDesc}>Manually added owned sets · BrickEconomy sync is in General</div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div onDragOver={e => e.preventDefault()} onDrop={handleDropCollection} style={dropZoneStyle}>
              <strong style={{ color: "#e8e2d5" }}>Drop file here</strong>
              <div style={{ fontSize: 12, marginTop: 4 }}>Excel · CSV · JSON</div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ ...dataBlockDesc, marginBottom: 6, fontWeight: 700, color: "#c9a84c" }}>Import from services</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label style={redBtn}>BrickEconomy CSV<input type="file" accept=".csv" onChange={importBrickEconomyExportCSV} style={{ display: "none" }} /></label>
                <label style={ghostBtn}>Brickset My Sets CSV<input type="file" accept=".csv" onChange={importBricksetMySetCSV} style={{ display: "none" }} /></label>
              </div>
              <div style={{ ...dataBlockDesc, marginTop: 6 }}>BrickEconomy: go to your collection → Export → CSV. Brickset: My Sets → Export.</div>
            </div>
            <div style={{ ...dataBlockDesc, marginBottom: 6, fontWeight: 700, color: "#8a9bb0" }}>Manual import / export</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <label style={ghostBtn}>Import Excel<input type="file" accept=".xlsx,.xls" onChange={importCollectionExcel} style={{ display: "none" }} /></label>
              <label style={ghostBtn}>Import CSV<input type="file" accept=".csv" onChange={importCollectionCSV} style={{ display: "none" }} /></label>
              <label style={ghostBtn}>Import JSON<input type="file" accept=".json" onChange={importCollectionJSON} style={{ display: "none" }} /></label>
              <button onClick={exportCollectionCSV} style={ghostBtn}>Export CSV</button>
              <button onClick={exportCollectionJSON} style={ghostBtn}>Export JSON</button>
              <button onClick={exportEnrichedCSV} style={ghostBtn}>Export Enriched CSV</button>
              <button onClick={downloadCollectionTemplate} style={ghostBtn}>Template</button>
            </div>
          </div>
        </div>

        <div style={dataDivider} />

        {/* ── Watch List ── */}
        <div style={dataBlock}>
          <div style={dataBlockHeader}>
            <div>
              <div style={dataBlockTitle}>Watch List</div>
              <div style={dataBlockDesc}>Wanted sets, buy targets, and retirement tracking</div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div onDragOver={e => e.preventDefault()} onDrop={handleDropWatchList} style={dropZoneStyle}>
              <strong style={{ color: "#e8e2d5" }}>Drop file here</strong>
              <div style={{ fontSize: 12, marginTop: 4 }}>CSV · JSON</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <label style={redBtn}>Import JSON<input type="file" accept=".json" onChange={importWantedListJSON} style={{ display: "none" }} /></label>
              <label style={ghostBtn}>Import CSV<input type="file" accept=".csv" onChange={importWantedListCSV} style={{ display: "none" }} /></label>
              <button onClick={exportWantedListJSON} style={ghostBtn}>Export JSON</button>
              <button onClick={exportWantedListCSV} style={ghostBtn}>Export CSV</button>
              <button onClick={downloadWatchListTemplate} style={ghostBtn}>Download Template</button>
            </div>
          </div>
        </div>

        <div style={dataDivider} />

        {/* ── Budget & Purchases ── */}
        <div style={dataBlock}>
          <div style={dataBlockHeader}>
            <div>
              <div style={dataBlockTitle}>Budget & Purchases</div>
              <div style={dataBlockDesc}>Purchase log only · Excel (.xlsx), CSV, or JSON</div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ ...dataBlockDesc, marginBottom: 6 }}>Import mode</div>
              <label style={{ marginRight: 16, color: "#e8e2d5", fontSize: 14 }}>
                <input type="radio" checked={importMode === "add"} onChange={() => setImportMode("add")} /> Add new / skip duplicates
              </label>
              <label style={{ color: "#e8e2d5", fontSize: 14 }}>
                <input type="radio" checked={importMode === "replace"} onChange={() => setImportMode("replace")} /> Replace all
              </label>
            </div>
            <div onDragOver={e => e.preventDefault()} onDrop={handleDrop} style={dropZoneStyle}>
              <strong style={{ color: "#e8e2d5" }}>Drop file here</strong>
              <div style={{ fontSize: 12, marginTop: 4 }}>Excel · CSV · JSON</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <label style={redBtn}>Import Excel<input type="file" accept=".xlsx,.xls" onChange={handleExcelImport} style={{ display: "none" }} /></label>
              <label style={ghostBtn}>Import CSV<input type="file" accept=".csv" onChange={importCSV} style={{ display: "none" }} /></label>
              <label style={ghostBtn}>Import JSON<input type="file" accept=".json" onChange={importJSON} style={{ display: "none" }} /></label>
              <button onClick={exportCSV} style={ghostBtn}>Export CSV</button>
              <button onClick={exportJSON} style={ghostBtn}>Export JSON</button>
              <button onClick={downloadCSVTemplate} style={ghostBtn}>Download Template</button>
            </div>
          </div>
        </div>
      </section>
      )}

      {settingsTab === "columns" && (
      <section style={panel}>
        <h3>Columns</h3>
        <p style={mutedSmall}>Drag columns directly in table headers to reorder. Use these controls to show or hide columns.</p>

        <div style={settingsGrid}>
          <ColumnSettings title="Purchases Columns" columns={purchaseColumns} type="purchase" onToggle={toggleColumn} onReset={resetColumns} isOpen={!!openColumnSections.purchase} onToggleOpen={() => setOpenColumnSections(prev => ({ ...prev, purchase: !prev.purchase }))} />
          <ColumnSettings title="Owned Sets Columns" columns={ownedColumns} type="owned" onToggle={toggleColumn} onReset={resetColumns} isOpen={!!openColumnSections.owned} onToggleOpen={() => setOpenColumnSections(prev => ({ ...prev, owned: !prev.owned }))} />
          <ColumnSettings title="Acquisition Queue Columns" columns={acquisitionColumns} type="acquisition" onToggle={toggleColumn} onReset={resetColumns} isOpen={!!openColumnSections.acquisition} onToggleOpen={() => setOpenColumnSections(prev => ({ ...prev, acquisition: !prev.acquisition }))} />
        </div>
      </section>
      )}

      {settingsTab === "data" && (
      <section style={panel}>
        <h3>API & Cache</h3>
        <p style={mutedSmall}>
          BrickEconomy lookups are cached locally to protect your daily API quota.
        </p>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 10,
          marginTop: 12,
          marginBottom: 12
        }}>
          <div style={miniStat}>
            <div style={mutedSmall}>Last Collection Sync</div>
            <strong>
              {collectionSyncInfo.lastSync
                ? new Date(collectionSyncInfo.lastSync).toLocaleString()
                : "Never"}
            </strong>
          </div>

          <div style={miniStat}>
            <div style={mutedSmall}>Inventory Entries</div>
            <strong>{collectionSyncInfo.setsCount || 0}</strong>
          </div>

          <div style={miniStat}>
            <div style={mutedSmall}>Unique Sets</div>
            <strong>{collectionSyncInfo.uniqueSets || 0}</strong>
          </div>

          <div style={miniStat}>
            <div style={mutedSmall}>Multi-Copy Sets</div>
            <strong>{collectionSyncInfo.duplicateGroups || 0}</strong>
          </div>

          <div style={miniStat}>
            <div style={mutedSmall}>Portfolio Value</div>
            <strong>
              {collectionSyncInfo.portfolioValue
                ? `$${Number(collectionSyncInfo.portfolioValue).toLocaleString()}`
                : "$0"}
            </strong>
          </div>

          <div style={miniStat}>
            <div style={mutedSmall}>Total Paid</div>
            <strong>
              {collectionSyncInfo.totalPaid
                ? `$${Number(collectionSyncInfo.totalPaid).toLocaleString()}`
                : "$0"}
            </strong>
          </div>

          <div style={miniStat}>
            <div style={mutedSmall}>Unrealized Gain</div>
            <strong>
              {collectionSyncInfo.unrealizedGain
                ? `$${Number(collectionSyncInfo.unrealizedGain).toLocaleString()}`
                : "$0"}
            </strong>
          </div>

          <div style={miniStat}>
            <div style={mutedSmall}>Inventory Source</div>
            <strong>{collectionSyncInfo.inventorySource || "—"}</strong>
          </div>

          <div style={miniStat}>
            <div style={mutedSmall}>Value Source</div>
            <strong>{collectionSyncInfo.valueSource || "—"}</strong>
          </div>

          <div style={miniStat}>
            <div style={mutedSmall}>Cost Basis Source</div>
            <strong>{collectionSyncInfo.costBasisSource || "—"}</strong>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={syncBrickEconomyCollection} style={redBtn} disabled={collectionSyncing}>
            {collectionSyncing ? "Syncing..." : "Sync BrickEconomy Collection"}
          </button>

          <button onClick={clearApiCache} style={ghostBtn}>
            Clear BrickEconomy Cache
          </button>
        </div>
      </section>
      )}

      {settingsTab === "general" && (
      <section style={panel}>
        <h3 style={{ margin: "0 0 4px" }}>BrickLink</h3>
        <p style={{ ...mutedSmall, margin: "0 0 14px" }}>
          Connect your BrickLink account for real market pricing data.{" "}
          <a
            href="https://bricklink.com/v3/brickstore-access-management.page"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#c9a84c", textDecoration: "underline" }}
          >
            Get your access token
          </a>{" "}
          (free BrickLink buyer account — no seller account needed).
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: blConnected ? "#22c55e" : "#4d5e70",
            flexShrink: 0
          }} />
          <span style={{ fontSize: 14, color: blConnected ? "#22c55e" : "#8a9bb0", fontWeight: 700 }}>
            {blConnected ? "Connected" : "Not connected"}
          </span>
        </div>

        {!blConnected && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: 12, color: "#5d6f80", marginBottom: 5 }}>Access token</div>
              <input
                type="password"
                placeholder="Paste your BrickLink access token"
                value={blAccessTokenInput}
                onChange={e => setBlAccessTokenInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && saveBrickLinkToken()}
                style={{ width: 280 }}
              />
            </div>
            <button onClick={saveBrickLinkToken} style={redBtn} disabled={!blAccessTokenInput.trim()}>
              Connect
            </button>
          </div>
        )}

        {blConnected && (
          <button onClick={disconnectBrickLink} style={ghostBtn}>
            Disconnect
          </button>
        )}
      </section>
      )}

      {settingsTab === "general" && (
      <section style={panel}>
        <h3>Stores</h3>
        <p style={{ ...mutedSmall, marginBottom: 14 }}>Add or remove stores available when logging purchases.</p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 12, color: "#5d6f80", marginBottom: 5 }}>Store name</div>
            <input placeholder="e.g. Costco" value={newStore} onChange={e => setNewStore(e.target.value)} onKeyDown={e => e.key === "Enter" && addStore()} style={{ width: 200 }} />
          </div>
          <button onClick={addStore} style={ghostBtn}>Add Store</button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {stores.map(store => (
            <div key={store} style={{ display: "flex", alignItems: "center", gap: 12, background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px" }}>
              <span style={{ flex: 1, fontWeight: 700 }}>{store}</span>
              <button onClick={() => deleteStore(store)} style={{ background: "transparent", color: "#5d6f80", border: "none", cursor: "pointer", fontWeight: 900, fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
            </div>
          ))}
        </div>
      </section>
      )}
    </div>
  );
}

function ColumnSettings({ title, columns, type, onToggle, onReset, isOpen, onToggleOpen }) {
  const visibleCount = columns.filter(c => c.visible).length;
  const hiddenCount = columns.length - visibleCount;

  return (
    <div style={subPanel}>
      <div
        onClick={onToggleOpen}
        style={{
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12
        }}
      >
        <div>
          <h4 style={{ margin: 0 }}>
            {isOpen ? "▾" : "▸"} {title}
          </h4>
          <div style={mutedSmall}>{visibleCount} visible • {hiddenCount} hidden</div>
        </div>

        <button
          onClick={e => {
            e.stopPropagation();
            onReset(type);
          }}
          style={smallButton}
        >
          Reset
        </button>
      </div>

      {isOpen && (
        <>
          <ColumnGroup title="Visible Columns" columns={columns.filter(c => c.visible)} action="Hide" actionStyle={hideButton} type={type} onToggle={onToggle} />
          <ColumnGroup title="Hidden Columns" columns={columns.filter(c => !c.visible)} action="Show" actionStyle={showButton} type={type} onToggle={onToggle} emptyText="No hidden columns." />
        </>
      )}
    </div>
  );
}

function ColumnGroup({ title, columns, action, actionStyle, type, onToggle, emptyText }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ color: "#8a9bb0", fontWeight: 800, marginBottom: 8 }}>{title}</div>
      {columns.length === 0 ? (
        <div style={emptyState}>{emptyText || "No columns."}</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {columns.map(col => (
            <div key={col.key} style={columnRow}>
              <span>{col.label}</span>
              <button onClick={() => onToggle(type, col.key)} style={actionStyle}>{action}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const page = { background: "transparent", color: "#e8e2d5", minHeight: "100vh", padding: 22 };
const panel = { background: "rgba(20,31,48,0.82)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 20, marginTop: 18, boxShadow: "0 4px 24px rgba(0,0,0,0.35)" };
const subPanel = {
  background: "rgba(15,26,40,0.9)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 12,
  padding: 16,
  alignSelf: "start"
};
const settingsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
  gap: 14,
  alignItems: "start"
};
const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 };
const columnRow = { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0b1520", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 12px" };
const muted = { color: "#8a9bb0", marginTop: 6 };
const mutedSmall = { color: "#8a9bb0", fontSize: 14 };
const emptyState = { color: "#4d5e70", background: "#0b1520", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 10, padding: "10px 12px" };
const redBtn = { display: "inline-block", background: "#c9a84c", color: "#0d1623", border: "none", borderRadius: 10, padding: "10px 14px", fontWeight: 800, cursor: "pointer" };
const ghostBtn = { background: "transparent", color: "#8a9bb0", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", fontWeight: 800, cursor: "pointer" };
const smallButton = { ...ghostBtn, padding: "6px 10px" };
const hideButton = { background: "#3b0a0a", color: "#e8e2d5", border: "1px solid #7f1d1d", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const showButton = { background: "#0f3b17", color: "#e8e2d5", border: "1px solid #166534", borderRadius: 8, padding: "6px 10px", cursor: "pointer" };
const notice = { background: "#332500", color: "#ffdf74", padding: 12, borderRadius: 10, marginTop: 16 };


const miniStat = {
  background: "#0b1520",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10,
  padding: 12
};

const stTabHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 4 };
const stTabBar = { display: "flex", gap: 8, flexWrap: "wrap" };
const stTabBtn = { background: "transparent", color: "#8a9bb0", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 18px", fontWeight: 800, cursor: "pointer", fontSize: 14 };
const stActiveTab = { ...stTabBtn, background: "#c9a84c", color: "#0d1623", borderColor: "#c9a84c" };

const dataBlock = { padding: "4px 0" };
const dataBlockHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" };
const dataBlockTitle = { fontWeight: 800, fontSize: 15, color: "#e8e2d5", marginBottom: 3 };
const dataBlockDesc = { fontSize: 13, color: "#8a9bb0" };
const dataDivider = { height: 1, background: "rgba(255,255,255,0.06)", margin: "18px 0" };
const dropZoneStyle = { border: "2px dashed rgba(255,255,255,0.12)", borderRadius: 10, padding: "16px 20px", textAlign: "center", color: "#8a9bb0", background: "rgba(255,255,255,0.02)", fontSize: 13 };
