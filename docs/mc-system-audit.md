# My Collection — System Audit

**Scope:** the My Collection (MC) tab end-to-end — every surface, every on-screen field's
provenance, the data model's bones, and the seams to Budget and Wanted. **Read-only**: a map +
a prioritized findings list, not a fix-it pass. Anchors are `file:line` against today's code
(audited 2026-06-03, on `main` @ `f05109e`).

## Status & relation to existing docs

**This lives best as a new doc (here), not folded into the inventory.** Different altitude:
[`ui-data-inventory.md`](ui-data-inventory.md) is a *flat, four-tab field catalog*; this is an
*MC-deep, provenance-and-seams audit with a verdict*. Folding it in would bloat the inventory and
blur its purpose. Instead, this doc **supersedes the MC-relevant parts** of the inventory and
cross-links; the inventory should be patched on the stale lines below.

**The inventory is ~1 day stale on exactly the MC areas audited here.** It was frozen 2026-06-02
18:22; MC then took its largest recent arc — Paid-column removal, tri-value cell, paid/value
provenance, and the whole condition bucket + bulk/per-copy editing line — through 2026-06-03 11:57.
[`app-architecture.md`](app-architecture.md) (and [`valuation.md`](valuation.md)) **are current**;
where the two docs disagree, architecture wins.

**Inventory lines to reconcile (all verified against code):**
- **§2.1 "17 columns … `paid`(edit), value, gain"** — the standalone **Paid column is gone**
  (commit `b6b192b`). Value/Paid/Retail now stack in one **TriValueCell** ([`MyCollection.jsx:1014`](src/MyCollection.jsx:1014), [`TriValueCell.jsx`](src/TriValueCell.jsx)).
- **§1.6 / Part 3(c) "No BrickLink value feeds the main Value column"** — **false now.** A
  BrickLink value overlay (`blOverlayValue`/`resolveCopies`, [`portfolio.js:120`](src/utils/portfolio.js:120)) is the **primary** market source, BE the fallback, threaded through the table and every total via `valueMap`.
- **Part 3(d)1 "retirement banner / hover / New-Used cards render unknown as $0"** — **fixed**
  ("Workstream A"): banner is null-aware ([`MyCollection.jsx:2108`](src/MyCollection.jsx:2108)), New/Used cards use `fmtAgg` ([`:1357`](src/MyCollection.jsx:1357)), hover uses `formatValue`.
- **New, undocumented in the inventory:** paid provenance (`setPaidProvenance`/`costBasisBreakdown`/`realCostROI`), retail provenance (`setRetailProvenance`), `reconcilePaidEdit`/`reconcileConditionEdit`, the condition normalizer ([`condition.js`](src/utils/condition.js)), and per-copy condition editing.

---

## 1 · Surfaces & windows — what each SHOWS vs lets you EDIT

