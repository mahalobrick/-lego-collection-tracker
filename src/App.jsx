import { useEffect, useState } from "react";
import { Toaster, toast } from "react-hot-toast";
import BudgetDashboard from "./BudgetDashboard";
import WantedList from "./WantedList";
import MyCollection from "./MyCollection";
import AppSettings from "./AppSettings";
import { exportFullBackup, pushToCloud, fetchFromCloud, decryptCloudBackup, applyBackupToLocalStorage } from "./utils/exportBackup";
import { runDailyBEBatch } from "./utils/beSyncValues";

export default function App() {
  const [view, setView] = useState(() => localStorage.getItem("blLastTab") || "collection");
  const [pendingPurchase, setPendingPurchase] = useState(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [cloudRestoreData, setCloudRestoreData] = useState(null); // non-null = show restore banner
  const [cloudPassphrase, setCloudPassphrase] = useState(() => {
    const p = sessionStorage.getItem("blCloudPassphraseHandoff");
    if (p) { sessionStorage.removeItem("blCloudPassphraseHandoff"); return p; }
    return "";
  }); // session-only, never persisted
  const [bannerPassphrase, setBannerPassphrase] = useState("");
  const [bannerError, setBannerError] = useState("");
  const [bannerBusy, setBannerBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | pending | syncing | saved

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 220);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function switchTab(tab) { setView(tab); localStorage.setItem("blLastTab", tab); }

  function handleBuyNow(item) {
    setPendingPurchase(item);
    switchTab("budget");
  }

  // Auto-export: check on every app boot whether the interval has elapsed.
  // showSaveFilePicker is unavailable here (no user gesture), so it always
  // falls back to the Downloads folder — which is what you want for auto.
  useEffect(() => {
    const days = Number(localStorage.getItem("blAutoExportDays") || "0");
    if (!days) return;
    const last = localStorage.getItem("blLastAutoExport");
    const daysSince = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
    if (daysSince >= days) {
      exportFullBackup().then(date => {
        if (date) toast.success(`Auto-backup saved · brickledger-backup-${date}.json`, { duration: 7000 });
      });
    }
  }, []);

  // Cloud sync banner: fetch the encrypted payload and compare timestamps.
  // If the cloud copy is meaningfully newer than this browser's last push,
  // show the banner prompting for the passphrase to decrypt and restore.
  useEffect(() => {
    fetchFromCloud().then(payload => {
      if (!payload || !payload.ciphertext) return; // nothing stored, or old unencrypted format
      const cloudTime     = payload.exportedAt ? new Date(payload.exportedAt).getTime() : 0;
      const localPushRaw  = localStorage.getItem("blLastCloudPush");
      const localPushTime = localPushRaw ? new Date(localPushRaw).getTime() : 0;
      if (cloudTime > localPushTime + 60_000) {
        setCloudRestoreData(payload); // payload = encrypted envelope, decrypted on Sync Now
      }
    }).catch(err => {
      console.warn("[BrickLedger] Cloud sync check failed:", err.message);
    });
  }, []);

  // Rolling daily batch: silently syncs 50 oldest-cached sets per day.
  // Cycle length auto-scales with collection size (600 sets = 12-day cycle).
  // New sets get priority — no fetchedAt means they go first.
  useEffect(() => {
    const timer = setTimeout(() => {
      runDailyBEBatch().catch(() => {}); // always silent — errors are non-critical
    }, 15_000); // 15s delay so UI is interactive first
    return () => clearTimeout(timer);
  }, []);

  // Cloud auto-push: push on mount (after 10s grace) and every 5 minutes.
  // Requires cloudPassphrase — re-registers when the passphrase is set/changed.
  // Also pushes when the tab becomes visible again (user returns to the app).
  useEffect(() => {
    const doPush = () => pushToCloud(cloudPassphrase).catch(() => {}); // always silent
    const timer = setTimeout(doPush, 10_000); // 10s after passphrase is set
    const interval = setInterval(doPush, 5 * 60_000); // every 5 min
    const onVisible = () => { if (document.visibilityState === "visible") doPush(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cloudPassphrase]);

  // Change-triggered auto-push: listen for any data write (emitted by the patched
  // localStorage.setItem in main.jsx), debounce 15s, then push silently.
  // Shows a small sync indicator in the nav while pending/syncing.
  useEffect(() => {
    if (!cloudPassphrase) return;
    let timer = null;
    const onChange = () => {
      setSyncStatus("pending");
      clearTimeout(timer);
      timer = setTimeout(async () => {
        setSyncStatus("syncing");
        try {
          await pushToCloud(cloudPassphrase);
          setSyncStatus("saved");
          setTimeout(() => setSyncStatus("idle"), 3000);
        } catch {
          setSyncStatus("idle"); // silent — interval will retry
        }
      }, 15_000);
    };
    window.addEventListener("brickledger:datachange", onChange);
    return () => { window.removeEventListener("brickledger:datachange", onChange); clearTimeout(timer); };
  }, [cloudPassphrase]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap');
        * { box-sizing: border-box; }
        @media (max-width: 700px) {
          .app-shell { padding: 12px !important; }
          .app-title { font-size: 26px !important; letter-spacing: 3px !important; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .owned-table-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .owned-table-scroll::-webkit-scrollbar-track { background: transparent; }
        .owned-table-scroll::-webkit-scrollbar-thumb { background: #2f3446; border-radius: 10px; }
        @media (max-width: 600px) {
          .app-header { padding: 18px 16px !important; }
          .nav-wrap { padding: 10px 12px !important; }
          .nav-pill { gap: 2px !important; padding: 4px !important; width: 100% !important; border-radius: 14px !important; }
          .nav-pill-btn { flex: 1 !important; padding: 9px 6px !important; font-size: 11px !important; letter-spacing: 0 !important; }
          .page-content { padding: 12px !important; }
        }
      `}</style>

      <div className="app-shell" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "radial-gradient(ellipse at top, #1a2840 0%, #0d1623 55%, #0b1020 100%)", minHeight: "100vh", padding: 0 }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <div className="app-header" style={{ background: "linear-gradient(180deg, #111e30 0%, #0d1623 100%)", padding: "28px 32px", textAlign: "center", borderBottom: "1px solid rgba(201,168,76,0.25)", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>
            <h1 className="app-title" style={{ margin: 0, fontSize: 36, fontWeight: 900, letterSpacing: 5, color: "#e8e2d5", textTransform: "uppercase" }}>
              BrickLedger
            </h1>
            <div style={{ width: 48, height: 2, background: "linear-gradient(90deg, transparent, #c9a84c, transparent)", margin: "12px auto 0", borderRadius: 999 }} />
          </div>

          <div className="nav-wrap" style={{ display: "flex", justifyContent: "center", padding: "12px 24px", position: "sticky", top: 0, zIndex: 100, background: "rgba(11,16,32,0.9)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="nav-pill" style={{
              display: "inline-flex",
              gap: 4,
              background: "rgba(20,31,48,0.85)",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 999,
              padding: 5,
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
              flexWrap: "wrap",
              justifyContent: "center"
            }}>
              {[
                { key: "collection", label: "My Collection" },
                { key: "budget", label: "Budget" },
                { key: "acquisition", label: "Wanted List" },
                { key: "settings", label: "Settings" }
              ].map(tab => (
                <button
                  key={tab.key}
                  className="nav-pill-btn"
                  onClick={() => switchTab(tab.key)}
                  style={{
                    border: "none",
                    borderRadius: 999,
                    padding: "10px 20px",
                    cursor: "pointer",
                    fontWeight: 800,
                    fontSize: 13,
                    letterSpacing: 0.3,
                    background: view === tab.key ? "#c9a84c" : "transparent",
                    color: view === tab.key ? "#0d1623" : "#8a9bb0",
                    transition: "all 0.15s ease"
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* Cloud sync status — only visible when passphrase is active and something is happening */}
            {cloudPassphrase && syncStatus !== "idle" && (
              <div style={{
                position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)",
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 11, fontWeight: 600, pointerEvents: "none",
                color: syncStatus === "saved" ? "#22c55e" : "#c9a84c",
              }}>
                {syncStatus === "pending" && <span style={{ fontSize: 7, animation: "pulse-dot 1.5s ease-in-out infinite" }}>●</span>}
                {syncStatus === "syncing" && <span style={{ display: "inline-block", animation: "spin 0.8s linear infinite" }}>↻</span>}
                {syncStatus === "saved"   && <span>✓</span>}
                <span>{syncStatus === "pending" ? "Unsaved" : syncStatus === "syncing" ? "Syncing…" : "Saved"}</span>
              </div>
            )}
          </div>

          <Toaster
            position="bottom-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: "#0d1623",
                color: "#e8e2d5",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 10,
                fontSize: 13,
                fontFamily: "'Inter', sans-serif",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              },
              success: { iconTheme: { primary: "#5aa832", secondary: "#0d1623" } },
              error:   { iconTheme: { primary: "#ff8b8b", secondary: "#0d1623" } },
            }}
          />

          <div className="page-content">
            {view === "collection" && <MyCollection onBuyNow={handleBuyNow} onSwitchTab={switchTab} />}
            {view === "acquisition" && <WantedList onBuyNow={handleBuyNow} />}
            {view === "budget" && (
              <BudgetDashboard
                pendingPurchase={pendingPurchase}
                onPendingPurchaseConsumed={() => setPendingPurchase(null)}
                onNavigateToSettings={() => switchTab("settings")}
              />
            )}
{view === "settings" && <AppSettings cloudPassphrase={cloudPassphrase} onPassphraseChange={setCloudPassphrase} />}
          </div>
        </div>
      </div>

      {/* Cloud sync banner — encrypted backup is newer than this browser's last push */}
      {cloudRestoreData && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 300,
          background: "linear-gradient(90deg, #0d1e35, #0f2540)",
          borderTop: "1px solid rgba(201,168,76,0.4)",
          boxShadow: "0 -4px 32px rgba(0,0,0,0.6)",
          padding: "14px 20px",
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          fontFamily: "'Inter', sans-serif",
        }}>
          <span style={{ fontSize: 20 }}>🔒</span>
          <span style={{ color: "#e8e2d5", fontSize: 13 }}>
            Encrypted cloud backup from{" "}
            <strong>{cloudRestoreData.exportedAt ? new Date(cloudRestoreData.exportedAt).toLocaleString() : "a previous session"}</strong>
          </span>
          <input
            type="password"
            placeholder="Enter passphrase"
            value={bannerPassphrase}
            onChange={e => { setBannerPassphrase(e.target.value); setBannerError(""); }}
            onKeyDown={e => { if (e.key === "Enter" && bannerPassphrase) e.currentTarget.nextSibling?.click(); }}
            style={{
              background: "#0b1520", border: `1px solid ${bannerError ? "#ef4444" : "rgba(255,255,255,0.12)"}`,
              borderRadius: 8, padding: "7px 12px", color: "#e8e2d5", fontSize: 13,
              outline: "none", width: 180,
            }}
          />
          <button
            disabled={!bannerPassphrase || bannerBusy}
            onClick={async () => {
              setBannerBusy(true);
              setBannerError("");
              try {
                const backup = await decryptCloudBackup(cloudRestoreData, bannerPassphrase);
                applyBackupToLocalStorage(backup);
                if (cloudRestoreData.exportedAt) {
                  localStorage.setItem("blLastCloudPush", cloudRestoreData.exportedAt);
                }
                // Promote the passphrase for this session so auto-push starts working
                setCloudPassphrase(bannerPassphrase);
                sessionStorage.setItem("blCloudPassphraseHandoff", bannerPassphrase);
                setCloudRestoreData(null);
                toast.success("Cloud backup restored — reloading…", { duration: 3000 });
                setTimeout(() => window.location.reload(), 1500);
              } catch (err) {
                setBannerError(err?.message?.startsWith("Backup version") ? err.message : "Wrong passphrase");
              } finally {
                setBannerBusy(false);
              }
            }}
            style={{
              background: bannerPassphrase && !bannerBusy ? "#c9a84c" : "#1a2840",
              color: bannerPassphrase && !bannerBusy ? "#0d1623" : "#5d6f80",
              border: "none", borderRadius: 8, padding: "8px 18px",
              fontWeight: 700, fontSize: 13, cursor: bannerPassphrase ? "pointer" : "default",
              transition: "all 0.15s",
            }}
          >
            {bannerBusy ? "Decrypting…" : "Sync Now"}
          </button>
          {bannerError && <span style={{ color: "#ef4444", fontSize: 12 }}>{bannerError}</span>}
          <button
            onClick={() => { setCloudRestoreData(null); setBannerPassphrase(""); setBannerError(""); }}
            style={{ background: "transparent", color: "#5d6f80", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}
          >
            Not Now
          </button>
        </div>
      )}

      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title="Back to top"
          aria-label="Scroll to top"
          style={{
            position: "fixed", bottom: cloudRestoreData ? 96 : 24, right: 24, zIndex: 200,
            width: 38, height: 38, borderRadius: "50%",
            background: "rgba(20,31,48,0.92)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "#c9a84c", fontSize: 18, lineHeight: 1,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.45)",
            transition: "opacity 0.15s ease",
          }}
        >
          ↑
        </button>
      )}
    </>
  );
}
