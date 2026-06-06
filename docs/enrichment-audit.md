# Enrichment / Caching Layer — Read-Only Discovery Audit

**Status:** Discovery only. No code changed. No design decided.
**Date:** 2026-06-06 · **HEAD:** `6aad351` · **Branch:** `main` (CI green at audit time)
**Goal of the workstream (not this doc):** one shared, persisted, backed-up enrichment
cache with a TTL refresh strategy that every surface reads from. This doc only maps
reality so we can triage. **No recommendation is made here.**

---

## 0. Scope & method

### What I read (directly verified, file:line cited from my own reads)
- `src/App.jsx` (full, 1–504) — boot/sign-in/sync orchestration.
- `src/utils/exportBackup.js` (1–260) — `BACKUP_KEYS`, census, wipe scope, push guard.
- `src/utils/valueCache.js` (full) — BrickLink value cache (`blValueCache`).
- `src/utils/rebrickable.js` (full) — local CSV catalog.
- `src/utils/brickset.js` (full) — Brickset API client + retail resolver.
- `src/utils/beSyncValues.js` (full) — BE daily batch + manual value sync.
- `src/MyCollection.jsx:330–482` — value-overlay effect, Rebrickable load, Brickset
  enrichment fns, CMF retail, mount enrichment, portfolio snapshot.
- `src/AppSettings.jsx:236–279, 983–987, 1277–1320` — Rebrickable "Fill Missing",
  clear-cache, sync buttons.
- TTL/key constants in `bricklink-client.js`, `legoLastChance.js`, BF cache sites.

### What was gathered via read-only sub-agents (spot-verified, not every line re-opened)
- Full `useEffect` inventories + chart-memoization survey for `MyCollection.jsx`,
  `WantedList.jsx`, `BudgetDashboard.jsx`, `SetDetailPanel.jsx`.
- Line citations into those four large files come from sub-agent reads; I verified the
  decision-critical ones (MyCollection mount enrichment, both "Fill" handlers, App boot
  chain) against the source directly. Where a citation is sub-agent-sourced and not
  re-opened, treat the line number as ±a few lines.

### Read-only commands run
`find`, `rg`, `sed -n` (read slices), `git log`. **No** edits, **no** `npm install`,
**no** dev server, **no** network calls. Only file written: this one.

### What I did NOT do
No code changes, no refactors, no design, no benchmarking with a running app
(perf claims below are static-analysis inferences, flagged as such).

---

## 1. Per-surface enrichment behavior

**Key architectural fact that frames everything:** `App.jsx:468–478` renders each tab with
`{view === "collection" && <MyCollection/>}` (and likewise for the other three tabs).
This is **conditional rendering**, so **switching tabs unmounts and remounts the whole
surface.** Every `useEffect(…, [])` "on mount" effect therefore **re-runs on every
navigation back to that tab**, not once per session. (Whether that re-run does real work
depends on whether the cache it reads is warm — see §5.)

