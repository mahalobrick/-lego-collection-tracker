import { asNumber, money, setImageUrl } from "./utils/formatting";

function StatBox({ label, value, color }) {
  return (
    <div style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ color: "#8a9bb0", fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 900, fontSize: 15, color: color || "#e8e2d5" }}>{value || "—"}</div>
    </div>
  );
}

export default function WatchDetailPanel({ item, onClose, onEdit, onBuyNow }) {
  if (!item) return null;

  // Pull cached BrickEconomy set data (pieces, year, market value)
  const setCache = (() => {
    try { return JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}"); } catch { return {}; }
  })();
  const cacheEntry = setCache[item.setNumber] || setCache[String(item.setNumber || "").replace(/-1$/, "")] || {};
  const cached = cacheEntry.data || {};
  const pieces = cached.pieces_count || null;
  const releaseYear = cached.year || Number(String(cached.released_date || "").slice(0, 4)) || null;
  const marketValue = asNumber(cached.current_value_new) || null;

  const msrp = asNumber(item.msrp);
  const targetPrice = asNumber(item.targetPrice);
  const discount = msrp > 0 && targetPrice > 0 ? ((msrp - targetPrice) / msrp) * 100 : null;
  const savings = msrp > 0 && targetPrice > 0 ? msrp - targetPrice : null;
  const discountColor = discount === null ? "#e8e2d5" : discount >= 20 ? "#5aa832" : discount >= 10 ? "#f59e0b" : "#ff8b8b";

  const score = item.score ?? item.priority ?? null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 999, backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 420, maxWidth: "100vw",
        background: "rgba(13,22,35,0.97)", borderLeft: "1px solid rgba(255,255,255,0.08)", zIndex: 1000,
        overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 20,
        boxShadow: "-8px 0 40px rgba(0,0,0,0.6)"
      }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "#8a9bb0", fontSize: 12, marginBottom: 4 }}>
              {item.theme || "—"} • #{item.setNumber}
            </div>
            <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.3, color: "#e8e2d5" }}>
              {item.name || item.setNumber}
            </h2>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {item.status && (
                <span style={chip}>{item.status}</span>
              )}
              {item.retiringSoon && (
                <span style={{ ...chip, background: "#3b0a0a", border: "1px solid #7f1d1d", color: "#ff8b8b", fontWeight: 700 }}>
                  Retiring Soon
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {onBuyNow && (
              <button onClick={onBuyNow} style={{ background: "#0a2e1a", border: "1px solid #166534", color: "#5aa832", borderRadius: 8, padding: "0 12px", height: 32, cursor: "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
                Bought →
              </button>
            )}
            {onEdit && (
              <button onClick={onEdit} style={{ background: "#1a2840", border: "1px solid rgba(255,255,255,0.08)", color: "#c9a84c", borderRadius: 8, padding: "0 12px", height: 32, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                Edit
              </button>
            )}
            <button onClick={onClose} style={{ background: "#1a2840", border: "1px solid rgba(255,255,255,0.08)", color: "#e8e2d5", borderRadius: 999, width: 32, height: 32, cursor: "pointer", fontWeight: 900, fontSize: 18 }}>×</button>
          </div>
        </div>

        {/* ── Set image ── */}
        <img
          src={setImageUrl(item.setNumber)}
          alt=""
          onError={e => { e.currentTarget.style.display = "none"; }}
          style={{ width: "100%", maxHeight: 180, objectFit: "contain", background: "#0b1520", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", padding: 8 }}
        />

        {/* ── Metadata chips ── */}
        {(releaseYear || pieces || msrp > 0) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {releaseYear && <span style={chip}>{releaseYear}</span>}
            {pieces && <span style={chip}>{pieces.toLocaleString()} pcs</span>}
            {msrp > 0 && <span style={chip}>MSRP {money(msrp)}</span>}
          </div>
        )}

        {/* ── Pricing ── */}
        <div>
          <div style={sectionLabel}>Pricing</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <StatBox label="MSRP" value={msrp > 0 ? money(msrp) : null} />
            <StatBox label="Target Price" value={targetPrice > 0 ? money(targetPrice) : null} />
            {discount !== null && (
              <StatBox label="Discount at Target" value={`${discount.toFixed(1)}%`} color={discountColor} />
            )}
            {savings !== null && (
              <StatBox label="Savings" value={money(savings)} color="#5aa832" />
            )}
            {marketValue && (
              <StatBox label="Market Value" value={money(marketValue)} />
            )}
            {marketValue && msrp > 0 && (
              <StatBox
                label="Market vs. MSRP"
                value={`${marketValue >= msrp ? "+" : ""}${(((marketValue - msrp) / msrp) * 100).toFixed(1)}%`}
                color={marketValue >= msrp ? "#5aa832" : "#ff8b8b"}
              />
            )}
          </div>
        </div>

        {/* ── Priority & retirement ── */}
        {(score !== null || item.retirementYear || item.retirementConfidence) && (
          <div>
            <div style={sectionLabel}>Buy Signal</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {score !== null && <StatBox label="Priority Score" value={score} />}
              {item.retirementYear && (
                <StatBox label="Retirement Year" value={item.retirementYear} color={item.retiringSoon ? "#ff8b8b" : "#e8e2d5"} />
              )}
              {item.retirementConfidence && <StatBox label="Confidence" value={item.retirementConfidence} />}
              {item.retirementSource && <StatBox label="Data Source" value={item.retirementSource} />}
            </div>
          </div>
        )}

        {/* ── Notes ── */}
        {item.notes && (
          <div style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ color: "#8a9bb0", fontSize: 11, marginBottom: 4 }}>Notes</div>
            <div style={{ fontSize: 14, color: "#e8e2d5", lineHeight: 1.5 }}>{item.notes}</div>
          </div>
        )}
      </div>
    </>
  );
}

const chip = { background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "#8a9bb0" };
const sectionLabel = { color: "#8a9bb0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 };
