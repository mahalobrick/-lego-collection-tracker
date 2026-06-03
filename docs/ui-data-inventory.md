# BrickLedger — Data & Presentation Inventory

**Purpose:** a read-only inventory of *what data the app holds* (every entity, every field, pulled from actual code) and *how/where each field is surfaced in the UI* — plus honestly-flagged gaps. **No redesign proposals here.** This is the map we review before picking targets.

**Method:** full reads of the data-model utils + the four tab components and their detail panels; field names taken from code, with `file:line` anchors. Authoritative entity list = the `BACKUP_KEYS` registry in [`src/utils/exportBackup.js:128`](src/utils/exportBackup.js:128).

**Conventions used below:**
- **Source** = where a field is populated: *user* (manual entry/import), *Brickset*, *BrickEconomy (BE)*, *Rebrickable (RB)*, *BrickLink (BL)*, *LEGO last-chance*, or *computed*.
- **Value vs cost rule (from CLAUDE.md):** *value* reads go through the null-aware layer (`valueAmount`/`setValueProvenance`/`formatValueCell`) where `0`/absent → unknown → `"—"`. *Cost/spend* stays inclusive (`$0` is genuine). Where a surface violates this, it's flagged.

---

## Part 1 — Entities & data shapes

### 1.1 `BACKUP_KEYS` — the authoritative localStorage registry
[`src/utils/exportBackup.js:128`](src/utils/exportBackup.js:128). Everything that syncs to the cloud blob is here; anything not listed is device-local or regeneratable.

| localStorage key | entity | synced (census) |
|---|---|---|
| `blOwnedSets` | Collection set records (manual / Brickset-import path) | ✓ |
| `brickEconomyNormalizedCollection` | Collection set records (BE-import path) | ✓ |
| `brickEconomyCollectionSyncInfo` | BE sync summary/stats | ✓ |
| `blSoldSets` | Sold-set records | ✓ |
| `blPortfolioHistory` | Daily portfolio snapshots | ✓ |
| `blWantedList` | Wanted/watched items | ✓ |
| `blPurchases` | Purchase records | ✓ |
| `blStores` | Store name list (default `DEFAULT_STORES`) | ✓ |
| `blStoreBudgets` | Per-store budget map | ✓ |
| `blAnnualBudget` | Annual budget scalar (default `10320`) | ✓ |
| `blDisplayCurrency` | Display currency (default `USD`) | ✓ |
| `blOwnedColumns`, `blAcquisitionColumns`, `blPurchaseColumns` | Table column config | ✗ (settings) |
| `blDashboardWidgetSettings`, `blCollectionItems`, `blOwnedColWidths` | Layout/widget prefs | ✗ (settings) |

**Not synced / regeneratable:** `brickEconomySetCache` (BE `/set` payloads — deleted before push), `bricksetSetCache`, `blPriceGuideCache` (BL), `legoLastChanceCache`, `bricksetThemesCache`; device prefs `blAutoExportDays`/`blLastAutoExport`; sync metadata `blLastPushHash`/`blLastCloudPush`/`blSyncedUserId`; migration flags `blMigrated_v1..v3`.

> **Note — dual collection stores:** owned sets live in **two** stores with overlapping-but-different shapes (`blOwnedSets` uses `qty`/`paidPrice`; `brickEconomyNormalizedCollection` uses `quantity`/`totalPaid`/`entries[]`). The UI merges them inline in `MyCollection.jsx` `useState` ([`MyCollection.jsx:153`](src/MyCollection.jsx:153)). Value/cost helpers read both synonyms.

---

### 1.2 Collection Set Record (`blOwnedSets` + `brickEconomyNormalizedCollection`)
No formal schema; fields defined inline. **Surfaced-where** column: B=Browse table, O=Overview cards/panels, D=SetDetailPanel, T=hover tooltip, —=held but not shown.

