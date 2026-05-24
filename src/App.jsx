import { useEffect, useState } from "react";
import BudgetDashboard from "./BudgetDashboard";
import WantedList from "./WantedList";
import MyCollection from "./MyCollection";
import AppSettings from "./AppSettings";
import { exportFullBackup } from "./utils/exportBackup";

export default function App() {
  const [view, setView] = useState("collection");
  const [autoExportToast, setAutoExportToast] = useState("");
  const [pendingPurchase, setPendingPurchase] = useState(null);

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
        if (date) {
          setAutoExportToast(`Auto-backup saved · brickledger-backup-${date}.json`);
          setTimeout(() => setAutoExportToast(""), 7000);
        }
      });
    }
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
        @media (max-width: 600px) {
          .app-header { padding: 18px 16px !important; }
          .nav-wrap { padding: 10px 12px 0 !important; }
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
            <div style={{ marginTop: 10 }}>
              <a href="https://ko-fi.com/mahalobrick" target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", borderRadius: 999, background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)", color: "#c9a84c", fontSize: 12, fontWeight: 700, textDecoration: "none", letterSpacing: 0.3 }}>
                ☕ Support on Ko-fi
              </a>
            </div>
          </div>

          <div className="nav-wrap" style={{ display: "flex", justifyContent: "center", padding: "16px 24px 0" }}>
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

          {autoExportToast && (
            <div style={{
              position: "fixed", bottom: 24, right: 24, zIndex: 2000,
              background: "#0a2e1a", border: "1px solid #166534", borderRadius: 10,
              padding: "12px 18px", color: "#5aa832", fontWeight: 700, fontSize: 13,
              boxShadow: "0 4px 24px rgba(0,0,0,0.5)", maxWidth: 380
            }}>
              ✓ {autoExportToast}
            </div>
          )}

          <div className="page-content">
            {view === "collection" && <MyCollection onBuyNow={handleBuyNow} onSwitchTab={setView} />}
            {view === "acquisition" && <WantedList onBuyNow={handleBuyNow} />}
            {view === "budget" && (
              <BudgetDashboard
                pendingPurchase={pendingPurchase}
                onPendingPurchaseConsumed={() => setPendingPurchase(null)}
              />
            )}
            {view === "settings" && <AppSettings />}
          </div>
        </div>
      </div>
    </>
  );
}
