export const searchInput = {
  color: "#e8e2d5",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 999,
  padding: "10px 14px",
  minWidth: 190,
  outline: "none"
};

export const filterSelect = {
  color: "#e8e2d5",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 999,
  padding: "10px 14px",
  fontWeight: 800,
  outline: "none",
  minWidth: 130,
  maxWidth: 160
};

export const clearFilterButton = {
  background: "transparent",
  color: "#8a9bb0",
  border: "1px solid rgba(255,255,255,0.1)",
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
  color: "#8a9bb0",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  verticalAlign: "middle",
  cursor: "help",
  whiteSpace: "nowrap"
};