| Field | Source | Meaning | Surfaced |
|---|---|---|---|
| `setNumber` | user/API | set id (`75192` / `75192-1`) | B col, D, T |
| `name` | user/Brickset/RB | set name | B col, O panels, D, T |
| `theme` | user/Brickset/RB | theme | B col, O charts, D, filter |
| `subtheme` | Brickset/BE | subtheme | D only (searchable, **no column**) |
| `themeGroup` | Brickset | theme group | **—** |
| `year` | Brickset/RB | release year | D chip (searchable, **no column**) |
| `pieces` | Brickset/BE | piece count | O card, D chip |
| `minifigs` | Brickset/BE | minifig count | B col (hidden), O card, D |
| `condition` | user/BE | `new`/`used*`/`mixed` | B col (badge, dbl-click edit) |
| `source` | computed | `"BrickEconomy"`/`"Brickset"` tag | **—** (drives persistence split + provenance basis) |
| `notes` | user | free text | B col (hidden), D per-copy |
| `thumbnail`/`image` | Brickset | image URLs | B `thumb` col (hidden), D image |
| `qty` / `quantity` | user | copies (store-dependent synonym) | B col (dbl-click edit), O totals |
| `paidPrice` / `totalPaid` / `averagePaid` | user | cost (per-unit / total / avg) | B `paid` col, D Cost Basis / Avg Paid |
| `msrp` / `retailPrice` / `totalRetailPrice` | user/Brickset | MSRP | O "Retail Value" card, D MSRP chip (**no per-row column**) |
| `currentValue` / `totalValue` | BE/user | market value (per-unit / total) | B `value` col, O value cards/charts, D Market Value |
| `roiPct` | BE | stored ROI snapshot | seeds ROI-leaders + tooltip (table recomputes via `setROI`) |
| `retired` | BE | retired bool | D status badge; gates market-vs-retail basis |
| `acquiredDate` | user/BE | most-recent acquisition | B col (hidden), D per-copy |
| `retiredDate` / `releasedDate` | Brickset/BE | exit / launch dates | B cols (hidden), D |
| `exitDate`/`launchDate`/`availability`/`released` | Brickset | raw Brickset date/availability | used for retirement countdown; not columns |
| `entries[]` | BE | per-copy rows (see below) | D "Per-Copy Breakdown" |
| `addedAt` | computed | insert time | sort key only, **never shown** |
| Brickset extras: `rating`, `review_count`, `packaging_type`, `age_min`, `height`/`width`/`depth`, `owned_by`, `wanted_by`, `instructions_count`, `ean`, `tags[]`, `brickset_url` | Brickset | catalog metadata | `rating`/`age_min` in D; rest **—** |

**`entries[]` per-copy shape** (BE CSV, [`AppSettings.jsx:56`](src/AppSettings.jsx:56)): `set_number`, `name`, `theme`, `subtheme`, `year`, `condition`, `paid_price`, `current_value`, `retail_price`, `pieces_count`, `minifigs_count`, `retired`, `retired_date`, `released_date`, `acquired_date` (also read mis-spelled `aquired_date` at [`MyCollection.jsx:169`](src/MyCollection.jsx:169)), `notes`. Each copy is valued at its own condition ([`beSyncValues.js:43`](src/utils/beSyncValues.js:43)). **D shows each copy; entry-level `notes` and per-copy acquired dates beyond the first are collapsed/dropped on load.**

---

### 1.3 Wanted/Watched Item (`blWantedList`)
Created [`WantedList.jsx:1364`](src/WantedList.jsx:1364); id `wl_${Date.now()}_${rand}`. Surfaced-where: Q=Queue table, O=Overview cards/panels, W=WatchDetailPanel, —=not shown.

| Field | Source | Meaning | Surfaced |
|---|---|---|---|
| `id`, `addedAt` | computed | id + insert time | sort only |
| `setNumber`, `name`, `theme`, `subtheme` | user/lookup | identity | Q cols, W |
| `pieces`, `minifigs`, `rating`, `packagingType`, `ageMin`, `weight` | Brickset | catalog detail | Q cols (hidden), W Details |
| `ownedByCount`, `wantedByCount` | Brickset | popularity | Q cols (hidden) |
| `msrp` | user/lookup | MSRP | Q col (edit), O cards, W |
| `targetDiscount`, `targetPrice` | user/computed | goal price | Q `targetPrice` col (edit), W |
| `discount` | computed | `(msrp−target)/msrp` | Q col |
| `storePrice` | user | logged sale/deal price | **—** (drives Price-Drop alerts + `dealLogCount`, but **column removed** — never visible) |
| `currentValue` | BE | market value | Q col (hidden), W Market Value |
| `forecast2yr`, `forecast5yr` | BE | value forecasts | Q cols (hidden), W |
| `blPriceNew`/`blPriceUsed` (+`…Range`/`…Min`/`…Max`) | BL | 6-mo avg sold | Q cols (hidden), W (auth-gated) |
| `exit_date`, `retirementYear`, `bfRetirementDate`, `retiringSoon`, `isLastChance`, `retirementSource`, `lastRetirementUpdate` | Brickset/BF/LEGO | retirement signals | Q `Retires`/`Days Left`/toggle cols, O timeline, W, alert banners |
| `priority` | user | 1–5 | feeds score |
| `owned` | computed | cross-ref to collection | Q badge |
| `status` | user | freeform status | W header chip only (**no column/filter**) |
| `notes` | user | free text | Q col (edit), W |
| `customFields[cf_*]` | user | user-defined | Q `cf_*` cols |
| `availability` | Brickset | availability | **—** |
| `score`, `recommendation` | computed | `priorityScore()` → label | Q `Action` pill, O panels, W Buy Signal |