| Surface (file:line) | WHAT it fetches/computes | WHEN | FROM WHERE | Cached? where |
|---|---|---|---|---|
| **App boot** `App.jsx:78–104,127–203` | Cloud backup pull + reconcile | mount / per-login | `/api/sync` (Redis blob) | writes BACKUP_KEYS to localStorage |
| **App boot** `App.jsx:231–236` | `runDailyBEBatch()` 15s after boot | mount / per-login (24h cooldown) | BE API, 50 sets/day | `brickEconomySetCache`, `beValueBatchLast` |
| **MyCollection — initial state** `MyCollection.jsx:~162–236` | Hydrates `sets`; resolves minifigs/pieces/value from caches | mount **(every tab switch)** | reads `blOwnedSets`, `brickEconomyNormalizedCollection`, `brickEconomySetCache`, `bricksetSetCache`, `brickEconomyCollectionSyncInfo` | reads only |
| **MyCollection — BL value overlay** `MyCollection.jsx:338–348` | `peekValueCache` (sync warm) → `fetchValues` (async) | mount + when owned set numbers change | BrickLink via `valueCache.js` → `/api/values` | `blValueCache` (24h TTL) |
| **MyCollection — Rebrickable load** `MyCollection.jsx:388` | `loadRebrickable()` | mount **(every tab switch)** | local CSV (no network) | module-level maps (per session) |
| **MyCollection — Brickset enrichment** `MyCollection.jsx:393–435,454–466` | `runBricksetEnrichment(sets,false)` fills missing **minifigs + pieces** | mount **(every tab switch)**; skips sets already having both | Brickset API `/api/brickset-set`, 400ms throttle | `bricksetSetCache` (7d), patches `sets` state |
| **MyCollection — CMF retail** `MyCollection.jsx:437–449,457` | `fetchCmfSeriesRetail` fetches `-0` series MSRP | mount **(every tab switch)**; skips cached `-0` | Brickset API | `bricksetSetCache` |
| **MyCollection — MC Overview** `MyCollection.jsx:~1356–1823` | Donut/bar/area charts + stat cards (minifigs, MSRP, ROI) | render while `tab==="overview"` | derived from `sets` + `valueMap` | chart data **memoized** (§5) |
| **MyCollection — portfolio snapshot** `MyCollection.jsx:469–482` | Records daily value/paid point | on `sets` change, once/day | in-app aggregate | `blPortfolioHistory` (synced) |
| **MyCollection — Rebrickable Fill button** `MyCollection.jsx:813–857,2267–2282` | Fills pieces/theme/year/name | manual click | local Rebrickable | `blOwnedSets`, `blWantedList` |
| **WantedList — Brickset retro-fill** `WantedList.jsx:369–415` | Fetches missing `exit_date`/`msrp`/minifigs/subtheme | mount **(every tab switch)**, 400ms throttle | Brickset API | `brickEconomySetCache` |
| **WantedList — Last Chance** `WantedList.jsx:420–431` | `getLastChanceCodes()` flags items | mount **(every tab switch)** | `/api/lego-last-chance` | `legoLastChanceCache` (23h) |
| **WantedList — BF retirement** `WantedList.jsx:513–522` | Bulk retirement sync if cache stale | mount **(every tab switch)**, 7d TTL guard | Brick Fanatics API | `blBFRetirementCache` (7d) |
| **WantedList — research lookup** `WantedList.jsx:1170–1317` | Rebrickable→Brickset→BE→BL→BF chain | manual "Look Up" | local + 4 APIs | `brickEconomySetCache` + form fill |
| **WantedList — Tracking Overview** `WantedList.jsx:~1410–1801` | Urgency/theme/score/MSRP charts | render while `subTab==="overview"` | derived from `wanted` | **mostly NOT memoized** (§5) |
| **Budget — Overview/Dashboard** `BudgetDashboard.jsx:~1282–1599` | Store/month/theme/savings charts | render while `tab==="dashboard"` | derived from `purchases` + read-only `blOwnedSets`/`brickEconomyNormalizedCollection` | **mostly NOT memoized** (§5); no enrichment fetch |
| **Budget — line search** `BudgetDashboard.jsx:~974–982` | Brief BE cache read on set search | manual | `brickEconomySetCache` | reads/writes that key |
| **SetDetailPanel** `SetDetailPanel.jsx:40–45` | BL price guide (only network call) | panel open (per `setNumber`) | BrickLink, 6h TTL | `blPriceGuideCache` |
| **SetDetailPanel** `SetDetailPanel.jsx:71–121` | minifigs, MSRP/retail, pieces, year, Last Chance | render (sync reads, **no fetch**) | `brickEconomySetCache`, `bricksetSetCache`, `legoLastChanceCache` | reads only |
| **AppSettings — Fill Missing** `AppSettings.jsx:241–279,1305` | Rebrickable fill (pieces/theme/name) | manual click | local Rebrickable | `blOwnedSets`, `blWantedList` |
| **AppSettings — Sync BE values** `AppSettings.jsx:1052–1073,1274` | Full BE value sync | manual click | BE API, 24h TTL or force | `brickEconomySetCache`, collections, `beValueSyncLast` |
| **AppSettings — BL price batch** `AppSettings.jsx:1023–1049,1320` | Bulk BL price guide | manual click | BL API, 12h TTL | `blPriceGuideCache`, `blPriceSyncLast` |
| **AppSettings — BF retirement** `AppSettings.jsx:181–229,1291` | Retirement sync | manual click | BF API | `blBFRetirementCache`, `blWantedList` |
| **AppSettings — Clear Cache** `AppSettings.jsx:983–987,1277` | Drops BE caches | manual click | — | removes `brickEconomySetCache`, `brickEconomyCollectionCache` |
| **AppSettings/MyCollection/WantedList — themes** e.g. `MyCollection.jsx:1068` | `fetchLegoThemes()` | mount | Brickset, 30d TTL | `bricksetThemesCache` |

