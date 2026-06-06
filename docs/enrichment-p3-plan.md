# P3 — Shared Enrichment Cache: Discovery + Align-and-Extend Plan

**Status:** Discovery / design only. **No code changed.** STOP before any build.
**Date:** 2026-06-06 · **Branch:** `main` · Companions:
[`docs/enrichment-plan.md`](enrichment-plan.md) (5-phase shape + budget), [`docs/enrichment-audit.md`](enrichment-audit.md) (layer map).

**P3 goal (to build later, not here):** generalize `valueCache.js` into ONE shared enrichment
cache (memo + localStorage mirror + TTL + sync `peek`), route the scattered caches through it, and
warm-seed reads so surfaces render from cache instantly and refresh stale entries in the background.
**P3 must NOT touch `BACKUP_KEYS` / sync** — that's P4. Behavior-neutral, G4-style: cached values +
TTLs + displayed money stay byte-identical.

---

## 1. Reference implementation — `valueCache.js` (the pattern to generalize)

Read end-to-end (`src/utils/valueCache.js`, 135 lines). Its shape:

| Layer | How it works | Lines |
|---|---|---|
| **Memo** | Module-level `const memo = new Map()` — `number → { record, fetchedAt }`. De-dupes within a session; survives remounts (module singleton), lost on reload. | 29 |
| **localStorage mirror** | `loadStore()` = `JSON.parse(getItem(CACHE_KEY)||"{}")` (try/catch → `{}`); `saveStore(store)` = **`setItemSafe(CACHE_KEY, …)`** in try/catch. Key `blValueCache`. | 24, 31-36 |
| **TTL** | `CACHE_TTL_MS = 24h`; `isFresh(entry)` = `entry.fetchedAt` is a **number (ms-epoch)** and `Date.now() - fetchedAt < TTL`. | 25, 37-39 |
| **Async get/refresh** | `fetchValues(nums,{force})` — read memo→store, collect `need` (not-fresh), one batched `apiFetch("/api/values")`, route the response through **`readSource`/`reportSourceFailure`** (never a silent throw; serve stale on failure), validate each record shape, write back to memo+store, `saveStore`. | 61-107 |
| **Sync `peek`** | `peekValueCache(nums)` — **synchronous**, returns only requested numbers present **and fresh**, no network. The warm-seed primitive. | 118-128 |
| **Clear** | `clearValueCache()` — `memo.clear()` + `setItemSafe(KEY,"{}")`. | 131-134 |
| **Shape validation** | `isRecord`/`isCondition` — a malformed response can't poison the cache (coerces to `null`). | 41-53 |

**Persistence path:** DATA-4-compliant — writes go through **`setItemSafe`** (the sanctioned choke
point), never raw `localStorage.setItem`. Reads use raw `getItem` (reads are not banned).

