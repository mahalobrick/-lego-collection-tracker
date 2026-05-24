import { asNumber, money, setImageUrl, conditionLabel, conditionColor, daysUntilRetirement } from "./utils/formatting";

function entryPaid(e) {
  return asNumber(e.paid_price ?? e.Paid ?? e.paid ?? 0);
}

function entryValue(e) {
  return asNumber(e.current_value ?? e.Value ?? e.value ?? 0);
}


function shortDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function StatBox({ label, value, color }) {
  return (
    <div style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ color: "#8a9bb0", fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 900, fontSize: 15, color: color || "#e8e2d5" }}>{value}</div>
    </div>
  );
}

export function openSetDetail(setNumber) {
  const col = (() => {
    try { return JSON.parse(localStorage.getItem("brickEconomyNormalizedCollection") || "[]"); } catch { return []; }
  })();
  return col.find(n => n.setNumber === setNumber) || null;
}

export default function SetDetailPanel({ item, onClose, onEdit }) {
  if (!item) return null;

  const entries = item.entries || [];
  const qty = item.quantity || entries.length || 1;
  const totalPaid = asNumber(item.totalPaid);
  const totalValue = asNumber(item.totalValue);
  const gain = totalValue - totalPaid;
  const roi = totalPaid > 0 ? (gain / totalPaid) * 100 : 0;
  const avgPaid = qty > 0 ? totalPaid / qty : 0;

  // Enrich with cached BrickEconomy set data
  const setCache = (() => {
    try { return JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}"); } catch { return {}; }
  })();
  const cacheEntry = setCache[item.setNumber] || setCache[String(item.setNumber).replace(/-1$/, "")] || {};
  const cached = cacheEntry.data || {};
  const pieces = cached.pieces_count || null;
  const releaseYear = cached.year || Number(String(cached.released_date || "").slice(0, 4)) || null;
  const retailPrice = asNumber(cached.retail_price_us) || null;
  const forecast2yr = asNumber(cached.forecast_value_new_2_years) || null;
  const forecast5yr = asNumber(cached.forecast_value_new_5_years) || null;

  // Enrich with cached Brickset data (retirement, details)
  const bsCache = (() => {
    try { return JSON.parse(localStorage.getItem("bricksetSetCache") || "{}"); } catch { return {}; }
  })();
  const bsKey = item.setNumber || "";
  const bsEntry = bsCache[bsKey] || bsCache[String(bsKey).replace(/-1$/, "")] || bsCache[`${String(bsKey).replace(/-1$/, "")}-1`] || {};
  const bs = bsEntry.data || {};
  const subtheme = bs.subtheme || null;
  const minifigs = bs.minifigs != null ? bs.minifigs : null;
  const rating = bs.rating ? Number(bs.rating) : null;
  const ageMin = bs.age_min || null;
  const exitDate = bs.exit_date || null;

  // Last Chance detection from cached codes
  const isLastChance = (() => {
    try {
      const lc = JSON.parse(localStorage.getItem("legoLastChanceCache") || "null");
      if (!lc?.setCodes) return false;
      const clean = String(item.setNumber || "").replace(/-1$/, "");
      return lc.setCodes.includes(clean) || lc.setCodes.includes(`${clean}-1`);
    } catch { return false; }
  })();

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 999, backdropFilter: "blur(4px)" }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 420, maxWidth: "100vw",
        background: "rgba(13,22,35,0.97)", borderLeft: "1px solid rgba(255,255,255,0.08)", zIndex: 1000,
        overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 20,
        boxShadow: "-8px 0 40px rgba(0,0,0,0.6)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ color: "#8a9bb0", fontSize: 12, marginBottom: 4 }}>{item.theme || "—"} • #{item.setNumber}</div>
            <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.3, color: "#e8e2d5" }}>{item.name || item.setNumber}</h2>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{
                background: item.retired ? "#3b0a0a" : "#0a2e1a",
                border: `1px solid ${item.retired ? "#7f1d1d" : "#166534"}`,
                color: item.retired ? "#ff8b8b" : "#5aa832",
                borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700
              }}>
                {item.retired ? "Retired" : "Active"}
              </span>
              {isLastChance && (
                <span style={{ background: "#3b0a0a", border: "1px solid #7f1d1d", color: "#ef4444", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 800 }}>
                  🚨 Last Chance
                </span>
              )}
              {exitDate && !item.retired && (() => {
                const days = daysUntilRetirement(exitDate);
                const color = days <= 60 ? "#ef4444" : days <= 180 ? "#f59e0b" : "#5aa832";
                return (
                  <span style={{ background: "#0f1a28", border: `1px solid ${color}40`, color, borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
                    {days <= 0 ? "Past retirement date" : `Retires in ${days}d`}
                  </span>
                );
              })()}
              <span style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "#8a9bb0" }}>
                {qty} {qty === 1 ? "copy" : "copies"}
              </span>
            </div>
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

        <img
          src={setImageUrl(item.setNumber)}
          alt=""
          onError={e => { e.currentTarget.style.display = "none"; }}
          style={{ width: "100%", maxHeight: 180, objectFit: "contain", background: "#0b1520", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", padding: 8 }}
        />

        {(pieces || releaseYear || retailPrice) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {releaseYear && <span style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "#8a9bb0" }}>{releaseYear}</span>}
            {pieces && <span style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "#8a9bb0" }}>{pieces.toLocaleString()} pcs</span>}
            {retailPrice && <span style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "#8a9bb0" }}>MSRP {money(retailPrice)}</span>}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <StatBox label="Cost Basis" value={money(totalPaid)} />
          <StatBox label="Market Value" value={money(totalValue)} />
          <StatBox label="Net Gain" value={money(gain)} color={gain >= 0 ? "#5aa832" : "#ff8b8b"} />
          <StatBox label="ROI" value={`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`} color={roi >= 0 ? "#5aa832" : "#ff8b8b"} />
          <StatBox label="Avg Paid / Copy" value={money(avgPaid)} />
          <StatBox label="Value / Copy" value={qty > 0 ? money(totalValue / qty) : "—"} />
          {retailPrice && totalPaid > 0 && <StatBox label="vs. Retail" value={`${(((totalValue / qty) - retailPrice) / retailPrice * 100) >= 0 ? "+" : ""}${(((totalValue / qty) - retailPrice) / retailPrice * 100).toFixed(1)}%`} color={(totalValue / qty) >= retailPrice ? "#5aa832" : "#ff8b8b"} />}
        </div>

        {(forecast2yr || forecast5yr) && (
          <div>
            <div style={sectionLabel}>Investment Forecast</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {forecast2yr && <StatBox label="2yr Forecast" value={money(forecast2yr)} color="#5aa832" />}
              {forecast5yr && <StatBox label="5yr Forecast" value={money(forecast5yr)} color="#5aa832" />}
              {forecast2yr && retailPrice && (
                <StatBox
                  label="2yr vs. Retail"
                  value={`${forecast2yr >= retailPrice ? "+" : ""}${(((forecast2yr - retailPrice) / retailPrice) * 100).toFixed(1)}%`}
                  color={forecast2yr >= retailPrice ? "#5aa832" : "#ff8b8b"}
                />
              )}
              {forecast5yr && retailPrice && (
                <StatBox
                  label="5yr vs. Retail"
                  value={`${forecast5yr >= retailPrice ? "+" : ""}${(((forecast5yr - retailPrice) / retailPrice) * 100).toFixed(1)}%`}
                  color={forecast5yr >= retailPrice ? "#5aa832" : "#ff8b8b"}
                />
              )}
            </div>
          </div>
        )}

        {(subtheme || minifigs != null || rating || ageMin) && (
          <div>
            <div style={sectionLabel}>Set Details</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {subtheme && <StatBox label="Subtheme" value={subtheme} />}
              {minifigs != null && <StatBox label="Minifigs" value={minifigs} />}
              {rating && <StatBox label="Rating" value={`★ ${rating.toFixed(1)}`} />}
              {ageMin && <StatBox label="Min Age" value={`${ageMin}+`} />}
            </div>
          </div>
        )}

        {entries.length > 0 && (
          <div>
            <div style={{ color: "#8a9bb0", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
              Per-Copy Breakdown
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {entries.map((entry, i) => {
                const paid = entryPaid(entry);
                const val = entryValue(entry);
                const g = val - paid;
                const r = paid > 0 ? (g / paid) * 100 : 0;
                const cond = conditionLabel(entry.condition);
                const acquired = shortDate(entry.aquired_date || entry.acquired_date);
                return (
                  <div key={i} style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {cond && (
                          <span style={{ background: "#0b1520", border: `1px solid ${conditionColor(entry.condition)}`, color: conditionColor(entry.condition), borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                            {cond}
                          </span>
                        )}
                        {acquired && <span style={{ color: "#5d6f80", fontSize: 12 }}>{acquired}</span>}
                        {!cond && !acquired && <span style={{ color: "#5d6f80", fontSize: 13 }}>Copy {i + 1}</span>}
                      </div>
                      <span style={{ color: r >= 0 ? "#5aa832" : "#ff8b8b", fontWeight: 900, fontSize: 13 }}>
                        {r >= 0 ? "+" : ""}{r.toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ color: "#5d6f80", fontSize: 11 }}>Paid</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#e8e2d5" }}>{money(paid)}</div>
                      </div>
                      <div>
                        <div style={{ color: "#5d6f80", fontSize: 11 }}>Value</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#e8e2d5" }}>{money(val)}</div>
                      </div>
                      <div>
                        <div style={{ color: "#5d6f80", fontSize: 11 }}>Gain</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: g >= 0 ? "#5aa832" : "#ff8b8b" }}>{money(g)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const sectionLabel = { color: "#8a9bb0", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 };
