# Frontend Audit — Surface 1: MC Browse

> **Scope:** UI/UX audit of the My Collection main table and its attached surfaces (column controls,
> filter/sort, RB-fill, hover card, detail panel, edit form). The frontend counterpart to
> [`mc-system-audit.md`](mc-system-audit.md).
> **Method:** Strictly read-only — inventory + classify. No code changed.
> **Tree state:** `main` @ `de6d824` (Retail Phase 3c shipped).
> **Verdict key:** ✅ **keep** · 🔧 **fix** (frontend-only) · ❌ **remove/consolidate** · 🗄️ **needs-backend** (data model / persistence / population — decide before building more frontend).

Primary file: `src/MyCollection.jsx` (~2800 lines). Supporting: `src/TriValueCell.jsx`,
`src/RowHoverCard.jsx`, `src/SetDetailPanel.jsx`, `src/utils/columnDefaults.js`,
`src/utils/portfolio.js`.

---

## 0. Headline findings (read these first)

1. **MSRP edit field — NOT missing.** It is present and unconditional at `MyCollection.jsx:2621`, Row 3
   of the **Edit Set** side-panel. Sam's report is almost certainly a *discoverability/layout* issue,
   not absent code — see [§7](#7-edit-form--msrp-ground-truth--per-copy). 🔧 (layout/disambiguation, not a code add)
2. **"Investment Forecast" is an un-caveated pass-through of BrickEconomy forecast figures** — the same
   source the app just demoted out of value (3c) and out of retail. No timestamp, no confidence marker,
   no "estimate" label. Highest-judgement item here: keep-with-caveat or cut. See [§6](#6-detail-panel--investment-forecast).
3. **Two BrickLink columns (`blSoldNew`/`blSoldUsed`) are toggleable but backed only by a non-persisted,
   auth-gated read overlay** — frequently empty, and the same numbers already render inside the detail
   panel. Wire-or-remove. 🗄️/❌ See [§2](#2-columns).
4. **Sort dropdown is ~80% redundant** with per-column header sort (4 of its 5 presets duplicate header
   clicks; only "Recently Added" is unique). See [§3](#3-filtersort-controls).
5. **Terminology split:** the table/detail/hover say **"Retail"**; the add/edit forms and Wanted List say
   **"MSRP"** — for the *same* field (`set.msrp`). Pick one. See [§8](#8-retail-vs-msrp-terminology).

---

## 1. View label — "Browse"

| Item | String | Location |
|---|---|---|
| Tab label | **"Browse"** | `MyCollection.jsx:1298` — `{ key: "collection", label: "Browse" }` |
| Page title | "My Collection" | `MyCollection.jsx:1292` |
| Section title | "Owned Sets" | `MyCollection.jsx:2205` |

**Observation.** "Browse" is borrowed from store/catalog UIs, where you *browse* inventory you don't own
yet. Here the tab shows **sets you already own** — you're not browsing a catalog, you're viewing your
holdings. The sibling section header already calls it "Owned Sets," so the tab and its own content
disagree.

**Alternatives** (in rough order of fit): **"Sets"**, **"Owned"**, **"Collection"**, **"My Sets"**,
**"Holdings"**, **"Inventory"**. "Sets" or "Owned" reads most naturally against the other tabs
(Budget / Wanted / Settings).

**Verdict:** 🔧 **fix** (label-only, trivial) — rename "Browse" → "Sets" or "Owned". Low risk; product call.

---

## 2. Columns

Source of truth: `DEFAULT_OWNED_COLUMNS` in `src/utils/columnDefaults.js` (lines 7–24). Visibility menu
at `MyCollection.jsx:2273`; persisted to `localStorage.blOwnedColumns`. Header sort/reorder/resize wired
at `MyCollection.jsx:2389`.

| Col key | Label | Default | Data source | Populated? | Verdict |
|---|---|---|---|---|---|
| `thumb` | Image | hidden | `set.thumbnail` / `setImageUrl(setNumber)` | Usually (CDN-derived); placeholder fallback | ✅ keep |
| `setNumber` | Set # | **shown, locked** | `set.setNumber` | Always (primary key) | ✅ keep |
| `name` | Set Name | **shown, locked** | `set.name` | Always | ✅ keep |
| `theme` | Theme | **shown, locked** | `set.theme` | Always (BE/Brickset/RB-fill/manual) | ✅ keep |
| `condition` | Condition | hidden | `setConditionDisplay(set)` → new/used/mixed | Always (defaults "new") | ✅ keep (also a filter axis) |
| `qty` | Qty | **shown, locked** | `set.qty` | Always (defaults 1) | ✅ keep |
| `value` | Value | **shown, locked** | 3-up `TriValueCell` (Retail/Paid/Market) | Always renders ("—" per missing leaf) | ✅ keep — see [§2a](#2a-the-value-column-tri-cell) |
| `gain` | Gain | **shown, locked** | `setGain(set, valueMap)` | When market **and** cost known, else "—" | ✅ keep |
| `roi` | ROI | **shown, locked** | `setROI(set, valueMap)` | When market **and** cost known, else "—" | ✅ keep |
| `minifigs` | Minifigs | hidden | `set.minifigs` | **Sparse** — needs Brickset sync or RB-fill | 🔧 keep, but depends on RB-fill/Brickset enrichment to be useful |
| `acquiredDate` | Acquired | hidden | `set.acquiredDate` | Sparse (BE entries / manual) | ✅ keep |
| `retiredDate` | Retired On | hidden | `set.retiredDate` | Sparse (Brickset `exit_date`) | ✅ keep |
| `releasedDate` | Released | hidden | `set.releasedDate` | Sparse (Brickset `launch_date`) | ✅ keep |
| `blSoldNew` | BL New (6mo) | hidden | `blPriceCache[n]?.data?.qty_avg_price_new` | **Sparse** — read-only overlay, auth-gated, not persisted | 🗄️/❌ wire-or-remove — see [§2b](#2b-bl-price-columns) |
| `blSoldUsed` | BL Used (6mo) | hidden | `blPriceCache[n]?.data?.qty_avg_price_used` | **Sparse** — same | 🗄️/❌ wire-or-remove |
| `notes` | Notes | hidden | `set.notes` | Sparse (manual) | ✅ keep |

### 2a. The "Value" column (tri-cell)
`MyCollection.jsx:1045` renders `TriValueCell` (`src/TriValueCell.jsx`) — three stacked leaves:
- **Retail** (`TriValueCell.jsx:55`) ← `retailFor(set)` → Brickset → manual `set.msrp` (BE removed in 3c).
- **Paid** (`:64`) ← `setCost(set)`.
- **Market** (`:70`) ← `setValueProvenance(set, valueMap)` (BL overlay → BE fallback).

In **compact** density (default) the cell shows **Market only**; Retail + Paid move to the hover card
(see [§5](#5-row-hover-card)). Each leaf shows "—" when unknown (never a phantom $0). ✅ Sound.

### 2b. BL price columns
`blSoldNew`/`blSoldUsed` read `blPriceCache`, a **read-time overlay** fetched on mount — not stored,
gated on the BrickLink batch having run for those set numbers. For most users/sets these render blank.
The **same two figures already appear in the detail panel** ("BL Avg Sold New/Used",
`SetDetailPanel.jsx:193–201`). As top-level toggleable columns they invite a user to enable a column
that's usually empty.

> 🗄️ **Backend flag — population, not UI.** These columns can't be "fixed" in the frontend: their value
> depends on the BrickLink value batch (`scripts/refresh-values.mjs` → Upstash) having coverage for the
> user's sets. Decide population strategy before keeping them as first-class columns. If coverage stays
> partial, ❌ remove from the column menu and leave them in the detail panel only.

---

## 3. Filter/sort controls

Toolbar at `MyCollection.jsx:2207–2243`. Applied in the `visibleSets` memo (`:1102–1117`).

### Filters — all functional ✅
| Control | State | Filters on | Location |
|---|---|---|---|
| Search box | `searchText` | setNumber, name, theme, subtheme, notes, year (substring, case-insensitive) | `:2208` / logic `:1104–1111` |
| Theme dropdown | `filterTheme` | `set.theme` exact match; options from collection | `:2214` / `:1116` |
| Condition dropdown | `filterCondition` | `setConditionDisplay(set)` ∈ {new, used, mixed} | `:2219` / `:1117` |
| Clear | — | resets all three; shown only when a filter is active | `:2225` |

### Sort — two mechanisms, mostly redundant
- **(a) Preset dropdown** (`:2229–2243`): 5 options — `addedAt:desc` (Recently Added), `setNumber:asc`,
  `name:asc`, `value:desc`, `gain:desc`.
- **(b) Per-column header click** (`sortHeader`, `:1088–1095`; wired `:2389`): sorts by **any visible
  column**, toggles direction on re-click, smart default (desc for value/gain, asc otherwise). Active
  column shows " ↑/↓" (`sortLabel`, `:1097`).

Both write the same `sortColumn`/`sortDirection` state (persisted `:381`).

**Redundancy:** 4 of the dropdown's 5 presets (`setNumber`, `name`, `value`, `gain`) are reachable by a
header click. Only **"Recently Added" (`addedAt`)** is unique — and notably, **`addedAt` is *not* a
visible column**, so it has no header to click. That's the one thing the dropdown does that headers
can't.

**Verdict:** 🔧 **fix/consolidate.** The dropdown is largely duplicative. Two clean options:
(1) drop the dropdown and add an "Added" column (or a small "Recently added" toggle) so header sort
covers everything; or (2) keep the dropdown but trim it to just "Recently Added" + maybe "Value", and
lean on headers for the rest. Either removes the dual-control confusion. Both controls *work*; this is
about UX clarity, not bugs.

---

## 4. RB-fill (Rebrickable) button

`MyCollection.jsx:2244–2259`; handler `enrichFromRebrickable()` `:815–859`.

- **Label:** "RB Fill" → "…" while running → "✓ RB (N)" after (N = fields filled).
- **What it does:** scans the local **bundled** Rebrickable catalog (no API call) and fills **only
  missing** `pieces`, `theme`, `year`, `name` on owned sets (and the Wanted List). Persists via
  `setItemSafe`. Toasts the count.
- **Tooltip:** *"Fill missing pieces / theme / name from local Rebrickable catalog (no API call)"* — clear
  and honest about scope and zero network cost.

**Assessment:** Functional and useful for backfilling sparse metadata (esp. the `minifigs`/`pieces`-style
gaps that make hidden columns empty). The label "RB Fill" is jargon-y for a casual user — the *tooltip*
carries the meaning, but the button face doesn't.

**Verdict:** ✅ **keep**; 🔧 minor — consider a plainer face label ("Fill details" / "Autofill") with "RB"
in the tooltip. Note it fills `name`/`theme`/`year`/`pieces` but **not** `minifigs` despite minifigs
being a hidden column users might enable expecting data (the catalog's part/minifig counts aren't wired
into this fill) — small expectation gap worth a look.

---

## 5. Row hover card

`src/RowHoverCard.jsx`; triggered on row `onMouseEnter` (`MyCollection.jsx:2424`), positioned at cursor
(`tipPos`), rendered `:2104–2111`.

**Shows:** image (72px), name, then a grid — Set #, Theme, Condition, Qty, **Retail**, **Paid**,
**Market** (gold), plus ROI% (if `set.roiPct`) and Status (Retired/Active if `set.retired != null`),
footer "click for details".

**Duplication analysis:**
- **Vs. row (compact density):** *Complementary, not duplicate* — the compact row shows Market only, so
  the card is where Retail + Paid live. This is intentional and the card earns its place **in compact
  mode**.
- **Vs. row (full density):** the row already shows all three values → the card's value grid is then
  redundant; it adds only ROI% + Status + image.
- **Vs. detail panel:** every field except ROI%/Status is a strict subset of `SetDetailPanel`.

**Verdict:** ✅ **keep** — it's a genuine quick-glance, *especially* in the default compact density. Minor
note: its value to a **full-density** user is thin (image + ROI + status only). Acceptable as-is.

---

## 6. Detail panel + investment forecast

`src/SetDetailPanel.jsx`. Opened by clicking a row (`MyCollection.jsx:2421`); the **Edit** button
(top-right, gold, `:157–160`) bridges to the Edit Set form.

### Layout (top → bottom)
Header (theme/set#, name, Retired/Active + Last-Chance + Retiring-Soon badges, copy-count) → image →
chips (Year, Pieces, **Retail**) → **Stats grid** (Cost Basis, Market, Net Gain, ROI, Avg Paid/Copy,
Value/Copy, vs. Retail %) → **BL Prices** (conditional) → **Investment Forecast** (conditional) → **Set
Details** (subtheme/minifigs/rating/age) → **Per-Copy Breakdown** (conditional). Generally complete and
well-ordered. ✅

### Investment Forecast — surfaced method
`SetDetailPanel.jsx:203–225`, data extracted `:61–70`.

- **Displays:** "2yr Forecast" + "5yr Forecast" (green dollar figures), and "2yr vs. Retail" /
  "5yr vs. Retail" percentages (shown only when both forecast and retail exist).
- **Source:** read **verbatim** from the BrickEconomy cache (`localStorage.brickEconomySetCache`):
  `cached.forecast_value_new_2_years` / `forecast_value_new_5_years`, via `asNumber()`.
- **Computation:** **none** for the dollar figures — they are pass-through external BE projections. The
  only math is the vs-Retail %: `((forecast − retail) / retail) × 100` (`:212`, `:219`).
- **Caveat shown:** **none.** No timestamp, no source attribution, no confidence/estimate marker —
  unlike the Market value, which carries `est./thin/ask` confidence tags. The only framing is the
  section header "Investment Forecast."

> **Why this is the key judgement call.** BrickLedger spent the value arc establishing BrickLink-sold as
> the calibrated source and **demoting BrickEconomy** (uncalibratable, ~+18–24% biased, ~2.6× polybag
> overvaluation — see [`value-source-decision.md`](value-source-decision.md) §4). 3c then pulled BE out
> of **retail** too. Yet the most authoritative-sounding number in the panel — a dollar "forecast" in
> confident green — is a **raw BE projection with no caveat**, presented as fact. That's a provenance
> inconsistency with the rest of the app.

**Verdict:** 🔧 **caveat** *or* ❌ **cut** (product decision):
- **Caveat path:** label it clearly as a third-party BrickEconomy projection, add the source/asOf, drop
  the unqualified green, and gate it behind the same confidence treatment as Market. Keeps the feature,
  removes the false precision.
- **Cut path:** if BE is being retired from the data story, a green "forecast" sourced solely from it is
  the most misleading thing to keep. Removing it is defensible and consistent with 3c.
- 🗄️ **Backend note:** there is no BrickLink-derived forecast; building a grounded replacement would need
  a new data source / model (out of frontend scope). Until then this is BE-or-nothing.

### Multi-copy handling ✅
For BE sets with `entries[]`, the panel renders one **Per-Copy Breakdown** card per copy (`:239–316`):
per-copy Condition, Acquired, Paid, Value (condition-matched, with lots label), and ROI. A 6-copy set
shows 6 cards; headline stats show aggregates (Avg Paid/Copy, Value/Copy). This is the panel's strongest
section. (See per-copy *editing* limits in [§7](#7-edit-form--msrp-ground-truth--per-copy).)

---

## 7. Edit form, MSRP ground truth & per-copy

### The Edit Set form (`MyCollection.jsx:2573–2631`)
A sticky side-panel shown when `selectedSetIndex !== null`. Four rows, all writing via
`updateSet(index, field, value)` (`:1195`):

| Row | Fields |
|---|---|
| 1 | Set # (text), Set Name (text) |
| 2 | Theme (select), Condition (New/Used toggle) |
| 3 | **Qty** (number), **Paid** (number), **Value** (number), **MSRP** (number) |
| 4 | Acquired (date), Notes (text) |

### MSRP — definitive answer: **present, not absent**
- **It renders unconditionally** at `MyCollection.jsx:2621` (Row 3, 4th field). No source-gating — it
  shows for both BrickEconomy and manual sets:
  ```jsx
  <label><span style={lbl}>MSRP</span><input type="number" min="0" step="0.01"
    value={s.msrp || ""} onChange={e => updateSet(selectedSetIndex, "msrp", e.target.value)} /></label>
  ```
- **Write path is real and persistent.** `updateSet` coerces msrp to a number and applies
  `manualMsrpPatch(value)` → `{ msrp, retailPrice }` (`utils/portfolio.js:242`). For BE sets it persists
  through `persistBESetEdit` onto `brickEconomyNormalizedCollection` (`:1231`, `:1150`), which
  auto-pushes to cloud; manual sets persist via the `blOwnedSets` effect. Also set by the Add-Set form
  (`:2070`) and auto-filled on Brickset lookup (`:765`).
- **Read path is real.** Consumed by the retail ladder (`retailFor`, `:271`) and the detail panel
  (`SetDetailPanel.jsx:91`). Covered by `src/utils/manualMsrp.test.js`.

### So why does Sam see it "missing"? — likely causes (frontend)
The field exists; the issue is **how you reach it and how it looks**:
1. **It's two clicks deep and in a *different* panel than where people look.** Clicking a row opens the
   **detail panel** ("more info"), which has **no MSRP field** (only a read-only Retail chip + per-copy
   condition). You must then click the gold **"Edit"** button (`SetDetailPanel.jsx:157`) to open the Edit
   Set form where MSRP lives. Anyone inspecting "more info" for an MSRP field won't find one.
2. **Row 3 is a cramped 4-column grid** (`gridTemplateColumns: "1fr 1fr 1fr 1fr"`, `:2617`). On a narrow
   / mobile-first viewport (this app is mobile-first), four number inputs in one row squeeze hard — MSRP,
   the last column, is the most likely to be clipped, wrapped oddly, or visually lost next to Qty/Paid/
   Value.
3. **Stale bundle** is possible but secondary given (1)+(2) fully explain it.

**Verdict:** 🔧 **fix (UX, not code-add).** The field is shipped and working. Recommended: (a) make MSRP
discoverable from the detail panel (it's the panel that shows "Retail" read-only — add an inline edit or
a clearer route), and/or (b) reflow Row 3 on narrow widths so MSRP doesn't get squeezed. **No backend
change needed.** Confirm with Sam *where* he was looking — near-certainly the detail panel, not the Edit
form.

### Per-copy editing — what works today
| Field | Editable per-copy? | Where / how |
|---|---|---|
| **Condition** | ✅ **Yes** | New/Used buttons per copy in the detail panel (`SetDetailPanel.jsx:267`) → `onEditCopyCondition` → `editCopyCondition` → `reconcileConditionEdit` → `persistBESetEdit` |
| Paid | ❌ No (aggregate) | `entries[].paid_price` exists but only the form-level Paid is editable; `reconcilePaidEdit` *distributes* an aggregate across copies |
| Value | ❌ No | per-copy value is read from cache/BL, condition-matched; not directly editable |
| Acquired | ❌ No | `entries[].acquired_date` shown read-only |
| MSRP / Qty | ❌ No | set-level only by nature |

> 🗄️ **Backend / data-model flags (decide before building per-copy UI):**
> 1. **Only BrickEconomy sets have `entries[]`.** **Manually-added sets have no per-copy array at all** —
>    so per-copy display *and* editing are structurally impossible for them. Any "edit each copy" feature
>    for manual sets needs a data-model change (give manual sets an `entries[]`).
> 2. **Per-copy Paid/Acquired editing.** The data model *already stores* `entries[].paid_price` /
>    `acquired_date`, but the UI offers no per-copy write — and the current aggregate-Paid path
>    *reconciles/distributes* down to entries, which a true per-copy editor would conflict with. Wiring
>    per-copy paid/acquired editing is mostly frontend, but needs the persistence/reconciliation contract
>    settled first (which write wins — aggregate or per-copy?).
>
> Net: **per-copy condition editing is the only per-copy edit today.** Extending it is a backend/data-model
> decision, not a pure frontend task — flagged distinctly per the brief.

---

## 8. Retail vs MSRP terminology

Same underlying field (`set.msrp`, resolved by `setRetailProvenance`) is labeled **two different ways**:

| Term | Where (user-facing) |
|---|---|
| **"Retail"** | TriValueCell leaf (`TriValueCell.jsx:55`), hover card (`RowHoverCard.jsx:41`), detail chip + "vs. Retail" stats (`SetDetailPanel.jsx:179,190,211,218`), "Retail Value" overview card (`MyCollection.jsx:39,1400`) |
| **"MSRP"** | Add-Set form label "MSRP — retail" (`:2070`), Edit form label (`:2621`), Wanted List column + forms (`WantedList.jsx:42,2298,2974`) |

The detail-panel code even *comments* that "Retail" is meant to be "one term across the app"
(`SetDetailPanel.jsx:177`) — but the **input** controls that set the value all say "MSRP." So a user
types a number into "MSRP" and watches it appear under "Retail." That's the friction.

**Verdict:** 🔧 **fix (standardize, label-only, low-risk).** Pick one term app-wide. Recommendation:
**standardize on "MSRP"** for the *editable sticker price* — it's precise (manufacturer's suggested
retail price), it's already what every *input* says, and it disambiguates from "Retail Value" (the
aggregate card) and "resale/market." Keep "vs. Retail" comparisons readable but unify the field noun.
(If the team prefers "Retail" for friendliness, the inverse works too — the point is *one* noun for the
field.) Either way the test ids (`msrp-chip`) can stay internal. **No backend impact.**

---

## 9. Anything else on the surface

- **`addedAt` has no column** but is the default sort target ("Recently Added") — see §3; minor
  inconsistency (sort by a field you can't see/sort via header).
- **Hidden-by-default columns dominate** (10 of 16 hidden). A first-time user sees a fairly bare table;
  the richest columns (dates, minifigs, BL prices) require both the column menu *and* upstream data. Not
  a bug — worth a "customize columns" nudge.
- **Header affordances are dense:** one `<th>` is click-to-sort + drag-to-reorder + drag-edge-to-resize
  (`:2389` tooltip). Powerful but discoverable only via tooltip; fine to keep, note for onboarding.
- **`thumbnail` vs `setImageUrl`:** the image column/hover derive URLs by convention; broken/missing
  images fall back silently. Acceptable.

---

## 10. Triaged list

### 🗄️ Needs-backend / data-model (decide before more frontend)
| # | Item | Why it's backend |
|---|---|---|
| B1 | **Investment Forecast has no grounded source** | Only BE provides it; a calibrated forecast needs a new source/model. Until then it's BE-or-nothing (and BE is being retired). |
| B2 | **`blSoldNew`/`blSoldUsed` column population** | Depends on the BL value batch covering the user's sets; not a frontend fix. |
| B3 | **Per-copy editing for manual sets** | Manual sets have no `entries[]`; per-copy needs a data-model change. |
| B4 | **Per-copy Paid/Acquired editing** | Data exists in `entries[]` but the aggregate-Paid reconciliation contract must be resolved before a per-copy writer. |

### 🔧 Fix (frontend-only)
| # | Item | Action |
|---|---|---|
| F1 | **MSRP "missing"** | Field is present (`:2621`); fix *discoverability* — surface MSRP from the detail panel and/or reflow the cramped Row-3 4-col grid on narrow widths. Confirm Sam's vantage point. |
| F2 | **Forecast caveat** | If kept: add source/asOf + confidence treatment, drop the unqualified green. (Else → R-list.) |
| F3 | **Retail/MSRP terminology** | Standardize on one noun app-wide (recommend "MSRP" for the editable field). |
| F4 | **Sort dropdown redundancy** | Trim dropdown to its unique value (Recently Added) or add an "Added" column and drop the dropdown. |
| F5 | **"Browse" tab label** | Rename → "Sets"/"Owned". |
| F6 | **RB-fill label** | Plainer face label; consider also filling `minifigs`. |

### ❌ Remove / consolidate (candidates)
| # | Item | Note |
|---|---|---|
| R1 | **`blSoldNew`/`blSoldUsed` as top-level columns** | Usually empty + duplicated in detail panel. Remove from column menu unless B2 guarantees coverage. |
| R2 | **Investment Forecast** | If BE is being retired, cutting the un-caveated green forecast is the consistent move (alternative to F2). |

### ✅ Keep (working, no change)
Filters (search/theme/condition/clear), per-column header sort, the Value tri-cell + null-aware "—",
Gain/ROI, RB-fill mechanics, the hover card (esp. compact density), the detail panel layout + per-copy
*breakdown*, and the MSRP write/persist/read plumbing.

---

*Read-only audit — no application code modified. This document is the sole output.*
