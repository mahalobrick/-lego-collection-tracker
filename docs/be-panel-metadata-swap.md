# BE removal — panel metadata source-swap (pieces / year) → Brickset

**Scope:** read-only discovery + a build proposal. Maps the swap of the last BrickEconomy **metadata**
reads (pieces / release-year, plus PurchaseDetailPanel's MSRP) from the `brickEconomySetCache` device
cache over to Brickset, per [`be-removal-plan.md`](be-removal-plan.md) §2e. **No code changed** — this
doc is review-gated. Probe date **2026-06-12**. Origin verified `mahalobrick/-lego-collection-tracker`.

Builds on completed teardown work: Phase-1 cleanup, **D1** promos frozen (`117b095`), **D2**
wanted-side forecasts dropped (`6bee85b`), and the **MyCollection BE-metadata tail already removed**
(`3eee4d0`). That last commit is why only **4 sites** remain — MyCollection no longer reads BE for
metadata.

---

## TL;DR

- **The full `brickEconomySetCache` reader census (§6) confirms exactly 4 metadata reads remain**, all
  in detail-panel / cell render paths: `SetDetailPanel:99-100`, `WatchDetailPanel:33-34`,
  `PurchaseDetailPanel:31-33`, `WantedList:841`. Every other reader is D3 (WatchDetailPanel
  value+trend) or machinery (form auto-fill writers, BE sync, backup/registry plumbing).
- **Brickset already serves every field needed.** `api/brickset-set.js` returns `year` (:95),
  `pieces` (:99), `minifigs` (:100), **and `retail_price_us`** (:114). The full payload is persisted to
  `bricksetSetCache[brickset_<n>].data` (7-day TTL) by the existing enrichment loops.
- **No mandatory enrichment extension.** Year is **already in the device cache** for every
  Brickset-enriched set — `runBricksetEnrichment` patches only `pieces`+`minifigs` onto *rows*
  (MyCollection.jsx:429-430) but caches the *whole* `bsData` (incl. `year`) first (`:424`). The panels
  read the **cache**, not the row, so they get year for free. One **optional** two-line extension to
  WantedList's own loop is the cleanest fix for its cell (alt: repoint the cell's fallback).
- **Difficulty is uneven:** SetDetailPanel is a 2-line swap (its Brickset `bs` object is *already in
  scope*); WatchDetailPanel and PurchaseDetailPanel need a **new** `bricksetSetCache` read added (they
  read no Brickset today); WantedList needs the cell's BE fallback repointed (or the loop extended).
- **Q4 answer (§6): YES — this removes the last non-D3 BE *display* consumer.** After the swap, the
  only remaining `brickEconomySetCache` display reads are WatchDetailPanel's `marketValue` (:35) and
  price-history chart (:154) — both the **D3** bucket. Once D3 repoints those, *no component reads the
  BE cache for display* and the machinery can be torn down.

---

## 1. Per-site current source trace (where pieces/year come from today)

All four read the same BE device cache: `JSON.parse(localStorage.getItem("brickEconomySetCache"))`,
look up `[setNumber]` (with a `/-1$/`-strip fallback), unwrap `cacheEntry.data` → `cached`, then read
BE-shaped field names. The BE-shaped names matter for the swap: BE uses **`pieces_count`** and
**`released_date`**; Brickset uses **`pieces`** and a numeric **`year`** (no `released_date`).

| Site | Lines | Field → current source | In scope at that point |
|---|---|---|---|
| **SetDetailPanel** (owned) | 94-100 | `pieces = cached.pieces_count`; `releaseYear = cached.year \|\| released_date.slice(0,4)` | **Brickset `bs` object already built** at :105-110 (`bsEntry.data` from `bricksetSetCache[brickset_<n>]`); already feeds `subtheme/minifigs/rating/age_min/exit_date` (:129-133). `item` = owned row. |
| **WatchDetailPanel** (watch) | 28-35 | `pieces = cached.pieces_count`; `releaseYear = cached.year \|\| released_date.slice(0,4)` | **No Brickset read anywhere in file** (grep = 0). Props `{item,onClose,onEdit,onBuyNow}`. Same `cached` also yields `marketValue` (:35) + price-history (:154) — **D3/value, not metadata**. |
| **PurchaseDetailPanel** (purchase) | 26-33 | `pieces = cached.pieces_count`; `releaseYear = cached.year \|\| released_date.slice(0,4)`; **`msrp = cached.retail_price_us`** (:33) | **No Brickset read anywhere in file** (grep = 0). Props `{item,onClose,onEdit}`. Purchase row carries **no** top-level pieces/year/msrp. |
| **WantedList** ageMonths cell | 836-852 | `yr = item.releaseYear ?? (BE-cache fallback: e.data.year \|\| released_date.slice(0,4))` at :841 | **Brickset already reachable**: file imports/uses `fetchBricksetSet` (×3) and runs a per-row mount enrichment (:367-411) that already has `bsData` in hand. Row may carry `item.releaseYear`/`item.pieces` from lookup/import paths. |