---

### 1.4 Purchase Record (`blPurchases`)
Created [`BudgetDashboard.jsx:1070`](src/BudgetDashboard.jsx:1070); id `pur_…`. Surfaced: P=Purchases table, DP=PurchaseDetailPanel, O=Overview charts/tiles.

| Field | Source | Meaning | Surfaced |
|---|---|---|---|
| `id` | computed | id | — |
| `setNumber`, `name`, `theme` | user/lookup | identity | P cols, DP |
| `qty` | user | copies | P col (edit), DP |
| `faceValue` / `amount` | user | per-unit price (`amount`=alias) | P `Unit Price` col (edit), DP |
| `msrp` | lookup | suggested MSRP | O Savings panel + DP "vs MSRP" only (**no column/default tile**) |
| `tax`, `shipping`, `gcApplied` | user | fees / gift-card | P cols, DP, O `gcSaved` tile |
| `total` | computed | `faceValue×qty + tax + shipping` | P `Paid` col, DP Subtotal |
| `cashPaid` | computed | `max(0, total − gcApplied)` | P `Paid` col (cash), DP, **all spend totals** |
| `orderLabel`, `orderNotes` | user | multi-line order grouping | P col + row accent, DP |
| `store`, `date`, `month`, `year` | user/computed | when/where | P cols, O store/monthly charts, filters |
| `notes` | user | free text | P col (edit), DP |

> **Spend model:** every Budget total routes through `lineCashPaid`/`lineTotal` ([`formatting.js:8`](src/utils/formatting.js:8)) — inclusive, `$0` genuine, never `"—"`. The null-aware value layer is **not imported** in any Budget file. Correct per CLAUDE.md.

---

### 1.5 Sold-Set Record (`blSoldSets`)
Created [`MyCollection.jsx:1066`](src/MyCollection.jsx:1066): `setNumber`, `name`, `theme`, `condition`, `qty`, `soldPrice`, `soldDate`, `paidPrice`, `gain` (=`soldPrice−paidPrice`), `roi`, `notes`, `loggedAt`. **Surfaced:** Sold sub-tab (4 tiles + per-sale rows). Uses own `money()`/`%` math (realized sales always have a price, so falsy-zero is moot).

### 1.6 Value / Provenance object (derived, never persisted)
`toValue` → `{ amount: number|null, source, condition, basis: 'retail'|'market'|'unknown', asOf }` ([`value.js:102`](src/utils/value.js:102)). `setValueProvenance(s)` reads `totalValue`/`currentValue`/`qty`/`source`/`condition`/`retired` ([`portfolio.js:53`](src/utils/portfolio.js:53)). `0→unknown` single-sourced in `valueAmount` ([`value.js:40`](src/utils/value.js:40)). **Surfaced:** drives every null-aware Value/Gain/ROI cell; `basis` powers the retail-warning tooltip; **`asOf` and `source`/`basis` are otherwise never shown.**

### 1.7 Price Event series (derived from BE cache)
`priceEventsFromBE` → `{ new: [{date,value}], used: [{date,value}] }` ([`priceEvents.js`](src/utils/priceEvents.js)). BE retired-only, ~12 points, ASC, unknowns dropped. **Surfaced:** the WatchDetailPanel line chart (`.new` only). **`.used` series is mapped but never plotted.** No sparkline anywhere else.

