# BrickEconomy removal — Phase 0 plan (discovery, demote-not-delete)

**Scope:** read-only discovery. Updated BE-dependency map measured against the live collection
**post-CMF Phase 2**, plus a phased *demote-not-delete* removal proposal. **No behavior changed, no
code written** — this doc is review-gated. Builds on and supersedes the forward-looking parts of
[`be-fallback-gap-audit.md`](be-fallback-gap-audit.md) (which predicted this state; this confirms it).
Probe date **2026-06-12**, against the cron batch `asOf 2026-06-11T17:43Z`. Redis touched
**read-only** (KEYS / GET / LRANGE only — no writes). Origin verified
`mahalobrick/-lego-collection-tracker`.

---

## TL;DR

- **Post-CMF re-probe (live, today): only the 2 promos still ride BE for value.** 598/600 owned sets
  are fully BL-covered; `F1 = 2` (`6490363-1`, `6550806-1`, **~$56.68** BE), `F2 = 0`, `F3 = 0`. The
  audit's 7 "rung-gap used" sets are **all closed** — `modeled_thin` shipped and they now read
  `U: modeled_thin` off BL. This is the "re-probe reads ~zero" milestone the audit's §5 step 3
  demanded; it reads **2**, both promos, both correctly cron-deferred (no `value:SET` key) with their
  last BE number frozen in the collection store.
- **BE is no longer load-bearing for VALUE** beyond those 2 promos. But the **BE *machinery* still
  runs** for four consumers: (1) the 2 promo values, (2) **2yr/5yr forecasts** (BE-only, *no* BL or
  Brickset equivalent), (3) metadata fallback (pieces/year/minifigs — Brickset is canonical, BE is
  the fallback-of-the-fallback), (4) ad-hoc form auto-fill on the Wanted/Budget add flows.
- **The one true blocker to deleting the machinery is a product decision on forecasts.** If forecasts
  stay sourced from BE, the daily batch + proxy + key stay load-bearing **forever**. Everything else
  (metadata, promo value, the WatchDetailPanel trend repoint) is in-repo and safe once sequenced.
- **Nothing in this plan touches `brickEconomyNormalizedCollection`** (the owned-sets *store*).
  Confirmed by a full read/write trace (§4). The only effect of removal on that key: its BE value
  *fields* stop being refreshed and freeze as provenance — the rows, entries, and conditions stay.

---

## 1. Post-CMF re-probe (live, 2026-06-12)

Source = the cron's own inputs: the Upstash per-user blob (1 user, 600-set union) × the `value:SET`
keyspace, cross-referenced with the exact app resolution logic (condition-matched per copy, same as
`resolveCopies`).

| Bucket | Sets | BE $ riding | vs. audit (2026-06-10) |
|---|---|---|---|
| **Fully BL** (every owned condition has a BL amount) | **598** | — | was 454 → **+144** |
| **F1 — no `value:SET` record → BE** | **2** | **$56.68** | was 139 (CMF+promo); CMF closed, **only promos left** |
| **F2 — record present, no owned condition has a BL amount** | **0** | **$0** | was 7; **closed by `modeled_thin`** |
| **F3 — mixed copies (sum includes BE)** | **0** | — | unchanged |
| **Total still displaying BE for value** | **2 (0.3%)** | **~$56.68 (~0.2%)** | was 146 / ~$1,415 |

**The 2 promos, verified individually:** both have `value:SET` **absent** (correctly deferred — VPS
probe confirmed 404 on the BL SET endpoint), `theme=Seasonal`, owned `new`, last BE value frozen in
the collection: `6490363-1` "By the Fireplace" **$23.72**, `6550806-1` "Gingerbread Lane" **$32.96**.

