import { formatValue, formatValueCell, retailTooltip, valueConfidence } from "./utils/valueDisplay";
import { confidenceBadge } from "./uiStyles";

// ─────────────────────────────────────────────────────────────────────────────
// MSRP Step 2 — reusable three-up value display: Retail / Paid / Market, stacked.
//
// One compact unit so a reader sees a set's three money figures together (the
// sticker price it shipped at, what they paid, what it's worth now). Built here
// once; the Collection rows wire it in first, Budget / Wanted reuse it later
// (Wanted has no "Paid" — it just passes paid={null}, which renders "—").
//
// Each line shows its figure or "—" when unknown (docs/valuation.md rule 6 — never
// a phantom $0). The Market line PINS the prior value-cell behavior exactly:
// confidence marker (est./thin/ask) + retail/confidence tooltip. Retail carries its
// own at-retail caveat via retailTooltip, and a quiet "be" tag when it is still
// leaning on the deprecated BrickEconomy source so BE's footprint stays visible.
//
// Prominence is intentionally flat-and-subtle by default (Market a touch brighter);
// Sam tunes prominence after. Pure presentational — no localStorage, no derivation.
//
// Props (all already derived by the caller — see setRetailProvenance / setCost /
// setValueProvenance):
//   retail  {import("./utils/value").Value | null}  Brickset-canonical MSRP, BE fallback.
//   paid    {number | null}                          per-set cost basis; null → "—".
//   market  {import("./utils/value").Value | null}   the existing Market value.
// ─────────────────────────────────────────────────────────────────────────────

const labelStyle = {
  color: "#5d6f80",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: "uppercase",
};
const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, lineHeight: 1.4 };
const dimFigure = { color: "#8a9bb0", fontWeight: 600 };
const marketFigure = { color: "#e8e2d5", fontWeight: 800 };

export default function TriValueCell({ retail, paid, market }) {
  const conf = valueConfidence(market);
  const marketTip = conf?.tooltip || retailTooltip(market) || undefined;
  const retailIsBE = retail?.amount != null && retail?.source === "brickeconomy";

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
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
      <div style={rowStyle}>
        <span style={labelStyle}>Paid</span>
        <span style={dimFigure} data-testid="tri-paid">{formatValue(paid)}</span>
      </div>
      <div style={rowStyle} title={marketTip}>
        <span style={labelStyle}>Market</span>
        <span style={marketFigure} data-testid="tri-market">
          {formatValueCell(market)}
          {conf && <span style={confidenceBadge}>{conf.marker}</span>}
        </span>
      </div>
    </div>
  );
}