### 1.8 Catalog/market caches
- **Brickset** (`bricksetSetCache` / `bricksetThemesCache`): full normalized metadata ([`api/brickset-set.js:92`](api/brickset-set.js:92)) — name/year/theme/subtheme/pieces/minifigs/rating/packaging/age/dimensions/retail prices (us/uk/ca/de)/launch+exit dates/owned+wanted counts/instructions/ean/tags/urls.
- **BrickEconomy** (`brickEconomySetCache`, not synced): `current_value_new`/`_used`, `retail_price_us`, `retired`, `forecast_value_new_2_years`/`_5_years`, `price_events_new`/`_used`, `pieces_count`, `minifigs_count`.
- **Rebrickable** (in-memory from `/public/*.csv`): `name`, `year`, `themeId`, `theme`, `numParts`, `imgUrl`. Catalog-only; used for "RB Fill".
- **BrickLink** (`blPriceGuideCache`): opaque US sold price-guide payload → `blPriceNew/Used` (+ranges), `blSoldNew/Used`. Auth-gated (`blBrickLinkAccessToken`).
- **LEGO last-chance** (`legoLastChanceCache`): `setCodes[]` of products on LEGO's "Last Chance" page → `isLastChance` bool.

### 1.9 BE sync summary (`brickEconomyCollectionSyncInfo`)
Built [`AppSettings.jsx:650`](src/AppSettings.jsx:650): `lastSync`, `setsCount`, `uniqueSets`, `newCount`, `usedCount`, `piecesCount`, `duplicateGroups`, `totalPaid`, `portfolioValue`, `unrealizedGain`, `retiredCount`, `retiredPct`, `retailValue`, `newValue`, `usedValue`, `valueSource`, `costBasisSource`, `inventorySource`. **Surfaced:** only `lastSync` (BE status line). **~15 computed fields held but never displayed.**

### 1.10 Portfolio history (`blPortfolioHistory`)
Daily `{ date, value, paid }`, 365-day cap ([`AppSettings.jsx:22`](src/AppSettings.jsx:22)). **Surfaced:** the My-Collection "Portfolio History" area chart only (value gold + paid blue). **Not** what the Budget "Investment Curve" plots.

### 1.11 Settings/prefs
`blStores`, `blStoreBudgets`, `blAnnualBudget`, `blDisplayCurrency` (display symbol only — data stays USD), column configs, `blCollectionItems` (card/panel layout), `blOwnedColWidths`, `blAutoExportDays`/`blNotificationsEnabled`.

---

## Part 2 — Presentation surfaces (catalogs)

### 2.1 My Collection — Browse table
17 columns, all toggle/reorder/resize ([`MyCollection.jsx:2155`](src/MyCollection.jsx:2155); defaults [`columnDefaults.js:7`](src/utils/columnDefaults.js:7)): `thumb`(hidden), `setNumber`, `name`, `theme`, `condition`(hidden, badge+inline-edit), `qty`(edit), `paid`(edit), **`value`**, **`gain`**, **`roi`**, `minifigs`(hidden), `acquiredDate`(hidden), `retiredDate`(hidden), `releasedDate`(hidden), `blSoldNew`(hidden), `blSoldUsed`(hidden), `notes`(hidden). Value/Gain/ROI use the **null-aware** path. Filters: search (`setNumber/name/theme/subtheme/notes/year`), theme `<select>`, condition `<select>`; sort dropdown + click-headers. Actions: RB Fill, Brickset enrichment ⟳.

### 2.2 My Collection — Overview cards & panels
17 stat cards ([`MyCollection.jsx:1159`](src/MyCollection.jsx:1159)) incl. Total Sets, Collection Value (known-only + unknown note), Cost Basis, Net Gain, ROI, Themes, Retired, New/Used, Avg Value/Paid, Pieces, Minifigs, Retail Value, New/Used Value, Wanted. Panels: condition donut, **Value by Theme** (donut/bar via `groupRollup`), ROI Leaders, Most Valuable, Wanted highlights, Budget Snapshot, **Portfolio History** (area), **Theme Performance** (null-aware table). Plus a **retirement-alert banner** with "Sell on BrickLink ↗" deep links.

