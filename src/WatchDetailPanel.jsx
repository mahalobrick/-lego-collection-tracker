import { useState, useEffect } from "react";
import { asNumber, money, setImageUrl, daysUntilRetirement, retirementWaveLabel, priorityScore, recommendation } from "./utils/formatting";
import { fetchBrickLinkPriceGuide, hasBrickLinkAuth } from "./utils/bricklink-client";
import { getPriceHistory } from "./utils/priceHistory";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

function StatBox({ label, value, color }) {
  return (
    <div style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ color: "#8a9bb0", fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 900, fontSize: 15, color: color || "#e8e2d5" }}>{value || "—"}</div>
    </div>
  );
}

export default function WatchDetailPanel({ item, onClose, onEdit, onBuyNow }) {
  const [blPrice, setBlPrice] = useState(null);

  useEffect(() => {
    if (item?.setNumber && hasBrickLinkAuth()) {
      fetchBrickLinkPriceGuide(item.setNumber).then(setBlPrice).catch(() => {});
    }
  }, [item?.setNumber]);

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
  const forecast2yr = cached.forecast_value_new_2_years || null;
  const forecast5yr = cached.forecast_value_new_5_years || null;

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
              {item.isLastChance && (
                <span style={{ ...chip, background: "#3b0a0a", border: "1px solid #7f1d1d", color: "#ef4444", fontWeight: 800 }}>
                  🚨 Last Chance
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {onBuyNow && (
              <button onClick={onBuyNow} style={{ background: "#0a2e1a", border: "1px solid #166534", color: "#5aa832", borderRadius: 8, padding: "0 12px", height: 32, cursor: "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>
                Purchase
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
            {blPrice?.avg_price_new && (
              <StatBox label="BL Avg (New)" value={money(blPrice.avg_price_new)} color="#3b82f6" />
            )}
            {blPrice?.min_price_new && blPrice?.max_price_new && (
              <StatBox label="BL New Range" value={`${money(blPrice.min_price_new)} – ${money(blPrice.max_price_new)}`} color="#3b82f6" />
            )}
            {blPrice?.avg_price_used && (
              <StatBox label="BL Avg (Used)" value={money(blPrice.avg_price_used)} />
            )}
            {blPrice?.min_price_used && blPrice?.max_price_used && (
              <StatBox label="BL Used Range" value={`${money(blPrice.min_price_used)} – ${money(blPrice.max_price_used)}`} />
            )}
            {(item.forecast2yr || forecast2yr) && (
              <StatBox label="2yr Forecast" value={money(item.forecast2yr || forecast2yr)} color="#5aa832" />
            )}
            {(item.forecast5yr || forecast5yr) && (
              <StatBox label="5yr Forecast" value={money(item.forecast5yr || forecast5yr)} color="#5aa832" />
            )}
          </div>
        </div>

        {/* ── Price History Chart ── */}
        {(() => {
          const history = getPriceHistory(item.setNumber).filter(s => s.value != null || s.blPriceNew != null);
          if (history.length < 2) return null;
          const hasValue  = history.some(s => s.value    != null);
          const hasBL     = history.some(s => s.blPriceNew != null);
          return (
            <div>
              <div style={sectionLabel}>Price History</div>
              <div style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "12px 4px 8px" }}>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={history} margin={{ top: 4, right: 10, bottom: 0, left: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#5d6f80" }}
                      tickFormatter={d => d.slice(5)}
                      minTickGap={30}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#5d6f80" }}
                      tickFormatter={v => `$${v}`}
                      width={44}
                    />
                    <Tooltip
                      contentStyle={{ background: "#0d1623", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "#8a9bb0" }}
                      formatter={(v, name) => [money(v), name === "value" ? "Market Value" : "BL Avg (New)"]}
                    />
                    {hasValue && <Line type="monotone" dataKey="value" stroke="#c9a84c" strokeWidth={2} dot={false} connectNulls />}
                    {hasBL    && <Line type="monotone" dataKey="blPriceNew" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls />}
                  </LineChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 6 }}>
                  {hasValue && <span style={{ fontSize: 11, color: "#c9a84c" }}>● Market Value</span>}
                  {hasBL    && <span style={{ fontSize: 11, color: "#3b82f6" }}>● BL Avg (New)</span>}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Buy Signal ── */}
        <div>
          <div style={sectionLabel}>Buy Signal</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {(() => {
              const sc = priorityScore(item);
              const rec = recommendation(sc);
              const recColor = rec === "Buy Now" ? "#ef4444" : rec === "Watch Closely" ? "#f59e0b" : "#5aa832";
              return <StatBox label="Recommendation" value={rec} color={recColor} />;
            })()}
            {item.exit_date
              ? (() => {
                  const days = daysUntilRetirement(item.exit_date);
                  const wave = retirementWaveLabel(item.exit_date);
                  const color = days <= 60 ? "#ef4444" : days <= 180 ? "#f59e0b" : "#8a9bb0";
                  return (
                    <>
                      <StatBox label="Retires" value={wave || item.retirementYear || "—"} color={color} />
                      <StatBox label="Days Left" value={days <= 0 ? "Past exit" : `${days} days`} color={color} />
                    </>
                  );
                })()
              : item.retirementYear
                ? <StatBox label="Retirement Year" value={item.retirementYear} color={item.retiringSoon ? "#ff8b8b" : "#e8e2d5"} />
                : null
            }
            {item.retirementSource && <StatBox label="Data Source" value={item.retirementSource} />}
          </div>
        </div>

        {/* ── Details ── */}
        {(item.subtheme || item.minifigs || item.rating || item.ageMin) && (
          <div>
            <div style={sectionLabel}>Details</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {item.subtheme && <StatBox label="Subtheme" value={item.subtheme} />}
              {item.minifigs && <StatBox label="Minifigs" value={item.minifigs} />}
              {item.rating && <StatBox label="Rating" value={`★ ${Number(item.rating).toFixed(1)}`} />}
              {item.ageMin && <StatBox label="Min Age" value={`${item.ageMin}+`} />}
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