### The three Overviews — shared path or re-implemented?
**Re-implemented, three times.** There is no shared Overview component, no shared
enrichment hook, and no shared chart-data layer:
- **MC Overview** (`MyCollection.jsx`) derives chart data via `groupRollup` + the
  null-aware `portfolio.js` helpers, and **memoizes** the datasets (`useMemo` on
  `[sets, valueMap]`).
- **Tracking Overview** (`WantedList.jsx`) derives its chart data with **inline IIFEs
  computed every render** (no `useMemo`) — §5.
- **Budget Overview** (`BudgetDashboard.jsx`) likewise computes most chart datasets
  **inline every render**; only `cumulativeSpendData` is memoized.

So the three Overviews diverge both in *how* they compute (memoized vs inline) and in
*what enrichment they trigger on mount* (MC and Wanted each fire their own Brickset
mount-enrichment; Budget fires none). This is a duplication surface, not a shared path.

---

## 2. Cache & persistence inventory + BACKUP_KEYS gap analysis

### Enrichment-relevant localStorage keys

| Key | Writer / reader | Shape | TTL | In BACKUP_KEYS? |
|---|---|---|---|---|
| `blValueCache` | `valueCache.js` w/r; MyCollection r | `{num:{record,fetchedAt}}` | 24h | **NO** (device-local by design) |
| `brickEconomySetCache` | `beSyncValues.js`, lookups w/r | `{num:{data,fetchedAt}}` | 24h (manual) / rolling (batch) | **NO** (deleted before push; "regeneratable") |
| `bricksetSetCache` | `brickset.js`, MyCollection w/r | `{brickset_<n>:{data,fetchedAt}}` | 7d | **NO** (deleted before push) |
| `bricksetThemesCache` | `brickset.js` w/r | `{fetchedAt,themes[]}` | 30d | **NO** |
| `blPriceGuideCache` | `bricklink-client.js` w/r | `{num:{data,cachedAt}}` | 6h / 12h bulk | **NO** |
| `blSessionToken` | `bricklink-client.js` | `{token,cachedAt}` | 50m | **NO** (secret-ish, correct to exclude) |
| `legoLastChanceCache` | `legoLastChance.js` w/r | `{setCodes[],fetchedAt}` | 23h | **NO** |
| `blBFRetirementCache` | WantedList/AppSettings w/r | `{...,fetchedAt}` | 7d | **NO** |
| `beValueBatchLast` | `beSyncValues.js` | ISO ts | cooldown only | **NO** |
| `beValueSyncLast` | AppSettings/`beSyncValues.js` | ISO ts | staleness only | **NO** |
| `blPriceSyncLast` | AppSettings | ISO ts | — | **NO** |
| **`brickEconomyNormalizedCollection`** | importer, `applyCache`, edits | array of normalized sets **incl. computed `currentValue`/`totalValue`** | — | **YES** (`exportBackup.js:128`) |
| **`brickEconomyCollectionSyncInfo`** | BE import | `{minifsCount,piecesCount,…}` aggregate | — | **YES** (`exportBackup.js:129`) |
| `blOwnedSets` | manual sets (incl. patched minifigs/pieces for *manual* sets) | array | — | **YES** |
| `blPortfolioHistory` | snapshot | array | — | **YES** |

### The gap, precisely
`BACKUP_KEYS` (`exportBackup.js:127–148`) syncs the **collection rows and the
already-computed value/aggregate fields**, but **none of the per-set enrichment caches**.
Two keys are explicitly excluded with a comment ("regeneratable"): `brickEconomySetCache`
(also `delete`d before push at `exportBackup.js:42`) and `bricksetSetCache`. The rest
(`blValueCache`, `bricksetThemesCache`, `blPriceGuideCache`, `legoLastChanceCache`,
`blBFRetirementCache`) are simply never registered.

**Consequence per omission:**
- **`bricksetSetCache` not synced** → on a fresh device, **minifigs and pieces are
  `null`** for every BE-synced set (manual-set minifigs/pieces ride along in `blOwnedSets`,
  which *is* synced; BE-set minifigs/pieces live only here + ephemeral state). The mount
  enrichment then re-fetches **all ~600** from Brickset. This is the dominant cold-start
  cost.