**This is exactly the target shape:** memo + localStorage mirror + ms-TTL + sync peek + funnel-routed
failure + shape validation + `setItemSafe` writes. P3 = "make this generic over `(key, ttl, fetcher,
keyFn, tsFn, validate)` and point the other caches at it."

---

## 2. Caches to migrate — inventory (key · writers · readers · TTL · shape · consumers)

### 2a. Per-entry map caches (fit the shared shape directly)

| Cache | Writers | Readers | TTL | Entry shape | Timestamp |
|---|---|---|---|---|---|
| **`blValueCache`** | `valueCache.js:saveStore` (`setItemSafe`) | `valueCache.js` (memo+store); MC `peekValueCache`/`fetchValues` (`MyCollection.jsx:342-345`) | 24h | `{[num]:{record,fetchedAt}}` | **ms-epoch (number)** |
| **`bricksetSetCache`** | `brickset.js:170` (`setItemSafe`); `MyCollection.jsx:412-413` (`runBricksetEnrichment`, `setItemSafe`) | `brickset.js` (`fetchBricksetSet`, `bricksetRetailEntry`); MC initial-state hydration; `SetDetailPanel.jsx` | 7d | `{[brickset_<n>]:{data,fetchedAt}}` | **ISO string** |
| **`brickEconomySetCache`** | `beSyncValues.js:171,217` (`setItemSafe`); BE lookups | `beSyncValues.js` (batch/manual); `BudgetDashboard.jsx` line-search; `SetDetailPanel.jsx`; WantedList research | 24h (manual) / rolling (batch) | `{[num]:{data,fetchedAt}}` | **ISO string** |
| **`blPriceGuideCache`** | `bricklink-client.js:127` (`setItemSafe`) | `bricklink-client.js` (single + bulk); `SetDetailPanel.jsx:40-45` | 6h single / 12h bulk | `{[num]:{data,cachedAt}}` | **ms-epoch**, field named **`cachedAt`** |

### 2b. Single-blob (whole-cache) caches — a *variant* of the shape, not per-entry

| Cache | Writers | Readers | TTL | Shape | Timestamp |
|---|---|---|---|---|---|
| **`bricksetThemesCache`** | `brickset.js:87` (`setItemSafe`) | `fetchLegoThemes` → MC/WantedList/Budget mount (`:1068`/`:579`/`:140`) | 30d | **single blob** `{fetchedAt,themes[]}` | ISO |
| **`legoLastChanceCache`** | `legoLastChance.js:48` (`setItemSafe`) | `getLastChanceCodes`/`getCachedLastChanceCodes`; WantedList; SetDetailPanel | 23h | **single blob** `{fetchedAt,setCodes[]}` | ISO |
| **`blBFRetirementCache`** | `WantedList.jsx:445,514`, `AppSettings.jsx:186` (`setItemSafe`) | `WantedList.jsx`, `AppSettings.jsx:177` | 7d (TTL guard) | **single blob** `{…,fetchedAt}` | ISO |

### 2c. Does NOT fit / must NOT migrate (flag + reason)

| Item | Why excluded |
|---|---|
| **`blSessionToken`** | Secret-ish (BL session), 50m TTL, in `SYNC_SKIP_KEYS`. Auth, not enrichment. Leave in `bricklink-client.js`. |
| **`blBrickLinkAccessToken`** | User secret. Not a cache. |
| **`brickEconomyCollectionCache`** | **DEAD/vestigial** — only a `removeItem` in `clearApiCache` (`AppSettings.jsx:985`) + a `SYNC_SKIP_KEYS` entry; **zero writers** in `src/`. (Same class as `brickEconomyOwnedSets`, P2 Q4.) Don't migrate; P5 delete candidate. |

**Cross-cache divergences the shared module must absorb (else not behavior-neutral):**
1. **Timestamp format differs:** ms-epoch (`blValueCache`, `blPriceGuideCache`) vs ISO string
   (brickset, BE, themes, lastchance, BF). TTL math differs (`Date.now()-n` vs
   `Date.now()-new Date(iso).getTime()`). Per-cache `tsParse`/`tsWrite` must preserve each.
2. **Field name differs:** `fetchedAt` everywhere except `blPriceGuideCache` (`cachedAt`).
3. **Key namespacing differs:** `bricksetSetCache` prefixes map keys `brickset_<n>`; BE/value
   de-variant the number (`replace(/-1$/,"")`). Per-cache `keyFn`.
4. **Entry value field differs:** `record` (value) vs `data` (brickset/BE/priceguide).
5. **Per-entry map vs single-blob:** 2b caches have no per-number key — they're "one blob, one
   TTL." They fit a thinner `blobCache(key, ttl)` variant, not the per-entry `get/set/peek`.
6. **Dual TTL:** `blPriceGuideCache` has 6h (single) and 12h (bulk skip) — two thresholds against
   one `cachedAt`. The module must let a *reader* pass its own freshness window.

---

## 3. Shared module API (proposal) — `src/utils/enrichmentCache.js`

A factory that stamps out a per-cache instance, each owning its `localStorage` key + memo + TTL.
**Cached values and TTL semantics stay byte-identical** — the factory just centralizes the
load/save/fresh/peek plumbing that's currently copy-pasted 5×.

```
createEntryCache({
  key,                       // localStorage key, e.g. "bricksetSetCache"
  ttlMs,                     // default freshness window
  valueField = "data",       // "record" for value, "data" for the rest
  keyFn = (n) => n,          // bricksetSetCache → `brickset_${n}`; BE/value → n.replace(/-1$/,"")
  tsField = "fetchedAt",     // "cachedAt" for priceguide
  tsParse, tsWrite,          // ms-epoch (identity) vs ISO (new Date().toISOString())
  validate = (x) => x,       // value shape guard (isRecord for value; identity elsewhere)
})  →  { peek(nums, {ttlMs?}), getFresh(nums,{ttlMs?}), put(num, value), putMany(map), clear(), raw() }