| Surface | Anchor | Shows | Edits |
|---|---|---|---|
| **Browse table** | rows [`:997`](src/MyCollection.jsx:997); cols [`columnDefaults.js:7`](src/utils/columnDefaults.js:7) | `setNumber`, `name`, `theme`, **Value cell (tri-value)**, `gain`, `roi` default-visible; `thumb`/`condition`/`minifigs`/dates/`blSoldNew·Used`/`notes` hidden | **qty** (dbl-click), **condition** (dbl-click, binary New/Used **bulk** = all copies) |
| **TriValueCell** | [`:1014`](src/MyCollection.jsx:1014), [`TriValueCell.jsx`](src/TriValueCell.jsx) | full density: **Retail / Paid / Market** stacked + confidence badge (est./thin); compact: Market only, Retail+Paid in hover card | read-only |
| **Row density toggle** | [`:2217`](src/MyCollection.jsx:2217) | compact ↔ full | — |
| **Overview cards** | [`:1333`](src/MyCollection.jsx:1333) (17 cards, [`columnDefaults`/items :25](src/utils/columnDefaults.js:25)) | Collection Value (+ "N unknown · X% estimated"), Cost Basis (+ MSRP-estimate note), Net Gain, ROI (+ MSRP-included note), Themes, Multi-Copy, Retired, New/Used, Avg Value/Paid, Pieces, Minifigs, Retail Value, New/Used Value, Wanted | read-only |
| **Overview panels** | [`:1406`–`:1748`](src/MyCollection.jsx:1406) | Condition donut (**bucketed** New/Used/Mixed), Value-by-Theme (donut/bar via `groupRollup`), ROI Leaders, Most Valuable, Wanted highlights, Budget Snapshot, Portfolio History (area), Theme Performance (null-aware table) | chart-type cycle only |
| **Retirement alert banner** | [`:2091`](src/MyCollection.jsx:2091) | owned sets retiring soon: Paid/Market/Gain/ROI (null-aware) + "Sell on BrickLink ↗" | dismiss |
| **SetDetailPanel** | [`SetDetailPanel.jsx:36`](src/SetDetailPanel.jsx:36) | header (retired/last-chance/countdown/copies), image, meta chips, stat grid (Cost/Market/Gain/ROI/Avg-Paid/Value-per-copy/vs-Retail), BL live prices (auth-gated), 2/5yr forecast, Set Details, **Per-Copy Breakdown** | **per-copy condition** (New/Used, copyIndex-aware) [`:257`](src/SetDetailPanel.jsx:257); edit-set modal (paid/value/qty/condition) |
| **Edit-set modal** | [`:2417`](src/MyCollection.jsx:2417) area | — | **paid, current value, qty, condition** |
| **Filters / sort** | search + theme `<select>` + condition `<select>`; sort dropdown + header click | search hits `setNumber/name/theme/subtheme/notes/year`; condition filter reads the **bucket** | — |
| **Entry points / actions** | "RB Fill", Brickset ⟳ enrichment, **Log Sale** ([`:1225`](src/MyCollection.jsx:1225)) | — | enrich metadata; sell→`blSoldSets` |

**valueMap (BL overlay) wiring** — held at [`:331`](src/MyCollection.jsx:331), warmed by `peekValueCache` then refreshed by `fetchValues` ([`:341`–`:344`](src/MyCollection.jsx:341)), and threaded into **every** value consumer: `portfolioValue`/`knownValueCount` ([`:483`](src/MyCollection.jsx:483),[`:492`](src/MyCollection.jsx:492)), `portfolioGain`/`portfolioROI`/`estimatedValueShare` ([`:530`](src/MyCollection.jsx:530)), `groupRollup` ([`:540`](src/MyCollection.jsx:540),[`:588`](src/MyCollection.jsx:588)), per-row `setGain`/`setROI`/`setValueProvenance` ([`:997`–`:1017`](src/MyCollection.jsx:997)), sort ([`:1090`](src/MyCollection.jsx:1090)), panel ([`:2047`](src/MyCollection.jsx:2047)). `valuesReady` gates the cells to "…" until the first map resolves.

---

## 2 · Data provenance — field by field

Source key: **BE** = BrickEconomy blob (`brickEconomyNormalizedCollection`, incl. `entries[]`) · **BS** = Brickset cache · **BL** = BrickLink value cache (`blValueCache`, device-local) · **ledger** = `blPurchases` via `buildPurchaseMap` · **manual** = user/promotion-written `blOwnedSets` · **computed** = derived read-time.