- **`blValueCache` not synced** → fresh device shows BE snapshot values, then the BL
  overlay (`valueMap`) fills in from empty → headline value/gain/ROI **"climb"** as
  `fetchValues` lands.
- **`brickEconomySetCache` not synced** → BE values *display* (they were folded into the
  synced `brickEconomyNormalizedCollection`), but the **freshness/`fetchedAt` is lost**, so
  the daily batch treats every set as never-fetched and re-cycles all ~600 over ~12 days.
- **`legoLastChanceCache` / `blBFRetirementCache` / `bricksetThemesCache` not synced** →
  re-fetched once per fresh device (cheap, single calls; minor).

> Note: the **wipe scope** (`clearLocalUserData`, `exportBackup.js:~205`) is intentionally a
> *superset* of `BACKUP_KEYS` — it clears everything `bl*`/`brickEconomy*`/`brickset*` on
> sign-out. So a sign-out + sign-in on the *same* device produces the same cold-start as a
> brand-new device: all enrichment caches gone. This is why the symptom is reproducible
> without literally changing machines.

---

## 3. The "Rebrickable Fill" vs auto-populate split

**Finding: there are TWO manual Rebrickable-fill buttons (duplicated logic), and SEPARATELY
an automatic Brickset mount-enrichment. The "manual vs auto" inconsistency conflates two
different things — and the manual button itself is duplicated.**

### 3a. Two manual "Fill" buttons — near-duplicate logic, neither shared
- **AppSettings** `handleRbFill()` `AppSettings.jsx:241–279` (button at `:1305`, label
  "Fill Missing"). Reads `blOwnedSets` + `blWantedList` from localStorage, `rbLookupSet`
  each, fills **pieces/theme/name** (3 fields) if missing, writes both keys.
- **MyCollection** `enrichFromRebrickable()` `MyCollection.jsx:813–857` (button at `:2267`,
  label "Rebrickable Fill"). Works off **React `sets` state** (+ `blWantedList` from
  localStorage), fills **pieces/theme/year/name** (4 fields — adds `year`) on owned,
  3 fields on wanted, writes both keys.

They share `rbLookupSet`/`rbReady` but **not the fill logic** — the loop is copy-pasted
with a one-field divergence (`year`) and a different source (state vs localStorage). Two
buttons, two code paths, slightly different results.

### 3b. The automatic path is a *different* source (Brickset, not Rebrickable)
The "Overview auto-loads" behavior is **`runBricksetEnrichment`** (`MyCollection.jsx:454–466`,
mount) — it fills **minifigs + pieces** from the **Brickset API**, not from the local
Rebrickable catalog. Rebrickable is loaded on mount (`:388`) but **never auto-applied** —
there is no auto `enrichFromRebrickable` call anywhere; it is button-only.

### Why Sets needs a manual button while Overview "auto-loads"
Because they fill **different fields from different sources** and only one is automated:
- `pieces`/`minifigs` (Brickset) → **auto** on mount via `runBricksetEnrichment`.
- `pieces`/`theme`/`year`/`name` (local Rebrickable, no network) → **manual** only.

So a set added with a sparse row gets minifigs/pieces auto-filled from Brickset, but its
`theme`/`year`/`name` stay blank until someone clicks a Rebrickable Fill button — and there
are two such buttons that don't agree on field set. The "should be one path" intuition is
correct; today it is **three** paths (2 manual + 1 auto) across **different sources**.

---

## 4. Cold-start "climbing numbers" trace

Trigger: signed-in user on a device with **no enrichment caches** — either a brand-new
device, or the same device after a sign-out wipe (§2 note) followed by sign-in.

**Step 1 — Cloud pull (`App.jsx:78–104` → `reconcileOnSignIn` `:127`).**
Fresh device → `applyCloudBackup` writes the `BACKUP_KEYS` set and reloads (`:171`).
Restored: `blOwnedSets`, `brickEconomyNormalizedCollection` (with prior computed
values), `brickEconomyCollectionSyncInfo`, `blPortfolioHistory`, etc.
**Not restored:** every enrichment cache in §2 (empty).

**Step 2 — MyCollection mounts; initial state hydrates (`:~162–236`).**
Minifigs/pieces for BE sets resolve from `bricksetSetCache`/`brickEconomySetCache` →
**empty → `null`**. The Minifigs stat card falls back to `beSyncInfo.minifsCount` (the
synced aggregate) — so the card shows a total, then individual rows are blank.