createBlobCache({ key, ttlMs, tsField })   // 2b: { peek(), isFresh(), put(payload), clear() }
```

- **`peek(nums)`** — synchronous, memo→store, returns only fresh requested entries (generalizes
  `peekValueCache`). The warm-seed primitive.
- **`getFresh` / `put` / `putMany`** — the read-through + write-back the async fetchers wrap (each
  caller keeps owning its `apiFetch` + `readSource` funnel call; the module owns only cache state).
- **Persistence** — **all writes via `setItemSafe`** (DATA-4). The factory NEVER calls raw
  `setItem`. It also NEVER touches `BACKUP_KEYS` or the sync registry.
- **`{ttlMs?}` override** — lets `blPriceGuideCache`'s bulk path pass 12h while the single path uses
  6h, against one stored `cachedAt`.

**Mapping each cache onto it:**

| Cache | Factory call (key params) |
|---|---|
| `blValueCache` | `createEntryCache({key:"blValueCache", ttlMs:24h, valueField:"record", tsField:"fetchedAt"(ms), validate:isRecord})` |
| `bricksetSetCache` | `createEntryCache({key:"bricksetSetCache", ttlMs:7d, valueField:"data", keyFn:n=>`brickset_${n}`, tsField:"fetchedAt"(ISO)})` |
| `brickEconomySetCache` | `createEntryCache({key:"brickEconomySetCache", ttlMs:24h, valueField:"data", keyFn:devariant, tsField:"fetchedAt"(ISO)})` |
| `blPriceGuideCache` | `createEntryCache({key:"blPriceGuideCache", ttlMs:6h, valueField:"data", tsField:"cachedAt"(ms)})` + bulk reader passes `{ttlMs:12h}` |
| `bricksetThemesCache` | `createBlobCache({key, ttlMs:30d})` |
| `legoLastChanceCache` | `createBlobCache({key, ttlMs:23h})` |
| `blBFRetirementCache` | `createBlobCache({key, ttlMs:7d})` |

**Behavior-neutrality bar (the G4 money-neutrality analogue):** for every cache, after migration the
exact same entries are fresh/stale at the exact same instants, the same bytes land in
`localStorage`, and the same `datachange`/`storagefull` events fire (see §6a). No displayed
enrichment or money value changes.

---

## 4. Warm-seed — render-cache-then-refresh

**The cold-start "climb" is the minifigs trickle** (Brickset, ~600 sequential @ 400ms ≈ 4–7 min,
per P2 §3); the value overlay is already a fast single batch. Warm-seed targets the **warm-remount
stall and the MC chart data-dependency**, NOT the cold-start fetch itself (that's the same network
work) — it makes surfaces paint from the persisted cache immediately and refresh stale entries in
the background.

**Read sites and their transition:**

| Read site | Today | After warm-seed |
|---|---|---|
| **MC value overlay** `MyCollection.jsx:339-348` | ✅ ALREADY render-cache-then-refresh (`peekValueCache` seeds, `fetchValues` refreshes) | **Reference — no change.** This is the pattern the others adopt. |
| **MC minifigs/pieces** `runBricksetEnrichment` (mount, `:393-435`) + initial-state hydration (`~162-236`) | Hydrates from `bricksetSetCache` in initial state; mount effect re-iterates ~600 calling `fetchBricksetSet` (warm → short-circuits per-set, but still loops; cold → trickles) | Initial state calls `bricksetCache.peek(nums)` for minifigs/pieces → charts paint counts from cache on first render; the mount effect only **refreshes stale/missing** in the background (TTL-gated, not "all missing on every remount"). |
| **MC charts** (`themeChartData` etc., memoized on `[sets, valueMap]`) | Block on `valueMap` (fast) + `sets.minifigs` (from above) | Paint from warm `sets`+`valueMap` immediately; recompute when the background refresh lands new `sets`/`valueMap`. **No displayed-number change** — same data, earlier paint. |
| **WantedList Brickset retro-fill** `WantedList.jsx:369-415` (mount) | fetch-then-render on mount | `peek` `brickEconomySetCache`/`bricksetSetCache` first; refresh stale in background. |
| **Budget Overview** `BudgetDashboard.jsx` | Reads synced `brickEconomyNormalizedCollection` only (no enrichment fetch) | **No change** — no enrichment dependency. |

**Mechanism:** the synchronous `peek` returns fresh entries for the first render; a background
`getFresh`/refresh updates state when stale entries return. Identical to MC's existing value path —
P3 generalizes it to minifigs/pieces so the MC chart stall (audit §5 "data-dependency, not
memoization") is fixed by warm-seed, with displayed data unchanged.

---

## 5. Characterization net (pin CURRENT behavior before refactor)

Tests to land **first** (each green on `main` before any module code), so the migration is provably
behavior-neutral:

1. **What's cached & where** — for each cache: a `put` then `peek` round-trips the exact stored
   bytes under the exact `localStorage` key (key namespacing incl. `brickset_` prefix and the
   `-1` de-variant preserved).
2. **TTL boundaries** — with a faked clock, an entry stamped at `T` is fresh at `T+ttl-1ms` and
   stale at `T+ttl`, **per cache** (24h/7d/6h/12h-bulk/30d/23h), and for **both** timestamp formats
   (ms-epoch vs ISO) and **both** field names (`fetchedAt`/`cachedAt`). This is the divergence guard.
3. **Cache-hit vs refetch** — a fresh entry returns from cache with **no `apiFetch`** (spy/mock);
   a stale/missing entry triggers exactly one fetch; `force` bypasses freshness. Pin the existing
   `valueCache` behavior and the `fetchBricksetSet`/`syncBEValues`/`getLastChanceCodes` short-circuits.
4. **Failure → serve-stale** — a funnel failure (`readSource` not-ok) returns cached data, never
   throws, and routes through `reportSourceFailure` (assert the funnel is still called).
5. **Displayed enrichment/money unchanged** — a snapshot/golden test over a fixture collection:
   minifigs/pieces counts, MSRP, and the aggregate value/gain/ROI render identically before and
   after (the G4 money-neutrality bar, extended to enrichment counts).
6. **Sync untouched** — assert `dedupHash`/`buildBackup` output is byte-identical before/after (no
   cache key leaked into `BACKUP_KEYS`); and that cache writes fire `datachange` **exactly** as
   today per §6a (the auto-push trigger set is unchanged).

---

## 6. Risks

### 6a. DATA-4 (no raw `setItem`) + the auto-push trigger — and the per-`.entries` ban
- **All current cache writes already use `setItemSafe`** (verified: `valueCache`, `brickset`,
  `beSyncValues`, `bricklink-client`, `legoLastChance`, the MC enrichment write at `:412`). The
  shared module must keep that — **raw `setItem` is banned** (`eslint.config.js` `noRawSetItem`,
  enforced everywhere except `safeStorage.js`). The factory routes 100% of writes through
  `setItemSafe`. ✅ low risk if the rule is respected.
- **⚠️ Subtle: the `datachange` auto-push trigger is per-key, and it is NOT uniform across the
  caches today.** `setItemSafe` fires `brickledger:datachange` (→ debounced auto-push) when a
  `bl*`/`brickEconomy*` key changes **and is not in `SYNC_SKIP_KEYS`** (`safeStorage.js:19-24,56`).
  Current state:
  - In `SYNC_SKIP_KEYS` (no trigger): `bricksetSetCache`, `brickEconomySetCache`,
    `brickEconomyCollectionCache`, `blPriceGuideCache`.
  - **NOT skipped, `bl*` → currently DO fire a push trigger:** **`blValueCache`** and
    **`blBFRetirementCache`** (harmless today — they're not in `BACKUP_KEYS`, so the push computes
    `no_change` and skips, but the trigger fires).
  - No trigger by prefix (not `bl`/`brickEconomy`): `bricksetThemesCache` (`brickset*`),
    `legoLastChanceCache` (`lego*`).
  **Behavior-neutral requirement:** the shared module must NOT change which keys fire `datachange`.
  Either (a) keep each key's current trigger behavior exactly (preferred for P3), or (b) make a
  deliberate, separately-justified decision to add `blValueCache`/`blBFRetirementCache` to
  `SYNC_SKIP_KEYS` — which removes wasted no-op push triggers but **is a behavior change** and
  belongs in its own commit with the net green, not silently inside the refactor. **Recommend (a)
  for P3; flag (b) as an optional hygiene follow-up.**
- **Per-`.entries` ban** (`noDirectEntriesIteration`): the shared cache stores opaque `record`/`data`
  blobs and **never iterates `<set>.entries`** — it has no per-copy logic. So it won't trip the ban,
  *provided* the module stays a dumb key→blob store and value math stays in `value.js`/`portfolio.js`.
  ✅ low risk; the net's §5.5 golden test backstops it.

### 6b. Circular-import risk (the G4 percopy↔portfolio cycle class)
A widely-imported shared module is a cycle magnet. Mitigation: **keep `enrichmentCache.js` a LEAF.**
It may import only `safeStorage` and (for the fetchers that wrap it) `readSource` — both already
leaves. It must **NOT** import `value.js`, `portfolio.js`, `percopy.js`, `valueDisplay.js`, or any
surface. The per-cache *fetchers* (`brickset.js`, `beSyncValues.js`, …) import the cache module, not
the reverse. Today `valueCache.js` already depends only on `apiFetch`+`safeStorage`+`readSource`
with no cycle — preserve that dependency direction. If a future warm-seed read needs a value helper,
**deref at call time** (pass the helper in) rather than importing it into the leaf (the G4 hoisted-
decl / call-time-deref fix). ✅ low risk if the leaf rule holds.

### 6c. Accidental sync / `BACKUP_KEYS` change (must stay untouched in P3)
- The shared module must **not** add, rename, or reorder any `BACKUP_KEYS` entry, must **not** edit
  `exportBackup.js`, and must **not** add a cache key to `dedupHash`/`buildBackup`. §5.6 pins this
  with a byte-identical `dedupHash`/`buildBackup` assertion.
- `brickEconomySetCache` is still `delete`d before push (`exportBackup.js:38`) — P3 leaves that
  exactly as-is (re-including it is a P4 decision, gated on the budget verdict).

---

## 7. Phasing — one commit per step, each green, behind the net

| Phase | Scope | Acceptance bar |
|---|---|---|
| **P3.0 — Characterization net** | Land §5 tests against current code. No module yet. | All §5 tests green on `main`; they encode today's TTLs, hit/refetch, money/enrichment goldens, and the `datachange`/`dedupHash` invariants. |
| **P3.1 — Module, inert** | Add `enrichmentCache.js` (`createEntryCache`/`createBlobCache`) + its own unit tests. **No caller rewired.** | Module unit tests green; `npm run lint` clean (no raw `setItem`); zero imports from surfaces (leaf check). Production behavior unchanged (nothing calls it). |
| **P3.2 — Migrate `blValueCache`** | Re-express `valueCache.js` on top of the module (it's already the reference shape → lowest risk first). | §5 net still green; `valueCache.js` public API (`fetchValues`/`peekValueCache`/`clearValueCache`) unchanged; MC value overlay identical. |
| **P3.3 — Migrate `bricksetSetCache`** | Route `brickset.js` (`fetchBricksetSet`) + the MC enrichment write through the module (preserve `brickset_` keyFn + ISO ts + 7d TTL). | Net green; minifigs/pieces goldens unchanged; `bricksetSetCache` bytes/keys identical. |
| **P3.4 — Migrate `brickEconomySetCache`** | Route `beSyncValues.js` (batch + manual) through the module (de-variant keyFn, 24h/rolling). | Net green; BE values identical; **`exportBackup.js` strip untouched** (§6c). |
| **P3.5 — Migrate `blPriceGuideCache`** | Route `bricklink-client.js` through the module with the dual-TTL reader override (6h single / 12h bulk). | Net green; SetDetailPanel price guide identical. |
| **P3.6 — Migrate blob caches** | `bricksetThemesCache`, `legoLastChanceCache`, `blBFRetirementCache` → `createBlobCache`. | Net green; themes/last-chance/retirement reads identical. |
| **P3.7 — Warm-seed reads** | Apply §4: MC minifigs/pieces `peek` in initial state + background TTL refresh; WantedList retro-fill peek-first. | Net green incl. the §5.5 money/enrichment golden; charts paint from cache on warm remount with **no displayed-number change**; cold-start refresh still occurs in background. |

**Optional follow-up (NOT P3):** §6a (b) — add `blValueCache`/`blBFRetirementCache` to
`SYNC_SKIP_KEYS` to drop wasted no-op push triggers (own commit, own justification). And the P5
hygiene items (consolidate Rebrickable-Fill; make `clearApiCache` clear all ~7; delete dead
`brickEconomyCollectionCache`/`brickEconomyOwnedSets`).

---

## Open questions (for Sam / design call)
1. **`datachange` neutrality vs cleanup:** ship P3 strictly preserving today's per-key push triggers
   (recommend), or fold the `SYNC_SKIP_KEYS` cleanup for `blValueCache`/`blBFRetirementCache` in
   now? (It's a behavior change, however benign.)
2. **Blob caches in-scope?** `bricksetThemesCache`/`legoLastChance`/`blBFRetirement` are single-blob
   and barely benefit from the per-entry machinery. Migrate for uniformity (P3.6), or leave them and
   scope P3 to the four per-entry caches only?
3. **Warm-seed depth:** is the MC minifigs/pieces initial-state `peek` enough, or do we also want a
   keep-mounted (CSS-hide) tab model to kill remount re-parse churn (audit §7.6)? The latter is a
   bigger change — likely out of P3.
4. **Memo lifetime across the shared module:** one shared `Map` per cache key (matches today) vs a
   single namespaced `Map` — any concern with memory for `brickEconomySetCache` at ~600×1.5KB? (Tiny;
   confirm we keep per-cache memos for clarity.)

*End of P3 discovery. No code modified. Build starts at P3.0 (net) only after sign-off.*

---

# P3.7 — Warm-seed: design pass (the first browser-observable step)

**Status:** Design only — READ-ONLY pass, **no code written.** **Date:** 2026-06-06 · **Branch:** `main`.
Prereqs DONE: P3.1 inert module (`enrichmentCache.js`) + P3.2–P3.5 migrations (`blValueCache`
1b6ae9e · `bricksetSetCache` 8c751b0 · `brickEconomySetCache` canonical engine 4596104 ·
`blPriceGuideCache` bd981d3), all behavior-neutral, net + CI green. P3.6 (blob caches) deferred.

This section supersedes the §4 sketch where the code disagrees with it (it does — see §P3.7.1). Read it,
not §4, for the build.

## P3.7.0 — What the code actually shows (correcting the §4 assumptions)

Reading the post-P3.3/P3.4 code end-to-end changes the picture the §4 table painted:

1. **MC minifigs/pieces are ALREADY warm-seeded.** The MC initial-state hydration
   (`MyCollection.jsx:170`) already does `JSON.parse(localStorage.getItem("bricksetSetCache"))` and
   fills `minifigs`/`pieces` on the *first* render. `runBricksetEnrichment` (`:393`) is async (fires
   after paint) and already gates on **state-field presence** (`s.minifigs != null && s.pieces != null`)
   — so a warm device paints counts immediately and re-fetches **nothing**. The cold-start "climb" is the
   genuinely-cold case (empty cache → ~600 sequential `fetchBricksetSet` @ 400ms); warm-seed cannot
   shrink that — it's the same network work. So there is **no "blocking refetch on mount" left to fix**
   for MC; the §4 "after warm-seed" column describes a state that already exists.

2. **`fetchBricksetSet` reads via `bricksetCache.peek` — memo-aware** (`brickset.js:170`). This is the
   ONE managed read that consults the in-memory memo. It matters for §P3.7.1.

3. **All `brickEconomySetCache` reads are store-direct, never memo-aware.** The display reads
   (`MyCollection.jsx:171` hydration, `:1158` `revalueFromCache`, `WantedList.jsx:347/845`, the
   SetDetailPanel) all `JSON.parse(localStorage.getItem(...))` directly, and BE's own engine uses
   `beSetCache.getRaw()`/`saveRaw()` (also store-direct). **Nothing calls `beSetCache.peek`/`readThrough`/
   `staleKeys`** — so the BE memo is *written and rebuilt but never served*.

4. **WantedList has no `bricksetSetCache` read at all.** Its brickset access is `fetchBricksetSet`
   (`WantedList.jsx:339`, already peek-backed); its only direct cache reads are `brickEconomySetCache`
   (out of scope). **The §4 "WantedList Brickset retro-fill" warm-seed row is moot — drop it.**

5. **No in-session raw clear of `blValueCache` exists.** `disconnectBrickLink` (`AppSettings.jsx:999`)
   touches only `blBrickLinkAccessToken` + `blSessionToken` + `clearPriceGuideCache()` — **not**
   `blValueCache`. `clearValueCache()` is defined (`valueCache.js:89`) but **has no caller**. The task's
   "disconnectBrickLink's blValueCache clear" does not exist.

**Net effect:** the substantive P3.7 work is the **memo-coherence sweep** (§P3.7.1) — which fixes a real
in-session bug. The "warm-seed reads" (§P3.7.3) collapse to optional cosmetic single-sourcing, because the
seed already happens and `getRaw`/raw-`JSON.parse` are byte-identical store reads.

## P3.7.1 — Memo-coherence sweep (the real finding) — REQUIRED, own commit

The P3.x migrations gave each managed cache an in-session memo. Any **in-session raw `removeItem` of a
managed key** now leaves the memo populated → a later **memo-aware** read serves the ghost. (Page reload
wipes the memo, so only in-session clears matter.) Full sweep of the 4 managed keys:

| Managed key | In-session raw clear today | Memo-aware reader? | Verdict |
|---|---|---|---|
| **`bricksetSetCache`** | `AppSettings.jsx:1262` — the inline **"Clear cache"** button does `localStorage.removeItem("bricksetSetCache")` | **YES** — `fetchBricksetSet` → `bricksetCache.peek` (`brickset.js:170`) | **🔴 ACTIVE BUG. MUST route.** After the click, the store is empty but the memo keeps every entry → the very next `fetchBricksetSet` serves the ghost and re-persists it. "Clear cache" silently does nothing until reload. |
| **`brickEconomySetCache`** | `AppSettings.jsx:984` — `clearApiCache()` does `localStorage.removeItem("brickEconomySetCache")` (the P5 item) | **NO** — every BE read is store-direct (`getRaw`/raw `JSON.parse`); nothing calls `beSetCache.peek`/`readThrough` | **🟡 Contract/hygiene. SHOULD route.** Benign *today* (no reader consults the BE memo), but it violates the module's clear() contract and is a latent trap the instant anyone peeks BE. Route it now while it's free. |
| **`blPriceGuideCache`** | `AppSettings.jsx:1002` — `disconnectBrickLink()` → `clearPriceGuideCache()` | YES (client peek) | **✅ Already routed (P3.5).** No action. |
| **`blValueCache`** | *none* | n/a | **✅ Nothing to do.** No raw clear exists; `clearValueCache()` is uncalled. |

**The two fixes (commit `P3.7a`):**
- Add `clearBricksetCache()` to `brickset.js` (one line: `bricksetCache.clear()`), export it, and replace
  the inline `localStorage.removeItem("bricksetSetCache")` at `AppSettings.jsx:1262` with it.
- Add `clearBESetCache()` to `beSyncValues.js` (`beSetCache.clear()`), export it, and replace the
  `localStorage.removeItem("brickEconomySetCache")` at `AppSettings.jsx:984` with it. (Leave the adjacent
  `brickEconomyCollectionCache` removeItem — it's dead/vestigial, §2c, no memo.)

This mirrors exactly the P3.5 `clearPriceGuideCache` precedent (`bricklink-client.js:36`).

**Secondary observation (NOT in P3.7 scope, noted for completeness):** several sites raw-**write** the BE
map via `setItemSafe("brickEconomySetCache", …)` after a load-mutate (`MyCollection.jsx:786`,
`WantedList.jsx:1153/1261`, `BudgetDashboard.jsx:984`, the import-restore at `AppSettings.jsx:491`) — these
bypass `beSetCache.saveRaw()` and leave the BE memo stale too. **Same benign class** (no BE memo-aware
reader), a P3.4 leftover. Leave as-is: BE is slated for full removal, so churning these write sites earns
nothing. Flag only if BE ever grows a peek-backed read.

## P3.7.2 — Warm-seed SCOPE recommendation (Q1)

**Confirm the task's lean, with one refinement:**
- ✅ **`bricksetSetCache` — in scope** (the only cold-start pain; minifigs/pieces). But see §P3.7.3 — the
  seed already exists, so this reduces to single-sourcing the read, not a new pattern.
- ❌ **`brickEconomySetCache` — out of scope.** Slated for full removal; its values already display from the
  synced `brickEconomyNormalizedCollection`; its reads are mixed-key (`c[num]` vs `c[num-1]` vs
  `c[\`brickset_…\`]`) so a `peek` would be ambiguous. Confirmed.
