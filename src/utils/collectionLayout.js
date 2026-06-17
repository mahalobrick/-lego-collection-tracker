// Collection Stats — overview card/panel layout registry + persistence loader.
//
// Extracted verbatim from MyCollection's useState initializer (net refactor, Phase: panel-design
// SOP commit 1). This module currently mirrors the legacy {key,type,label,visible,width,collapsed}
// model exactly so the extraction is behaviour-identical; later commits (tiered layout, override-map
// persistence) build on top of it. Pinned by collectionLayout.test.js.

export const DEFAULT_COLLECTION_ITEMS = [
  { key: "qty",          type: "card",  label: "Total Sets",       visible: true,  width: "auto",  collapsed: false },
  { key: "value",        type: "card",  label: "Collection Value", visible: true,  width: "auto",  collapsed: false },
  { key: "cost",         type: "card",  label: "Cost Basis",       visible: true,  width: "auto",  collapsed: false },
  { key: "gain",         type: "card",  label: "Net Gain / Loss",  visible: true,  width: "auto",  collapsed: false },
  { key: "roi",          type: "card",  label: "ROI",              visible: true,  width: "auto",  collapsed: false },
  { key: "themes",       type: "card",  label: "Themes",           visible: true,  width: "auto",  collapsed: false },
  { key: "duplicates",   type: "card",  label: "Multi-Copy Sets",  visible: true,  width: "auto",  collapsed: false },
  { key: "retired",      type: "card",  label: "Retired Sets",     visible: false, width: "auto",  collapsed: false },
  { key: "newUsed",      type: "card",  label: "New / Used",       visible: false, width: "auto",  collapsed: false },
  { key: "avgValue",     type: "card",  label: "Avg Set Value",    visible: false, width: "auto",  collapsed: false },
  { key: "avgPaid",      type: "card",  label: "Avg Paid / Set",   visible: false, width: "auto",  collapsed: false },
  { key: "pieces",       type: "card",  label: "Total Pieces",     visible: false, width: "auto",  collapsed: false },
  { key: "minifigs",     type: "card",  label: "Minifigs",         visible: false, width: "auto",  collapsed: false },
  { key: "retailValue",  type: "card",  label: "MSRP Value",       visible: false, width: "auto",  collapsed: false },
  { key: "newValue",     type: "card",  label: "New Sets Value",   visible: false, width: "auto",  collapsed: false },
  { key: "usedValue",    type: "card",  label: "Used Sets Value",  visible: false, width: "auto",  collapsed: false },
  { key: "mixedValue",   type: "card",  label: "Mixed Sets Value", visible: false, width: "auto",  collapsed: false },
  { key: "watchList",    type: "card",  label: "Wanted List",      visible: false, width: "auto",  collapsed: false },
  { key: "condition-breakdown", type: "panel", label: "Condition Breakdown", visible: false, width: "half", collapsed: false },
  { key: "theme-chart",   type: "panel", label: "Value by Theme",     visible: true,  width: "half",  collapsed: false },
  { key: "roi-leaders",   type: "panel", label: "ROI Leaders",        visible: true,  width: "half",  collapsed: false },
  { key: "most-valuable", type: "panel", label: "Most Valuable Sets", visible: true,  width: "half",  collapsed: false },
  { key: "watch-list",    type: "panel", label: "Wanted List",        visible: true,  width: "half",  collapsed: false },
  { key: "budget",           type: "panel", label: "Budget Snapshot",    visible: true,  width: "full",  collapsed: false },
  { key: "portfolio-history", type: "panel", label: "Portfolio History",  visible: true,  width: "full",  collapsed: false },
  { key: "theme-performance", type: "panel", label: "Theme Performance",  visible: true,  width: "full",  collapsed: false },
];

// Keys that used to exist but were superseded. Their visibility is folded forward into the
// replacement card (newSets|usedSets → newUsed) so a returning user doesn't silently lose a card.
const REMOVED_KEYS = new Set(["newSets", "usedSets", "retiringSoon"]);

// Reconcile a persisted blCollectionItems array against the current defaults:
//  - drop removed + unknown keys (so a stale config can't render a rendererless ghost),
//  - refresh type/label from defaults (keep the user's visible/width/collapsed/order),
//  - append any newly-added default cards at the end (newUsed inherits the old split's visibility).
// `saved` is the raw localStorage string (or null). Mirrors the pre-extraction initializer exactly,
// including the JSON.parse throw-on-corrupt behaviour.
export function loadCollectionItems(saved) {
  if (!saved) return DEFAULT_COLLECTION_ITEMS;
  const parsed = JSON.parse(saved);
  const legacyVisible = new Set(parsed.filter(c => c.visible).map(c => c.key));
  const knownKeys = new Set(DEFAULT_COLLECTION_ITEMS.map(c => c.key));
  const filtered = parsed.filter(c => !REMOVED_KEYS.has(c.key) && knownKeys.has(c.key));
  const typeMap = Object.fromEntries(DEFAULT_COLLECTION_ITEMS.map(c => [c.key, c.type]));
  const labelMap = Object.fromEntries(DEFAULT_COLLECTION_ITEMS.map(c => [c.key, c.label]));
  const merged = filtered.map(c => ({ ...c, type: typeMap[c.key] ?? c.type, label: labelMap[c.key] ?? c.label }));
  const savedKeys = new Set(merged.map(c => c.key));
  const missing = DEFAULT_COLLECTION_ITEMS.filter(c => !savedKeys.has(c.key)).map(c => ({
    ...c,
    // newUsed inherits visibility if either old card was visible
    visible: c.key === "newUsed" ? (legacyVisible.has("newSets") || legacyVisible.has("usedSets") || c.visible) : c.visible,
  }));
  return [...merged, ...missing];
}

// ── Tiers (panel-design SOP rule 1) ──────────────────────────────────────────
// Cards are grouped by decision-weight, not laid out as one flat grid. Hero = the
// numbers that drive a decision on this tab (raised, pinned on top); the rest split
// into two labelled secondary tiers. Intra-tier key order defines render order.
// Every card key in DEFAULT_COLLECTION_ITEMS must appear in exactly one tier.
export const CARD_TIERS = [
  { id: "hero",           label: null,                 keys: ["value", "gain", "roi"] },
  { id: "composition",    label: "Composition",        keys: ["qty", "themes", "duplicates", "newUsed", "retired", "pieces", "minifigs", "watchList"] },
  { id: "valueCondition", label: "Value & condition",  keys: ["cost", "retailValue", "avgValue", "avgPaid", "newValue", "usedValue", "mixedValue"] },
];

// Group the currently-visible CARD items into their tiers, preserving tier order and
// intra-tier key order, dropping empty tiers. Any visible card NOT assigned to a tier is
// surfaced in the last tier (never silently dropped — SOP "no silently hidden cards").
export function tieredVisibleCards(items) {
  const visibleKeys = items.filter(i => i.type === "card" && i.visible).map(i => i.key);
  const assigned = new Set(CARD_TIERS.flatMap(t => t.keys));
  const tiers = CARD_TIERS.map(t => ({ id: t.id, label: t.label, keys: t.keys.filter(k => visibleKeys.includes(k)) }));
  const orphans = visibleKeys.filter(k => !assigned.has(k));
  if (orphans.length) tiers[tiers.length - 1].keys.push(...orphans);
  return tiers.filter(t => t.keys.length > 0);
}