**Step 3 — BL value overlay (`:338–348`).** `peekValueCache` empty → no warm seed →
`valueMap` undefined→`{}`; `fetchValues(ownedNumbers)` batches **all ~600** numbers to
`/api/values`. As it resolves, `valueMap` populates → **headline value / gain / ROI climb**
from the BE snapshot toward the BL overlay. (Cause: `blValueCache` not synced.)

**Step 4 — Brickset mount enrichment (`:454–466` → `runBricksetEnrichment` `:393–435`).**
Every set has `minifigs==null && pieces==null` → `toFetch` = **all ~600** → sequential
fetch at **400ms throttle (~4 minutes)**. Each response patches `sets` state and writes
`bricksetSetCache`. **Minifig/pieces counts climb** set-by-set as patches land. (Cause:
`bricksetSetCache` not synced.) Then `fetchCmfSeriesRetail` fetches ~11 `-0` entries.

**Step 5 — Daily BE batch (`App.jsx:231` → `runDailyBEBatch` `beSyncValues.js:142`).**
`beValueBatchLast` empty → not skipped → fetches **50 oldest** sets from BE, `applyCache`
rewrites values in `brickEconomyNormalizedCollection` + `blOwnedSets`. Only 50/day, so the
BE cache fully rebuilds over **~12 days** — but values already display from the synced
normalized collection, so this is a freshness rebuild, not a visible climb.

**Net:** the visible "climb" is **Step 3 (BL overlay) + Step 4 (minifigs/pieces)**, both
driven entirely by the §2 BACKUP_KEYS gap. The "~600 re-fetch" is Step 4 (Brickset, ~600
calls) + Step 3 (one batched BL call for ~600 numbers) + Step 5 (BE, 50/day × ~12 days).

---

## 5. Performance sore spots

### Per-navigation re-run vs cold-start-only (the diagnostic you asked for)
Because tabs unmount/remount (`App.jsx:468–478`), the mount-enrichment effects re-run on
**every tab switch**. But on a **warm cache** they short-circuit:
- `runBricksetEnrichment`: `toFetch` filters out sets that already have minifigs+pieces
  (`MyCollection.jsx:395–400`) → warm device → `toFetch=[]` → returns early, **no fetch**.
- `fetchValues`: `peekValueCache` seeds; entries fresh within 24h → `need=[]` → returns
  before any network (`valueCache.js`). 
- `loadRebrickable`: module-memoized → resolves immediately.

So **the heavy enrichment is cold-start-only, not per-navigation.** The per-navigation cost
that *does* remain on a warm device is cheaper but real:
1. Re-`JSON.parse` of potentially large `bricksetSetCache`/`brickEconomySetCache`/
   `brickEconomyNormalizedCollection` blobs in initial-state construction on every remount.
2. Re-running the mount effects to compute "nothing to do".
3. **Chart-dataset recomputation** on the Overviews (below) — this is the render-time class.

### The donut/graph slowness — render-recompute vs data-dependency (per surface)
- **MC Overview (`MyCollection.jsx`)** — chart datasets are **memoized**: `themeChartData`
  (`useMemo [sets, valueMap]`), `topRoiSets`, `topValueSets`, `watchListHighlights`,
  `portfolioHistory`, `themePerformance`. The only unmemoized inline bits are tiny
  (condition pie bucket count; portfolio date `filter`). So MC Overview slowness, if any,
  is a **data-dependency**: charts render `"…"` until the `valueMap` overlay fetch resolves
  (`fmtAgg`, `:354`). **Fix class: caching/warm-seed, not memoization.**
- **Tracking Overview (`WantedList.jsx`)** — **render-recompute**, not memoized:
  - `urgency-chart` IIFE runs **5× `.filter(wanted…)`** every render — `:1621–1627`.
  - `wlThemeData` `:1048–1055`, `wlScoreBuckets` `:1101–1115`, `wlMsrpVsTargetData`
    `:1057–1061`, action-breakdown counts `:1071–1074` — all inline IIFEs, no `useMemo`.
  - (Only `retirementWaves` `:980–1024` is memoized.) **Fix class: `useMemo`.**
- **Budget Overview (`BudgetDashboard.jsx`)** — **render-recompute**, mostly not memoized:
  - `monthlyChartData` `:322–325` (12 months × filter/reduce each render),
    `storeTotals`/`storePieData` `:310–329`, `themeSpendData` `:331–341`,
    `storeSavingsData` `:354–365` — inline, no `useMemo`.
  - (Only `cumulativeSpendData` `:368–380` is memoized.) **Fix class: `useMemo`.**

