import { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";

// "?" info affordance shared by the Budget metric labels and the My Collection
// overview card sub-lines (Card's `subTip`), so the help-dot looks + behaves
// identically across tabs.
//
// MOBILE-READY (Workstream #1):
//  - The "?" is a real focusable <button> (keyboard + a11y: aria-expanded /
//    aria-describedby), not a hover-only <span>.
//  - TAP/CLICK toggles the popover (works on touch); mouse HOVER still reveals it
//    on hover-capable devices; outside-click + Escape close it.
//  - The popover is PORTALED to <body> and position:fixed off the trigger's rect, so
//    it floats over neighbors and escapes the stat card's overflow:hidden AND the
//    per-card backdrop-filter stacking context that a z-index alone can't beat.
//    A max-width keeps long text WRAPPING instead of overflowing.
//
// Props are unchanged (text, color, size) — drop-in for every existing call site.
export default function InfoTip({ text, color = "#5d6f80", size = 15 }) {
  const [pinned, setPinned] = useState(false);   // toggled open by click / tap / keyboard
  const [hovered, setHovered] = useState(false);  // mouse hover (fine pointer only)
  const [pos, setPos] = useState(null);           // {left, top, below} viewport coords for the fixed popover
  const btnRef = useRef(null);
  const tipId = useId();
  const open = pinned || hovered;

  const isBright = color === "#c9a84c";
  const bg     = isBright ? "rgba(201,168,76,0.18)"  : color === "#4caf7d" ? "rgba(76,175,61,0.15)"  : "rgba(255,255,255,0.08)";
  const border = isBright ? "rgba(201,168,76,0.4)"   : color === "#4caf7d" ? "rgba(76,175,61,0.3)"   : "rgba(255,255,255,0.14)";

  // Position the fixed popover from the trigger's viewport rect; drop BELOW when
  // there isn't room above (near the top of the viewport).
  function place() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 96;
    setPos({ left: r.left + r.width / 2, top: below ? r.bottom : r.top, below });
  }

  // While open, keep it aligned to the trigger on scroll / resize.
  useEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  // A pinned popover is dismissible by outside-click / touch / Escape (WCAG 1.4.13).
  useEffect(() => {
    if (!pinned) return;
    const close = () => { setPinned(false); setHovered(false); };
    const onDown = (e) => { if (!btnRef.current?.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <span style={{ display: "inline-flex", verticalAlign: "middle" }}>
      <button
        ref={btnRef}
        type="button"
        aria-label="More information"
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setPinned(p => !p)}
        // pointerType filter: ignore the synthetic enter that fires right before a
        // touch tap, so a tap is a single clean toggle (not enter+click cancelling out).
        onPointerEnter={(e) => { if (e.pointerType === "mouse") setHovered(true); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setHovered(false); }}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: size, height: size, padding: 0, margin: 0,
          borderRadius: "50%", background: bg, border: `1px solid ${border}`, color,
          fontSize: size * 0.6, fontWeight: 800, lineHeight: 1, cursor: "pointer",
          userSelect: "none", WebkitTapHighlightColor: "transparent",
        }}
      >?</button>
      {open && pos && createPortal(
        <div
          id={tipId}
          role="tooltip"
          style={{
            position: "fixed", left: pos.left, top: pos.top,
            transform: pos.below ? "translate(-50%, 8px)" : "translate(-50%, calc(-100% - 8px))",
            zIndex: 9999, width: "max-content", maxWidth: 240,
            background: "#0b1520", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 9,
            padding: "8px 11px", fontSize: 11.5, color: "#c9d6e3",
            boxShadow: "0 6px 24px rgba(0,0,0,0.65)", pointerEvents: "none",
            lineHeight: 1.5, whiteSpace: "normal",
          }}
        >
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}
