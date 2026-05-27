import { useEffect, useState } from "react";
import { Toaster, toast } from "react-hot-toast";
import BudgetDashboard from "./BudgetDashboard";
import WantedList from "./WantedList";
import MyCollection from "./MyCollection";
import AppSettings from "./AppSettings";
import { exportFullBackup, pushToCloud, fetchFromCloud, applyBackupToLocalStorage } from "./utils/exportBackup";
import { syncBEValues, runDailyBEBatch } from "./utils/beSyncValues";

export default function App() {
  const [view, setView] = useState("collection");
  const [pendingPurchase, setPendingPurchase] = useState(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [cloudRestoreData, setCloudRestoreData] = useState(null); // non-null = show restore banner

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 220);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function handleBuyNow(item) {
    setPendingPurchase(item);
    setView("budget");
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

  // Cloud restore banner: on first load, if localStorage looks fresh (no sets),
  // check for a cloud backup and offer to restore it.
  useEffect(() => {
    const localSets = localStorage.getItem("blOwnedSets");
    const beNormalized = localStorage.getItem("brickEconomyNormalizedCollection");
    const hasLocalData = (localSets && localSets !== "[]") || (beNormalized && beNormalized !== "[]");
    if (hasLocalData) return; // existing data — no need to prompt
    fetchFromCloud().then(data => {
      if (data && data.app === "BrickLedger") setCloudRestoreData(data);
    }).catch(() => {}); // silent — cloud may not be configured
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
  // Also push whenever the tab becomes visible again (user returns to the app).
  useEffect(() => {
    const doPush = () => pushToCloud().catch(() => {}); // always silent
    const timer = setTimeout(doPush, 10_000); // 10s after mount
    const interval = setInterval(doPush, 5 * 60_000); // every 5 min
    const onVisible = () => { if (document.visibilityState === "visible") doPush(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800;900&display=swap');
        * { box-sizing: border-box; }
        @media (max-width: 700px) {
          .app-shell { padding: 12px !important; }
          .app-title { font-size: 26px !important; letter-spacing: 3px !important; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
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
                  onClick={() => setView(tab.key)}
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
            {view === "collection" && <MyCollection onBuyNow={handleBuyNow} onSwitchTab={setView} />}
            {view === "acquisition" && <WantedList onBuyNow={handleBuyNow} />}
            {view === "budget" && (
              <BudgetDashboard
                pendingPurchase={pendingPurchase}
                onPendingPurchaseConsumed={() => setPendingPurchase(null)}
                onNavigateToSettings={() => setView("settings")}
              />
            )}
{view === "settings" && <AppSettings />}
          </div>
        </div>
      </div>

      {/* Cloud restore banner — shown when localStorage is fresh and cloud backup exists */}
      {cloudRestoreData && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 300,
          background: "linear-gradient(90deg, #0d1e35, #0f2540)",
          borderTop: "1px solid rgba(201,168,76,0.4)",
          boxShadow: "0 -4px 32px rgba(0,0,0,0.6)",
          padding: "14px 20px",
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          fontFamily: "'Inter', sans-serif",
        }}>
          <span style={{ fontSize: 20 }}>☁️</span>
          <span style={{ flex: 1, color: "#e8e2d5", fontSize: 13 }}>
            A cloud backup from{" "}
            <strong>{cloudRestoreData.exportedAt ? new Date(cloudRestoreData.exportedAt).toLocaleString() : "a previous session"}</strong>{" "}
            was found. Restore it to recover your collection?
          </span>
          <button
            onClick={() => {
              applyBackupToLocalStorage(cloudRestoreData);
              setCloudRestoreData(null);
              toast.success("Cloud backup restored — reloading…", { duration: 3000 });
              setTimeout(() => window.location.reload(), 1500);
            }}
            style={{ background: "#c9a84c", color: "#0d1623", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
          >
            Restore
          </button>
          <button
            onClick={() => setCloudRestoreData(null)}
            style={{ background: "transparent", color: "#5d6f80", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title="Back to top"
          aria-label="Scroll to top"
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 200,
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
