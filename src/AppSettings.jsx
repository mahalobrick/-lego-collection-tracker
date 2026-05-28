import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import Papa from "papaparse";
import { importBudgetExcel, parseExcelFirstSheet } from "./utils/importBudgetExcel";
import { asNumber } from "./utils/formatting";
import { exportFullBackup as runExportBackup, pushToCloud, fetchFromCloud, decryptCloudBackup, applyBackupToLocalStorage } from "./utils/exportBackup";
import { getBrickLinkAccessToken, hasBrickLinkAuth, getBrickLinkSession, bulkSyncPrices } from "./utils/bricklink-client";
import { DEFAULT_WANTED_COLUMNS } from "./utils/columnDefaults";
import { syncBEValues } from "./utils/beSyncValues";
import { loadRebrickable, rbLookupSet, rbReady } from "./utils/rebrickable";
import { notificationsSupported, notificationPermission, requestNotificationPermission } from "./utils/notifications";

const DEFAULT_STORES = ["Amazon", "Best Buy", "Bricklink", "LEGO", "Target", "Walmart"];
const DEFAULT_ANNUAL_BUDGET = 10320;



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
      set_number:    obj.Number || obj["Set Number"] || obj.number || "",
      name:          obj.Name   || obj.name   || "",
      theme:         obj.Theme  || obj.theme  || "",
      condition:     (obj.Condition || obj.condition || "new").toLowerCase().replace(/\s+/g, "_"),
      paid_price:    stripMoney(obj.Paid         || obj.paid         || obj.paid_price),
      current_value: stripMoney(obj.Value        || obj.value        || obj.current_value),
      retail_price:  stripMoney(obj.Retail       || obj.retail       || obj.retail_price || obj["Retail Price"] || ""),
      pieces_count:  Number(obj.Pieces || obj.pieces || obj.pieces_count || 0) || 0,
      subtheme:      obj.Subtheme || obj.subtheme || "",
      year:          Number(obj.Year || obj.year || 0) || 0,
      retired:       /yes|true|1/i.test(obj.Retired || obj.retired || ""),
      acquired_date: obj.Date || obj.date || obj.acquired_date || "",
      notes:         obj.Notes || obj.notes || "",
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
        subtheme: item.subtheme || item.Subtheme || "",
        year: Number(item.year || item.Year || 0) || 0,
        pieces: Number(item.pieces_count || item.Pieces || 0) || 0,
        quantity: 0,
        totalPaid: 0,
        totalValue: 0,
        totalRetailPrice: 0,
        retired: !!item.retired,
        entries: []
      };
    }

    const paid        = Number(item.paid_price    ?? item.Paid    ?? item.paid    ?? 0) || 0;
    const value       = Number(item.current_value ?? item.Value   ?? item.value   ?? 0) || 0;
    const retailPrice = Number(item.retail_price  ?? item.Retail  ?? 0) || 0;

    bySet[setNumber].quantity         += 1;
    bySet[setNumber].totalPaid        += paid;
    bySet[setNumber].totalValue       += value;
    bySet[setNumber].totalRetailPrice += retailPrice;
    bySet[setNumber].entries.push(item);
  });

  const normalized = Object.values(bySet).map(item => ({
    ...item,
    averagePaid:   item.quantity ? item.totalPaid  / item.quantity : 0,
    retailPrice:   item.quantity ? item.totalRetailPrice / item.quantity : 0,
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

export default function AppSettings({ cloudPassphrase = "", onPassphraseChange = () => {} }) {
  const [collectionSyncing, setCollectionSyncing] = useState(false);
  const [collectionSyncInfo, setCollectionSyncInfo] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("brickEconomyCollectionSyncInfo") || "{}");
    } catch {
      return {};
    }
  });

  const [settingsTab, setSettingsTab] = useState("general");

  // ── BrickLink auth state ─────────────────────────────────────
  const [blAccessTokenInput, setBlAccessTokenInput] = useState("");
  const [blConnected, setBlConnected] = useState(() => hasBrickLinkAuth());
  const [blTesting, setBlTesting] = useState(false);
  const [blPriceSync, setBlPriceSync] = useState(null); // null | { done, total, status }
  const [blPriceSyncLast, setBlPriceSyncLast] = useState(() => localStorage.getItem("blPriceSyncLast") || null);

  const [beValueSync, setBeValueSync] = useState(null); // null | { done, total }
  const [beValueSyncLast, setBeValueSyncLast] = useState(() => localStorage.getItem("beValueSyncLast") || null);

  // ── Brick Fanatics retirement sync ────────────────────────────
  const [bfSyncing, setBfSyncing] = useState(false);
  const [bfSyncLast, setBfSyncLast] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blBFRetirementCache") || "null")?.fetchedAt || null; } catch { return null; }
  });
  const [bfSyncResult, setBfSyncResult] = useState(null); // { updated, total }

  async function handleSyncBFRetirement(force = true) {
    if (bfSyncing) return;
    setBfSyncing(true);
    setBfSyncResult(null);
    try {
      const CACHE_KEY = "blBFRetirementCache";
      const STALE_MS  = 7 * 24 * 60 * 60 * 1000;
      let bfSets = null, fetchedAt = null;
      if (!force) {
        try {
          const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
          if (c?.sets && c.fetchedAt && Date.now() - new Date(c.fetchedAt).getTime() < STALE_MS) {
            bfSets = c.sets; fetchedAt = c.fetchedAt;
          }
        } catch {}
      }
      if (!bfSets) {
        const res  = await fetch("/api/brickfanatics-retiring");
        const json = await res.json();
        if (!res.ok || json.error || !json.sets?.length) throw new Error(json.message || "BF fetch failed");
        bfSets = json.sets; fetchedAt = json.fetchedAt || new Date().toISOString();
        localStorage.setItem(CACHE_KEY, JSON.stringify({ sets: bfSets, fetchedAt }));
      }
      const bfMap = new Map(bfSets.map(s => [String(s.setNumber).replace(/-1$/, ""), s]));
      const currentYear = new Date().getFullYear();
      let updated = 0;
      // Cross-reference Wanted List
      const wl = JSON.parse(localStorage.getItem("blWantedList") || "[]");
      const wlNext = wl.map(w => {
        if (w.retirementSource === "Brickset" && w.exit_date) return w;
        const match = bfMap.get(String(w.setNumber || "").replace(/-1$/, "").trim());
        if (!match) return w;
        const yrMatch = (match.retirementDate || "").match(/\b(20\d{2})\b/);
        const yr = yrMatch ? Number(yrMatch[1]) : null;
        if (w.retirementSource === "Brick Fanatics" && w.retirementYear === (yr ? String(yr) : w.retirementYear)) return w;
        updated++;
        return { ...w, retiringSoon: yr ? yr <= currentYear + 1 : true, retirementYear: yr ? String(yr) : w.retirementYear || "",
          retirementConfidence: "High", retirementSource: "Brick Fanatics", lastRetirementUpdate: new Date().toISOString().slice(0, 10) };
      });
      localStorage.setItem("blWantedList", JSON.stringify(wlNext));
      setBfSyncLast(fetchedAt);
      setBfSyncResult({ updated, total: bfSets.length });
      toast.success(`BF sync: ${updated} items updated · ${bfSets.length} sets on retiring list`);
    } catch (err) {
      toast.error("BF sync failed: " + err.message);
    } finally {
      setBfSyncing(false);
    }
  }

  // ── Rebrickable local fill ─────────────────────────────────────
  const [rbLoaded, setRbLoaded] = useState(() => rbReady());
  const [rbFilling, setRbFilling] = useState(false);
  const [rbFillResult, setRbFillResult] = useState(null); // number of fields filled

  useEffect(() => {
    loadRebrickable().then(() => setRbLoaded(rbReady())).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check whether the cloud has an encrypted backup, a legacy unencrypted one, or nothing
  useEffect(() => {
    fetchFromCloud().then(payload => {
      if (!payload)              setCloudStatus("empty");
      else if (payload.ciphertext) setCloudStatus("encrypted");
      else                         setCloudStatus("legacy");
    }).catch(() => setCloudStatus("empty"));
  }, []);

  function handleRbFill() {
    if (!rbReady()) { toast("Rebrickable catalog still loading — try again in a moment."); return; }
    setRbFilling(true);
    let enriched = 0;
    // Enrich My Collection
    try {
      const owned = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");
      const next  = owned.map(s => {
        const rb = rbLookupSet(s.setNumber);
        if (!rb) return s;
        const up = {};
        if (!s.pieces && rb.numParts) up.pieces = rb.numParts;
        if (!s.theme  && rb.theme)    up.theme  = rb.theme;
        if (!s.name   && rb.name)     up.name   = rb.name;
        if (Object.keys(up).length)   { enriched++; return { ...s, ...up }; }
        return s;
      });
      localStorage.setItem("blOwnedSets", JSON.stringify(next));
    } catch {}
    // Enrich Wanted List
    try {
      const wl   = JSON.parse(localStorage.getItem("blWantedList") || "[]");
      const next = wl.map(w => {
        const rb = rbLookupSet(w.setNumber);
        if (!rb) return w;
        const up = {};
        if (!w.pieces && rb.numParts) up.pieces = rb.numParts;
        if (!w.theme  && rb.theme)    up.theme  = rb.theme;
        if (!w.name   && rb.name)     up.name   = rb.name;
        if (Object.keys(up).length)   { enriched++; return { ...w, ...up }; }
        return w;
      });
      localStorage.setItem("blWantedList", JSON.stringify(next));
    } catch {}
    setRbFillResult(enriched);
    setRbFilling(false);
    if (enriched > 0) toast.success(`Rebrickable: ${enriched} fields filled`);
    else toast("Rebrickable: nothing new to fill in");
  }

  const [newStore, setNewStore] = useState("");
  const [editingStore, setEditingStore] = useState(null);   // store name currently being renamed
  const [editingStoreName, setEditingStoreName] = useState(""); // live value in the rename input

  // ── Notifications ────────────────────────────────────────────
  const [notifPermission, setNotifPermission] = useState(() => notificationPermission());
  const [notifEnabled, setNotifEnabled] = useState(() => !!localStorage.getItem("blNotificationsEnabled"));

  const [autoExportDays, setAutoExportDays] = useState(() =>
    Number(localStorage.getItem("blAutoExportDays") || "0")
  );
  const [lastExportAt, setLastExportAt] = useState(
    () => localStorage.getItem("blLastAutoExport") || ""
  );
  const [lastCloudPush, setLastCloudPush] = useState(
    () => localStorage.getItem("blLastCloudPush") || ""
  );
  const [cloudBusy, setCloudBusy] = useState(false);
  const [passphraseDraft, setPassphraseDraft] = useState(""); // typed but not yet committed
  const [cloudStatus, setCloudStatus] = useState(null); // null | "encrypted" | "legacy" | "empty"

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

  useEffect(() => localStorage.setItem("blAutoExportDays", String(autoExportDays)), [autoExportDays]);
  useEffect(() => localStorage.setItem("blAnnualBudget", annualBudget), [annualBudget]);
  useEffect(() => localStorage.setItem("blStores", JSON.stringify(stores)), [stores]);

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
      toast.success(`Replaced purchases with ${cleaned.length} imported rows.`);
      return;
    }

    const existing = getPurchases();
    const existingKeys = new Set(existing.map(purchaseKey));
    const newRows = cleaned.filter(p => !existingKeys.has(purchaseKey(p)));
    setPurchases([...existing, ...newRows]);

    toast.success(`Imported ${newRows.length} new purchases. Skipped ${cleaned.length - newRows.length} duplicate(s).`);
  }

  async function importAnyFile(file) {
    if (!file) return;

    const name = file.name.toLowerCase();
    const fakeEvent = { target: { files: [file] } };

    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return handleExcelImport(fakeEvent);
    if (name.endsWith(".csv")) return importCSV(fakeEvent);
    if (name.endsWith(".json")) return importJSON(fakeEvent);

    toast.error("Unsupported file type. Use Excel, CSV, or JSON.");
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
        if (!data.length) { toast.error("No data found in CSV."); return; }
        const purchases = data.map(item => ({
          date:      csvDateToISO(item.date || ""),
          store:     item.store || "LEGO",
          setNumber: item.setNumber || "",
          name:      item.name || "",
          theme:     item.theme || "",
          qty:       Number(item.qty || 1),
          amount:    Number(item.amount || 0),
          notes:     item.notes || "",
          month:     getMonthLabel(csvDateToISO(item.date || "")),
          year:      Number(String(csvDateToISO(item.date || "")).slice(0, 4)) || new Date().getFullYear(),
        }));
        applyImportedPurchases(purchases);
      },
      error: () => toast.error("Invalid CSV file."),
    });
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
      toast.success("Backup downloaded.");
    }
  }

  // ── Cloud Backup ─────────────────────────────────────────────
  // Resolves the active passphrase: committed session value takes priority,
  // then falls back to whatever is currently typed in the draft field.
  // This lets users type → click Push/Pull in one step without a separate "Save" click.
  function resolvePassphrase() {
    const p = cloudPassphrase || passphraseDraft;
    if (p && !cloudPassphrase) onPassphraseChange(p); // promote draft to session
    return p;
  }

  async function handlePushToCloud() {
    const p = resolvePassphrase();
    if (!p) { toast.error("Enter a passphrase first."); return; }
    setCloudBusy(true);
    try {
      const result = await pushToCloud(p);
      if (result === null) {
        toast.error("Cloud backup not configured — connect a Redis database in Vercel Storage.");
      } else if (result?.skipped === "no_data") {
        toast.error("Nothing to push — import your collection first, then push.");
      } else {
        const ts = result.savedAt || new Date().toISOString();
        setLastCloudPush(ts);
        setCloudStatus("encrypted");
        toast.success("Encrypted backup saved to cloud ✓");
      }
    } catch (err) {
      toast.error(`Cloud push failed: ${err.message}`);
    } finally {
      setCloudBusy(false);
    }
  }

  async function handlePullFromCloud() {
    const p = resolvePassphrase();
    if (!p) { toast.error("Enter a passphrase first."); return; }
    if (!window.confirm("Pull from cloud? This will overwrite your local data with the cloud backup.")) return;
    setCloudBusy(true);
    try {
      const payload = await fetchFromCloud();
      if (!payload) {
        toast.error("No cloud backup found.");
      } else if (!payload.ciphertext) {
        toast.error("Cloud backup is in an old unencrypted format. Push a fresh backup from your main browser.");
      } else {
        const backup = await decryptCloudBackup(payload, p);
        applyBackupToLocalStorage(backup);
        if (payload.exportedAt) localStorage.setItem("blLastCloudPush", payload.exportedAt);
        toast.success("Cloud backup restored — reloading…", { duration: 3000 });
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (err) {
      toast.error(err.message.includes("passphrase") ? "Wrong passphrase." : `Cloud pull failed: ${err.message}`);
    } finally {
      setCloudBusy(false);
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
      applyBackupToLocalStorage(data);
      // Also restore the set cache — large but worthwhile for a manual full restore
      if (data.brickEconomySetCache && typeof data.brickEconomySetCache === "object") {
        localStorage.setItem("brickEconomySetCache", JSON.stringify(data.brickEconomySetCache));
      }
      toast.success("Backup restored. Reloading…");
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      toast.error(err?.message?.startsWith("Backup version")
        ? err.message
        : "Could not read backup file — make sure it's a valid BrickLedger JSON backup.");
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
    toast.success(`Imported ${sets.length} sets. Refresh to see changes.`);
  }

  function importCollectionCSV(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        if (!data.length) { toast.error("No data found in collection CSV."); return; }
        applyCollectionImport(rowsToCollectionSets(data));
      },
      error: () => toast.error("Invalid collection CSV."),
    });
  }

  async function importCollectionJSON(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error();
      await applyCollectionImport(rowsToCollectionSets(data));
    } catch { toast.error("Invalid collection JSON — expected an array of sets."); }
  }

  async function importCollectionExcel(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try {
      const rows = await parseExcelFirstSheet(file);
      await applyCollectionImport(rowsToCollectionSets(rows));
    } catch (err) { toast.error(err.message || "Could not read Excel file."); }
  }

  // ── BrickEconomy CSV export import ───────────────────────────────────────
  async function importBrickEconomyExportCSV(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try {
      const text = await file.text();
      const items = parseBECollectionCSV(text);
      if (!items) { toast.error("Unrecognised format — use the CSV export from brickeconomy.com/user/collection."); return; }
      if (items.length === 0) { toast.error("No sets found in this CSV."); return; }
      const ok = window.confirm(`Import ${items.length} entries from BrickEconomy CSV? Replaces existing BrickEconomy data.`);
      if (!ok) return;
      const normalized    = normalizeBrickEconomyCollection(items);
      const totalPaid     = normalized.reduce((s, i) => s + i.totalPaid,  0);
      const totalValue    = normalized.reduce((s, i) => s + i.totalValue, 0);
      const retailValue   = normalized.reduce((s, i) => s + (i.totalRetailPrice || 0), 0);
      const totalCopies   = items.length;
      const retiredCount  = normalized.filter(i => i.retired).length;
      const retiredPct    = normalized.length ? Math.round(retiredCount / normalized.length * 10000) / 100 : 0;
      const newValue      = items.filter(e => e.condition === "new").reduce((s, e) => s + (Number(e.current_value) || 0), 0);
      const usedValue     = items.filter(e => e.condition !== "new").reduce((s, e) => s + (Number(e.current_value) || 0), 0);
      recordPortfolioSnapshot(totalValue, totalPaid);
      const syncInfo = {
        lastSync: new Date().toISOString(),
        setsCount:      items.length,
        uniqueSets:     normalized.length,
        newCount:       items.filter(e => e.condition === "new").length,
        usedCount:      items.filter(e => e.condition !== "new").length,
        piecesCount:    normalized.reduce((s, i) => s + (i.pieces || 0) * (i.quantity || 1), 0),
        duplicateGroups: normalized.filter(i => i.quantity > 1).length,
        totalPaid,
        portfolioValue: totalValue,
        unrealizedGain: totalValue - totalPaid,
        retiredCount,
        retiredPct,
        retailValue:    Math.round(retailValue * 100) / 100,
        newValue:       Math.round(newValue    * 100) / 100,
        usedValue:      Math.round(usedValue   * 100) / 100,
        valueSource:     "BrickEconomy CSV export",
        costBasisSource: "BrickEconomy CSV export",
        inventorySource: "BrickEconomy CSV import"
      };
      localStorage.setItem("brickEconomyNormalizedCollection", JSON.stringify(normalized));
      localStorage.setItem("brickEconomyCollectionSyncInfo", JSON.stringify(syncInfo));
      setCollectionSyncInfo(syncInfo);
      toast.success(`Imported ${normalized.length} unique sets (${items.length} entries) from BrickEconomy CSV. Refresh My Collection to see changes.`);
    } catch (err) { toast.error("Could not parse BrickEconomy CSV: " + (err.message || err)); }
  }

  // ── Brickset "My Sets" CSV import ────────────────────────────────────────
  async function importBricksetMySetCSV(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try {
      const text = await file.text();
      const items = parseBricksetMySetCSV(text);
      if (items.length === 0) { toast.error("No sets found — make sure this is a Brickset 'My Sets' CSV export."); return; }
      const ok = window.confirm(`Import ${items.length} sets from Brickset? They'll be added as manual items with $0 paid price (update later).`);
      if (!ok) return;
      const existing = JSON.parse(localStorage.getItem("blOwnedSets") || "[]").filter(s => s.source !== "Brickset");
      localStorage.setItem("blOwnedSets", JSON.stringify([...existing, ...items]));
      toast.success(`Imported ${items.length} sets from Brickset. Open My Collection → Collection to review.`);
    } catch (err) { toast.error("Could not parse Brickset CSV: " + (err.message || err)); }
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
    toast.error("Drop an Excel, CSV, or JSON file for My Collection.");
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
    const ok = window.confirm(`Import ${data.length} wanted list items? Current list will be replaced.`);
    if (!ok) return;
    localStorage.setItem("blWantedList", JSON.stringify(data));
    toast.success(`Wanted list restored with ${data.length} items. Refresh to see changes.`);
  }

  async function importWantedListJSON(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    try { await applyWatchListImport(JSON.parse(await file.text())); }
    catch { toast.error("Invalid wanted list JSON — expected an array."); }
  }

  function importWantedListCSV(e) {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (e?.target) e.target.value = "";
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const items = data.filter(o => o.setNumber);
        applyWatchListImport(items).catch(() => toast.error("Could not import wanted list CSV."));
      },
      error: () => toast.error("Invalid wanted list CSV."),
    });
  }

  async function handleDropWatchList(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv")) return importWantedListCSV({ target: { files: [file] } });
    if (name.endsWith(".json")) return importWantedListJSON({ target: { files: [file] } });
    toast.error("Drop a CSV or JSON file for Wanted List.");
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

  function startEditStore(store) {
    setEditingStore(store);
    setEditingStoreName(store);
  }

  function cancelEditStore() {
    setEditingStore(null);
    setEditingStoreName("");
  }

  function confirmRenameStore(oldName) {
    const newName = editingStoreName.trim();
    setEditingStore(null);
    setEditingStoreName("");
    if (!newName || newName === oldName) return;
    if (stores.includes(newName)) {
      alert(`"${newName}" already exists in your stores list.`);
      return;
    }
    setStores(prev => prev.map(s => s === oldName ? newName : s).sort());
    const purchases = getPurchases();
    const affected = purchases.filter(p => p.store === oldName).length;
    if (affected > 0 && window.confirm(`Also update ${affected} purchase${affected !== 1 ? "s" : ""} from "${oldName}" → "${newName}"?`)) {
      setPurchases(purchases.map(p => p.store === oldName ? { ...p, store: newName } : p));
    }
  }

  function sortStoresAZ() {
    setStores(prev => [...prev].sort());
  }

  async function syncBrickEconomyCollection() {
    setCollectionSyncing(true);

    try {
      const res = await fetch("/api/brickeconomy-collection");
      const text = await res.text();

      if (!text) {
        toast.error(`API returned an empty response (HTTP ${res.status}). Make sure the app is running via: npm run dev`);
        return;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        toast.error(`API returned unexpected content (HTTP ${res.status}): ${text.slice(0, 120)}`);
        return;
      }

      if (!res.ok || data.error) {
        toast.error(data.message || data.error || "Collection sync failed.");
        return;
      }

      const collection = data.data?.sets || data.sets || data.data || [];
      const periods = data.data?.periods || data.periods || [];

      const normalizedCollection = Array.isArray(collection)
        ? normalizeBrickEconomyCollection(collection)
        : [];

      const totalPaid       = normalizedCollection.reduce((sum, item) => sum + item.totalPaid, 0);
      const totalValue      = normalizedCollection.reduce((sum, item) => sum + item.totalValue, 0);
      const retailValue     = normalizedCollection.reduce((sum, item) => sum + (item.totalRetailPrice || 0), 0);
      const duplicateGroups = normalizedCollection.filter(item => item.quantity > 1).length;
      const totalCopies     = Array.isArray(collection) ? collection.length : normalizedCollection.reduce((s, i) => s + (i.quantity || 1), 0);
      const retiredCount    = normalizedCollection.filter(item => item.retired).length;
      const retiredPct      = normalizedCollection.length ? Math.round(retiredCount / normalizedCollection.length * 10000) / 100 : 0;
      const apiData         = data.data || data;
      const newValue        = Array.isArray(collection) ? collection.filter(e => e.condition === "new").reduce((s, e) => s + (Number(e.current_value) || 0), 0) : 0;
      const usedValue       = Array.isArray(collection) ? collection.filter(e => e.condition !== "new").reduce((s, e) => s + (Number(e.current_value) || 0), 0) : 0;

      const syncInfo = {
        lastSync: new Date().toISOString(),
        setsCount:     apiData.sets_count        ?? (Array.isArray(collection) ? collection.length : 0),
        uniqueSets:    apiData.sets_unique_count  ?? normalizedCollection.length,
        newCount:      apiData.sets_new_count     ?? collection.filter(e => e.condition === "new").length,
        usedCount:     apiData.sets_used_count    ?? collection.filter(e => e.condition !== "new").length,
        piecesCount:   apiData.sets_pieces_count  ?? 0,
        minifsCount:   apiData.sets_minifigs_count ?? 0,
        duplicateGroups,
        totalPaid,
        portfolioValue:  apiData.current_value ?? periods?.[0]?.value ?? totalValue,
        unrealizedGain:  (apiData.current_value ?? totalValue) - totalPaid,
        retiredCount,
        retiredPct,
        retailValue:   Math.round(retailValue * 100) / 100,
        newValue:      Math.round(newValue    * 100) / 100,
        usedValue:     Math.round(usedValue   * 100) / 100,
        valueSource:      "BrickEconomy current_value",
        costBasisSource:  "BrickEconomy paid_price",
        inventorySource:  "BrickEconomy collection sync",
        currency: apiData.currency || "USD"
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
      toast.success(`BrickEconomy collection synced: ${syncInfo.setsCount} sets.`);
    } catch (err) {
      toast.error(err.message || "Could not sync BrickEconomy collection.");
    } finally {
      setCollectionSyncing(false);
    }
  }

  function clearApiCache() {
    localStorage.removeItem("brickEconomySetCache");
    localStorage.removeItem("brickEconomyCollectionCache");
    toast.success("BrickEconomy API cache cleared.");
  }

  // ── BrickLink auth handlers ──────────────────────────────────
  function saveBrickLinkToken() {
    const trimmed = blAccessTokenInput.trim();
    if (!trimmed) return;
    localStorage.setItem("blBrickLinkAccessToken", trimmed);
    setBlConnected(true);
    setBlAccessTokenInput("");
    toast.success("BrickLink access token saved.");
  }

  function disconnectBrickLink() {
    localStorage.removeItem("blBrickLinkAccessToken");
    localStorage.removeItem("blSessionToken");
    localStorage.removeItem("blPriceGuideCache");
    setBlConnected(false);
    toast.success("BrickLink disconnected and session cache cleared.");
  }

  async function testBrickLinkConnection() {
    setBlTesting(true);
    try {
      const session = await getBrickLinkSession();
      if (session) {
        toast.success("BrickLink connected — price guide is active.");
      } else {
        toast.error("Authentication failed. Check your access token and try again.");
      }
    } catch {
      toast.error("BrickLink connection test failed.");
    } finally {
      setBlTesting(false);
    }
  }

  async function syncBrickLinkPrices() {
    if (blPriceSync) return; // already running
    try {
      const raw = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]");
      const setNumbers = raw.map(s => s.setNumber).filter(Boolean);
      if (setNumbers.length === 0) { toast.error("No sets in collection to sync."); return; }
      setBlPriceSync({ done: 0, total: setNumbers.length, status: "running" });
      const { synced, skipped, failed } = await bulkSyncPrices(setNumbers, ({ done, total }) => {
        setBlPriceSync({ done, total, status: "running" });
      });
      const now = new Date().toISOString();
      localStorage.setItem("blPriceSyncLast", now);
      setBlPriceSyncLast(now);
      setBlPriceSync(null);
      toast.success(`BL prices synced — ${synced} updated, ${skipped} cached, ${failed} failed.`, { duration: 6000 });
    } catch (err) {
      setBlPriceSync(null);
      toast.error("BL price sync failed: " + (err.message || err));
    }
  }

  // ── BE value sync ────────────────────────────────────────────
  async function handleSyncBEValues() {
    if (beValueSync) return;
    const normalized = JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]");
    const manual     = JSON.parse(localStorage.getItem("blOwnedSets") || "[]");
    const total = [...new Set(
      [...normalized, ...manual].map(s => String(s.setNumber || "").replace(/-1$/, "").trim()).filter(Boolean)
    )].length;
    if (total === 0) { toast.error("No sets in collection to sync."); return; }
    setBeValueSync({ done: 0, total });
    try {
      const { updated, skipped, failed } = await syncBEValues(({ done, total: t }) => {
        setBeValueSync({ done, total: t });
      });
      const now = new Date().toISOString();
      setBeValueSyncLast(now);
      setBeValueSync(null);
      toast.success(`BE values updated — ${updated} sets refreshed, ${skipped} cached, ${failed} failed.`, { duration: 6000 });
    } catch (err) {
      setBeValueSync(null);
      toast.error("BE value sync failed: " + (err.message || err));
    }
  }

  // ── Notification handlers ────────────────────────────────────
  async function enableNotifications() {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
    if (result === "granted") {
      localStorage.setItem("blNotificationsEnabled", "1");
      // Reset throttle so the next app open fires immediately
      localStorage.removeItem("blLastNotifyDate");
      setNotifEnabled(true);
      toast.success("Notifications enabled — price drops will alert on app open.");
    } else if (result === "denied") {
      toast.error("Notifications blocked. Allow them in your browser settings and try again.");
    }
  }

  function disableNotifications() {
    localStorage.removeItem("blNotificationsEnabled");
    setNotifEnabled(false);
    toast.success("Price drop notifications disabled.");
  }

  return (
    <div style={page}>
      <div style={stTabHeader}>
        <div>
          <h2 style={{ margin: 0 }}>Settings</h2>
          <p style={{ ...muted, margin: "4px 0 0" }}>App-wide configuration and data management.</p>
        </div>
        <div style={stTabBar}>
          {[
            { key: "general", label: "General" },
            { key: "data", label: "Data" },
          ].map(t => (
            <button key={t.key} onClick={() => setSettingsTab(t.key)} style={settingsTab === t.key ? stNavActiveTab : stNavTabBtn}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

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

      {settingsTab === "data" && (
      <section style={panel}>
        <h3 style={{ margin: "0 0 4px" }}>Cloud Backup</h3>
        <p style={{ ...mutedSmall, margin: "0 0 14px" }}>
          End-to-end encrypted sync — your data is encrypted with your passphrase before leaving the browser.
          The server only stores ciphertext; the passphrase is never saved or transmitted.
          Requires Upstash KV (<code style={{ color: "#c9a84c", fontSize: 12 }}>KV_REST_API_URL</code> + <code style={{ color: "#c9a84c", fontSize: 12 }}>KV_REST_API_TOKEN</code>) or a Redis URL (<code style={{ color: "#c9a84c", fontSize: 12 }}>REDIS_URL</code>).
        </p>

        {/* ── Cloud status ── */}
        {cloudStatus === "legacy" && (
          <div style={{ background: "#1a1500", border: "1px solid #78350f", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#fbbf24" }}>
            ⚠️ Your cloud backup is in the old unencrypted format. Set a passphrase below and hit <strong>Push to Cloud</strong> to upgrade it — then other browsers will prompt for the passphrase.
          </div>
        )}
        {cloudStatus === "empty" && (
          <div style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#8a9bb0" }}>
            No cloud backup found yet. Set a passphrase and push to get started.
          </div>
        )}
        {cloudStatus === "encrypted" && (
          <div style={{ background: "#0a1f0a", border: "1px solid #166534", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#5aa832" }}>
            🔒 Encrypted backup is in the cloud. Other browsers will prompt for your passphrase on load.
          </div>
        )}

        {/* ── Passphrase row ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <input
            type="password"
            placeholder={cloudPassphrase ? "●●●●●●●● (active this session)" : "Cloud backup passphrase"}
            value={cloudPassphrase ? "" : passphraseDraft}
            onChange={e => { onPassphraseChange(""); setPassphraseDraft(e.target.value); }}
            onKeyDown={e => { if (e.key === "Enter") handlePushToCloud(); }}
            style={{
              background: "#0b1520",
              border: `1px solid ${cloudPassphrase ? "#166534" : "rgba(255,255,255,0.12)"}`,
              borderRadius: 8, padding: "7px 12px", color: "#e8e2d5", fontSize: 13, outline: "none", width: 240,
            }}
          />
          {cloudPassphrase && (
            <button
              onClick={() => { onPassphraseChange(""); setPassphraseDraft(""); }}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "3px 10px", fontSize: 12, color: "#8a9bb0", cursor: "pointer" }}
            >
              Change
            </button>
          )}
          <span style={{ fontSize: 12, color: cloudPassphrase ? "#5aa832" : "#5d6f80" }}>
            {cloudPassphrase ? "🔒 Active this session" : "Never stored — re-enter each session"}
          </span>
        </div>

        {/* ── Push / Pull row ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button onClick={handlePushToCloud} disabled={cloudBusy || (!cloudPassphrase && !passphraseDraft)} style={{ ...smallButton, opacity: cloudBusy || (!cloudPassphrase && !passphraseDraft) ? 0.4 : 1 }}>
            {cloudBusy ? "Working…" : "Push to Cloud"}
          </button>
          <button onClick={handlePullFromCloud} disabled={cloudBusy || (!cloudPassphrase && !passphraseDraft)} style={{ ...smallButton, opacity: cloudBusy || (!cloudPassphrase && !passphraseDraft) ? 0.4 : 1 }}>
            Pull from Cloud
          </button>
          {lastCloudPush && (
            <div style={{ fontSize: 13, color: "#5d6f80" }}>
              Last push:{" "}
              <span style={{ color: "#8a9bb0" }}>{new Date(lastCloudPush).toLocaleString()}</span>
            </div>
          )}
        </div>
      </section>
      )}

      {settingsTab === "data" && (
      <section style={panel}>
        <h3 style={{ margin: "0 0 4px" }}>Local Backup</h3>
        <p style={{ ...mutedSmall, margin: "0 0 20px" }}>
          Schedule automatic downloads or save a full backup on demand. Backs up everything — collection, wanted list, budget, and settings.
        </p>

        {/* ── Auto-Export ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#8a9bb0", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Automatic</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
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
            </div>
          )}
        </div>

        <div style={dataDivider} />

        {/* ── Manual ── */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#8a9bb0", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Manual</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={exportFullBackup} style={redBtn}>Export Backup</button>
              <label style={ghostBtn}>Restore Backup<input type="file" accept=".json" onChange={importFullBackup} style={{ display: "none" }} /></label>
            </div>
            <div style={{ fontSize: 11, color: "#4d5e70" }}>Chrome/Edge: prompts to choose location · Safari/Firefox: saves to Downloads</div>
          </div>
        </div>
      </section>
      )}

      {settingsTab === "data" && (
      <section style={panel}>
        <h3 style={{ margin: "0 0 4px" }}>Data Sources</h3>
        <p style={{ ...muted, margin: "0 0 16px", fontSize: 13 }}>Each source has a specific role. Sync individually or let the app auto-refresh on a schedule.</p>

        {/* ── Source rows ── */}
        {[
          // Brickset
          {
            name: "Brickset",
            role: "Metadata authority — name, pieces, MSRP, minifigs, retirement dates",
            dot: (() => { try { return Object.keys(JSON.parse(localStorage.getItem("bricksetSetCache") || "{}")).length > 0 ? "#22c55e" : "#4d5e70"; } catch { return "#4d5e70"; } })(),
            status: (() => {
              try {
                const cache = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}");
                const count = Object.keys(cache).length;
                return count ? `${count} sets cached` : "No cache yet";
              } catch { return "No cache yet"; }
            })(),
            actions: (
              <button onClick={() => { localStorage.removeItem("bricksetSetCache"); toast.success("Brickset cache cleared"); }} style={ghostBtn}>
                Clear Cache
              </button>
            ),
          },
          // BrickEconomy
          {
            name: "BrickEconomy",
            role: "Value only — current value, 2yr & 5yr forecasts",
            dot: "#c9a84c",
            status: beValueSyncLast ? `Values synced ${new Date(beValueSyncLast).toLocaleDateString()}` : collectionSyncInfo.lastSync ? `Collection synced ${new Date(collectionSyncInfo.lastSync).toLocaleDateString()}` : "Never synced",
            actions: (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={handleSyncBEValues} disabled={!!beValueSync} style={redBtn}>
                  {beValueSync ? `${beValueSync.done}/${beValueSync.total}` : "Sync Values"}
                </button>
                <button onClick={clearApiCache} style={ghostBtn}>Clear Cache</button>
              </div>
            ),
            progress: beValueSync ? Math.round((beValueSync.done / beValueSync.total) * 100) : null,
          },
          // Brick Fanatics
          {
            name: "Brick Fanatics",
            role: "Retirement data — cross-references every tracked set against their retiring list",
            dot: bfSyncLast ? "#f59e0b" : "#4d5e70",
            status: bfSyncLast
              ? `Synced ${new Date(bfSyncLast).toLocaleDateString()}${bfSyncResult ? ` · ${bfSyncResult.updated} updated` : ""}`
              : "Not synced — auto-runs weekly",
            actions: (
              <button onClick={() => handleSyncBFRetirement(true)} disabled={bfSyncing} style={redBtn}>
                {bfSyncing ? "Syncing…" : "Sync Retirement"}
              </button>
            ),
          },
          // Rebrickable
          {
            name: "Rebrickable",
            role: "Local catalog — fills missing pieces & theme data, no API key needed",
            dot: rbLoaded ? "#22c55e" : "#f59e0b",
            status: rbLoaded
              ? `Catalog loaded${rbFillResult !== null ? ` · last fill: ${rbFillResult} fields` : ""}`
              : "Loading catalog…",
            actions: (
              <button onClick={handleRbFill} disabled={rbFilling || !rbLoaded} style={ghostBtn}>
                {rbFilling ? "Filling…" : rbFillResult !== null ? `Fill Missing (${rbFillResult} last)` : "Fill Missing"}
              </button>
            ),
          },
          // BrickLink
          {
            name: "BrickLink",
            role: "6-month US sold prices — new & used. Requires free BrickLink account.",
            dot: blConnected ? "#22c55e" : "#4d5e70",
            status: blConnected
              ? (blPriceSyncLast ? `Synced ${new Date(blPriceSyncLast).toLocaleDateString()}` : "Connected — not yet synced")
              : "Not connected",
            actions: blConnected ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={syncBrickLinkPrices} disabled={!!blPriceSync} style={redBtn}>
                  {blPriceSync ? `${blPriceSync.done}/${blPriceSync.total}` : "Sync BL Prices"}
                </button>
                <button onClick={testBrickLinkConnection} disabled={blTesting} style={ghostBtn}>
                  {blTesting ? "Testing…" : "Test"}
                </button>
                <button onClick={disconnectBrickLink} style={ghostBtn}>Disconnect</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <input
                  type="password"
                  placeholder="Paste access token…"
                  value={blAccessTokenInput}
                  onChange={e => setBlAccessTokenInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && saveBrickLinkToken()}
                  style={{ fontSize: 13, padding: "6px 10px", background: "#111d2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e2d5", width: 230 }}
                />
                <button onClick={saveBrickLinkToken} disabled={!blAccessTokenInput.trim()} style={redBtn}>Connect</button>
              </div>
            ),
            progress: blPriceSync ? Math.round((blPriceSync.done / blPriceSync.total) * 100) : null,
            link: !blConnected ? { href: "https://bricklink.com/v3/brickstore-access-management.page", label: "Get token ↗" } : null,
          },
        ].map(src => (
          <div key={src.name} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "14px 0", lastChild: { border: "none" } }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: src.dot, flexShrink: 0, marginTop: 5 }} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#e8e2d5" }}>{src.name}</span>
                  <span style={{ fontSize: 11, color: "#5d6f80" }}>{src.status}</span>
                  {src.link && <a href={src.link.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#c9a84c", textDecoration: "underline" }}>{src.link.label}</a>}
                </div>
                <div style={{ fontSize: 12, color: "#5d6f80", marginBottom: 10 }}>{src.role}</div>
                {src.actions}
                {src.progress != null && (
                  <div style={{ marginTop: 8, height: 3, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 999, background: "#c9a84c", width: `${src.progress}%`, transition: "width 0.3s ease" }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>
      )}

      {settingsTab === "data" && (
      <section style={panel}>
        <h3 style={{ margin: "0 0 4px" }}>Data Management</h3>
        <p style={{ ...muted, margin: "0 0 20px", fontSize: 13 }}>Export or import data by category.</p>

        {/* ── My Collection ── */}
        <div style={dataBlock}>
          <div style={dataBlockHeader}>
            <div>
              <div style={dataBlockTitle}>My Collection</div>
              <div style={dataBlockDesc}>Manually added owned sets · BrickEconomy sync is in Data Sources above</div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ ...dataBlockDesc, marginBottom: 6, fontWeight: 700, color: "#c9a84c" }}>Import from services</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <label style={redBtn}>BrickEconomy CSV<input type="file" accept=".csv" onChange={importBrickEconomyExportCSV} style={{ display: "none" }} /></label>
              <label style={ghostBtn}>Brickset My Sets CSV<input type="file" accept=".csv" onChange={importBricksetMySetCSV} style={{ display: "none" }} /></label>
            </div>
            <div style={{ ...dataBlockDesc, marginBottom: 14 }}>BrickEconomy: collection → Export → CSV &nbsp;·&nbsp; Brickset: My Sets → Export.</div>
            <div style={{ ...dataBlockDesc, marginBottom: 6, fontWeight: 700, color: "#8a9bb0" }}>Template import / export</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={downloadCollectionTemplate} style={ghostBtn}>Download Template</button>
              <label style={ghostBtn}>Import CSV<input type="file" accept=".csv" onChange={importCollectionCSV} style={{ display: "none" }} /></label>
              <button onClick={exportCollectionCSV} style={ghostBtn}>Export CSV</button>
              <button onClick={exportCollectionJSON} style={ghostBtn}>Export JSON</button>
              <button onClick={exportEnrichedCSV} style={ghostBtn}>Export Enriched CSV</button>
            </div>
          </div>
        </div>

        <div style={dataDivider} />

        {/* ── Wanted List ── */}
        <div style={dataBlock}>
          <div style={dataBlockHeader}>
            <div>
              <div style={dataBlockTitle}>Wanted List</div>
              <div style={dataBlockDesc}>Wanted sets, buy targets, and retirement tracking</div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={downloadWatchListTemplate} style={ghostBtn}>Download Template</button>
              <label style={ghostBtn}>Import CSV<input type="file" accept=".csv" onChange={importWantedListCSV} style={{ display: "none" }} /></label>
              <button onClick={exportWantedListJSON} style={ghostBtn}>Export JSON</button>
              <button onClick={exportWantedListCSV} style={ghostBtn}>Export CSV</button>
            </div>
          </div>
        </div>

        <div style={dataDivider} />

        {/* ── Budget & Purchases ── */}
        <div style={dataBlock}>
          <div style={dataBlockHeader}>
            <div>
              <div style={dataBlockTitle}>Budget & Purchases</div>
              <div style={dataBlockDesc}>Purchase log only · Excel (.xlsx) or CSV · use template to format your data</div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 24, marginBottom: 12, flexWrap: "wrap" }}>
              <label style={{ color: "#e8e2d5", fontSize: 14, cursor: "pointer" }}>
                <input type="radio" checked={importMode === "add"} onChange={() => setImportMode("add")} style={{ marginRight: 6 }} />Add new / skip duplicates
              </label>
              <label style={{ color: "#e8e2d5", fontSize: 14, cursor: "pointer" }}>
                <input type="radio" checked={importMode === "replace"} onChange={() => setImportMode("replace")} style={{ marginRight: 6 }} />Replace all
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={downloadCSVTemplate} style={ghostBtn}>Download Template</button>
              <label style={redBtn}>Import Excel<input type="file" accept=".xlsx,.xls" onChange={handleExcelImport} style={{ display: "none" }} /></label>
              <label style={ghostBtn}>Import CSV<input type="file" accept=".csv" onChange={importCSV} style={{ display: "none" }} /></label>
              <button onClick={exportCSV} style={ghostBtn}>Export CSV</button>
              <button onClick={exportJSON} style={ghostBtn}>Export JSON</button>
            </div>
          </div>
        </div>
      </section>
      )}



      {settingsTab === "general" && (
      <section style={panel}>
        <h3 style={{ margin: "0 0 4px" }}>Price Drop Notifications</h3>
        <p style={{ ...mutedSmall, margin: "0 0 14px" }}>
          Get a browser alert when a tracked set hits your target price or goes Last Chance. Fires once per day on app open.
        </p>
        {notifPermission === "unsupported" ? (
          <div style={{ fontSize: 13, color: "#5d6f80" }}>Your browser doesn't support notifications.</div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: notifEnabled && notifPermission === "granted" ? "#22c55e" : "#4d5e70", flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: notifEnabled && notifPermission === "granted" ? "#22c55e" : "#8a9bb0", fontWeight: 700 }}>
                {notifPermission === "denied" ? "Blocked by browser" : notifEnabled && notifPermission === "granted" ? "Enabled" : "Disabled"}
              </span>
            </div>
            {notifPermission === "denied" && (
              <div style={{ fontSize: 12, color: "#5d6f80" }}>Open your browser settings and allow notifications for this site.</div>
            )}
            {notifPermission !== "denied" && !notifEnabled && (
              <button onClick={enableNotifications} style={redBtn}>Enable Notifications</button>
            )}
            {notifEnabled && notifPermission === "granted" && (
              <button onClick={disableNotifications} style={ghostBtn}>Disable</button>
            )}
          </div>
        )}
      </section>
      )}

      {settingsTab === "general" && (
      <section style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Stores</h3>
          <button onClick={sortStoresAZ} title="Sort stores alphabetically" style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#8a9bb0", fontSize: 11, padding: "3px 9px", cursor: "pointer" }}>Sort A–Z</button>
        </div>
        <p style={{ ...mutedSmall, marginBottom: 14 }}>Add or remove stores. Click a name to rename — existing purchases update too.</p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 12, color: "#5d6f80", marginBottom: 5 }}>Store name</div>
            <input placeholder="e.g. Costco" value={newStore} onChange={e => setNewStore(e.target.value)} onKeyDown={e => e.key === "Enter" && addStore()} style={{ width: 200 }} />
          </div>
          <button onClick={addStore} style={ghostBtn}>Add Store</button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {stores.map(store => (
            <div key={store} style={{ display: "flex", alignItems: "center", gap: 10, background: "#0f1a28", border: `1px solid ${editingStore === store ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.07)"}`, borderRadius: 10, padding: "8px 12px", transition: "border-color 0.15s" }}>
              {editingStore === store ? (
                <>
                  <input
                    autoFocus
                    value={editingStoreName}
                    onChange={e => setEditingStoreName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") confirmRenameStore(store); if (e.key === "Escape") cancelEditStore(); }}
                    style={{ flex: 1, background: "#0a1624", border: "1px solid rgba(201,168,76,0.4)", borderRadius: 6, color: "#e8e2d5", fontSize: 13, padding: "4px 8px", outline: "none", fontWeight: 700 }}
                  />
                  <button onClick={() => confirmRenameStore(store)} title="Confirm rename" style={{ background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.3)", borderRadius: 6, color: "#c9a84c", fontSize: 14, padding: "3px 9px", cursor: "pointer", fontWeight: 700 }}>✓</button>
                  <button onClick={cancelEditStore} title="Cancel" style={{ background: "transparent", border: "none", color: "#5d6f80", fontSize: 17, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>✗</button>
                </>
              ) : (
                <>
                  <span onClick={() => startEditStore(store)} title="Click to rename" style={{ flex: 1, fontWeight: 700, cursor: "text", userSelect: "none" }}>{store}</span>
                  <button onClick={() => startEditStore(store)} title="Rename" style={{ background: "transparent", border: "none", color: "#3a4f63", cursor: "pointer", fontSize: 13, padding: "0 4px", lineHeight: 1 }}>✏</button>
                  <button onClick={() => deleteStore(store)} title="Delete store" style={{ background: "transparent", color: "#5d6f80", border: "none", cursor: "pointer", fontWeight: 900, fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
      )}
    </div>
  );
}

const page = { background: "transparent", color: "#e8e2d5", minHeight: "100vh", padding: 22 };
const panel = { background: "rgba(20,31,48,0.82)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 20, marginTop: 18, boxShadow: "0 4px 24px rgba(0,0,0,0.35)" };
const muted = { color: "#8a9bb0", marginTop: 6 };
const mutedSmall = { color: "#8a9bb0", fontSize: 14 };
const redBtn = { display: "inline-block", background: "#c9a84c", color: "#0d1623", border: "none", borderRadius: 10, padding: "10px 14px", fontWeight: 800, cursor: "pointer" };
const ghostBtn = { background: "transparent", color: "#8a9bb0", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", fontWeight: 800, cursor: "pointer" };
const smallButton = { ...ghostBtn, padding: "6px 10px" };


const stTabHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 4 };
const stTabBar = { display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" };
// Underline style — used for General / Data nav tabs
const stNavTabBtn = { background: "none", border: "none", borderBottom: "2px solid transparent", color: "#5d6f80", padding: "8px 0 10px", fontWeight: 700, cursor: "pointer", fontSize: 14, lineHeight: 1 };
const stNavActiveTab = { ...stNavTabBtn, color: "#e8e2d5", borderBottom: "2px solid #c9a84c" };
// Pill style — used for option pickers (currency, auto-export interval)
const stTabBtn = { background: "transparent", color: "#8a9bb0", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 18px", fontWeight: 800, cursor: "pointer", fontSize: 14 };
const stActiveTab = { ...stTabBtn, background: "#c9a84c", color: "#0d1623", border: "1px solid #c9a84c" };

const dataBlock = { padding: "4px 0" };
const dataBlockHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" };
const dataBlockTitle = { fontWeight: 800, fontSize: 15, color: "#e8e2d5", marginBottom: 3 };
const dataBlockDesc = { fontSize: 13, color: "#8a9bb0" };
const dataDivider = { height: 1, background: "rgba(255,255,255,0.06)", margin: "18px 0" };
const dropZoneStyle = { border: "2px dashed rgba(255,255,255,0.12)", borderRadius: 10, padding: "16px 20px", textAlign: "center", color: "#8a9bb0", background: "rgba(255,255,255,0.02)", fontSize: 13 };