### 2.3 My Collection — SetDetailPanel
Header (theme/#, name, Retired/Active badge, Last-Chance badge, retirement countdown, copies) → image → meta chips (year/pcs/MSRP) → **stat grid** (Cost Basis, Market Value, Net Gain, ROI, Avg Paid/Copy, Value/Copy, **vs. Retail %**) → **BrickLink Market Prices** (live, auth-gated) → **Investment Forecast** (2yr/5yr + vs-retail) → Set Details (subtheme/minifigs/rating/min-age) → **Per-Copy Breakdown** (paid/value/gain per entry). Entirely null-aware.

### 2.4 Wanted List — Queue table
32 columns + custom fields ([`WantedList.jsx:2796`](src/WantedList.jsx:2796); defaults [`columnDefaults.js:30`](src/utils/columnDefaults.js:30)). Visible by default: `setNumber`, `name`(+✓Owned), `recommendation`(Action pill), `retirementDate`, `daysLeft`(countdown), `msrp`(edit), `targetPrice`(edit), `discount`, `theme`, `notes`(edit). Hidden: `currentValue`, `forecast2yr/5yr`, all BL price/range cols, `owned`, `ageMonths`, `pieces/subtheme/minifigs/rating/packaging/ageMin/weight`, `ownedByCount/wantedByCount`, `retiringSoon` toggle, `retirementSource`, `lastRetirementUpdate`, `thumb`. Mobile = card stack. Filters: Fuse search (`setNumber/name/theme`), theme, sort dropdown + click-headers.

### 2.5 Wanted List — Overview & alerts
14 stat cards (Wanted Sets, Retiring This Year, Total/Avg MSRP, Already Owned, Buy Now, Avg Discount, Tracking Cost, Budget After Buy, Potential Savings, Last Chance, Avg Potential ROI, Deals Tracked, Data Coverage). Panels: **retirement-timeline** (wave-bucketed chips), urgency donut, **MSRP-vs-target** dual bars, action-breakdown, score-distribution, theme-breakdown. Alert banners: **Last Chance** + **Price Drop** (dismissible). Once/day browser notifications.

### 2.6 Wanted List — WatchDetailPanel
Header (status/retiring/last-chance chips) → image → meta chips → **Pricing grid** (MSRP, Target, Discount@Target, Savings, Market Value, **Market vs. MSRP %**, BL avg/range new+used, 2yr/5yr forecast) → **Price History line chart** (BE `.new`, hidden if <2 pts — the app's only price timeline) → **Buy Signal** (recommendation, retires wave + days-left, retirement year, data source) → Details → Notes. Fires a live BL fetch on open if authed.

### 2.7 Budget — charts, tiles, tables
Charts ([`BudgetDashboard.jsx:1423`](src/BudgetDashboard.jsx:1423)): Spending by Store (cards/donut), Monthly Spend (bar/line), **Investment Curve** (cumulative *spend* — mislabeled), Store Pie, Spending by Theme, Savings vs MSRP. 12 tiles (spend, remaining, avg/month, purchases, projected, vs-budget, top-store, months, gc-saved, saved-vs-msrp, savings-rate, avg-per-set). **Purchases table** (13 cols, inline-edit, order-group accent, hover tooltip, bulk→Collection). **PurchaseDetailPanel** (StatBox grid + vs-MSRP + order/notes). Add-Purchase form with single/multi-order auto-distribution.

### 2.8 Settings + Sync
General/Data tabs. Controls: display currency, annual budget, auto-export interval, price-drop notifications, stores, import mode. **Cloud Sync** card (UserButton, last-sync from `blLastCloudPush`, Sync Now). **Local Backup** (export/restore). **Data Sources** rows: BrickEconomy (Sync Values / Clear Cache), Brick Fanatics (Sync Retirement), Rebrickable (Fill Missing), BrickLink (token connect / Sync Prices). **Data Management** import/export per entity (incl. Export Enriched CSV joining Brickset+BE).

---

## Part 3 — Flagged gaps (observations only)

### (a) Data we HOLD but don't show — or bury
1. **`brickEconomyCollectionSyncInfo` — ~15 computed fields, only `lastSync` shown.** new/used value split, retired %, duplicate groups, retail value, unrealized gain, pieces count, source provenance — all computed at [`AppSettings.jsx:650`](src/AppSettings.jsx:650), all invisible. *Biggest single buried-data find.*
2. **`storePrice` (wanted) is invisible but load-bearing.** It triggers Price-Drop alerts and `dealLogCount`, yet its column was removed — the user can't see the price that fired the alert.
3. **`subtheme` + `year` (collection)** are searchable but have **no Browse column** (subtheme only in the detail panel).
4. **Per-set `msrp`/retail (collection)** has no Browse column — only aggregated into one card + the detail panel. (The *wanted* table has MSRP; the *owned* table doesn't — asymmetry.)
5. **Forecast 2yr/5yr (collection)** live only in the detail panel — no column, no tile.
6. **Value provenance `asOf`/`source`/`basis`** computed but the as-of date is never shown.
7. **`status` (wanted)** shows only as a detail-panel chip; no column/filter.
8. **`priceEventsFromBE().used`** mapped but never plotted; **`retirementByYear` memo** computed but never rendered ([`WantedList.jsx:964`](src/WantedList.jsx:964)).
9. **Hidden-by-default everywhere:** on the wanted table, *all* market data (currentValue, forecasts, BL prices) is hidden by default — the table looks data-poor out of the box even when data exists.
10. **`bulkRefreshPrices` claims to record history but doesn't** ([`WantedList.jsx:1123`](src/WantedList.jsx:1123)) — comment vs behavior mismatch; no per-item price snapshots are ever stored.

### (b) Raw values where a derived/comparative view would help
1. **Collection Browse "Value" is a bare number** — no inline "vs paid" / "vs retail". The comparison exists *only* inside the detail drawer.
2. **Wanted table market columns (currentValue/forecast/BL) are raw `money()`** — no "vs MSRP/target/% gain". Comparative framing exists only in the WatchDetailPanel.
3. **No per-row ROI/gain on the wanted side** despite `avgRoi` being computed for a card.
4. **Budget "Top store" tile shows only the name**, not its $ or share; theme/store charts show absolute money with "% of total" only in the cards variant.
5. **Monthly Spend chart has no budget reference line** (`monthlyTarget` is computed, never drawn).
6. **`daysLeft` from `retirementYear`** is a crude `(year−now)×365` estimate rendered as months — italic-flagged but easily mistaken for precise data.

### (c) Where BL/market data slots are, and what fills them now
- **Primary collection Value/portfolio totals = BrickEconomy** (`currentValue`/`totalValue`), Brickset MSRP as retail fallback. **No BrickLink-sourced value feeds the main Value column or portfolio totals** — BL is supplementary only.
- **BrickLink slots:** owned `blSoldNew/Used` columns (hidden) + SetDetailPanel "BrickLink Market Prices" (live, auth-gated) + retirement-banner "Sell on BrickLink ↗"; wanted `blPriceNew/Used`+ranges (hidden) + WatchDetailPanel StatBoxes. **All BL slots empty unless `hasBrickLinkAuth()`** — and auth is off by default, so they're empty out of the box.
- **Asymmetry:** owned side has BL *sold/6-mo* columns; wanted side has BL *current avg/range* only.
- **Budget dashboard consumes no live market value** — its only market touchpoint is MSRP-at-purchase (savings) + per-row detail chips.
- **Price history:** exactly one timeline (WatchDetailPanel, BE retired-only `.new`). No sparklines in any table/card.

### (d) Views doing real work that are hard to read
1. **`MyCollection` Browse tbody** ([`:2235`](src/MyCollection.jsx:2235)): centralized `renderOwnedCell` *plus* ~5 inline special-cases that **re-derive `qty/paid/value/gain` independently** and differ from `renderOwnedCell` — source of a Paid double-derivation. Several render blocks (retirement-alert banner, hover tooltip, New/Used value cards) use the **old falsy-`||` pattern** and render unknown value as `$0` instead of `"—"`, re-opening the falsy-zero class the rest of the app closed.
2. **`WantedList.renderCell`** ([`:745`](src/WantedList.jsx:745)): ~150-line if-ladder over 30+ keys, mixing formatting, derived math that reaches into localStorage mid-render (`ageMonths`), badges, and a write-back toggle. `priorityScore` color/recommendation thresholds are re-derived in ≥3 places (drift risk).
3. **Budget Overview** ([`BudgetDashboard.jsx:1364`](src/BudgetDashboard.jsx:1364)): a 12-tile inline ternary chain + a ~270-line panel-type cascade; "Investment Curve" is **mislabeled** (plots cumulative cash, not portfolio value); `monthlyChartData` matches months by name-prefix string, fragile if labels change.
4. **Dead/empty UI:** the wanted column-gear renders an **"Intelligence" group header with no columns** ([`WantedList.jsx:2621`](src/WantedList.jsx:2621)); `DEFAULT_WANTED_COLUMNS` is imported into AppSettings but unused.
5. **Stale display:** `blLastCloudPush` is read once at mount, so the Settings "last sync" timestamp is stale after a manual Sync Now until reload.

---

*End of inventory. No redesign proposed — ready for review to pick targets.*
