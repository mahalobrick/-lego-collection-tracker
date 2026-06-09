# Donut diagnostic — MC Overview "Value by Theme"

**Scope:** read-only classification of the MyCollection (MC) Overview *Value by Theme* donut
slowness, and whether the same cause is a class across the other MC / Overview charts.
No code changed. Fixes named only.

---

## TL;DR

The donut's dataset is **already memoized correctly** (`themeChartData`,
[`MyCollection.jsx:584`](../src/MyCollection.jsx#L584), deps `[sets, valueMap]` — both stable
state). So this is **NOT** the P1 render-recompute class, and "mirror P1's memoization" does
**not** apply — there is nothing left to memoize.

The slowness is a **data-dependency → recharts re-animation** interaction:

- `valueMap` settles in **2–3 phases** (`undefined` → warm-cache seed → fetched), each a real
  state change ([`MyCollection.jsx:339-352`](../src/MyCollection.jsx#L339)).
- Each phase legitimately produces a **new `themeChartData` array identity**.
- recharts `<Pie>` has `isAnimationActive` **defaulted ON** (grep confirms the flag is set
  *nowhere* in `src/`), so each new array identity replays the full grow/sweep tween.
- The donut variant renders **all themes uncapped** as slices
  ([`MyCollection.jsx:1547-1548`](../src/MyCollection.jsx#L1547)) — unlike the bar variant which
  `.slice(0, 7)`s — so the animation runs over N≈(distinct themes) slices, 2–3 times in a row.

Net: the chart visibly grows-from-zero two or three times as enrichment trickles in. That reads
as "slow." The *data recompute* itself is cheap (linear `groupRollup`); the cost is the repeated
animated render over an uncapped slice count.

---

## 1. Classify the Value-by-Theme donut

| Question | Finding |
|---|---|
| Dataset memoized? | **Yes.** `themeChartData = useMemo(...)`, [`MyCollection.jsx:584-590`](../src/MyCollection.jsx#L584). |
| Deps stable or churning? | **Stable.** `[sets, valueMap]` are both `useState` values, not per-render literals. No identity churn — the memo holds across unrelated re-renders. |
| Blocks on / recomputes as enrichment arrives? | **Recomputes (correctly), 2–3×.** `valueMap` starts `undefined`, is seeded from warm cache ([`:343`](../src/MyCollection.jsx#L343)), then replaced by the fetch result ([`:347`](../src/MyCollection.jsx#L347)). Each `setValueMap` is a real dep change → memo recomputes → recharts re-renders. It does **not** block (the warm seed paints immediately); it re-animates. |
| Grouping size | `groupRollup(sets, s => s.theme, valueMap)` → one entry **per distinct theme** ([`portfolio.js:718`](../src/utils/portfolio.js#L718)). Iterates **themes × sets** with ~5 linear sub-passes (`knownValueCount` / `portfolioValue` / `portfolioGain` / `portfolioROI`). Linear in `sets` — **cheap** even at hundreds of sets. |
| recharts render cost | **Material.** `<Pie data={themeChartData} …>` at [`:1547`](../src/MyCollection.jsx#L1547) passes the **full** theme list (uncapped), animation on by default, inside a `ResponsiveContainer` (resize-observer). One `<Cell>` per theme ([`:1548`](../src/MyCollection.jsx#L1548)). |

### Dominant cause, ranked

1. **Data-dependency-driven re-animation (PRIMARY).** The 2–3 `valueMap` settle phases each
   replay the recharts entry animation. Root contact points:
   [`MyCollection.jsx:332`](../src/MyCollection.jsx#L332) (state),
   [`:343`](../src/MyCollection.jsx#L343)/[`:347`](../src/MyCollection.jsx#L347) (the two/three
   setters), [`:1547`](../src/MyCollection.jsx#L1547) (animated `<Pie>`).
2. **Uncapped slice count (AMPLIFIER).** [`:1547-1548`](../src/MyCollection.jsx#L1547) animates
   *every* theme as a slice; the bar variant caps at 7 and the legend list caps at 5/15, so the
   donut is the only consumer that doesn't bound N. More slices → longer/heavier each animation.
3. **Dataset recompute (NEGLIGIBLE).** `groupRollup` is linear; not the bottleneck. *(The earlier
   audit's "data-dependency stall" hypothesis is half-right: the trigger is the value-enrichment
   dependency, but the cost is the re-animated render, not a recompute stall and not a memo
   defect.)*

---

## 2. Is it a class?

**Partly — but the donut's dominant cause is mostly its own.**

- **All recharts charts share the "animate-on-data-change" trait** (animation is on by default
  everywhere — no `isAnimationActive={false}` exists in `src/`). But only the **value-dependent**
  charts re-render when `valueMap` settles. On MC Overview that is just the donut (and the cheap
  text consumers: the center "Collection Value" overlay via `fmtAgg`
  [`:1555`](../src/MyCollection.jsx#L1555), and the `stats` card). The other Overviews' charts
  (Wanted, Budget) key off `wanted` / `yearPurchases` / `purchases` — **not** `valueMap` — so they
  do not re-animate on the value-enrichment cycle.
- **One genuine render-recompute straggler on MC:** **Condition Breakdown**'s dataset is built
  **inline in an IIFE, unmemoized** ([`:1494-1498`](../src/MyCollection.jsx#L1494)) → new array
  every parent render → recharts can re-animate it on *any* MC state change. This *is* the P1
  class, but it's a **3-slice, value-independent** chart — low impact, and **not** the source of
  the donut's slowness. (Wanted/Budget datasets are all already memoized — verified.)

**Conclusion:** the donut is effectively a **one-off** (data-dependency + uncapped slices), not a
shared-cause cluster. The only other class member, Condition Breakdown, is unrelated and minor.
What *is* shared and fixable in one shot is the **animation-on-every-data-change** behavior.

---

## 3. Fix (names only — no code)

**Targeted — the donut** ([`MyCollection.jsx:1547`](../src/MyCollection.jsx#L1547)):
- **Disable / one-shot the entry animation** on the `<Pie>` (`isAnimationActive={false}`, or
  animate once and not on subsequent value-settle phases). This is the "cache-then-refresh"
  posture the value overlay already adopts on mount (warm seed paints, fetch updates) — the seed
  should *paint* and the fetch should *update values in place* without replaying the grow tween.
  This removes the 2–3× re-animation, the PRIMARY cost.
- **Cap the donut slice count** to top-N (mirror the bar variant's `.slice(0, 7)`), folding the
  remainder into an "Other" slice. Reduces slices rendered/animated and aligns with the already-
  capped bar + legend. *(See safety note — this one changes what's drawn.)*
- **Do NOT "mirror P1's memoization":** the dataset memo already exists and its deps are stable.
  P1's pattern is inapplicable here.

**Shared / class fix:**
- **`isAnimationActive={false}` across the recharts Pie/Bar/Area on the Overviews** — kills the
  animate-on-data-change cost everywhere in one pattern, and incidentally neutralizes the
  Condition Breakdown straggler's visible re-animation.
- **Optionally memoize the Condition Breakdown inline dataset**
  ([`:1494-1498`](../src/MyCollection.jsx#L1494)) — byte-identical derivation, dep `[sets]` — to
  stop per-render array churn (true P1-style fix for the one remaining render-recompute chart).

---

## 4. Safety

- **`isAnimationActive={false}` is behavior-neutral.** It changes only the visual transition, not
  any computed slice value, angle, total, tooltip number, or the center-overlay figure. Same data
  rendered, just without the tween. No regression to what any chart *computes*.
- **Memoizing Condition Breakdown is behavior-neutral** *iff* the derivation is moved
  byte-identically into a `useMemo(..., [sets])` (same bucket counts, same filter, same labels/
  colors). Same output, not recomputed.
- **Capping the donut slice count is NOT neutral** — it changes what the donut *draws* (fewer
  slices + an "Other" wedge). It must be an explicit, agreed visual change, not a silent
  optimization. The legend list and bar variant already cap, so this aligns them — but still flag
  it as a display change, not a free win.
- **The dataset memo must stay as-is.** Its deps (`[sets, valueMap]`) are exactly the inputs that
  legitimately change the output; do not narrow them (e.g. dropping `valueMap`) or the donut would
  stop updating when enrichment arrives.
