# Discovery — Row density, richer detail panel, condition model, Overview roll-up

**Status:** discovery only — no code changed. Inventory of current state so the four
features (row-density setting, richer detail panel, standardized condition model, Overview
three-up roll-up) are designed from facts. Line numbers are as of commit `1609de0`.

Related: [`valuation.md`](valuation.md) (value rules), the MSRP Step 2 three-up
(`src/TriValueCell.jsx`), [`value-source-decision.md`](value-source-decision.md).

---

## 1. Row hover — what a Collection row does today

**There is already a working hover mechanism to build on.** The "Browse" table row
(`src/MyCollection.jsx:2280-2296`) wires `onMouseEnter`/`onMouseLeave` to:

- background → `rgba(255,255,255,0.04)` on enter, back to `#332500` (if selected) / transparent on leave;
- `setHoveredSet(set)` / `setHoveredSet(null)` — a single shared hover-state slot;
- checkbox cell left-border → gold `#c9a84c` when `hoveredSet === set` (`:2297`);
- name-cell text → gold `#c9a84c` when hovered (`:2452`).

**A floating hover card already exists** (`:1961-1982`) — fixed-position, viewport-collision-aware
(`tipPos`), `pointerEvents:none`. It shows: image (72×72), name, set #, theme, condition (raw,
capitalized), qty, paid, value (gold, via `setValueProvenance`), ROI, status. Footer: "click for details".

- Row **click** opens the detail panel: `setDetailSet(openSetDetail(...) || set)` (`:2282`).

**Implication for compact+hover density:** the hover infrastructure (`hoveredSet`, the floating card,
collision logic) is reusable as-is. A "compact" mode can hide secondary columns/lines and lean on the
existing card to surface them on hover — no new hover plumbing needed. Note the card reads `condition`
raw (not via `CONDITION_LABELS`) and recomputes paid inline rather than via `setCost`.

---

## 2. Detail panel — what it shows now (`src/SetDetailPanel.jsx`)

420px right slide-out. Top→bottom:

| Area | Lines | Content |
|---|---|---|
| Header | 115–155 | theme · set #, title, status chips (Retired/Active, Last Chance, "Retires in Nd", copies count), Edit/Close |
| Image | 157–162 | `setImageUrl()` |
| Meta chips | 164–169 | release year, pieces, **MSRP chip** (`formatValue(retailPrice)` + `retailTooltip`) |
| Value StatBoxes | 171–180 | Cost Basis, **Market Value** (+ confidence badge), Net Gain, ROI, Avg Paid/Copy, Value/Copy, **vs. Retail** (cond.) |
| BrickLink | 182–190 | Avg Sold New / Used (cond.) |
| Forecast | 192–214 | 2yr / 5yr value, 2yr / 5yr vs. retail (cond.) |
| Set details | 216–226 | subtheme, minifigs, rating, min age (cond.) |
| **Per-copy breakdown** | 228–289 | only if `entries.length > 0` — one card per copy |

**The three values today:** MSRP via `setRetailProvenance({brickset, brickeconomy}, …)` (`:82-89`);
Paid via `asNumber(item.totalPaid)` aggregate + per-copy `entryPaid` (`:48,235`); Market via
`setValueProvenance(item, valueMap)` aggregate + per-copy `copyValueProvenance` (`:51-56,239-243`).
So the panel **already has all three** — but spread across a chip (retail) and StatBoxes (paid/market),
not as a unified three-up like the row.

**Per-copy data structure (`item.entries[]`)** — loosely-typed, multi-alias:

| Field | Aliases seen | Notes |
|---|---|---|
| condition | `condition` | per-copy; set-level `condition` is *derived* from these (§3) |
| paid | `paid_price` / `Paid` / `paid` | coalesced by `entryPaid` |
| value | `current_value` / `Value` / `value` | coalesced; resolved at read via `copyValueProvenance` |
| acquired | `aquired_date` / `acquired_date` | **note the misspelling variant is real and load-bearing** |

`entries[]` is populated for **BrickEconomy-imported** sets; **manually-added sets have no `entries[]`**
(panel falls back to the single set-level row — `:allEntries` builds a synthetic 1-entry list in the
Overview stats, `MyCollection.jsx:475`). Copy value is derived (never stored): BL cache by
condition-bucket first, BE stored value as fallback, `unknown ≠ $0`.

**Implication for richer panel:** the data to show more is already loaded (BL new/used, forecasts,
per-copy lots/basis). The gap is *presentation* + the per-copy field aliasing/misspelling, which any
richer per-copy UI must keep tolerating (or normalize once — see §3 caveat).

---

## 3. Conditions — the messiest area, needs a decision

