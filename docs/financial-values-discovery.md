# Three Financial Values — Discovery Note

**Date:** 2026-06-02 · **Status:** discovery only, no code changes
**Goal:** a per-item view of **Retail (MSRP) / What I Paid / Current Market** across Collection, Budget, and Wanted List.

---

## Verdict

**MSRP is already in the data and the source is already wired — this is mostly a display/plumbing job, not a new integration.**

The task brief assumed `BRICKSET_API_KEY` might be a dormant key. It is not: Brickset is a **fully wired, contract-tested integration** (three proxies, real key in `.env.local`, 6 captured fixtures). On top of that, retail/MSRP figures already exist in two other places (the BrickEconomy cache and the imported normalized collection). None of the three values requires a *new* external source. The work is: pick the canonical retail source, carry it through the value model as a distinct kind, and surface all three per item.

### Exact source for each value

| Value | Canonical source today | Where it lives | Per-item ready? |
|---|---|---|---|
| **Retail (MSRP)** | Brickset proxy `retail_price_us` (+ regional) — already wired; **also** present as BrickEconomy cache `retail_price_us` and as CSV-imported `retailPrice`/`totalRetailPrice` on the normalized set | `bricksetSetCache`, `brickEconomySetCache`, normalized collection | Yes — display exists, see §3 |
| **What I Paid** | `totalPaid` / `paidPrice` per set, `entries[].paid_price` per copy; `blPurchases` ledger is a separate transaction log | normalized collection + `blPurchases` | Yes — `setCost()` rollup, already shown |
| **Current Market** | BrickLink overlay (preferred) → BrickEconomy fallback, via `setValueProvenance()` | `valueMap` (`/api/values`) + cache | Yes — `formatValueCell()` |

---

## 1. MSRP/retail in the stored data — yes, three populated paths

**a) Imported normalized collection** (`brickEconomyNormalizedCollection`, synced to Upstash):
- `retailPrice` — per-copy average (`src/AppSettings.jsx:146`)
- `totalRetailPrice` — cumulative across copies (`src/AppSettings.jsx:126`)
- Derived at import from CSV `retail_price` / `Retail` (`src/AppSettings.jsx:134`).
- **Population:** in the `collection.json` sample, `retail_price > 0` on **484 / 570 unique sets (~85%)**; ~15% blank/zero.

**b) BrickEconomy set cache** (`brickEconomySetCache`): `retail_price_us` (+ `_uk/_ca/_eu/_au`) present on essentially every cached set. Already used as a value *fallback* in `beValueForCondition()` (`src/utils/beSyncValues.js:24`).

**c) Brickset set cache** (`bricksetSetCache`): `retail_price_us`/`_uk`/`_ca`/`_de`, field-selected from `LEGOCom.{region}.retailPrice` in `api/brickset-set.js:113-116`.

The per-user Upstash blob carries (a) — it's part of the normalized collection in `BACKUP_KEYS`. The caches (b, c) are device-local, not synced.

---

## 2. Brickset integration — wired, not dormant

`BRICKSET_API_KEY` is actively read by three proxies that follow the repo's integration standard (shared `_auth` / `_ratelimit` / `_cors` / `fetchWithTimeout`, field-select, typed error envelope):

- `api/brickset-set.js:43` — set lookup → 28 selected fields incl. regional retail prices
- `api/brickset-search.js:29` — catalog search (maps `LEGOCom.US.retailPrice` → `msrp`)
- `api/brickset-themes.js:26` — theme list

Client utils in `src/utils/brickset.js` (`fetchBricksetSet`, `searchBricksetCatalog`, `fetchLegoThemes`), cached 7d in `bricksetSetCache`. Contract-locked by `src/utils/brickset.contract.test.js` + 6 fixtures in `test-data/brickset-fixtures/`. Real key present in `.env.local`.

**Where MSRP comes from today:** the detail chip (see §3) reads `retail_price_us` from the **BrickEconomy** cache, not Brickset. Brickset's richer/official MSRP is fetched and cached but the value chip doesn't yet prefer it — so the canonical-source choice for the build is open (recommend Brickset as the official figure, BE as fallback).

