import { asNumber, money, setImageUrl } from "./utils/formatting";

function StatBox({ label, value, color, span }) {
  return (
    <div style={{
      background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10,
      padding: "10px 12px", gridColumn: span === 2 ? "1 / -1" : undefined
    }}>
      <div style={{ color: "#8a9bb0", fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 900, fontSize: 15, color: color || "#e8e2d5" }}>{value ?? "—"}</div>
    </div>
  );
}

function longDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return null;
  return d.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "long", day: "numeric" });
}

export default function PurchaseDetailPanel({ item, onClose, onEdit }) {
  if (!item) return null;

  // Pull cached BrickEconomy set data for context
  const setCache = (() => {
    try { return JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}"); } catch { return {}; }
  })();
  const cacheEntry = setCache[item.setNumber] || setCache[String(item.setNumber || "").replace(/-1$/, "")] || {};
  const cached = cacheEntry.data || {};
  const pieces = cached.pieces_count || null;
  const releaseYear = cached.year || Number(String(cached.released_date || "").slice(0, 4)) || null;
  const msrp = asNumber(cached.retail_price_us) || null;

  const qty = asNumber(item.qty) || 1;
  const unitPrice = asNumber(item.amount);
  const total = unitPrice * qty;
  const vsRetail = msrp && unitPrice > 0 ? ((unitPrice - msrp) / msrp) * 100 : null;

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
            <div style={{ color: "#8a9bb0", fontSize: 12, marginBottom: 4 }}>Purchase</div>
            <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.3, color: "#e8e2d5" }}>
              {item.name || item.setNumber || "Unnamed Purchase"}
            </h2>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {onEdit && (
              <button onClick={onEdit} style={{ background: "#1a2840", border: "1px solid rgba(255,255,255,0.08)", color: "#c9a84c", borderRadius: 8, padding: "0 12px", height: 32, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                Edit
              </button>
            )}
            <button onClick={onClose} style={{ background: "#1a2840", border: "1px solid rgba(255,255,255,0.08)", color: "#e8e2d5", borderRadius: 999, width: 32, height: 32, cursor: "pointer", fontWeight: 900, fontSize: 18 }}>×</button>
          </div>
        </div>

        {/* ── Set image ── */}
        {item.setNumber && (
          <img
            src={setImageUrl(item.setNumber)}
            alt=""
            onError={e => { e.currentTarget.style.display = "none"; }}
            style={{ width: "100%", maxHeight: 180, objectFit: "contain", background: "#0b1520", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", padding: 8 }}
          />
        )}

        {/* ── Cached set metadata chips ── */}
        {(releaseYear || pieces || msrp) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {releaseYear && <span style={chip}>{releaseYear}</span>}
            {pieces && <span style={chip}>{pieces.toLocaleString()} pcs</span>}
            {msrp && <span style={chip}>MSRP {money(msrp)}</span>}
          </div>
        )}

        {/* ── All table columns as stat boxes ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <StatBox label="Set #"      value={item.setNumber || "—"} />
          <StatBox label="Theme"      value={item.theme || "—"} />
          <StatBox label="Store"      value={item.store || "—"} />
          <StatBox label="Date"       value={longDate(item.date)} />
          <StatBox label="Qty"        value={qty} />
          <StatBox label="Unit Price" value={money(unitPrice)} />
          <StatBox label="Total"      value={money(total)} />
          {msrp ? (
            <StatBox
              label="vs. MSRP"
              value={vsRetail !== null ? `${vsRetail >= 0 ? "+" : ""}${vsRetail.toFixed(1)}%` : "—"}
              color={vsRetail !== null ? (vsRetail <= 0 ? "#5aa832" : "#ff8b8b") : undefined}
            />
          ) : (
            <StatBox label="Set Name" value={item.name || "—"} />
          )}
        </div>

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