> **Update — Phase 1, Step 1 (decision + normalizer built).** The direction below
> ("two-layer model: keep granular grades durable") is **superseded**. The decision is a
> **binary New / Used + derived Mixed** model: grades collapse to the valuation bucket for
> display, rather than being preserved. Live data confirmed the simplification — the stored
> vocabulary is `new` and used-variants (`usedasnew` dominates) with **no `sealed`**, and all
> differing-copy sets are genuine new-vs-used Mixed (not used-grade variance).
>
> Step 1 added the canonical read-time coalescing point in **[`src/utils/condition.js`](../src/utils/condition.js)** (guard test `src/utils/condition.test.js`):
> - `conditionBucket(raw) → 'new'|'used'` — new/sealed/null → new, any `used*` → used. **`blCondition` (`portfolio.js:53`) now delegates to it**, so the new/used split has one source of truth (valuation byte-identical).
> - `setConditionDisplay(set) → 'new'|'used'|'mixed'` — buckets each `entries[]` copy, then uniform → that bucket, new+used → mixed. Manual sets (no entries) are never mixed. Bucketing-before-compare means used-grade variance (`usedasnew`+`usedcomplete`) reads as uniform **Used**, never false-Mixed.
> - `conditionDisplayLabel(display)` → New/Used/Mixed and `conditionDisplayColor(display)` (green / amber / **indigo `#6366f1`** for Mixed — fills the §3.4 color gap). These are **distinct from** formatting.js's granular `conditionLabel(raw)`/`conditionColor(raw)`, which still serve the per-copy panel.
>
> **Step 2 (wired).** The set-level derivation (`MyCollection.jsx` ~173) now calls
> `setConditionDisplay(set)` — one bucketed source. The **condition column** renders a New /
> Used / **indigo Mixed** pill via `conditionDisplay{Color,Label}` (replacing the old
> `isUsed = startsWith("used")` two-color logic that painted Mixed green-New); the dead shadowed
> `renderOwnedCell` condition text branch was removed. **Sort** on condition uses
> `setConditionDisplay` (New→Used→Mixed). The **SetDetailPanel per-copy badges** now route
> through `conditionDisplay{Label,Color}`, so a `usedasnew` copy reads a clean "Used" (the raw-token
> bug surfaced there too).
> Smoke (DOM-leaf, reversible seed): `usedasnew` → Used amber pill, a Mixed set → indigo Mixed pill
> (not green-New), per-copy badges read New/Used with no raw token.
>
> **Step 3 (wired) — filter; Phase 1 closed.** The condition filter predicate
> (`MyCollection.jsx` ~1081) now matches on `setConditionDisplay(set)`, not exact-string on the raw
> `set.condition` — so a manual set carrying a raw grade (e.g. `used_good` from the add-form) matches
> **Used**, and Mixed sets match **Mixed**. The dropdown is a fixed `[All, New, Used, Mixed]` built from
> `conditionDisplayLabel` (the data-derived raw-value option list was removed), so it can never show a
> raw `usedasnew` option. Smoke (incognito production build, DOM-leaf): New → {new BE set}, Used →
> {BE `usedasnew` set **and** the manual `used_good` set}, Mixed → {the new+used set}.
>
> **Step 4 (wired) — Condition Breakdown pie.** The pie (`MyCollection.jsx` ~1351) bucketed each set
> via `setConditionDisplay` instead of grouping per-copy by `CONDITION_LABELS[raw]`. The old version
> showed raw `usedasnew` slices, split the used-grades into separate slices, had **no** Mixed slice
> (per-copy iteration never saw a set as Mixed), and used a generic palette while labelling the
> tooltip "Sets". Now it renders at most three slices — New / Used / Mixed — labelled by
> `conditionDisplayLabel` and coloured by `conditionDisplayColor` (green / amber / indigo), counted
> per set (so the "Sets" tooltip is accurate). Dropped the now-dead `CONDITION_LABELS` import (and the
> long-unused `conditionColor` import) from MyCollection. Smoke: three slices — New 1 / Used 2 (BE
> `usedasnew` + manual `used_good` merged) / Mixed 1 — clean labels, semantic colours, no raw token.
>
> **Phase 1 is closed: display, column, sort, per-copy badges, filter, AND the condition pie all read
> through the one `condition.js` bucket.** Still pending (Phase 2): an `entries[]`-aware **editor** (the
> inline/panel condition write is still binary New/Used and per-set only — §3.4 #1), and the BE-ingest
> token cleanup. The taxonomy recommendation that follows is kept for history but is **not** the plan of record.

### What actually exists

**Canonical labels** (`formatting.js:48-56`): `new, sealed, used_as_new, used_good, used_acceptable,
used, mixed`.
**Cycle** (settable by inline table click, `MyCollection.jsx:21`): `["new", used_as_new, used_good,
used_acceptable]` — **no `sealed`, no `used`, no `mixed`**.
**Add-form `<select>`** (`:1914-1918`): `new, sealed, used_as_new, used_good, used_acceptable`.

### The full taxonomy table (verified)

| Value | Settable via | Label | `conditionColor` | BL bucket (`blCondition`) | BE value bucket |
|---|---|---|---|---|---|
| `new` | add, table-edit, panel-edit | New | `#5aa832` green | new | `current_value_new` |
| `sealed` | **add only** | Sealed | `#5aa832` green | new | new |
| `used_as_new` | add | Used — Like New | `#f59e0b` amber | used | used |
| `used_good` | add | Used — Good | `#c9c9c9` gray | used | used |
| `used_acceptable` | add | Used — Acceptable | `#c9c9c9` gray | used | used |
| `used` | **table/panel edit only** | Used | `#f59e0b` amber | used | used |
| `mixed` | **derived** (entries differ) | Mixed | `#c9c9c9` gray (no case) | per-entry | per-entry |
| `usedcomplete`, `usedasnew` | **BE import only** | *(none → raw, `_`→space)* | `#c9c9c9` gray | used | used |

`blCondition` (`portfolio.js:53`): `startsWith("used") ? "used" : "new"` — everything is binary at
valuation. `beValueForCondition` (`beSyncValues.js:21-28`): same binary split; BE only exposes
`current_value_new` / `current_value_used`.

### Confirmed inconsistencies (the reasons to standardize)

1. **Edit collapses detail.** Inline table edit (`:2339-2340`) and panel edit (`:2500`) offer only
   `new`/`used` and write the bare value — editing a `sealed` or `used_good` set silently overwrites it
   to `used`/`new`. Granularity is destroyable, unrecoverable.
2. **`sealed` is a roach-motel state** — settable on add, unreachable by any edit afterward.
3. **Granularity is valuation-inert.** `used_as_new`/`used_good`/`used_acceptable` all map to the same
   `used` bucket in *both* BL and BE — the sub-grades affect only display/filtering, never a number.
4. **Color is lossy & has a gap.** `used_good`, `used_acceptable`, and `mixed` are all the same gray;
   `mixed` has no explicit `conditionColor` case (falls through). Only `used_as_new`/`used` get amber.
5. **BE-import values are unlabeled** (`usedcomplete`, `usedasnew`) — render as raw underscore-stripped text.
6. **Set-level `condition` is derived for BE sets** (`:168-169`): single entry → its condition, multiple
   distinct → `mixed`, none → `null`. So the set-level field is authoritative only for manual sets.

### Recommendation — taxonomy to standardize on

Adopt a **two-layer model**: a *valuation bucket* (what already drives money) and a *display grade*
(what the user sees), with one canonical list.

- **Canonical stored values:** `new`, `sealed`, `used_like_new`, `used_good`, `used_acceptable`,
  `mixed` (derived only). Drop bare `used` as a *storable* value — keep it only as a **read-time
  display fallback** for legacy/BE rows so old data still renders. (Renaming `used_as_new` →
  `used_like_new` is optional; if churn isn't worth it, keep `used_as_new` and just stop minting bare
  `used`.)
- **Valuation bucket** = `sealed|new → "new"`, everything else → `"used"`. This is already the de-facto
  rule (`blCondition`); make it the *single* documented function both BL and BE call (they each
  re-implement the `startsWith("used")` test today).
- **Make every edit surface non-destructive:** replace the binary `new`/`used` dropdowns in inline-edit
  and panel-edit with the full canonical list (the add-form already has it), so editing can no longer
  collapse a grade. This is the single highest-value fix and unblocks the "standardized condition model."
- **Map BE-import oddballs on ingest:** `usedasnew → used_like_new`, `usedcomplete → used_good`
  (or a documented choice), so no unlabeled values reach the UI.
- **Fill the color gap:** give `mixed` its own swatch; decide whether the three used-grades should be
  visually distinct or share one "used" color (recommend distinct, since the whole point of keeping
  grades is display).

This keeps valuation behavior **byte-identical** (buckets unchanged) while making the grade durable,
labeled, editable, and consistently colored.

---

## 4. Overview roll-up — and the retail-source split to resolve

**Cards today** (`stats` useMemo `MyCollection.jsx:451-505`, rendered `:1236-1262`):

| Card | Source |
|---|---|
| Total Sets | `Σ qty` |
| **Collection Value** (Market) | `portfolioValue(sets, valueMap)` |
| **Cost Basis** (Paid) | `totalSpent(sets)` |
| Net Gain / ROI | `portfolioGain` / `portfolioROI` |
| Themes, Multi-Copy, Retired, New/Used, Avg Value, Avg Paid, Pieces, Minifigs | counts/sums |
| **Retail Value** *(hidden by default)* | `Σ (totalRetailPrice ‖ (retailPrice ‖ msrp) × qty)` |
| New / Used Sets Value | `portfolioValue` over condition-filtered subsets |

**So two of the three roll-ups already exist as headline cards** (Collection Value = Market, Cost Basis
= Paid), and a Retail total exists but is **hidden** and — critically — **computed from a different
source than the row three-up.**

### The retail-source divergence (must reconcile before the roll-up)

- **Row three-up / detail panel** read retail via `setRetailProvenance` over the **Brickset → BE
  caches** (`bricksetSetCache`, `brickEconomySetCache`) — `retailFor` (`MyCollection.jsx:240-252`).
- **Overview `retailValue` card** reads retail from **set-object fields** `totalRetailPrice`,
  `retailPrice`, `msrp` (`:471-474`) — stored on the row, not the canonical-provenance read.

These can disagree (stored `msrp` vs. live Brickset cache), and the card has no `× qty` provenance,
no 0-as-unknown coalescing, and no "—" when all-unknown parity with the row. **Recommendation:** add a
null-aware `portfolioRetail(sets, retailCaches)` to `portfolio.js` that sums `setRetailProvenance(...)
.amount ?? 0` and a `knownRetailCount`, mirroring `portfolioValue`/`knownValueCount`. Then:

> **The Overview three-up = three aggregate functions over the same per-set sources the row uses:**
> **Retail** `portfolioRetail` (new), **Paid** `totalSpent` (exists), **Market** `portfolioValue`
> (exists). It is *not* literally "sum the rendered three-up," but it **is** "sum the same per-set
> sources," which is the right invariant — same `unknown ≠ $0` handling, same retail provenance, so a
> row and the headline never contradict.

Render it as a single Overview three-up card (reusing the `TriValueCell` visual language) or as the
existing three separate cards made consistent. Keep `formatAggregateValue(total, knownCount)` so an
all-unknown column reads "—", not "$0".

**Caveat:** `retailFor` needs the retail caches; the Overview stats memo currently doesn't read them.
Wiring `retailCaches` into the memo (already in component scope, `:233-239`) is the only plumbing needed.

---

## 5. Where the density setting fits — existing prefs infrastructure

**No central prefs object.** The app uses **scattered, `bl`-prefixed, one-key-per-pref** localStorage,
each loaded via a `useState(() => localStorage.getItem(...))` initializer and written via a
`useEffect → setItemSafe(...)`. This is a well-established pattern, especially in MyCollection:
`blOwnedColumns`, `blOwnedColWidths`, `blOwnedSort`, `blOwnedSortDir`, `blCollectionItems`,
`blCollChartTypes`.

**AppSettings.jsx** holds cross-app prefs (currency, annual budget, auto-export interval, stores,
notifications) — but **view/layout prefs live with their view**, not in AppSettings.

**Sync registry** (`exportBackup.js:128-147`, `BACKUP_KEYS`): view-config prefs are marked
`settings:true` and synced (`blOwnedColumns`, `blOwnedColWidths`, `blCollectionItems`, …); device-local
ones (`blOwnedSort`, `blCollChartTypes`) are deliberately **not** synced. `setItemSafe` auto-fires
`brickledger:datachange` for any `bl*` key not in `SYNC_SKIP_KEYS`.

### Recommendation — where it goes

- **Home:** MyCollection-local, a new sibling key **`blOwnedRowDensity`** (`"full" | "compact"`),
  initialized + persisted exactly like `blOwnedSort` (`:86-88` for init, `:358-359` for the persist
  effect). Density is a Collection-table concern, so it belongs with the table's other view prefs — not
  in AppSettings.
- **UI placement:** beside the existing column-gear control in the Collection header (same neighborhood
  as the column-visibility toggle).
- **Sync:** add to `BACKUP_KEYS` with `settings:true` (parallel to `blOwnedColumns`) so a user's
  density choice follows them across devices — it's a view preference, like column layout, not a
  device-local nicety.
- **Nothing new to build:** the persistence pattern, the sync hook, and the hover card that "compact"
  mode leans on all already exist.

---

## Summary of recommendations

1. **Conditions:** one canonical list (`new, sealed, used_like_new|used_as_new, used_good,
   used_acceptable, mixed`); a single documented `new`/`used` valuation-bucket function; **make
   inline-edit and panel-edit use the full list** (stop the destructive binary collapse); map BE-import
   oddballs on ingest; give `mixed` a color. Valuation stays byte-identical.
2. **Overview roll-up:** add null-aware `portfolioRetail` + `knownRetailCount`; reconcile the hidden
   `retailValue` card to canonical provenance; present Retail / Paid / Market as a consistent three-up
   (= the same per-set sources the row uses, **not** scraping the rendered row).
3. **Density:** new `blOwnedRowDensity` key in MyCollection, synced via `BACKUP_KEYS`; reuse the
   existing hover card for the compact mode. No new infrastructure.