**The audit's 7 rung-gap sets, verified closed:** `11028-1, 42637-1, 43253-1, 76293-1, 40816-1,
40811-1, 40825-1` — all now `N: sold_thin / U: modeled_thin` (e.g. `40825-1 → U: modeled_thin
$35.13`). None reads BE anymore.

> The audit's hard sequence ("until the re-probe reads zero, BE stays load-bearing for 146 sets")
> is **satisfied**: it reads 2, and both are the deliberate, already-understood promo residual. The
> 2-promo tactic can now be locked.

---

## 2. Updated BE-dependency map (everything that reads BE today)

Line numbers from the 2026-06-12 trace (files opened and verified, not carried from the audit).

### (a) Value-fallback path — *live, but now fires only for the 2 promos*
Resolution chain in [`portfolio.js`](../src/utils/portfolio.js): `setValueProvenance` (:165–175) tries
`blOverlayValue` (:131–153) → on a full BL miss returns null → falls to `rawSetValue` (:40–45), the
BE leaf read (`totalValue` / `currentValue × qty`). Per-copy: `valueGroups` (:76–84) materializes
`g.be` from `entry.current_value`; `resolveCopies` (:102–114) tags a copy `source:"be"` when BL
covers it null; `copyValueProvenance` (:269–282) is the SetDetailPanel per-copy equivalent.
[`valueDisplay.js`](../src/utils/valueDisplay.js) (`formatValue` :27–63) is **pure display** — formats
whatever amount it's handed, no BE read. Consumers: MyCollection :1074, SetDetailPanel :85 / :299.
**Status:** keep-for-now → becomes the *frozen-provenance read path* for the 2 promos (or dead, if
the promos go to "—").

### (b) The 2 promos — *the only deliberate BE-for-value residual*
Deferred by [`setList.mjs:18`](../scripts/lib/setList.mjs#L18) `NUMERIC_PROMO_SKIP`; refreshed today
by the app's daily BE batch (`beSyncValues.js` :168–200) every ~12 days; displayed via the (a) path
with `source:"brickeconomy"`. **Decision-needed** (§3, Phase 2). BL/Brickset alternative is **not
viable** — `cmf-probe.mjs` proved 404 on BL, and promos have no retail MSRP.

### (c) Trend / price-history chart — *half-swapped to BL already*
- **Owned (SetDetailPanel): already LIVE on BrickLink.** `historyFromBL` + `/api/history` +
  `historyCache` shipped; SetDetailPanel :10–11 / :50–67 / :240–257 renders BL history. Parity test
  green.
- **Wanted/watch (WatchDetailPanel): still on BE.** :4 imports `priceEventsFromBE`
  ([`priceEvents.js`](../src/utils/priceEvents.js):32–53), :162 reads it, :158–195 draws the chart.
  Repoint to `historyFromBL` is staged but **pending a coverage decision** (wanted items can be
  *unowned* → not in the cron work-list → no BL history). See
  [`trend-history-swap-plan.md`](trend-history-swap-plan.md). **Decision-needed** (§3, Phase 2).
  `priceEvents.js` becomes deletable once WatchDetailPanel repoints.

### (d) Forecasts (2yr / 5yr) — *BE-only, no equivalent anywhere — THE critical-path decision*
`forecast_value_new_2_years` / `_5_years` read at WatchDetailPanel :36–37 / :148–153; WantedList
:70–71 (form), :830–831 (table cells), :1163–1164 (BE-sync refresh), :1268–1269 (lookup auto-fill);
exported in AppSettings CSV :675–676. **No BL or Brickset source exists.** SetDetailPanel already
*removed* its forecast display (:272–274, "a BL-grounded forecast is a future feature, not a BE
passthrough"). **Decision-needed / product** (§3, Phase 2). This is the consumer that keeps the whole
BE machinery alive.

### (e) Metadata fallback (pieces / year / minifigs) — *Brickset canonical, BE is fallback-fallback*
`brickEconomySetCache.data.pieces_count / .year / .released_date / .minifigs_count` read as a
*tertiary* fallback at SetDetailPanel :94–100, WatchDetailPanel :28–35, PurchaseDetailPanel :27–32,
MyCollection :181–186 / :770–772, WantedList :845–847 / :1220 / :398. Every field is primary-sourced
from Brickset ([`brickset-set.js`](../src/utils/brickset-set.js): pieces :99, year :95, minifigs
:100) and secondarily Rebrickable/per-entry. **Remove-now (in-repo)**, gated on one precondition:
confirm Brickset is backfilled for all 600 owned sets (else a few rows lose pieces/year until
re-enriched). BE supplies **nothing** here that Brickset/BL don't.

### (f) Ingestion / sync machinery — *still runs; feeds (b)+(d)+(e) and ad-hoc lookups*
- Mount trigger: `runDailyBEBatch()` at [`App.jsx:249`](../src/App.jsx#L249) (50 sets/day, 24h guard).
- Manual full-sync: [`AppSettings.jsx:1053–1074`](../src/AppSettings.jsx#L1053) → `syncBEValues`
  (`beSyncValues.js` :216–248).
- Proxy: [`api/brickeconomy-set.js`](../api/brickeconomy-set.js) (`BRICKECONOMY_API_KEY` :52) +
  `vite.config.js:34` dev route + `.env.example:4–5`.
- Cache + apply: `beSyncValues.js` :20–27 (`brickEconomySetCache`), :128 (`applyCache` writes value
  fields into the collection), :149 (`fetchSet`).
- Ad-hoc form auto-fill: MyCollection :807, WantedList :1143 / :1256, BudgetDashboard :979 (fires a BE
  fetch on add-to-wanted / add-purchase for current value + forecast + metadata).
- Fixture helper: [`capture-price-events.mjs`](../scripts/capture-price-events.mjs) — **not** in the
  production path; deletable now.
- **Note:** the VPS cron (`refresh-values.mjs`) makes **no** BE call and never has — BE is entirely
  app-side.

### (g) Storage / backup registry — *correct as-is; the owned store stays*
`brickEconomySetCache` in `SYNC_SKIP_KEYS` ([`safeStorage.js:21`](../src/utils/safeStorage.js#L21)) and
excluded from `BACKUP_KEYS`/cloud push (regeneratable). `brickEconomyNormalizedCollection`
(field `brickEconomyNormalized`), `blOwnedSets` (`ownedSets`), and `brickEconomyCollectionSyncInfo`
(`brickEconomySyncInfo`) are **in** `BACKUP_KEYS` ([`exportBackup.js:200–209`](../src/utils/exportBackup.js#L200))
— the first is the **owned collection itself** and **must stay**. `enrichmentSnapshot.js` deliberately
excludes `brickEconomySetCache`.

---

## 3. Phased demote-not-delete sequence

### Phase 1 — Remove-now (in-repo, no product decision, safe today)
| Item | Action | Files | Gate |
|---|---|---|---|
| Fixture helper | Delete `capture-price-events.mjs` | `scripts/capture-price-events.mjs` | none — no prod consumer |
| Metadata BE fallback | Drop the `beData.pieces_count/.year/.minifigs_count/.released_date` tertiary reads (Brickset is canonical) | SetDetailPanel, WatchDetailPanel, PurchaseDetailPanel, MyCollection, WantedList (sites in §2e) | **Precondition:** one-time read-only probe confirming Brickset coverage for all 600 owned (else re-enrich first) |

### Phase 2 — Decision-needed (product calls — must be made before Phase 3)
| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1 — the 2 promos** | How to value `6490363-1` / `6550806-1` once machinery is gone | **(a)** keep BE batch alive for 2 sets (zero code, but BE stays load-bearing forever); **(b)** *freeze* last BE value as provenance, stop refreshing (~5-line guard in `beSyncValues.js`, honest "as-of" date, unblocks removal); **(c)** null them → display "—" (lose ~$57, fully unblocks); **(d)** BL/Brickset — **not viable (404, proven)** | **(b) freeze** — truest to demote-not-delete; keeps the ~$57 as a dated last-resort number while cutting the dependency |
| **D2 — forecasts (critical path)** | 2yr/5yr have no non-BE source | **(1)** keep BE *solely* for forecasts (smallest change, but machinery stays forever — blocks the arc); **(2)** drop the forecast UI, own the "no forecast" messaging (honest, BL-only); **(3)** build a BL-grounded forecast (future feature) | Reviewer call. **(2)** is the only option that lets the machinery be deleted; **(1)** means "BE removal" is really "BE demotion to a forecast-only sidecar" |
| **D3 — WatchDetailPanel trend** | Wanted/watch chart still on BE `price_events` | Per `trend-history-swap-plan.md`: **(a)** BE fallback for unowned, **(b)** expand cron work-list to watched sets, **(c)** move chart to owned-only | Decide alongside D2 (same panel); infra (`historyFromBL`) is already shipped and parity-tested |

### Phase 3 — Deletable later (machinery teardown — *only after Phase 2 resolves*)
Unlocked **only if D2 = drop/replace** (and D1 ∈ {freeze, unknown}, D3 repointed). Then delete, in
order: ad-hoc BE form lookups (§2f) → `runDailyBEBatch` call + `beSyncValues.js` → `api/brickeconomy-set.js`
+ dev route + `BRICKECONOMY_API_KEY` → manual Settings sync handler → `brickEconomySetCache` reads +
the value-fallback branch in `portfolio.js` (optional — see Keep-forever). If **D2 = keep-BE-for-forecast**,
Phase 3 does **not** happen; the machinery is demoted to a forecast-only sidecar instead.

### Keep-forever (never delete — demote-not-delete invariants)
- `brickEconomyNormalizedCollection` + `blOwnedSets` + `brickEconomyCollectionSyncInfo` in
  `BACKUP_KEYS` (owned store + manual store + sync metadata).
- The stored BE value numbers inside the collection (frozen provenance).
- Optionally the `portfolio.js` BE-fallback branch (§2a) as a harmless last-resort rung that reads
  those frozen numbers — recommended to keep under D1=(b).

---

## 4. Blast-radius confirmation — `brickEconomyNormalizedCollection` is safe

Full read/write trace confirms this key is the **owned-sets store**, not a BE-value cache, and
**nothing proposed above deletes or restructures it** — removal only stops the value *fields* from
being refreshed (they freeze). Writers: collection add/edit/import, `beSyncValues.applyCache`
(value-field patch only), backup-apply. Readers: the whole app's collection render, the cron's
`collectionFromBlob` ([`setList.mjs`](../scripts/lib/setList.mjs)), `exportBackup` census/summarize.

**Guardrails for the build phase (carry into every removal PR):**
1. **`BACKUP_KEYS` is sacred** — never remove `brickEconomyNormalized` from the registry
   ([`exportBackup.js:208`](../src/utils/exportBackup.js#L208)); removal breaks cloud-restore
   atomicity and fresh-device census. Add a `deprecated` flag rather than delete an entry.
2. **`brickEconomySetCache` ≠ `brickEconomyNormalizedCollection`** — the former is a regeneratable API
   cache (safe to delete); the latter is user inventory (persist forever). Any "clear BE cache" path
   must **allowlist `['brickEconomySetCache']`**, never prefix-match `brickEconomy*`.
3. **`clearLocalUserData` prefix-wipe is correct for sign-out** ([`exportBackup.js:278–292`](../src/utils/exportBackup.js#L278))
   — do not "fix" it; just don't reuse its prefix pattern for a cache-only clear.
4. **Prove structure survives** — `beCollection.test.js` + `exportBackup` round-trip tests must pass
   after any machinery removal, confirming the collection persists without `applyCache`.

---

## 5. Recommended decision summary (for the reviewer)

| Item | Class | In-repo / Product | Recommendation |
|---|---|---|---|
| `capture-price-events.mjs` delete | remove-now | in-repo | Do it |
| Metadata BE fallback | remove-now | in-repo | Do it, after a Brickset-coverage check |
| **D1 promos** | decision-needed | product | **Freeze (b)** — keep ~$57 as dated provenance, stop refreshing |
| **D2 forecasts** | decision-needed | product | **Drop (2)** if the goal is true BE removal; else accept "demote to forecast-only sidecar" |
| **D3 WatchDetailPanel trend** | decision-needed | in-repo + product | Repoint to `historyFromBL` per the swap plan; decide alongside D2 |
| Machinery teardown | deletable-later | in-repo | Sequence after D1/D2/D3; blocked entirely by D2 |
| Owned store + frozen numbers | keep-forever | — | Never delete |

**Bottom line:** the value arc is *done* — BL covers everything but 2 promos. "BE removal" from here
is **one product decision (forecasts) wide**. Resolve D2 and the machinery can come out cleanly behind
the four guardrails; leave D2 on BE and the honest framing is "BE demoted to a forecast-only sidecar,"
not removed.

---

*Probe integrity: Redis accessed read-only (KEYS/GET/LRANGE); counts from the live user blob ×
`value:SET` keyspace, condition-matched to the app's `resolveCopies` logic. No code changed; this doc
is uncommitted and review-gated.*
