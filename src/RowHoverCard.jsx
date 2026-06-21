import { setImageUrl, money, asNumber } from "./utils/formatting";
import { formatValue, formatRetailCell } from "./utils/valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// Floating summary card shown when a Collection row is hovered. In COMPACT density
// the row shows Market only, so this card carries the full three-up — MSRP / Paid /
// Market — plus the set's identity (image, #, theme, condition, qty, ROI, status).
//
// Pure/presentational: the parent derives `retail` and `market` (the same
// setRetailProvenance / setValueProvenance reads the row uses) and passes them in;
// Paid + ROI + status are read off the set, matching the prior inline card.
// Positioning (fixed, viewport-collision-aware) is preserved from the original.
//
// Props:
//   set     the hovered set row.
//   retail  {import("./utils/value").Value | null}  MSRP provenance.
//   market  {import("./utils/value").Value | null}  Market-value provenance.
//   tipPos  {{x:number, y:number}}                  cursor position for placement.
// ─────────────────────────────────────────────────────────────────────────────

const label = { color: "#5d6f80" };

export default function RowHoverCard({ set, retail, market, tipPos }) {
  if (!set) return null;
  const paid = set.totalPaid || asNumber(set.paidPrice) * (set.qty || 1);
  const x = tipPos?.x ?? 0;
  const y = tipPos?.y ?? 0;

  return (
    <div style={{ position: "fixed", left: x > window.innerWidth - 280 ? x - 256 : x + 16, top: y > window.innerHeight - 230 ? y - 215 : y - 8, zIndex: 9999, background: "#0b1520", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "10px 14px", pointerEvents: "none", boxShadow: "0 8px 32px rgba(0,0,0,0.55)", minWidth: 240 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <img src={setImageUrl(set.setNumber)} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
          style={{ width: 72, height: 72, objectFit: "contain", borderRadius: 8, background: "#111d2e", border: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: "#e8e2d5", marginBottom: 6, fontSize: 13 }}>{set.name || set.setNumber || "Set"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", fontSize: 12 }}>
            {set.setNumber && <><span style={label}>Set #</span><span style={{ color: "#e8e2d5" }}>{set.setNumber}</span></>}
            {set.theme && <><span style={label}>Theme</span><span style={{ color: "#e8e2d5" }}>{set.theme}</span></>}
            {set.condition && <><span style={label}>Condition</span><span style={{ color: "#e8e2d5", textTransform: "capitalize" }}>{set.condition}</span></>}
            <span style={label}>Qty</span><span style={{ color: "#e8e2d5" }}>{set.qty || 1}</span>
            <span style={label}>MSRP</span><span style={{ color: "#8a9bb0" }} data-testid="hover-retail">{formatRetailCell(retail)}</span>
            <span style={label}>Paid</span><span style={{ color: "#8a9bb0" }} data-testid="hover-paid">{money(paid)}</span>
            <span style={label}>Value</span><span style={{ color: "#c9a84c", fontWeight: 700 }} data-testid="hover-market">{formatValue(market?.amount)}</span>
            {set.roiPct != null && <><span style={label}>ROI</span><span style={{ color: set.roiPct >= 0 ? "#5aa832" : "#ff8b8b", fontWeight: 700 }}>{set.roiPct >= 0 ? "+" : ""}{Number(set.roiPct).toFixed(1)}%</span></>}
            {set.retired != null && <><span style={label}>Status</span><span style={{ color: set.retired ? "#f59e0b" : "#5aa832" }}>{set.retired ? "Retired" : "Active"}</span></>}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "#5d6f80", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>click for details</div>
    </div>
  );
}