- ❌ **WantedList retro-fill — drop it** (refinement, §P3.7.0 pt 4): WantedList has no `bricksetSetCache`
  read; its brickset path is already peek-backed via `fetchBricksetSet`, and its BE reads are out of scope.
  Nothing to warm-seed there.

So warm-seed scope = **the two MC `bricksetSetCache` raw reads** (`MyCollection.jsx:170` hydration,
`:632` `retirementAlertsForOwned`), and even those are optional (§P3.7.3).

## P3.7.3 — Warm-seed PATTERN (Q3): what the value-overlay reference does and does NOT transfer

The MC value-overlay reference is **`peekValueCache` (fresh-only seed) → render → one batched
`fetchValues` refresh of the stale.** Two reasons it does **not** map cleanly onto brickset:

1. **`peek` is fresh-only (TTL-gated); the current brickset seed is not.** `MyCollection.jsx:170` paints
   from the raw whole map regardless of age, so a >7d-stale-but-present entry **still paints today**.
   Swapping to `bricksetCache.peek` would *drop* those from first paint → "—" for up to 4–7 min while the
   400ms trickle refills them. **That is a displayed-data regression, not warm-seed.** The behavior-neutral
   seed is **`bricksetCache.getRaw()`** (whole map, no TTL) — byte-identical to today's `JSON.parse`.

