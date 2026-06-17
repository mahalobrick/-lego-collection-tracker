import { useState } from "react";

// Minimal "?" info affordance: a hover-reveal tooltip bubble. Shared by the Budget
// metric labels and the My Collection overview card sub-lines (Card's `subTip`), so
// the help-dot looks + behaves identically across tabs. Pure presentational.
export default function InfoTip({ text, color = "#5d6f80", size = 15 }) {
  const [show, setShow] = useState(false);
  const isBright = color === "#c9a84c";
  const bg     = isBright ? "rgba(201,168,76,0.18)"  : color === "#4caf7d" ? "rgba(76,175,61,0.15)"  : "rgba(255,255,255,0.08)";
  const border = isBright ? "rgba(201,168,76,0.4)"   : color === "#4caf7d" ? "rgba(76,175,61,0.3)"   : "rgba(255,255,255,0.14)";
  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: "50%", background: bg, border: `1px solid ${border}`, color, fontSize: size * 0.6, fontWeight: 800, cursor: "default", userSelect: "none", lineHeight: 1 }}>?</span>
      {show && (
        <div style={{ position: "absolute", bottom: "calc(100% + 7px)", left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: "#0b1520", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 9, padding: "8px 11px", fontSize: 11.5, color: "#c9d6e3", width: 230, boxShadow: "0 6px 24px rgba(0,0,0,0.65)", pointerEvents: "none", lineHeight: 1.5, whiteSpace: "normal" }}>
          {text}
        </div>
      )}
    </span>
  );
}