Notes:
- **SetDetailPanel** uses `cached` (BE) at **only** :99-100 — the whole BE block (:94-100) is fully
  removable once pieces/year move to `bs`.
- **WatchDetailPanel** uses `cached` at :33 (pieces), :34 (year), :35 (marketValue, **value**), :154
  (`priceEventsFromBE(cached)`, **D3 chart**). The BE block **cannot be deleted by this arc** — only
  :33-34 move; :35 and :154 stay until D3.
- **PurchaseDetailPanel** uses `cached` at :31-33 only (pieces, year, **msrp**). To remove BE here the
  swap must also cover **msrp** (Brickset serves `retail_price_us`). Then the BE block is fully
  removable.
- **WantedList** ageMonths *prefers* the row field `item.releaseYear` (:837); BE is a **fallback only**
  (:841). The pieces column (:809) reads `item.pieces` with no BE read at all.

---

## 2. Brickset coverage (verified by reading source, not the stale plan)

### 2a. Does the proxy/cache serve YEAR? — **Yes, and pieces, minifigs, and MSRP.**
`api/brickset-set.js` builds `data` from the Brickset response (:92-124):

```
year:            s.year || null,        // :95   ← release year (numeric)
pieces:          s.pieces || null,      // :99
minifigs:        s.minifigs || null,    // :100
retail_price_us: (lego.US && lego.US.retailPrice) || null,  // :114  ← MSRP
```

There is **no `released_date`** field on the Brickset payload — it exposes a numeric `year`
(plus `launch_date`/`exit_date`). So the BE `released_date.slice(0,4)` fallback has **no Brickset
equivalent** and should simply be dropped; read `bs.year` directly.

### 2b. Cache shape (`src/utils/brickset.js`)
- Key **`bricksetSetCache`**, `keyFn = brickset_<n>` (verbatim prefix, **no de-variant**), entry
  `{ fetchedAt: ISO, data }`, **7-day TTL** (`CACHE_TTL_MS`).
- Accessors: `getBricksetCache()` (raw map), `fetchBricksetSet(n)` (peek→fetch→`cacheBricksetSet`),
  `bricksetRetailEntry(bsCache, n)` (figure→base→`-0`→`-1` walk).
- `fetchBricksetSet` returns `data` carrying `.year` and `.pieces`.

### 2c. Does enrichment backfill YEAR onto rows? — **No, but it doesn't need to.**
`runBricksetEnrichment` (MyCollection.jsx:404-442):
- **Coverage guard** keys on `s.minifigs != null && s.pieces != null` (:408) — **not** year.
- **Caches the full `bsData`** (incl. `year`) to `bricksetSetCache` via `cacheBricksetSet(clean, bsData)`
  (**:424**) **before** the row-patch.
- **Row-patch writes only `minifigs` + `pieces`** (:429-430, comment "minifigs + pieces only") — year
  is never written to the collection row.

