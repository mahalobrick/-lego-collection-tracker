export const searchInput = {
  color: "var(--bk-text)",
  border: "1px solid var(--bk-border)",
  borderRadius: 999,
  padding: "10px 14px",
  minWidth: 190,
  outline: "none"
};

export const filterSelect = {
  color: "var(--bk-text)",
  border: "1px solid var(--bk-border)",
  borderRadius: 999,
  padding: "10px 14px",
  fontWeight: 800,
  outline: "none",
  minWidth: 130,
  maxWidth: 160
};

export const clearFilterButton = {
  background: "transparent",
  color: "var(--bk-text-muted)",
  border: "1px solid var(--bk-border)",
  borderRadius: 999,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 800
};

export const filterBar = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
  justifyContent: "flex-end"
};

// Subtle value-confidence marker (app-read Step 3): a small muted pill beside an estimated /
// thin / asking value so it doesn't read as a hard sold figure. Deliberately low-contrast —
// it's a caveat, not a call-to-action. `cursor: help` pairs with the title tooltip.
export const confidenceBadge = {
  marginLeft: 5,
  padding: "0 5px",
  fontSize: 9,
  fontWeight: 800,
  lineHeight: "14px",
  letterSpacing: 0.3,
  textTransform: "lowercase",
  color: "var(--bk-text-muted)",
  background: "var(--bk-surface-2)",
  border: "1px solid var(--bk-border)",
  borderRadius: 6,
  verticalAlign: "middle",
  cursor: "help",
  whiteSpace: "nowrap"
};

// Heritage Luxe shared CTAs (gold-forward). actionBtn = primary FILL (the former misnamed
// local "redBtn"); ghostBtn = secondary gold outline. The --bk-action-hover interaction is
// applied via the global `.bk-action-btn:hover` rule (App.jsx) — inline styles can't do :hover.
export const actionBtn = { display: "inline-block", background: "var(--bk-action)", color: "var(--bk-action-ink)", border: "none", borderRadius: 10, padding: "10px 14px", fontWeight: 800, cursor: "pointer", transition: "background 0.15s ease" };

export const ghostBtn = { background: "transparent", color: "var(--bk-gold-ink)", border: "1px solid var(--bk-gold-deep)", borderRadius: 10, padding: "10px 14px", fontWeight: 800, cursor: "pointer" };
