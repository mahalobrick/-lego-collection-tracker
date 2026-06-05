import { setConditionDisplay, conditionDisplayColor, conditionDisplayLabel } from "./utils/condition";

// ─────────────────────────────────────────────────────────────────────────────
// Condition pill for the Sets table — DISPLAY-ONLY by construction.
//
// A collection row is the LINE, not a single physical copy. The cell's previous
// inline editor (double-click → New/Used <select> → updateSet(index,"condition"))
// bulk-rewrote EVERY copy of a multi-copy line (e.g. 6 qty) in one silent move —
// a footgun, because the row can't express which copy you meant. Condition is now
// edited only where copy semantics are explicit:
//   • the Edit form's Condition field   (line-level New/Used)
//   • the detail panel's per-copy control (entries[]-aware, one copy at a time)
// This component renders the New / Used / Mixed pill and nothing interactive —
// there is no edit affordance to mis-fire (lock-by-construction).
// ─────────────────────────────────────────────────────────────────────────────

export default function ConditionPill({ set }) {
  const display = setConditionDisplay(set);       // 'new' | 'used' | 'mixed'
  const color = conditionDisplayColor(display);   // green / amber / indigo
  return (
    <span style={{ background: `${color}18`, color, border: `1px solid ${color}50`, borderRadius: 10, padding: "2px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}>
      {display === "new" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0, animation: "pulse-dot 2s ease-in-out infinite" }} />}
      {conditionDisplayLabel(display)}
    </span>
  );
}
