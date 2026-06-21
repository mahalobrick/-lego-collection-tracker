import { useState } from "react";
import { Show, SignInButton, SignUpButton, UserButton, useUser } from "@clerk/react";
import Icon from "./Icon";
import sidebarCoin from "./assets/sidebar-coin.png"; // frameless coin (brickuity-logo.png stays the favicon/app-icon)
import { setItemSafe } from "./utils/safeStorage";

const RAIL_W = 64;
const EXPANDED_W = 232;

// Destinations map to the SAME view keys App.jsx switches on. The 4 main items are reorderable
// device-locally (blNavOrder) via hover ▲▼; Settings stays pinned last. Switching is key-based,
// so reordering NEVER affects routing — only this presentational order changes.
const NAV = [
  { key: "collection", icon: "collection", label: "Collection" },
  { key: "acquisition", icon: "wanted", label: "Wanted" },
  { key: "budget", icon: "budget", label: "Budget" },
  { key: "performance", icon: "performance", label: "Performance" },
  { key: "settings", icon: "settings", label: "Settings" },
];

// The 4 reorderable nav keys, in canonical default order (Settings is pinned, excluded).
// NOTE: "Wanted" is key 'acquisition' — order is persisted/compared by KEY, never label.
const REORDERABLE_KEYS = ["collection", "acquisition", "budget", "performance"];
const NAV_BY_KEY = Object.fromEntries(NAV.map(item => [item.key, item]));

function railBtn(active) {
  return {
    display: "flex", alignItems: "center", gap: 12, width: "100%",
    borderTop: "none", borderRight: "none", borderBottom: "none", borderLeft: `3px solid ${active ? "var(--bk-action)" : "transparent"}`,
    background: active ? "var(--bk-hover)" : "transparent",
    color: active ? "var(--bk-action)" : "var(--bk-text-muted)",
    borderRadius: 8, padding: "10px 11px", cursor: "pointer",
    fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden",
    transition: "background 0.12s ease, color 0.12s ease",
  };
}