**Consequence:** `item.year` does **not** exist on owned rows, but `bricksetSetCache[brickset_<n>].data.year`
**does** (for every set that's been enriched). The panels read the **cache** (`bs`), so year is
available without extending the owned-set loop.

WantedList runs its **own** per-row mount enrichment (:367-411) calling `fetchBricksetSet` (:377) and
patching `minifigs/subtheme/age_min/rating/packaging_type` onto rows (:396-402) — but **not**
`releaseYear`/`pieces`. That's the one gap the WantedList cell still falls back to BE for.

### 2d. Read path the panels should use — **synchronous device-cache read** (established pattern)
The repo's established pattern is a synchronous `localStorage` read of `bricksetSetCache` at render
(SetDetailPanel's `bs`), **not** an on-mount `bsData` fetch. Recommend mirroring it. (An on-mount
`fetchBricksetSet` is the optional belt-and-suspenders for coverage — see §5.)

---

## 3. The swap map (per-site / per-field)

| Site | Field | From (BE) | To (Brickset) | Source of the read | Fallback |
|---|---|---|---|---|---|
| **SetDetailPanel** | pieces | `cached.pieces_count` | `bs.pieces` | **already in scope** (`bs`, :110) | `\|\| null` → chip/StatBox hidden |
| | releaseYear | `cached.year \|\| released_date` | `bs.year` | same `bs` | `\|\| null` → "—" |
| **WatchDetailPanel** | pieces | `cached.pieces_count` | `bs.pieces` | **NEW** `bricksetSetCache` read | `\|\| null` → chip hidden |
| | releaseYear | `cached.year \|\| released_date` | `bs.year` | same new read | `\|\| null` → chip hidden |
| **PurchaseDetailPanel** | pieces | `cached.pieces_count` | `bs.pieces` | **NEW** `bricksetSetCache` read | `\|\| null` → chip hidden |
| | releaseYear | `cached.year \|\| released_date` | `bs.year` | same new read | `\|\| null` → chip hidden |
| | **msrp** | `cached.retail_price_us` | `asNumber(bs.retail_price_us)` | same new read | `\|\| null` → MSRP chip + vs.MSRP box gate off (falls back to "Set Name" box) |
| **WantedList** ageMonths | year fallback | `e.data.year \|\| released_date` (:841) | `bs.year` (or `item.releaseYear` once loop-patched) | existing `getBricksetCache()` / loop | existing `if (!yr) return "—"` |
| **WantedList** pieces col | (already `item.pieces`) | — | populate `item.pieces` via loop | loop `bsData.pieces` | existing `? … : "—"` (:809) |

---

## 4. Build proposal (per site)

### Site 1 — SetDetailPanel.jsx — **cleanest; ~net-negative LOC**
- **Delete** the BE block :94-100 in full (it's used nowhere else — verified).
- **Add**, after the `bs` object is defined (:110):
  `const pieces = bs.pieces || null;` and `const releaseYear = bs.year || null;`
  (joining the existing `bs.subtheme/minifigs/rating/...` reads at :129-133).
- **Reads BE: 0.** ✅ Fully BE-free after this.

### Site 2 — WatchDetailPanel.jsx — **add a Brickset read; keep BE for value/D3**
- **Add** a `bricksetSetCache` read mirroring the existing BE block (parse
  `localStorage.getItem("bricksetSetCache")`, look up `bricksetSetCache["brickset_"+clean]`, unwrap
  `.data` → `bs`). Recommend reusing `getBricksetCache()` from `src/utils/brickset.js` rather than a
  raw parse.
- **Repoint** :33-34 → `pieces = bs.pieces || null;` `releaseYear = bs.year || null;`
- **Keep** the BE block for `marketValue` (:35) and `priceEventsFromBE(cached)` (:154) — **D3/value,
  out of this arc.**
- **Reads BE: metadata 0, value/chart unchanged.** ⚠️ Not fully BE-free until D3.

### Site 3 — PurchaseDetailPanel.jsx — **add a Brickset read; covers msrp too**
- **Replace** the BE block :26-30 with a `bricksetSetCache` read (`getBricksetCache()` → `brickset_<n>`
  → `.data` → `bs`).
- **Repoint** :31-33 → `pieces = bs.pieces || null;` `releaseYear = bs.year || null;`
  `msrp = asNumber(bs.retail_price_us) || null;`
- **msrp must be included** to make the panel BE-free (it's the same `cached` block); Brickset serves
  `retail_price_us` (§2a). All downstream gates already handle `null` gracefully (vs.MSRP box →
  "Set Name" fallback).
- **Reads BE: 0.** ✅ Fully BE-free after this.

### Site 4 — WantedList.jsx ageMonths cell — **two routes; prefer the loop extension**
- **Preferred:** extend the existing mount enrichment (after :402) with two lines —
  `if (bsData.year && !w.releaseYear) updates.releaseYear = String(bsData.year);`
  `if (bsData.pieces && !w.pieces) updates.pieces = bsData.pieces;`
  Then the cell's preferred branch (`item.releaseYear`, :837) fires from a Brickset-sourced row and
  the BE fallback at :841 is **dead → delete it**. Also fills the pieces column (:809) for rows
  missing `item.pieces`.
- **Alt (no enrichment change):** repoint the :841 fallback from `brickEconomySetCache` to
  `getBricksetCache()` (`brickset_<n>` lookup), reading `bs.year` only (drop the `released_date` half).
- **Field-name caution:** the cell reads **`item.releaseYear`** (camelCase). Write `releaseYear` (not
  `year`) so the cell's preferred branch matches. `item.pieces` is rendered with `.toLocaleString()`
  (:809), which expects a **Number** — `bsData.pieces` is a Number from the proxy; avoid `String()`
  coercion on the pieces write (the `year` write to a String is fine — it's only `Number(...)`'d).
- **Reads BE: 0** (for metadata). ✅

### Enrichment-extension verdict (task #3 flag)
- **MyCollection owned-set loop:** **no extension needed** — year is already in the device cache; panels
  read `bs.year`.
- **WantedList loop:** **optional** two-line extension (preferred route for site 4); the alt route
  needs no enrichment change.
- **Net: no *mandatory* enrichment extension.** One *recommended* two-line WantedList loop addition.

---

## 5. Coverage preconditions & risks

1. **Owned + wanted/watch sets are covered.** Both run on-mount Brickset enrichment that populates
   `bricksetSetCache` (MyCollection `runBricksetEnrichment`; WantedList :367-411). So SetDetailPanel,
   WatchDetailPanel, and WantedList read warm caches in normal use.
2. **Purchase-only sets are the one soft-spot.** Purchases get **no** enrichment (confirmed). A
   purchased set that was *never* owned/wanted may have a **cold** `bricksetSetCache` → pieces/year/msrp
   render "—". **This is the same coverage class BE had** (BE was only populated for synced sets), so
   it's not a regression — but for parity/robustness, optionally add an on-mount
   `fetchBricksetSet(item.setNumber)` to PurchaseDetailPanel (mirrors WatchDetailPanel's on-mount BL
   fetch). Decision point for the reviewer.
3. **WatchDetailPanel "watch" items** rendered outside WantedList's enrichment scope could also be cold
   → "—". Same optional on-mount `fetchBricksetSet` mitigation.
4. **`released_date` has no Brickset equivalent** — drop that fallback branch everywhere; use `bs.year`.
5. **Key normalization:** the BE reads use raw `setNumber` + `/-1$/`-strip; the Brickset cache is keyed
   `brickset_<n>` (verbatim). New reads must apply the `brickset_` prefix; reuse `getBricksetCache()` /
   the `bricksetRetailEntry` walk rather than hand-rolling lookups.
6. **`bs.pieces` type:** Number from the proxy → safe for `.toLocaleString()`. Don't `String()`-coerce
   on the WantedList pieces write.

---

## 6. Q4 — does this remove the last non-D3 BE consumer? (full census)

Every non-test `brickEconomySetCache` reader in `src/`, classified:

| Reader | Lines | Class | Touched by this arc? |
|---|---|---|---|
| SetDetailPanel | 95 (→99-100) | **metadata** | ✅ removed |
| PurchaseDetailPanel | 27 (→31-33) | **metadata** (incl. msrp) | ✅ removed |
| WatchDetailPanel | 29 (→33-34) | **metadata** | ✅ removed |
| WatchDetailPanel | 35, 154 (`priceEventsFromBE`) | **D3** (marketValue + trend) | ⛔ stays → D3 |
| WantedList | 841 | **metadata** (ageMonths) | ✅ removed |
| WantedList | 345 | value/forecast load | machinery (out of scope) |
| WantedList | 1147/1149, 1247/1255 | Research-lookup value fetch/write | machinery |
| MyCollection | 804/812, 1184 | form auto-fill / BE-sync write | machinery |
| BudgetDashboard | 976/984 | form auto-fill write | machinery |
| AppSettings | 491/492, 653 | backup restore / CSV export | machinery/backup |
| `beSyncValues.js`, `priceEvents.js`, `safeStorage.js`, `enrichmentCache.js`, `exportBackup.js`, `enrichmentSnapshot.js` | — | cache def / registry / backup plumbing | machinery |

**Result:** after this swap, the **only** remaining `brickEconomySetCache` *display* reads are
WatchDetailPanel `:35` (marketValue) and `:154` (price-history chart) — **both the D3 bucket**
(unowned-watch coverage problem; same root cause as the trend chart). Every other reader is **machinery**
(write-on-add, sync, backup, registry), not a render consumer, and the value-fallback for the 2 frozen
promos reads `brickEconomyNormalizedCollection` (the owned store), **not** this cache.

So: **YES — this metadata swap removes the last non-D3 BE display consumer.** After it **+ D3** (which
repoints WatchDetailPanel's marketValue and chart off BE), **no component reads `brickEconomySetCache`
for display**, and the machinery (form-fill writers, `beSyncValues`, the `api/brickeconomy-set.js`
proxy + key) can be torn down per [`be-removal-plan.md`](be-removal-plan.md) §3 Phase 3 — D1 (promos
frozen, reads the store) and D2 (forecasts dropped) already being complete.

---

## 7. Recommended sequence (for the build phase, when approved)

1. **SetDetailPanel** — the freebie; `bs` is already in scope (lowest blast radius, do first).
2. **PurchaseDetailPanel** — add the `bricksetSetCache` read; swap pieces/year/**msrp**; decide on the
   optional on-mount fetch (§5.2).
3. **WatchDetailPanel** — add the `bricksetSetCache` read; swap pieces/year **only**; leave the BE
   block for marketValue + chart (D3).
4. **WantedList** — extend the loop with the two `releaseYear`/`pieces` lines; delete the :841 BE
   fallback.
5. Lint + `npm test` (CI "verify"); confirm no remaining `brickEconomySetCache` metadata read via the
   §6 census grep.

---

*Probe integrity: read-only — no code changed, no writes to localStorage or Redis. Line numbers from
files opened 2026-06-12. This doc is uncommitted and review-gated.*
