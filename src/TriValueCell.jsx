import { formatValue, formatValueCell, retailTooltip, valueConfidence, paidConfidence } from "./utils/valueDisplay";
import { confidenceBadge } from "./uiStyles";

// ─────────────────────────────────────────────────────────────────────────────
// MSRP Step 2 — the Collection row's value cell, density-aware.
//
//   density="full"    → three-up stack: Retail / Paid / Market, one figure per line.
//   density="compact" → Market only — byte-identical to the pre-Step-2 cell
//                       (formatValueCell + confidence marker + retail/confidence tooltip).
//                       Retail + Paid surface in the row hover card instead (RowHoverCard).
//
// Built once so Budget / Wanted can reuse it later (Wanted has no "Paid" → paid={null} → "—").
// Each line shows its figure or "—" when unknown (docs/valuation.md rule 6 — never a phantom $0).
// Retail carries its at-retail caveat via retailTooltip and a quiet "be" tag when still leaning on
// the deprecated BrickEconomy source.
//
// TYPE: one font size for the whole cell (inherited from the table cell). Hierarchy is expressed
// through WEIGHT and COLOR only — labels are muted + light, the Market figure is bright + heavy,
// Retail/Paid sit dim in between. No ad-hoc per-line sizes (the shared confidence badge keeps its
// own size). Sam tunes prominence after.
//
// Props (all already derived by the caller — setRetailProvenance / setCost / setValueProvenance):
//   retail  {import("./utils/value").Value | null}  Brickset-canonical MSRP, BE fallback.
//   paid    {number | null}                          per-set cost basis; null → "—".
//   market  {import("./utils/value").Value | null}   the existing Market value.
//   density {"full" | "compact"}                      defaults to "full".
// ─────────────────────────────────────────────────────────────────────────────

const labelStyle = { color: "#5d6f80", fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" };
const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, lineHeight: 1.45 };
const dimFigure = { color: "#8a9bb0", fontWeight: 600 };
const marketFigure = { color: "#e8e2d5", fontWeight: 800 };

export default function TriValueCell({ retail, paid, paidProv, market, density = "full" }) {
  const conf = valueConfidence(market);
  const marketTip = conf?.tooltip || retailTooltip(market) || undefined;
  const paidConf = paidConfidence(paidProv); // quiet "MSRP?" when paid is a retail placeholder

  const marketFigureEl = (
    <>
      {formatValueCell(market)}
      {conf && <span style={confidenceBadge}>{conf.marker}</span>}
    </>
  );

  // Compact: the prior single Market cell, unchanged (net-first pin). Same testid so the row's
  // Market figure is found the same way in both modes.
  if (density === "compact") {
    return <span title={marketTip} data-testid="tri-market">{marketFigureEl}</span>;
  }

  const retailIsBE = retail?.amount != null && retail?.source === "brickeconomy";
  return (
    <div style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
      <div style={rowStyle} title={retailTooltip(retail) || undefined}>
        <span style={labelStyle}>Retail</span>
        <span style={dimFigure} data-testid="tri-retail">
          {formatValueCell(retail)}
          {retailIsBE && (
            <span
              style={confidenceBadge}
              title="Retail is still from the deprecated BrickEconomy source (no Brickset MSRP yet)"
            >
              be
            </span>
          )}
        </span>
      </div>
      <div style={rowStyle} title={paidConf?.tooltip || undefined}>
        <span style={labelStyle}>Paid</span>
        <span style={dimFigure} data-testid="tri-paid">
          {formatValue(paid)}
          {paidConf && <span style={confidenceBadge}>{paidConf.marker}</span>}
        </span>
      </div>
      <div style={rowStyle} title={marketTip}>
        <span style={labelStyle}>Market</span>
        <span style={marketFigure} data-testid="tri-market">{marketFigureEl}</span>
      </div>
    </div>
  );
}
