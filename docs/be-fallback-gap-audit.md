# BE-fallback gap audit — Phase 0 (discovery, no code)

**Scope:** read-only. What still falls back to BrickEconomy (BE), measured precisely against the live
collection + Redis; the path to BL coverage per bucket; the eventual BE-removal blast radius. No
behavior change. Redis probed **read-only** (SCAN / GET / MGET only — no writes issued).
Probe date: **2026-06-10**, against the cron batch of `asOf 2026-06-07`.

---

## TL;DR

- **146 of 600 owned sets (24.3%) display a BE value today** — but only **~$1,415 of value (~5%)**
  rides on it (BL portfolio ≈ $26,229). Two buckets, **not** the three the framing assumed:
  **139 CMF/promo** (cron-deferred, ~$1,211) + **7 owned-used "rung-gap" sets** (~$204).
- The **MSRP rung-5 "brand-new/no-sold" bucket is currently EMPTY on the owned side**: zero owned
  sets have an unknown NEW value (all 12 `unknown` basis records are USED-side; only the 7 on
  owned-used conditions are visible).
- The 7-set gap has a precise mechanical cause: the ladder's modeled rung (used = 0.75×new)
  **requires healthy new sold (≥10 lots)** — these 7 have `sold_thin` new (1–5 lots) + zero used
  sales, so used falls to `unknown` **by design** ([`deriveValue.mjs:18`](../scripts/lib/deriveValue.mjs#L18)).
- **CMF closure is 95% of the dollar gap** and is the cron's already-planned Phase 2 (BL MINIFIG
  endpoint); the blocker is a **set-number → BL minifig-ID mapping**, not API availability.
- BE is not a passive fallback — it's **actively refreshed** (50-set daily batch on app mount +
  manual Settings sync). Removal before coverage closure would freeze/blank those 146.

---

## 1. The fallback mechanics — exactly when BE displays