**Summary:** the slow donuts/graphs are in **Wanted + Budget Overviews** and are
**render-recompute** (missing `useMemo`), re-running on every render while that Overview is
open. MC Overview is already memoized; its only stall is **waiting on the BL value fetch**
(a data dependency, fixed by the cache work, not by memoizing). These are different fixes —
do not conflate them.

> Static-analysis caveat: "expensive" here is inferred from array sizes (~600 owned,
> wanted/purchases smaller) and operation counts, not measured. A profiler run during the
> design phase would confirm which actually cost frame time.

---

## 6. Option space for a unified cache (map only — NO recommendation)

The repo already contains a **reference implementation** of the target shape:
`valueCache.js` = in-memory `Map` memo + localStorage mirror + TTL + synchronous
`peekValueCache` warm-seed + funnel-routed failures + shape validation. Any unified design
is essentially "generalize this to all enrichment sources." The options differ on *scope*
and on *whether/how the cache enters the synced backup*.

### Option A — Keep per-source caches; just memoize the charts
Touch only §5 render-recompute (add `useMemo` in Wanted/Budget Overviews). No cache, no
backup, no TTL change.
- **Pros:** tiny blast radius; no sync interaction; immediately removes render jank.
- **Cons:** does **nothing** for cold-start climb or the manual/auto Fill split; leaves
  three Overview enrichment paths duplicated.

### Option B — One in-memory enrichment module (session cache), no new persistence
A single `enrichment.js` that owns minifig/pieces/MSRP/value reads, wrapping the existing
localStorage caches, with one `peek` + one `refresh` API every surface calls.
- **Pros:** kills the duplication (one path for the three Overviews + the Fill buttons);
  modest blast radius; no backup-size impact.
- **Cons:** cold-start still re-fetches (caches still not backed up); persistence/TTL
  unchanged, so "fresh login climbs" persists.

### Option C — Persist + unify, but still EXCLUDE from backup (device-local TTL cache)
Generalize the `valueCache.js` pattern to all sources, persisted to localStorage with
per-source TTLs, read by every surface — but explicitly **not** in `BACKUP_KEYS`.
- **Pros:** removes per-navigation re-parse churn and unifies code; **zero** added blast
  radius on the highest-risk sync path; no backup-size growth.
- **Cons:** a brand-new device still cold-starts (caches are device-local); only
  *same-device* sign-out→sign-in is helped (if wipe scope is also adjusted to retain them).
  The "fresh login doesn't re-fetch" goal is **not** met across devices.

### Option D — Persist + unify + ADD a snapshot to BACKUP_KEYS (synced enrichment)
As C, plus register a compacted enrichment snapshot (e.g. minifigs/pieces/retail per set,
and/or `bricksetSetCache`) in `BACKUP_KEYS` so a fresh device pulls it from cloud.
- **Pros:** the only option that actually kills the cross-device cold-start climb — fresh
  login shows complete data immediately.
