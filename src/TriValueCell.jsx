import { formatValue, formatValueCell, formatRetailCell, retailTooltip, retailCellTooltip, retailSourceMarker, valueConfidence } from "./utils/valueDisplay";
import { confidenceBadge } from "./uiStyles";

// ─────────────────────────────────────────────────────────────────────────────
// MSRP Step 2 — the Collection row's value cell, density-aware.
//
//   density="full"    → three-up stack: MSRP / Paid / Market, one figure per line.
//   density="compact" → Market only — byte-identical to the pre-Step-2 cell
//                       (formatValueCell + confidence marker + retail/confidence tooltip).
//                       MSRP + Paid surface in the row hover card instead (RowHoverCard).
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

const labelStyle = { color: "var(--bk-text-muted)", fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" };
const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, lineHeight: 1.45 };
const dimFigure = { color: "var(--bk-text-muted)", fontWeight: 600 };
const marketFigure = { color: "var(--bk-text)", fontWeight: 800 };

export default function TriValueCell({ retail, paid, market, density = "full" }) {
  const conf = valueConfidence(market);
  const marketTip = conf?.tooltip || retailTooltip(market) || undefined;

  const marketFigureEl = (
    <>
      {formatValueCell(market)}
      {conf && <span style={confidenceBadge}>{conf.marker}</span>}
    </>
  );

  // Compact: the prior single Market cell, unchanged (net-first pin). Same testid so the row's
  // Market figure is found the same way in both modes.
  if (density === "compact") {
    return <span title={marketTip} data-testid="tri-market" style={{ fontVariantNumeric: "tabular-nums" }}>{marketFigureEl}</span>;
  }

  const retailMark = retailSourceMarker(retail);
  return (
    <div style={{ display: "flex", flexDirection: "column", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
      <div style={rowStyle} title={retailCellTooltip(retail) || undefined}>
        <span style={labelStyle}>MSRP</span>
        <span style={dimFigure} data-testid="tri-retail">
          {formatRetailCell(retail)}
          {retailMark && (
            <span style={confidenceBadge} title={retailMark.tooltip}>{retailMark.marker}</span>
          )}
        </span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Paid</span>
        <span style={dimFigure} data-testid="tri-paid">
          {formatValue(paid)}
        </span>
      </div>
      <div style={rowStyle} title={marketTip}>
        <span style={labelStyle}>Value</span>
        <span style={marketFigure} data-testid="tri-market">{marketFigureEl}</span>
      </div>
    </div>
  );
}
