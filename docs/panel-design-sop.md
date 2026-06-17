# Panel design SOP

The repeatable pattern for the **summary panel at the top of each tab**. Collection Stats is the reference
implementation; this doc is the blueprint we apply to Budget, Wanted, Sold, and Settings in turn. Doing it once well and
cloning the pattern beats redesigning each tab from scratch.

Scope note up front: this governs the **top summary panel only**. The analysis panels *below* it (the Value-by-Theme
donut and its future siblings — drill-downs, configurable charts, breakdowns) are a separate "deep-dive" layer with their
own richer customization, handled per-tab later. Don't fold that into the summary panel.

---

## 1. Tier by decision-weight

Cards are not equal. Group them into tiers by how much they drive action on that tab:

- **Hero tier** — the two or three numbers that actually drive a decision on this tab. Raised cards (an **elevated
  surface** — a lighter bg + border in this dark theme; "white bg" was light-theme shorthand. Neutral hero numbers stay
  legible because the surface is raised, not literally white), larger number, top row. (Collection Stats: Collection
  Value, Net Gain, ROI.)
- **Secondary tiers** — grouped by meaning, as denser metric cards (secondary bg, no border). Each tier gets a short
  label. (Collection Stats: "Composition", "Value & condition".)

The point is to stop ~20 cards competing for equal attention. The few that matter rise; reference numbers recede.

## 2. Tooltip content audit — every card

Every label or sub-line that isn't self-evident gets a plain-English "?" tooltip.

- **Generic copy only.** No hardcoded counts or dollar figures in tooltip text — any per-collection number must be an
  existing *computed* value, relocated, never a literal. Enforced by the no-digit guard test (valueDisplay.cardCopy.test.js).
- **Single-sourced** in valueDisplay.js.
- **Explain the confusing parts** — denominators ("% of *unique* sets, each counted once"), grain (per-copy vs per-set),
  and what a number is vs isn't.
- **The InfoTip is already built** (shipped): portals out of the card (escapes overflow:hidden + the backdrop-filter
  stacking context), focusable button, tap-to-toggle + hover, Escape/outside-click to close. Reuse it.

## 3. Customization = on / off, not reorder

- The gear toggles **per-card visibility within fixed tiers**. No free drag/reorder — it would break the meaning the
  tiers carry (you can't have a piece-count land in the hero row).
- **Default = visible (opt-out).** New cards appear automatically; the gear is a declutter tool, not a discovery
  requirement. This kills the "card was hidden and I didn't know it existed" class of bug at the design level.
- **Partition cards travel as a group** (New / Used / Mixed) — one toggle or all-or-none, so a partial partition (two of
  three) can never display and make the numbers visibly fail to sum.
- **Persistence is a visibility set only** (which cards are *off*) — no card order to save or migrate. Extract the
  layout/visibility logic to a pure, tested function; because new cards default-on, there's no migration surprise to
  engineer around.

## 4. One responsive grid (mobile-first)

- A single grid that reflows **4 → 2 → 1 columns** by available width (auto-fit), hero pinned on top.
- Same structure on desktop and mobile — no separate mobile layout to maintain.
- Tooltips open on **tap** (done); touch targets sized for fingers.

## 5. Shared primitives — build once, inherit everywhere

Each tab inherits the same components instead of reinventing them:

- InfoTip — the "?" affordance (portal + tap), shipped.
- Card — metric-card + raised-hero variant + subTip.
- The tier / responsive-grid layout components (to extract during the Collection Stats build).
- Copy single-sourced in valueDisplay.js.
- Lint guards travel too: the no-digit tooltip guard; the raw-condition-bucketing ban; others as they emerge.

## 6. Rollout

1. **Collection Stats = reference instance** — built first against this SOP. Also lands the sync-button move to Settings
   and the layout/visibility extraction.
2. **Then tab-by-tab** — Budget, Wanted, Sold, Settings — each audited against the checklist above.
3. **Then circle back** to the deep-dive panels below each summary (the donut etc.) as their own thread.

Record per-tab deviations from the pattern here as they happen (decisions-to-disk).

### Recorded deviations

**Collection Stats:**

- **Hero = elevated surface, not literal white.** Rule 1 says "white bg + border"; in this dark theme that's a raised
  lighter surface (`heroCardBase`), so neutral hero numbers (Collection Value) stay legible. "White bg" was light-theme
  shorthand. The pattern is *raised vs receding*, not a specific colour.
- **Partition group defaults OFF** (New / Used / Mixed value). Rule 3's "default = visible (opt-out)" would show all three
  for everyone, duplicating the Collection Value breakdown. They stay opt-*in* (advanced), but travel as a group
  (all-or-none) so a partial partition can never display. Still discoverable in the gear.
- **Wanted List card defaults OFF.** It counts *wanted* items, not owned-collection composition — cross-tab noise in a
  My Collection summary. Opt-in via the gear; kept available, not removed.

### Per-tab status

| Tab | Tooltip audit | Tiered layout | On/off + defaults | Status |
|---|---|---|---|---|
| Collection Stats | done | done | in build | reference instance |
| Budget | — | — | — | pending |
| Wanted | — | — | — | pending |
| Sold | — | — | — | pending |
| Settings | — | — | — | pending |
