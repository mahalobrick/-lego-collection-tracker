import { useState } from "react";
import Icon from "./Icon";
import brickuityLogo from "./assets/brickuity-logo.png"; // expanded crest (wordmark built in)
import sidebarCoin from "./assets/sidebar-coin.png";      // collapsed coin

const RAIL_W = 64;
const EXPANDED_W = 232;

// Destinations map to the SAME view keys App.jsx already switches on (collection / budget /
// acquisition / settings) — the sidebar is pure presentation over switchTab().
const NAV = [
  { key: "collection", icon: "collection", label: "Collection" },
  { key: "acquisition", icon: "wanted", label: "Wanted" },
  { key: "budget", icon: "budget", label: "Budget" },
  { key: "performance", icon: "performance", label: "Performance" },
  { key: "settings", icon: "settings", label: "Settings" },
];

function railBtn(active) {
  return {
    display: "flex", alignItems: "center", gap: 12, width: "100%",
    border: "none", borderLeft: `3px solid ${active ? "var(--bk-action)" : "transparent"}`,
    background: active ? "var(--bk-hover)" : "transparent",
    color: active ? "var(--bk-action)" : "var(--bk-text-muted)",
    borderRadius: 8, padding: "10px 11px", cursor: "pointer",
    fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden",
    transition: "background 0.12s ease, color 0.12s ease",
  };
}

/**
 * Heritage Luxe vertical nav. Icon-rail by default (~64px); hover-expands as an OVERLAY
 * (fixed position → no layout reflow, never squeezes the table/detail panel) unless pinned,
 * in which case App reserves the expanded width. Owns the dark/light toggle (foot).
 */
export default function Sidebar({ view, onNavigate, theme, onToggleTheme, pinned, onTogglePin }) {
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  return (
    <aside
      data-theme="dark"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "fixed", left: 0, top: 0, bottom: 0, zIndex: 300,
        width: expanded ? EXPANDED_W : RAIL_W,
        background: "var(--bk-surface)", borderRight: "1px solid var(--bk-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        transition: "width 0.18s ease",
        boxShadow: expanded && !pinned ? "var(--bk-shadow)" : "none", // lift only when floating
      }}
    >
      {/* Brand: expanded crest (its "Brickuity" wordmark is built in) / collapsed coin */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: expanded ? "16px 14px 10px" : "12px 6px 8px", minHeight: 64 }}>
        <img
          src={expanded ? brickuityLogo : sidebarCoin}
          alt="Brickuity"
          style={{ width: expanded ? 150 : 40, height: "auto", objectFit: "contain", display: "block" }}
        />
      </div>

      {/* Destinations */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 8px", flex: 1 }}>
        {NAV.map(item => (
          <button key={item.key} onClick={() => onNavigate(item.key)} title={item.label} style={railBtn(view === item.key)}>
            <Icon name={item.icon} size={22} />
            {expanded && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Foot: theme toggle (single source of truth now) + pin */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 8px 12px", borderTop: "1px solid var(--bk-border)" }}>
        <button onClick={onToggleTheme} title={theme === "dark" ? "Switch to light" : "Switch to dark"} style={railBtn(false)}>
          <Icon name={theme === "dark" ? "theme-light" : "theme-dark"} size={20} />
          {expanded && <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
        </button>
        <button onClick={onTogglePin} title={pinned ? "Unpin sidebar" : "Pin sidebar open"} style={railBtn(pinned)}>
          <Icon name="collapse" size={20} />
          {expanded && <span>{pinned ? "Unpin" : "Pin open"}</span>}
        </button>
      </div>
    </aside>
  );
}