| On-screen field | Stored/derived | Source | Complete? | Editable · persists |
|---|---|---|---|---|
| Value (Market) | derived `setValueProvenance(s, valueMap)` | **BL** (condition-matched `.new`/`.used`) → **BE** fallback → null | gappy: BL only where batch covered; else BE per-copy | edit modal writes `currentValue` (manual sets) — persists, but overlay can mask it |
| Paid | derived `setCost` + `setPaidProvenance` | `totalPaid`→`paidPrice×qty`; provenance ledger/manual/msrp/none | complete as a number; provenance gappy (see CMF) | yes — `reconcilePaidEdit` rewrites `totalPaid`+`entries[].paid_price`; `persistBESetEdit` → BE blob |
| Retail (MSRP) | derived `setRetailProvenance` via `retailFor` | **BS** `retail_price_us` → **BE** deprecated fallback | **gappy — CMF hole (see §3)** | not editable on the row |
| Gain | computed `setGain` (null if value unknown) | value − cost | inherits value gaps → "—" | no |
| ROI | computed `setROI` (null if value unknown OR cost ≤ 0) | (value−cost)/cost | excludes ÷0 / unknown | no |
| Condition | display `setConditionDisplay` (bucketed; Mixed derived) | BE `entries[].condition` / set `condition` | complete; "mixed" never stored | yes — bulk (table) + per-copy (panel) via `reconcileConditionEdit`; re-values from BE cache |
| Qty / quantity | stored (store-dependent synonym) | manual / BE | complete | yes — persists |
| Avg Paid / Copy, Value / Copy | computed | from paid/value | inherits gaps | no |
| vs. Retail % | computed | market vs `setRetailProvenance` | gappy with retail | no |
| Pieces / Minifigs | stored | BS / BE | mostly complete | no (count fields; `||` fallback safe) |
| Retired / dates / countdown | stored | BS / BE / BF | gappy | no |
| Forecast 2/5yr | stored | BE | sparse | no (panel only) |
| Theme / subtheme / year / name | stored | BS / RB / user | complete-ish | metadata only via enrichment |
| Estimated-share disclosure | computed `estimatedValueShare` | BL basis modeled/asking | n/a | no |
| Cost-basis split (real vs MSRP) | computed `costBasisBreakdown` | `setPaidProvenance` over ledger join | n/a | no |

**The CMF retail hole, quantified.** Two compounding causes: (1) Brickset catalogs the **series**
(`71052`), not the individual minifig variants (`71052-1`…`-12`); (2) `retailFor` strips only the
`-1` suffix (`replace(/-1$/, "")`, [`:262`](src/MyCollection.jsx:262)), so a `71052-5` lookup tries
`brickset_71052-5` / `brickset_71052-5-1` — **never the series base `71052`**. Net: the Retail rung
and the `vs. Retail %` resolve to **"—" for every CMF figure whose variant ≠ `-1`**. Note the
**asymmetry** — the *paid* ledger join strips any `-N` (`baseSetNumber`, [`portfolio.js:410`](src/utils/portfolio.js:410)), so CMF figures *do* inherit a series purchase's cost, but *not* its retail. (Market value is unaffected: BL/BE value is per-figure.)

---

## 3 · The bones verdict

**The model is solid.** The core decisions are right and consistently applied:

- **Per-copy `entries[]` + bucketed condition** is the correct grain. `setConditionDisplay`
  derives Mixed from disagreeing copies (never stored), and value is condition-matched per copy
  (`valueGroups`/`resolveCopies`). This closed the "raw `usedasnew` token leaks to UI" class.