---

## 3. Where retail/MSRP already shows (the "already there for one" case)

- **SetDetailPanel** (My Collection → set detail): an **"MSRP $XX" chip** at `src/SetDetailPanel.jsx:156`, fed by `cached.retail_price_us` from `brickEconomySetCache` (`SetDetailPanel.jsx:60-67`). Note: the same panel reads `bricksetSetCache` separately (`:72-82`) but only for retirement/subtheme/rating/exit-date — **not** for the MSRP number.
- **My Collection "Retail Value" card** (`src/MyCollection.jsx:1235`), aggregate `totalRetailPrice → retailPrice → msrp×qty` (`MyCollection.jsx:447`). **Hidden by default**; opt-in via Settings.

For contrast: **Market** shows in SetDetailPanel "Market Value" (`:162`, via `setValueProvenance`); **Paid** shows as the "Cost Basis" / "Avg Paid / Copy" boxes (`:161`, `:166`) and the default "Paid" column in the table.

So **Collection** already has all three at the detail level; Budget and Wanted List do not yet show retail per item in the same triptych.

---

## 4. Cost basis ("what I paid")

- **Per set:** `totalPaid` (qty-adjusted) or `paidPrice × qty`, rolled up by `setCost()` (`src/utils/portfolio.js:258`). Feeds `setGain` / `setROI` (ROI eligible only when cost > 0 **and** value known).
- **Per copy:** `entries[].paid_price` (`entryPaid()`, `SetDetailPanel.jsx:8`) — copies can differ.
- **Budget ledger:** `blPurchases` is a separate ~15-field transaction log keyed by `setNumber` (`faceValue`, `tax`, `shipping`, `gcApplied`, `cashPaid`, `store`, `date`…). **It does not auto-roll into the collection's per-set cost** — collection `paidPrice`/`totalPaid` is entered/synced independently. (Worth noting for the build: "what I paid" has two non-reconciled homes.)
- **Surfaced per set?** Yes — "Paid" column (default), "Cost Basis" card, per-copy breakdown.

---

## 5. Value-model fit — room exists, but retail is a different *kind*

Provenance shape (`src/utils/value.js:46-57`, produced by `setValueProvenance()`):

```
{ amount, source, condition, basis, asOf, lots, confidence? }
  source : 'bricklink' | 'brickeconomy' | 'brickset' | null   (open string, no enum gate)
  basis  : 'retail' | 'market' | 'unknown' | BL bases ('sold'|'sold_thin'|'modeled'|'asking'|'mixed')
```

The model **already anticipates retail**: `deriveBasis()` returns `'retail'` for `source:'brickset'` (`value.js:89-94`), and `retailTooltip()` (`valueDisplay.js:94`) labels a `basis:'retail'` figure so it isn't mistaken for market. Docs (`valuation.md`, `value-source-decision.md`) call Brickset MSRP "rung 5" — a brand-new/no-sold fallback that is **not yet wired**.

**Recommendation for the build:** treat Retail as a **parallel value of a different kind**, not a competitor inside the BrickLink→BrickEconomy market waterfall. The waterfall works because its members are commensurate *market* estimates; MSRP is a historical sticker price.

- Fits cleanly: `amount`, `source:'brickset'`, `basis:'retail'`, `asOf` (use Brickset release date, not "now").
- Does **not** apply: `condition` (one MSRP, no new/used split → `null`), `lots` (`null`), `confidence` (absent).
- For a per-item Retail/Paid/Market triptych, carry retail as its **own read** alongside `setValueProvenance()` (e.g. a `setRetailProvenance()` returning a `basis:'retail'` Value), rather than extending the market precedence. No structural change to the Value type is required — the fields already exist; only the read path and the three-up display are new.

---

## Build implication (one line)

**Display/plumbing job, not a new integration:** all three numbers exist (Retail via the already-wired Brickset proxy — choose it as canonical, BE as fallback; Paid via `setCost`/`blPurchases`; Market via `setValueProvenance`). Remaining work is a canonical-retail read carried as `basis:'retail'`, plus the per-item three-up surface extended from Collection into Budget and Wanted List.