Resolution: `setValueProvenance(s, valueMap)` ([`portfolio.js:164-174`](../src/utils/portfolio.js#L164))
tries `blOverlayValue` first; BE displays when that returns null:

| # | Trigger | Where | Today's count |
|---|---|---|---|
| F1 | **No `valueMap[setNumber]` record** (cron never valued it — deferred CMF/promo; would also catch manual sets, see §2) | [`blOverlayValue:131`](../src/utils/portfolio.js#L131) cache-miss → null → `rawSetValue` | **139** |
| F2 | **Record present, but NO owned condition has a numeric amount** (`basis:"unknown"` on every owned condition) → `resolveCopies` marks every copy `source:"be"` → overlay returns null | [`resolveCopies:105-109`](../src/utils/portfolio.js#L105), [`blOverlayValue:133-134`](../src/utils/portfolio.js#L133) | **7** |
| F3 | **Partial/mixed**: some copies BL-covered, some not → set still *labels* `source:"bricklink"` but the sum **includes BE copy amounts** (`g.be` per uncovered copy) | [`blOverlayValue:132-140`](../src/utils/portfolio.js#L132) | **0** (no owned set mixes today) |

**Where the BE number itself lives:** `rawSetValue` reads the stored `s.totalValue` /
`s.currentValue × qty` ([`portfolio.js:40-45`](../src/utils/portfolio.js#L40)); per-copy reads
`entries[].current_value` ([`valueGroups:76-84`](../src/utils/portfolio.js#L76)). Those fields are
**written by BE sync**: `applyCache` in [`beSyncValues.js:109-145`](../src/utils/beSyncValues.js#L109)
patches `brickEconomyNormalizedCollection` (+ `blOwnedSets` for manual), fed by
[`api/brickeconomy-set.js`](../api/brickeconomy-set.js) (proxy to `brickeconomy.com/api/v1/set/{n}`,
`BRICKECONOMY_API_KEY`). Refresh cadence: `runDailyBEBatch()` (50 sets/day, called at
[`App.jsx:249`](../src/App.jsx#L249) on mount) + manual full sync
([`AppSettings.jsx:1053-1074`](../src/AppSettings.jsx#L1053)). **BE is live machinery, not a frozen
snapshot.**

## 2. Measured coverage (live cross-reference, 2026-06-10)

Source = the cron's own inputs: the Upstash per-user blob (1 user, 600-set union) × the 461
`value:SET` keys. Basis mix **verified**: `sold 514 / modeled 301 / sold_thin 82 / asking 13 /
unknown 12` per-condition records (= 461×2 = 922 — matches the stated last-run mix exactly).

| Bucket | Sets | BE $ riding | Detail |
|---|---|---|---|
| **Fully BL** (every owned condition has a BL amount) | **454** | — | |
| **CMF/promo deferred (F1)** | **139** | **$1,211.13** | `theme === "Minifigure Series"` + 2 promo IDs ([`setList.mjs:16-18`](../scripts/lib/setList.mjs#L16)). **All 139 have a stored BE value** — none currently display "—". |
| **Rung-gap used (F2)** | **7** | **$204.24** | `11028-1, 42637-1, 43253-1, 76293-1, 40816-1, 40811-1, 40825-1` — all owned **used**; record shape identical across all 7: `new = sold_thin (1–5 lots)`, `used = unknown (0 lots)`. |
| Mixed copies (F3) | 0 | — | |
| Manual sets not in cron work-list | 0 | — | The cron's work-list reads only `brickEconomyNormalized` ([`collectionFromBlob`](../scripts/lib/setList.mjs#L33)), so a future manually-added set would be **silently un-valued** (F1). Currently moot (0 manual sets), but it's a latent gap worth noting for the work-list. |
| Other uncovered (unexpected) | 0 | — | Clean — coverage is exactly CMF + the 7. |
| **Total displaying BE** | **146 (24.3%)** | **~$1,415 (~5.1%)** | of BL portfolio ≈ $26,229 |

**The "rung-5 MSRP" framing, corrected:** all 12 `unknown` records are **used-side**; **new-side
unknowns = 0**. No owned set is "brand-new with no sold data" today — the MSRP rung-5 gap is
*currently empty* (it can repopulate as brand-new sets are added, but it is not where today's BE
dependence lives). The real second bucket is **used-condition copies of sets whose new sales are
thin** — the ladder refuses to model used off a thin new sample
([`deriveValue.mjs:18`](../scripts/lib/deriveValue.mjs#L18): "new healthy ⇒ model used off it";
`HEALTHY_LOTS = 10`).

## 3. Path to BL coverage, per bucket

### 3a. CMF/promo — 139 sets, $1,211 (95% of the gap)
- **The plan already exists**: `value-source-decision.md` §4–5 defers the minifig namespace to
  "Phase 2: value via the BrickLink **MINIFIG** endpoint, not SET" — BL has a full minifig price
  guide (`/items/MINIFIG/{no}/price`, same API the cron already signs for).
- **The actual blocker is ID mapping**: the collection stores CMFs as set-style numbers
  (`71045-12` = series × figure index); BL catalogs minifigs under its own IDs (`col###`-style).
  A `71045-12 → BL minifig-ID` mapping must come from somewhere (BrickLink catalog lookup,
  Rebrickable's `fig-num` data, or a hand-curated table for the ~139 owned figures).
- **Classification:** cron-side valuing = **in-repo code** ([`refresh-values.mjs`](../scripts/refresh-values.mjs) +
  [`setList.mjs`](../scripts/lib/setList.mjs) un-defer + a `MINIFIG` fetch branch + ladder reuse)
  **but OFF-repo deploy** (the VPS runs it; IP-bound creds). The mapping source is a
  **product/eng decision** (automated catalog lookup vs curated table). App-side: **zero change**
  — once `value:SET:{71045-12}` keys appear, F1 closes by itself.
- Per-figure used pricing is thin on BL; expect `modeled`/`sold_thin` bases — fine, the confidence
  funnel already displays those.

### 3b. Rung-gap used — 7 sets, $204
Pure **ladder-policy decision** (mechanically trivial, all options small):
1. **Model used off thin new** — extend rung 2 to `sold_thin` new, ideally with a distinct basis
   (`modeled_thin`) so the estimate-share disclosure stays honest. **In-repo**
   ([`deriveValue.mjs`](../scripts/lib/deriveValue.mjs), unit-tested) **+ VPS redeploy**. Closes the
   bucket BL-only; the 0.75 multiplier on a 1–5-lot average is noisier — that's the trade.
2. **Keep BE for exactly this residue** — smallest change (none), but BE stays load-bearing → blocks
   the arc goal.
3. **Accept "unknown"** — display "—"/"no recent sales" for these 7 used copies. Honest,
   BL-only, zero code beyond BE removal itself; costs $204 of displayed value.
- **Recommendation to review:** option 1 (with the distinct basis tag), since it generalizes — any
  future thin-new/no-used set self-heals.

### 3c. Latent (not currently populated, must be policied before BE removal)
- **New-side no-sold (true rung-5)**: brand-new sets with zero sold lots → `asking` (if stock) →
  else unknown. Policy for the unknown tail: Brickset-MSRP rung (in-repo, the planned "rung 5") or
  accept "—". Currently 0 sets.
- **Manual sets**: add `blOwnedSets`/`ownedSets` to the cron work-list union
  ([`setList.mjs`](../scripts/lib/setList.mjs) — in-repo + redeploy). Currently 0 sets.

## 4. BE-removal blast radius (in-repo, when coverage closes)

Grouped; full file:line detail preserved from the sweep:

| Group | What | Files |
|---|---|---|
| (a) Value-fallback path | The BE branches: `rawSetValue`, `valueGroups` BE amounts, `resolveCopies` `g.be` copies, `setValueProvenance`/`copyValueProvenance` fall-throughs | [`portfolio.js`](../src/utils/portfolio.js) :40-45, :76-84, :101-113, :164-174, :268-281 |
| (b) Ingestion/sync machinery | **Delete**: [`beSyncValues.js`](../src/utils/beSyncValues.js) (entire), [`api/brickeconomy-set.js`](../api/brickeconomy-set.js) (entire), `runDailyBEBatch()` call ([`App.jsx:249`](../src/App.jsx#L249)), Settings sync handler ([`AppSettings.jsx:1053-1074`](../src/AppSettings.jsx#L1053)), `BRICKECONOMY_API_KEY` env, vite dev route | 4 files + config |
| (c) Metadata reads → Brickset substitute | `pieces_count`/`year`/`minifigs_count` fallbacks: [`SetDetailPanel.jsx:94-100`](../src/SetDetailPanel.jsx#L94), [`WatchDetailPanel.jsx:28-36`](../src/WatchDetailPanel.jsx#L28), [`MyCollection.jsx:184-186`](../src/MyCollection.jsx#L184), [`WantedList.jsx`](../src/WantedList.jsx) (4 sites) | Brickset already canonical; BE is the *fallback* fallback |
| (d) Trend + forecasts | `price_events` → **swap already staged** (`historyFromBL` shipped; WatchDetailPanel repoint pending the coverage decision in [`trend-history-swap-plan.md`](trend-history-swap-plan.md)). **No BL equivalent for `forecast_value_*_2/5_years`** (WatchDetailPanel + WantedList) — product decision: drop or keep-BE-for-forecast |
| (e) Storage/backup registry | `brickEconomySetCache` in `SYNC_SKIP_KEYS` ([`safeStorage.js:21`](../src/utils/safeStorage.js#L21)); `BACKUP_KEYS` entries `brickEconomyNormalizedCollection`/`brickEconomyCollectionSyncInfo` ([`exportBackup.js:206-226`](../src/utils/exportBackup.js#L206)) — **the normalized collection is the OWNED-SETS store itself**, so it stays (it's the collection, not BE-the-value-source); only the value *fields* stop being BE-written. Comments in `enrichmentSnapshot.js`/`exportBackup.js` |

**Decision flagged by §6 of `value-source-decision.md`:** removal = **demote, not delete** — stored
BE values stay as historical provenance so nothing regresses to "unknown" that had a number. "BE
removal" in-repo therefore means: kill the *machinery* (b) + the *refresh*, keep the stored numbers
as a frozen last-resort rung, or accept "—" — a reviewer call per bucket.

## 5. Recommended sequence

1. **CMF Phase 2 (cron)** — the ID mapping decision, then the MINIFIG fetch branch + un-defer
   (in-repo scripts + VPS redeploy). Closes 139/146 sets, $1,211/$1,415. App needs nothing.
2. **Ladder policy for thin-new used** (`modeled_thin`, option 3b-1) — small `deriveValue.mjs` PR +
   redeploy. Closes the last 7.
3. **Re-probe** (re-run this audit's cross-reference) → expect "Total displaying BE = 0", with the
   latent buckets policied (manual-set work-list union; new-side rung-5 → Brickset-MSRP rung or "—").
4. **Then** the in-repo removal per §4 — machinery first (b), fallback branch last (a), with the
   trend swap (d) and forecast decision resolved on their own track.

Until step 3 reads zero, **BE stays load-bearing for 146 sets** and the daily batch must keep
running.

---

**Probe integrity:** Redis accessed with `SCAN`, `GET`, `MGET` only — no writes. Counts are from the
live user blob + `value:SET` keyspace, cross-referenced with the exact app resolution logic
(condition-matched per-copy, same as `resolveCopies`).