- **Cons / risk surface (this is the big one):**
  - **Blast radius on sync** — the highest-risk code in the repo. New entries must thread
    through census/overwrite/build/push-guard/dedup-hash (all derive from `BACKUP_KEYS`)
    *and* the A4 unsynced-wipe guard. A wrong `census`/`default` flag could mis-classify a
    device as fresh/dirty (SYNC-CRIT-1 / A4 regression class).
  - **Backup-size impact** — `brickEconomySetCache` is `delete`d before push today
    *because it's large*. ~600 sets × full Brickset/BE payloads could bloat the Redis blob
    and every push body; a compacted projection (just the fields surfaces read) would be
    needed, which is new code to get right.
  - **Staleness risk** — a synced cache means one device can push stale enrichment that
    another pulls; TTL semantics must survive the round-trip (the pulled snapshot needs a
    believable `fetchedAt` or it'll be treated as fresh forever / always stale).
  - **dedup-hash churn** — if the enrichment snapshot is in the hash projection, every
    background refresh marks the device dirty and triggers a push; if excluded from the
    hash but included in the body, you reintroduce a census/hash drift the registry was
    built to prevent (A11). Deciding which side of the hash it sits on is non-trivial.
  - **Lint bans** — all cache writes must stay on `setItemSafe` (DATA-4) and must not
    reintroduce per-copy `.entries` reads outside the funnel; a new shared module is a
    fresh opportunity to trip both bans, so guard tests would need extending.

### Option E — Hybrid: C for most sources + D for *only* the cheap-to-sync derived fields
Persist all caches device-local (C), but sync only a tiny derived projection (e.g. per-set
`{minifigs, pieces, retail}`) — not the full API payloads — into `BACKUP_KEYS`.
- **Pros:** kills the visible cold-start climb (minifigs/pieces/MSRP) with minimal
  backup-size cost; full payloads stay regeneratable and out of sync.
- **Cons:** two-tier model is more concept to hold; still touches the sync registry (D's
  blast-radius applies, just with a smaller payload); the BL `valueMap` overlay climb is
  only fixed if the value projection is included too.

### Cross-cutting trade-off axes (for triage)
- **Migration cost:** A/B low; C medium (new module + rewire ~5 surfaces); D/E high (sync
  registry + projection + guard tests + a backup `version` bump per `exportBackup.js`).
- **Does it fix each symptom?** Render jank: A/B/C/D/E. Per-nav re-parse: C/D/E. Manual-vs-
  auto Fill split: B/C/D/E (whichever unifies the path). Cross-device cold-start climb:
  **only D/E.**
- **Interaction with highest-risk code:** A/B/C none-to-low; D/E direct.

**STOP — no recommendation. Decision deferred to triage.**

---

## 7. Open questions / couldn't determine from code alone

1. **Backup size budget.** What's the current `/api/sync` Redis blob size and any Upstash
   per-request limit? This gates whether Option D/E's projection is even feasible. (Needs a
   measurement, not in code.)
2. **Real cold-start wall-clock.** The ~600-set Brickset enrichment at 400ms throttle is
   ~4 min of trickle; is that the user-perceived "climb," or is the BL `valueMap` fetch the
   dominant visible effect? Needs a profiled cold start.
3. **Are minifigs/pieces for BE sets ever persisted to a synced key?** I traced
   `runBricksetEnrichment` patching `sets` state + `bricksetSetCache` only; the BE-set patch
   does **not** appear to write back to `brickEconomyNormalizedCollection`. Confirm there's
   no other writer (e.g. an edit path) that persists them — if there is, the cold-start
   minifig gap is smaller than §4 implies.
4. **`brickEconomyOwnedSets` key.** Referenced in `WantedList.jsx:293` (read) and once as a
   `getItem` elsewhere; it's not in `BACKUP_KEYS` and not obviously written. Legacy? Dead?
   Worth confirming before any cache redesign assumes the BE collection lives only in
   `brickEconomyNormalizedCollection`.
5. **`blPurchases_2026` / `blMigrated_v*`** keys appeared in the key scan — year-partitioned
   purchases and migration flags. Out of enrichment scope but flag for whoever touches the
   storage namespace.
6. **Whether per-navigation remount is intentional.** Conditional rendering
   (`view === … && <Comp/>`) is the cause; keeping components mounted (CSS hide) would
   eliminate remount churn but changes a lot of mount-effect assumptions. Design-phase call.

---

## 8. Deferred / flagged (noticed, did NOT touch)

- **Duplicated Rebrickable-fill logic** (`AppSettings.jsx:241–279` vs
  `MyCollection.jsx:813–857`) — near-identical, diverge on the `year` field and
  state-vs-localStorage source. A consolidation target, but a code change — deferred.
- **Unmemoized Overview chart datasets** in `WantedList.jsx` and `BudgetDashboard.jsx`
  (§5) — pure `useMemo` wins, no behavior change, but still a change — deferred.
- **`clearApiCache` (`AppSettings.jsx:983`) only clears 2 of ~7 enrichment caches** — it
  drops `brickEconomySetCache` + `brickEconomyCollectionCache` but not
  `bricksetSetCache`/`blValueCache`/`blPriceGuideCache`/etc. If "Clear Cache" is meant to
  force a full re-enrich, it's currently partial. Flag for the design phase.
- *(Retracted)* An earlier note suspected a misplaced-default bug
  (`getItem("key" || "{}")`) in `SetDetailPanel.jsx`. **Verified false** — the actual code
  at `:73,84,116` is correct (`getItem("key") || "{}"`, default outside, in try/catch).
  Recorded here only so the false lead isn't re-investigated.

---

*End of discovery. No code was modified. Triage next.*
