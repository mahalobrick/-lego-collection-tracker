import { useState, useEffect } from "react";
import { asNumber, money, setImageUrl, daysUntilRetirement } from "./utils/formatting";
import { conditionDisplayLabel, conditionDisplayColor, conditionBucket } from "./utils/condition";
import { fetchBrickLinkPriceGuide, hasBrickLinkAuth } from "./utils/bricklink-client";
import { setValueProvenance, setGain, setROI, copyValueProvenance, setRetailProvenance, isPromoNoRetail } from "./utils/portfolio";
import { bricksetRetailEntry } from "./utils/brickset";
import { formatValueCell, formatValue, valueConfidence, lotsLabel, isPromoNoRrp, retailCellTooltip, retailSourceMarker, PROMO_NO_RRP_LABEL } from "./utils/valueDisplay";
import { confidenceBadge } from "./uiStyles";

function entryPaid(e) {
  return asNumber(e.paid_price ?? e.Paid ?? e.paid ?? 0);
}

function shortDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function StatBox({ label, value, color, tip }) {
  return (
    <div title={tip || undefined} style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 12px" }}>
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

export default function SetDetailPanel({ item, onClose, onEdit, valueMap, onEditCopyCondition }) {
  const [blPrice, setBlPrice] = useState(null);
  useEffect(() => {
    if (!item?.setNumber || !hasBrickLinkAuth()) { setBlPrice(null); return; }
    fetchBrickLinkPriceGuide(String(item.setNumber).replace(/-1$/, ""))
      .then(data => setBlPrice(data))
      .catch(() => setBlPrice(null));
  }, [item?.setNumber]);

  if (!item) return null;

  const entries = item.entries || [];
  const qty = item.quantity || entries.length || 1;
  const totalPaid = asNumber(item.totalPaid);
  // Null-aware value/gain/roi: unknown value → "—", never $0 / phantom −cost / −100%.
  // (unknown≠0 sweep)
  const prov = setValueProvenance(item, valueMap);
  const provConf = valueConfidence(prov); // BL confidence marker (est./thin/ask) or null
  const valueKnown = prov.amount !== null;
  const totalValue = prov.amount ?? 0;
  const gain = setGain(item, valueMap);   // null when value unknown
  const roi = setROI(item, valueMap);     // null when value unknown OR cost ≤ 0
  const avgPaid = qty > 0 ? totalPaid / qty : 0;

  // Enrich with cached BrickEconomy set data
  const setCache = (() => {
    try { return JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}"); } catch { return {}; }
  })();
  const cacheEntry = setCache[item.setNumber] || setCache[String(item.setNumber).replace(/-1$/, "")] || {};
  const cached = cacheEntry.data || {};
  const pieces = cached.pieces_count || null;
  const releaseYear = cached.year || Number(String(cached.released_date || "").slice(0, 4)) || null;
  const forecast2yr = asNumber(cached.forecast_value_new_2_years) || null;
  const forecast5yr = asNumber(cached.forecast_value_new_5_years) || null;

  // Enrich with cached Brickset data (retirement, details). NOTE: the cache is keyed `brickset_${n}`
  // (src/utils/brickset.js) — the bare-key lookup this replaced never matched, so Brickset enrichment
  // (and the canonical MSRP below) silently fell through to BrickEconomy. Resolve the real keys.
  const bsCache = (() => {
    try { return JSON.parse(localStorage.getItem("bricksetSetCache") || "{}"); } catch { return {}; }
  })();
  const bsStripped = String(item.setNumber || "").replace(/-1$/, "");
  const bsEntry = bsCache[`brickset_${item.setNumber}`] || bsCache[`brickset_${bsStripped}`] || bsCache[`brickset_${bsStripped}-1`] || {};
  const bs = bsEntry.data || {};

  // Canonical retail (MSRP): Brickset (LEGO sticker price) leads; BrickEconomy is the deprecated
  // fallback. Retail resolves via the SHARED resolver so the panel matches the main table — for a
  // CMF figure it reaches the series -0 entry (71052-0 → $4.99), which the per-figure entry lacks.
  const bsRetailEntry = bricksetRetailEntry(bsCache, item.setNumber) || {};
  const bsRetail = bsRetailEntry.data || {};
  const retailProv = setRetailProvenance(
    {
      brickset: { amount: bsRetail.retail_price_us, asOf: bsRetailEntry.fetchedAt },
      manual: { amount: item.msrp }, // hand-entered MSRP (Phase 3a rung); 0/absent → skipped
      brickeconomy: { amount: cached.retail_price_us, asOf: cacheEntry.fetchedAt },
    },
    { condition: item.condition, promo: isPromoNoRetail(item) }
  );
  const retailPrice = retailProv?.amount ?? null;
  // Mark a hand-entered MSRP so it's distinguishable from a sourced Brickset figure (Phase 3a). Scoped
  // to 'manual' here — the panel intentionally does NOT carry the row's 'be' chip (BE shows as a clean
  // figure in the panel, per the DOM-leaf test); only the new manual rung gets a panel marker.
  const retailManualMark = retailProv?.source === "manual" ? retailSourceMarker(retailProv) : null;
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

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {releaseYear && <span style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "#8a9bb0" }}>{releaseYear}</span>}
          {pieces && <span style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "#8a9bb0" }}>{pieces.toLocaleString()} pcs</span>}
          {/* Canonical MSRP — always shown (unknown → "—", never hidden-as-absent). Tooltip flags it as sticker price. */}
          <span data-testid="msrp-chip" title={retailCellTooltip(retailProv) || undefined} style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 999, padding: "3px 10px", fontSize: 12, color: "#8a9bb0" }}>{isPromoNoRrp(retailProv) ? PROMO_NO_RRP_LABEL : <>MSRP {formatValue(retailPrice)}{retailManualMark && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }} title={retailManualMark.tooltip}>{retailManualMark.marker}</span>}</>}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <StatBox label="Cost Basis" value={money(totalPaid)} />
          <StatBox label="Market Value" tip={provConf?.tooltip}
            value={<>{formatValueCell(prov)}{provConf && <span style={confidenceBadge}>{provConf.marker}</span>}</>} />
          <StatBox label="Net Gain" value={gain === null ? "—" : money(gain)} color={gain === null ? undefined : gain >= 0 ? "#5aa832" : "#ff8b8b"} />
          <StatBox label="ROI" value={roi === null ? "—" : `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`} color={roi === null ? undefined : roi >= 0 ? "#5aa832" : "#ff8b8b"} />
          <StatBox label="Avg Paid / Copy" value={money(avgPaid)} />
          <StatBox label="Value / Copy" value={valueKnown && qty > 0 ? money(totalValue / qty) : "—"} />
          {valueKnown && retailPrice && totalPaid > 0 && <StatBox label="vs. Retail" value={`${(((totalValue / qty) - retailPrice) / retailPrice * 100) >= 0 ? "+" : ""}${(((totalValue / qty) - retailPrice) / retailPrice * 100).toFixed(1)}%`} color={(totalValue / qty) >= retailPrice ? "#5aa832" : "#ff8b8b"} />}
        </div>

        {blPrice && (blPrice.avg_price_new > 0 || blPrice.avg_price_used > 0) && (
          <div>
            <div style={sectionLabel}>BrickLink Market Prices</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {blPrice.avg_price_new  > 0 && <StatBox label="BL Avg Sold (New)"  value={money(blPrice.avg_price_new)}  color="#3b82f6" />}
              {blPrice.avg_price_used > 0 && <StatBox label="BL Avg Sold (Used)" value={money(blPrice.avg_price_used)} color="#8b5cf6" />}
            </div>
          </div>
        )}

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
                // Per-copy BL-preferred value (condition-matched), BE fallback on cache-miss/unknown.
                // copyValueProvenance keeps the shared VALUE-only 0→unknown rule for the BE fallback,
                // so a stored current_value of 0 reads as unknown, not $0. (unknown≠0 sweep)
                const entryProv = copyValueProvenance(
                  entry.current_value ?? entry.Value ?? entry.value,
                  { setNumber: item.setNumber, condition: entry.condition, retired: item.retired },
                  valueMap,
                );
                const entryConf = valueConfidence(entryProv); // est./thin/ask marker or null
                const entryLots = lotsLabel(entryProv);        // "N sales" / "from new price" / "N listings"
                const val = entryProv.amount;
                const g = val === null ? null : val - paid;
                const r = (val === null || paid <= 0) ? null : (g / paid) * 100;
                // Bucketed per-copy badge: clean New / Used, never a raw token (usedasnew → "Used").
                const cond = entry.condition ? conditionDisplayLabel(entry.condition) : null;
                const acquired = shortDate(entry.aquired_date || entry.acquired_date);
                return (
                  <div key={i} style={{ background: "#0f1a28", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {onEditCopyCondition ? (
                          // Editable per-copy condition — flipping one copy of a uniform set makes the
                          // set Mixed (derived by setConditionDisplay; nothing "mixed" is stored).
                          <div style={{ display: "inline-flex", gap: 4 }} data-testid="copy-cond-edit">
                            {["new", "used"].map(b => {
                              const active = conditionBucket(entry.condition) === b;
                              const c = conditionDisplayColor(b);
                              return (
                                <button key={b}
                                  onClick={() => onEditCopyCondition(i, b)}
                                  style={{ border: `1px solid ${active ? c : "rgba(255,255,255,0.12)"}`, background: active ? `${c}22` : "transparent", color: active ? c : "#5d6f80", borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                                >{conditionDisplayLabel(b)}</button>
                              );
                            })}
                          </div>
                        ) : cond ? (
                          <span style={{ background: "#0b1520", border: `1px solid ${conditionDisplayColor(entry.condition)}`, color: conditionDisplayColor(entry.condition), borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                            {cond}
                          </span>
                        ) : null}
                        {acquired && <span style={{ color: "#5d6f80", fontSize: 12 }}>{acquired}</span>}
                        {!onEditCopyCondition && !cond && !acquired && <span style={{ color: "#5d6f80", fontSize: 13 }}>Copy {i + 1}</span>}
                      </div>
                      <span style={{ color: r === null ? "#5d6f80" : r >= 0 ? "#5aa832" : "#ff8b8b", fontWeight: 900, fontSize: 13 }}>
                        {r === null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(1)}%`}
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ color: "#5d6f80", fontSize: 11 }}>Paid</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#e8e2d5" }}>{money(paid)}</div>
                      </div>
                      <div>
                        <div style={{ color: "#5d6f80", fontSize: 11 }}>Value</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#e8e2d5" }} title={entryConf?.tooltip || undefined}>
                          {formatValueCell(entryProv)}{entryConf && <span style={confidenceBadge}>{entryConf.marker}</span>}
                        </div>
                        {entryLots && <div style={{ color: "#5d6f80", fontSize: 10, marginTop: 2 }}>{entryLots}</div>}
                      </div>
                      <div>
                        <div style={{ color: "#5d6f80", fontSize: 11 }}>Gain</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: g === null ? "#5d6f80" : g >= 0 ? "#5aa832" : "#ff8b8b" }}>{g === null ? "—" : money(g)}</div>
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