- **Derive-on-load, persist-nothing-derived.** Value, paid, retail, gain, ROI provenance are all
  read-time projections ([`portfolio.js`](src/utils/portfolio.js)); the BL overlay is
  non-destructive (demote-don't-delete) and the BE fields stay as fallback.
- **Unknown ≠ $0 is single-sourced and now actually holds at the consumer sites** — `valueAmount`
  ([`value.js:40`](src/utils/value.js:40)) is the one coalescing point; the previously-flagged
  falsy-`||` leaks are fixed.
- **One ledger join** (`buildPurchaseMap` + base-number strip) feeds both paid provenance and the
  cost-basis split.

**Every known gap, in one place** (tagged):

| # | Gap | Tag |
|---|---|---|
| G1 | **CMF retail hole** — retail "—" for all CMF figures ≠ `-1`; `retailFor` strips `-1` only while the paid join strips `-N` (asymmetry) | **real-gap** |
| G2 | **Promotion launders paid/msrp as value.** Budget→Collection seeds `currentValue = paidPerUnit` ([`BudgetDashboard.jsx:1178`](src/BudgetDashboard.jsx:1178)); Wanted Buy-Now seeds `currentValue = BE→msrp→0` ([`WantedList.jsx:213`](src/WantedList.jsx:213)). Until BL/BE revalues, Value≈Paid → gain 0 / phantom-real value | **real-gap** |
| G3 | **Promoted sets carry no `source:"BrickEconomy"` and no `entries[]`** — they're flat manual records, so no per-copy treatment and they sit only in `blOwnedSets` (the BE-normalized path never sees them) | **real-gap** |
| G4 | **Dual collection stores persist** (`blOwnedSets` + `brickEconomyNormalizedCollection`, `qty/paidPrice` vs `quantity/totalPaid/entries[]`), merged inline at load. Promotion always writes the manual store; BE edits write the blob | **real-gap (structural)** |
| G5 | **`retailValue`/`retailValueKnown` aggregates use raw `||`** ([`:498`](src/MyCollection.jsx:498),[`:501`](src/MyCollection.jsx:501)) — a `totalRetailPrice` of 0 silently falls to `retailPrice`; gated by the known-count so the card is honest, but the per-set sum is the old pattern | **cosmetic** |
| G6 | **Edit-set modal can write `currentValue` for a manual set, but the BL overlay will mask it** on the next render if the BL cache covers that set/condition — the edit looks lost | **cosmetic/UX** |
| G7 | **BE-sync summary still ~15 fields, only `lastSync` shown** (carried from inventory §1.9); plus forecast/`asOf`/value-`source` never surfaced on the row | **cosmetic** |
| G8 | **Per-copy `notes` and acquired-dates beyond the first collapse on load** (inventory §1.2 note still true) | **cosmetic** |

No gap is in the *foundation*; G1–G4 are seam/coverage gaps, not modeling errors.

---

## 4 · The seams (anti-silo core)

**Topology: a star with Collection at the center, all flows one-directional.** Stores are
single-writer except `blOwnedSets`, which has three writers.

```
Budget ──owns──▶ blPurchases ──read-only──▶ Collection (cost-basis join)
  └─ "→ Collection" button ─writes─▶ blOwnedSets
Wanted ──owns──▶ blWantedList
  └─ Buy-Now ─writes─▶ blPurchases (+ optional blOwnedSets) ─removes─▶ self
  └─ "Owned" badge ◀─reads─ blOwnedSets + brickEconomyNormalizedCollection (+ legacy beOwned)
Collection ──Log Sale──▶ blSoldSets (+ deletes the owned row)   [no write back to Budget]
```

**MC ⇄ Budget — the cost-basis bridge (the good seam).** `blPurchases` is owned by Budget
([`BudgetDashboard.jsx:216`](src/BudgetDashboard.jsx:216)); MC reads it **read-only** ([`:249`](src/MyCollection.jsx:249)), runs it through `buildPurchaseMap` (base-number index), and `setPaidProvenance` tags each set `ledger`/`manual`/`msrp`/`none`. This is a clean *derive-don't-duplicate* seam: a purchase is never copied into the set; the link is recomputed at read time on the base number, so one CMF series purchase backs every figure. **`costBasisBreakdown`** then splits headline cost into real vs MSRP-placeholder.

**MC ⇄ Budget — the promotion seam (the lossy one).** "→ Collection" ([`BudgetDashboard.jsx:1184`/`1240`](src/BudgetDashboard.jsx:1184)) writes a flat `blOwnedSets` row via `makeCollectionEntry` — `condition:"new"`, `paidPrice = faceValue`, **`currentValue = faceValue`** (G2), no `source`/`entries`/retail/dates (G3). The purchase is flagged `inCollection:true` but **the value seeded here is paid, not market.** The display saves it only because the BL `valueMap` overlay, keyed on `setNumber`, later overwrites with a real figure *if the batch covered it* — otherwise the BE fallback is literally the paid amount.

**Wanted ⇄ Collection.** Ownership is **computed, not stored**: `ownedSetNumbers` merges three
stores at mount ([`WantedList.jsx:294`](src/WantedList.jsx:294)) — note it memoizes on `[]`, so the
badge only refreshes on remount/tab-switch, not live. Buy-Now is a richer promotion than Budget's
(carries msrp/retail/dates/pieces, BE-derived `currentValue`), but still **no `source`/`entries`**
(G3) and msrp-as-value fallback (G2).

**MC → Sold.** `logSale` ([`:1225`](src/MyCollection.jsx:1225)) writes `blSoldSets` (with realized
`gain`/`roi`, where falsy-zero is moot) and deletes the owned row. **It does not write back to
`blPurchases`** — realized P&L is a separate archive, invisible to Budget and Wanted.

**Shared vs duplicated.** *Genuinely shared/derived:* the cost-basis link (ledger join, read-time),
the BL value cache (fetched once per MC session), ownership (computed). *Duplicated per store:*
`setNumber`/`name`/`theme` (every store its own copy, no reconciliation), and **MSRP/retail +
`currentValue` carry different semantics in owned vs wanted** (owned = BE/BL market; wanted = BE
forecast/msrp) with no shared utility — a real drift surface, though lower-stakes than G1–G4.

---

## 5 · Prioritized, interconnection-aware findings

Ordered by blast radius × how many seams each touches. All read-only observations.

1. **F1 — Promotion launders paid/MSRP as market value (G2+G3, two seams).** Both Budget→Collection
   and Wanted→Collection seed `currentValue` from paid/msrp and omit `source:"BrickEconomy"`/`entries[]`.
   Interconnection: this is the *only* place the value layer's "unknown ≠ paid" discipline is
   violated, and it's violated at the **write** boundary where the null-aware read layer can't
   defend it — the masking by the BL overlay is luck, not design. Highest priority because it
   silently corrupts gain/ROI for every promoted set the BL batch hasn't covered. *(A seed of
   `currentValue: null`/absent would let `valueAmount` render "—" honestly.)*