const footPill = { borderRadius: 8, padding: "8px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "center", whiteSpace: "nowrap" };

// Inline person glyph for the collapsed sign-in affordance — matches the 24×24 currentColor
// line-icon style (the icon set ships no account icon).
function PersonGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.3" /><path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

/**
 * Heritage Luxe vertical nav (v2). Icon-rail (~64px) that hover-expands as a fixed OVERLAY
 * (no reflow) or pins (App reserves width). Panel toggle (pin) sits at the top; the foot is
 * the account zone — auth + sync + the dark/light toggle. Pinned dark via data-theme="dark".
 */
export default function Sidebar({ view, onNavigate, theme, onToggleTheme, pinned, onTogglePin, syncStatus }) {
  const [hovered, setHovered] = useState(false);
  const [hoveredNavKey, setHoveredNavKey] = useState(null); // reveals a single item's ▲▼
  const [navOrder, setNavOrder] = useState(() => {
    const saved = localStorage.getItem("blNavOrder");
    if (!saved) return REORDERABLE_KEYS;
    const parsed = JSON.parse(saved);
    // Mirror blOwnedColumns load: drop saved keys no longer reorderable, keep saved order,
    // then append any missing canonical keys in canonical position.
    const allowed = new Set(REORDERABLE_KEYS);
    const merged = parsed.filter(k => allowed.has(k));
    const savedKeys = new Set(merged);
    const missing = REORDERABLE_KEYS.filter(k => !savedKeys.has(k));
    return missing.length ? [...merged, ...missing] : merged;
  });
  const { user } = useUser();
  const expanded = pinned || hovered;

  // Mirror moveOwnedColumn: clone, find, bounds-check (no-op at the ends), splice out + in,
  // then persist device-local (blNavOrder is in safeStorage's no-sync skip-list).
  function moveNavItem(key, direction) {
    const next = [...navOrder];
    const index = next.findIndex(k => k === key);
    const newIndex = index + (direction === "up" ? -1 : 1);
    if (index < 0 || newIndex < 0 || newIndex >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(newIndex, 0, item);
    setNavOrder(next);
    setItemSafe("blNavOrder", JSON.stringify(next));
  }

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
        boxShadow: expanded && !pinned ? "var(--bk-shadow)" : "none",
      }}
    >
      {/* TOP: expanded = brand + toggle masthead row; collapsed = toggle-only (nav-box rhythm) */}
      <div style={{ padding: expanded ? "10px 12px 8px" : "10px 8px 8px" }}>
        {expanded ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src={sidebarCoin} alt="" style={{ width: 28, height: "auto", display: "block", flexShrink: 0 }} />
            <span style={{ fontFamily: "var(--bk-font-display)", color: "var(--bk-gold-ink)", fontSize: 21, fontWeight: 700, letterSpacing: 0.3 }}>Brickuity</span>
            <button onClick={onTogglePin} title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
              style={{ display: "flex", border: "none", background: "transparent", cursor: "pointer", padding: 6, borderRadius: 8, color: pinned ? "var(--bk-action)" : "var(--bk-text-muted)", marginLeft: "auto" }}>
              <Icon name="sidebar" size={20} />
            </button>
          </div>
        ) : (
          <button onClick={onTogglePin} title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
            style={{ display: "flex", alignItems: "center", width: "100%", borderTop: "none", borderRight: "none", borderBottom: "none", borderLeft: "3px solid transparent", background: "transparent", cursor: "pointer", padding: "10px 11px", borderRadius: 8, color: pinned ? "var(--bk-action)" : "var(--bk-text-muted)" }}>
            <Icon name="sidebar" size={22} />
          </button>
        )}
      </div>

      {/* Destinations — 4 reorderable items (hover ▲▼, expanded-only) then pinned Settings */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 8px", flex: 1 }}>
        {navOrder.map((key, i) => {
          const item = NAV_BY_KEY[key];
          return (
            <div
              key={key}
              data-testid={`navrow-${key}`}
              onMouseEnter={() => setHoveredNavKey(key)}
              onMouseLeave={() => setHoveredNavKey(null)}
              style={{ display: "flex", alignItems: "center", gap: 4 }}
            >
              {/* Nav button — UNCHANGED behavior (key-based onNavigate) */}
              <button data-testid={`navbtn-${key}`} onClick={() => onNavigate(key)} title={item.label} style={{ ...railBtn(view === key), flex: 1 }}>
                <Icon name={item.icon} size={22} />
                {expanded && <span>{item.label}</span>}
              </button>
              {/* Reorder ▲▼ — SIBLING of the button (never nested) so a click can't navigate; expanded + hover only */}
              {expanded && hoveredNavKey === key && (
                <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingRight: 2 }}>
                  <button data-testid={`navup-${key}`} onClick={() => moveNavItem(key, "up")} disabled={i === 0} title="Move up"
                    style={{ background: "none", border: "none", color: i === 0 ? "var(--bk-disabled-tx)" : "var(--bk-text-muted)", cursor: i === 0 ? "default" : "pointer", padding: "0 2px", fontSize: 10, lineHeight: 1 }}>▲</button>
                  <button data-testid={`navdown-${key}`} onClick={() => moveNavItem(key, "down")} disabled={i === navOrder.length - 1} title="Move down"
                    style={{ background: "none", border: "none", color: i === navOrder.length - 1 ? "var(--bk-disabled-tx)" : "var(--bk-text-muted)", cursor: i === navOrder.length - 1 ? "default" : "pointer", padding: "0 2px", fontSize: 10, lineHeight: 1 }}>▼</button>
                </div>
              )}
            </div>
          );
        })}
        {/* Settings — fixed last, never reorderable, no arrows */}
        <button data-testid="navbtn-settings" onClick={() => onNavigate("settings")} title={NAV_BY_KEY.settings.label} style={railBtn(view === "settings")}>
          <Icon name={NAV_BY_KEY.settings.icon} size={22} />
          {expanded && <span>{NAV_BY_KEY.settings.label}</span>}
        </button>
      </nav>

      {/* Foot: account → sync → theme */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 8px 12px", borderTop: "1px solid var(--bk-border)" }}>
        {/* Account */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: expanded ? "stretch" : "center" }}>
          <Show when="signed-in">
            <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: expanded ? "flex-start" : "center", padding: expanded ? "2px 3px" : 0 }}>
              <UserButton appearance={{ elements: { avatarBox: { width: 28, height: 28 } } }} />
              {expanded && <span style={{ color: "var(--bk-text)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.firstName || user?.fullName || "Account"}</span>}
            </div>
          </Show>
          <Show when="signed-out">
            {expanded ? (
              <>
                <SignInButton mode="modal">
                  <button style={{ ...footPill, background: "transparent", color: "var(--bk-text-muted)", border: "1px solid var(--bk-border)" }}>Sign in</button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button style={{ ...footPill, background: "var(--bk-action)", color: "var(--bk-action-ink)", border: "none" }}>Sign up</button>
                </SignUpButton>
              </>
            ) : (
              <SignInButton mode="modal">
                <button title="Sign in" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 999, border: "1px solid var(--bk-gold-deep)", background: "transparent", color: "var(--bk-gold-ink)", cursor: "pointer" }}>
                  <PersonGlyph size={18} />
                </button>
              </SignInButton>
            )}
          </Show>
        </div>

        {/* Sync (signed-in only) */}
        <Show when="signed-in">
          {syncStatus && syncStatus !== "idle" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: expanded ? "flex-start" : "center", fontSize: 11, fontWeight: 600, color: syncStatus === "saved" ? "var(--bk-positive)" : "var(--bk-gold-ink)", padding: expanded ? "0 6px" : 0, pointerEvents: "none" }}>
              {syncStatus === "pending" && <span style={{ fontSize: 7, animation: "pulse-dot 1.5s ease-in-out infinite" }}>●</span>}
              {syncStatus === "syncing" && <span style={{ display: "inline-block", animation: "spin 0.8s linear infinite" }}>↻</span>}
              {syncStatus === "saved" && <span>✓</span>}
              {expanded && <span>{syncStatus === "pending" ? "Unsaved" : syncStatus === "syncing" ? "Syncing…" : "Saved"}</span>}
            </div>
          )}
        </Show>

        {/* Theme toggle */}
        <button onClick={onToggleTheme} title={theme === "dark" ? "Switch to light" : "Switch to dark"} style={railBtn(false)}>
          <Icon name={theme === "dark" ? "theme-light" : "theme-dark"} size={20} />
          {expanded && <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
        </button>
      </div>
    </aside>
  );
}