2. **The "background refresh the stale" half doesn't pay off for brickset.** The value overlay refreshes
   because *values change*. The fields the brickset cache feeds the charts — **minifigs/pieces — are static**
   (a set's piece count never changes). Adding a `bricksetCache.staleKeys(nums)` TTL-refresh loop would fire
   ~600 refetches every 7d to re-derive numbers that can't have changed — pure churn, zero displayed
   benefit. (The mutable brickset fields — `exit_date`, retail — are consumed off the same cache but aren't
   the cold-start pain and aren't worth a 600-set sweep here.) **Recommend NOT adding a TTL-refresh loop**
   (simplicity-first, CLAUDE.md §2).

**Conclusion:** the only behavior-neutral, non-churning change available is **single-sourcing** the two MC
raw reads onto `bricksetCache.getRaw()` so every brickset read path goes through the one instance (and the
"Clear cache" button — once §P3.7.1 routes it through `clearBricksetCache()` — is coherent across *all* read
paths, not just the peek path). This changes **zero displayed bytes** (`getRaw()` ≡ today's `JSON.parse`).

| Read site | Today | After P3.7b (optional) |
|---|---|---|
| `MyCollection.jsx:170` (initial-state hydration) | `JSON.parse(localStorage.getItem("bricksetSetCache")\|\|"{}")` | `bricksetCache.getRaw()` — same bytes, single-sourced |
| `MyCollection.jsx:632` (`retirementAlertsForOwned`) | same raw `JSON.parse` | `bricksetCache.getRaw()` |
| `MyCollection.jsx:171/1158`, `WantedList.jsx:347/845`, panel (BE) | raw `JSON.parse(brickEconomySetCache)` | **unchanged** (BE out of scope) |
| MC value overlay (`:339`) | `peekValueCache`+`fetchValues` | **unchanged — the reference, already correct** |

Honest framing: P3.7b is cosmetic. It carries no behavior change and a non-trivial risk surface (touching
MC initial state). It can be **deferred or dropped** without losing anything observable; §P3.7.1 is the
commit that actually matters.

## P3.7.4 — Verification (Q4): first browser-observable change → Vercel-preview check

On top of the §5 net (golden over the fixture collection still byte-identical) and a **new memo-coherence
assertion** (see below), do a Vercel-preview manual check:

- **Memo-coherence (the bug fix), in one session, no reload:** populate the brickset cache (load MC so
  counts render) → Settings → click **"Clear cache"** → return to MC. **Observe:** counts/charts that
  derive from brickset (minifigs, pieces, retirement alerts) drop to "—" and a fresh trickle begins
  **in the same session**. Pre-fix, they stay populated (the ghost memo) until a hard reload — that
  contrast is the proof.
- **Warm remount (unchanged-good baseline):** with a populated cache, switch away from MC and back (and
  reload once). **Observe:** minifigs/pieces + theme/value charts paint immediately, **no "—" flash**, and
  the Network panel shows **no `/api/brickset-set` burst** (state-presence gate still short-circuits).
- **Cold load (unchanged-good baseline):** clear cache + reload. **Observe:** first paint is immediate
  (collection + values), brickset counts fill via the background trickle without blocking the UI.

**New automated assertion (lands in `P3.7a`):** after `bricksetCache.clear()`, **both** a `getRaw()` read
and a `fetchBricksetSet`/`peek` read return empty — i.e. `clear()` wipes memo **and** store so **no read
path serves a ghost.** This is the "warm-seed renders identical data" guard re-aimed at the actual defect
(coherence), and it would have caught the §P3.7.1 bug. (The displayed-data golden already covers P3.7b,
since `getRaw` ≡ `JSON.parse`.)

## P3.7.5 — Phasing (Q5): one commit per step, each net-green

| Commit | Scope | Required? | Acceptance |
|---|---|---|---|
| **P3.7a — Memo-coherence sweep (FIRST)** | Add+export `clearBricksetCache()` (`brickset.js`) and `clearBESetCache()` (`beSyncValues.js`); route `AppSettings.jsx:1262` → `clearBricksetCache()` and `:984` → `clearBESetCache()`. Add the post-`clear()` no-ghost assertion. | **YES** — fixes the active in-session "Clear cache" bug. | §5 net green; new no-ghost test green; manual: in-session clear works without reload. |
| **P3.7b — Single-source the brickset reads (OPTIONAL)** | `MyCollection.jsx:170` + `:632` raw `JSON.parse` → `bricksetCache.getRaw()`. **No** `peek`-fresh-only swap, **no** TTL-refresh loop (§P3.7.3). | **No** — cosmetic, byte-identical. Defer/drop freely. | §5 golden byte-identical; charts paint identically; no new network. |

**Explicitly NOT in P3.7** (and why): the brickEconomySetCache reads (BE removal coming); a brickset
TTL-refresh loop (static fields → churn); the raw BE *write* sites (benign, BE removal); making
`clearApiCache` clear all ~7 caches incl. blPriceGuideCache (the P5 hygiene item — its own commit).

*End of P3.7 design pass. No code modified. Build starts at P3.7a only after sign-off.*