2. **F2 — CMF retail asymmetry (G1).** Paid joins CMF figures to the series purchase but retail does
   not, so a CMF figure shows a real Paid and a "—" Retail and a broken `vs. Retail %`. One-line
   cause: `retailFor`'s `/-1$/` strip vs `baseSetNumber`'s `/-\d+$/`. Touches the tri-value cell,
   the detail panel, the Retail Value card, and (because retail feeds `paidEqualsRetail`) the
   **msrp-vs-manual paid classification** — so the hole also mis-buckets CMF cost basis.

3. **F3 — Dual collection stores + three writers of `blOwnedSets` (G4).** The manual store is the
   write target for both promotion paths *and* manual adds, while BE edits go to the blob; the two
   are merged inline at load. This is the structural root under F1/F3-style divergence and the
   highest-blast-radius thing the inventory already flagged. Not a quick fix — flagging as the
   standing structural debt that bounds how clean the seams can get.

4. **F4 — Ownership badge is stale-until-remount.** `ownedSetNumbers` memoizes on `[]`. Cross-tab,
   buying/adding a set elsewhere won't update Wanted's "Owned" badge until the tab remounts. Low
   stakes, but it's the one place the Wanted⇄Collection seam is read live and gets it slightly wrong.

5. **F5 — Edit-set `currentValue` write is overlay-masked (G6).** A manual value edit can appear
   lost when the BL cache covers the set. Interconnects with F1: same root (stored value vs overlay
   precedence). Worth a deliberate decision on whether manual value should pin over BL.

6. **F6 — Buried/derived-but-unshown (G5, G7, G8; carries inventory Part 3a).** `retailValue` raw-`||`
   sum (cosmetic), the ~15 unshown BE-sync fields, value `asOf`/`source`, per-copy notes/dates
   dropped on load. Low individual stakes; listed for completeness so they're tracked in one place.

---

*End of audit. Map + findings only — no code changed. Patch the inventory's stale MC lines per
"Status & relation to existing docs" above; this doc is the MC source of truth going forward.*
