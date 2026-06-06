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
