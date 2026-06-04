# BrickLedger — Value-Source Decision Record

> **Status:** DECIDED (value source). Net-additive doc — no code changed.
> **Date:** 2026-06-01. **Decides:** which external source is the canonical *current market value*.
> **Supersedes:** the BrickEconomy-as-value-source framing in [`docs/valuation.md`](valuation.md)
> (§"The value sources", "Canonical current-value source") and [`docs/value-layer-plan.md`](value-layer-plan.md).
> Those docs are **not yet rewritten** — full reconciliation is a build-time task (see §"Deferral").
>
> **Evidence artifacts** (all produced before this record, reproducible, no secrets):
> - [`docs/evidence/bl-coverage-full.csv`](evidence/bl-coverage-full.csv) — 600 sets, sold/new + sold/used, committed alongside this doc as durable evidence.
> - `outputs/bl-coverage.csv` — the 50-set pilot sample (local).
> - `outputs/pricecharting-import.txt` / `pricecharting-comparison.csv` — the PriceCharting comparison build (local).
> - `scripts/bl-price-test.mjs`, `scripts/bl-coverage-check.mjs` — throwaway BrickLink tooling (local; `oauth-1.0a` installed `--no-save`, to be added properly when the batch-refresh is built).
> - **Source collection:** `~/Downloads/brickledger-backup-2026-05-28(1).json` (exportedAt `2026-05-28T18:11:02.903Z`), 600 unique sets / 772 copies. **Region/currency:** all calls `currency_code=USD`; sold = BrickLink *global* sold; the stock rung will use `country_code=US`.

---

## 1. Decision

**BrickLink's 6-month *sold* average is BrickLedger's canonical current-market-value source, for both new and used.** It is the only source we tested that is real transaction data, independently fetchable, free, and empirically deep: among the 490 real boxed sets in the collection, **88.8% (435/490)** have a healthy (≥10-lot) sold/new history, median **53 lots** per healthy set. **BrickEconomy is out** as the value source (it is a non-independent aggregate that we found uncalibratable against real sold data — median **+23.5%** on new, **+18.3%** on used, with a systematic **~2.6× polybag overvaluation**; §4). **PriceCharting is out** for Phase 1 (its only advantage was used-price coverage, which we can fill for free with a modeled multiplier — rung 2, §3 — at a quality the data supports; §4). Rationale in §4; what happens to existing BE data and the one open trade-off in §6.

---

## 2. Source map

Each *field* is owned by the strongest source for that field; where two sources overlap, the rule is **stronger source per field**, not "one source per row."

| Field | Source | Notes |
|---|---|---|
| Current market value — **new & used** | **BrickLink sold** (6-mo avg) | The decision of this record. Per-copy resolution ladder in §3. |
| MSRP / retail price | **Brickset** | Official sticker price; also the brand-new-no-sold fallback (rung 5). |
| Release & retire dates, availability | **Brickset** | Drives retirement basis (market vs retail) and countdowns. |
| Official set metadata (name, theme, year) | **Brickset** | Catalog identity. |
| Total piece count | **Rebrickable** | Authoritative parts data. |
| Minifigs-per-set count | **Rebrickable** | Authoritative; also the Phase-2 CMF mapping spine (§5). |
| Minifig (CMF) value | **BrickLink MINIFIG endpoint** | **Phase 2** (§5). The SET endpoint is wrong for CMFs (§4). |

> **Brickset ↔ Rebrickable overlap** (both carry name/theme/year/pieces/minifig counts) is resolved by *stronger source per field*: **Brickset** for catalog identity + dates + retail; **Rebrickable** for piece/minifig counts and the CMF ID map. No field is sourced twice.

---

## 3. Value model — per-copy resolution ladder

Each owned **copy** is valued at its own condition by walking this ladder top-down; the first rung that resolves wins. Each rung carries a **provenance basis** and a **confidence** tier (to surface in the UI per the Workstream A discipline).

| # | Rung (condition / situation) | Resolution | Basis | Confidence |
|---|---|---|---|---|
| 1 | **Healthy sold** (lots ≥10) | Direct BL `sold/new` or `sold/used` **`avg_price`** (the conventional 6-mo price-guide average; matches the §4 evidence) | `sold` | **high** |
| 2 | **Used copy; used sold thin but new healthy** | **0.75 × BL new sold** (global multiplier; optional per-theme refinement below) | `modeled` | **estimate** |
| 3 | **Sparse sold** (lots 1–9) | BL sold average, **flagged thin** | `sold-thin` | **low** |
| 4 | **Both sold thin/absent** | BL **stock _lowest_** (US, `guide_type=stock&country_code=US`) — *never* the stock *average* (that's an asking price and overstates) | `asking` | **low** |
| 5 | **Brand-new, no sold history** | Brickset **MSRP** | `msrp` | (retail) |
| 6 | **Nothing resolves** | **unknown — flagged, never faked** (Workstream A $0-vs-unknown discipline: unknown is `null` → "—", never `$0`) | `unknown` | — |

**Rung 2 — optional per-theme refinement.** The global 0.75 is the headline multiplier (§4). For a cheap accuracy bump, substitute the theme's measured median used/new (n≥3 themes):

| Theme | n | median used/new |
|---|--:|--:|
| Star Wars | 55 | 0.749 |
| Harry Potter | 11 | 0.713 |
| Icons | 8 | 0.822 |
| Marvel Super Heroes | 5 | 0.745 |
| BrickHeadz | 5 | 0.597 |
| Speed Champions | 3 | 0.631 |
| Indiana Jones | 3 | 0.800 |
| City | 3 | 0.676 |
| Ideas | 3 | 0.799 |

Star Wars (the largest bucket, 55 of 103) lands on the global 0.749, so the global constant is safe; the refinement mainly helps the cheap-small (BrickHeadz 0.60, Speed Champions 0.63) and large-display (Icons 0.82) tails.

---

## 4. Evidence

All figures from the runs and `docs/evidence/bl-coverage-full.csv` (600 sets, two sold calls each), the 50-set pilot, and the derived ratio/outlier analyses.

### New-side coverage — BrickLink is deep
- **Full run, real sets (490, excluding the 110 CMF/errors):** healthy (≥10) **435 = 88.8%**, sparse (1–9) **53 = 10.8%**, no-sales (0) **2 = 0.4%**.
- **Headline including CMF errors (600):** healthy 435 (72.5%), sparse 53 (8.8%), no-sales 2 (0.3%), error/not-found 110 (18.3%) — the 18.3% is entirely the CMF artifact (§5), not thin sold data.
- **Median sold/new lots among healthy sets = 53** (50-set pilot: 78). Deep, liquid history.
- **Pilot (50 random) cross-check:** healthy 84.0%, sparse 8.0%, no-sales 0, error 8.0% — consistent; among real sets the pilot's healthy rate matches the full run.
- The only two no-sales/new are `71049-4` (McLaren — a CMF-series SET variant) and `76304-1` (Batman Forever Batmobile — a 2025 set too new to have new sold history).

### Used-side coverage — why a fallback is required
By `lots_used`, real sets only (110 errors excluded):
- **All real (490):** healthy **104 = 21.2%**, sparse **297 = 60.6%**, no-sales **89 = 18.2%**.
- **Used-owned subset (be_used_value present, 211):** healthy **52 = 24.6%**, sparse **128 = 60.7%**, no-sales **31 = 14.7%**.

Only ~**¼** of used-owned sets have trustworthy (≥10-lot) used sold history; ~**61%** are sparse (noisy single-digit averages) and ~**15%** have zero. BL used data alone cannot value the used half — hence rung 2.

### The used/new multiplier — tight enough to model for free
Sets with **both** sold samples ≥10 lots (n=**103**), ratio = `bl_sold_used_avg / bl_sold_new_avg`:
- **median 0.746**, **p25 0.689 / p75 0.802** (IQR width **0.113**), min **0.474** / max **1.233**.
- **73.8% (76/103)** fall in the tight band **0.5–0.8**; **98.1% (101/103)** in 0.4–0.9; **0** below 0.4, only **2** above 0.9.

A ±0.06 IQR around 0.75 → a fixed **used ≈ 0.75 × new** multiplier is well-supported. This is what makes PriceCharting unnecessary for the used gap.

### The BrickEconomy verdict — uncalibratable, so out
BE value ÷ BL sold average, full run:
- **be_over_bl_new** (n=314): **median 1.235**, range **0.057–2.660**.
- **be_over_bl_used** (n=180): **median 1.183**, range **0.048–5.560**.

The median bias (BE ~18–24% high) could in principle be corrected by a constant — but the **range is too wide to calibrate**: a single multiplier that fixes the median leaves individual sets off by multiples in both directions. Worse, the divergence is **non-random**: BE **systematically overvalues polybags ~2.6×** on well-traded sets — `30716-1` 2.601 (BE 8.99 vs BL 3.46, 51 lots), `30723-1` 2.622 (11.40 vs 4.35, 97 lots), `30675-1` 2.660 (10.96 vs 4.12, 121 lots). A source you must correct per-category, with residual per-set error, is not a value source.

### The outlier analysis — the median comparison is clean
Of the 27 ratio extremes (`<0.2` or `>2.5`):
- **Low end (13)** are **all `71xxx` CMF `-2` variants** — an **identity mismatch**: BE holds a single minifigure (~$3–13) while BL's `SET 71xxx-2` is the complete/sealed box (~$45–100). Different items, not a BE valuation error (e.g. `71052-2` 0.104 with 304 BL lots).
- **High end (14)** are **thin BL data** (8 have ≤2 used lots — a single cheap/incomplete sale, e.g. `60436-1` City Advent Calendar 5.560 on 1 lot) plus the polybag overvaluation above.
- **9 of 27** have ≤2 BL lots. None are real BE *failures* — the extremes are explained by mismatch/noise, which is why the **median** BE-vs-BL comparison above is trustworthy as a verdict.

### CMF artifact
- **110 errors** = **108 `71xxx-N` CMF entries** (series 71034–71052, suffixes `-3 … -18`) + **2 long-numeric promo IDs** (`6490363-1`, `6550806-1`).
- These are minifigures, not boxed sets: the SET endpoint returns 404 for most, and for the few that resolve (the `-2` variants) it returns the **wrong full-box price**, to be **discarded** — never used as a set value.

---

## 5. CMF scope — defer to Phase 2

- **Phase 1** values the **461 boxed sets** on the ladder in §3.
- **Phase 2** adds minifigure valuation: map the BrickLedger/Rebrickable CMF identity (e.g. `71045-12` → BrickLink `col###` minifig id) and value via the **BrickLink MINIFIG endpoint**, not SET.
- **CMF skip rule (precise).** The refresh batch (`scripts/refresh-values.mjs`) defers a set to Phase 2 iff `theme === "Minifigure Series"` (**137** entries) **or** it is one of the **2 long-numeric promo IDs** (`6490363-1`, `6550806-1`) — **139 deferred**, leaving **461 Phase-1 boxed sets** (600 − 139). The theme signal is data-driven and generalises to future runs (no fragile per-series suffix ranges); the 2 promo IDs are themed `Seasonal`, so they're skipped by explicit id.
- **§4 ↔ §5 reconciliation.** The **461** (not the earlier loose "~490", which was just 600 − the 110 SET-endpoint errors) reflects that the **27** minifig-series sets which *do* resolve on the SET endpoint are deferred too — per §4 their SET price is the **wrong full-box price** for a minifig and must never be used as a set value.
- **Rationale:** CMFs are ~**23% of item count** (139/600) but a small share of portfolio *dollars*, and correct valuation needs an **ID-mapping sub-project** (Rebrickable minifig IDs ↔ BL `col` ids). Not worth blocking Phase 1.

---

## 6. What's out (and what we keep)

- **BrickEconomy — out as the value source.** Existing `source:"BrickEconomy"` values are **DEMOTED to historical/fallback provenance, NOT deleted.** The funnel prefers BL; BE remains a last-resort/historical reading so nothing regresses to "unknown" that previously had a number.
- **BrickEconomy — also out as a RETAIL source (Retail Phase 3c).** The retail/MSRP ladder (`RETAIL_SOURCE_ORDER` / `setRetailProvenance` in [`src/utils/portfolio.js`](../src/utils/portfolio.js)) is now **Brickset → manual only** — BE was removed because it overvalues polybags ~2.6× (§4) and is not a trustworthy sticker price. The residual Brickset's API has no RRP for (the 71034 CMF series + ~50 polybags + occasional gaps) resolves to **"—"**, hand-fillable via the edit-form MSRP rung now, and reclaimable wholesale by a future Brickset site-scrape source (see [`backlog.md`](backlog.md)). BE keeps its VALUE-fallback role untouched.
- **OPEN DECISION — BE trend / `price_events`.** BE's dated `price_events_*` / forecast trend has **no BrickLink equivalent**; dropping BE silently loses it. This is a **build-time decision, not a silent loss.** Three options on record:
  1. **Keep BE solely for `price_events`/trend** (value comes from BL; BE used only for the history chart).
  2. **Build our own history** by snapshotting BL sold averages on each refresh (owned data, no BE dependency; starts empty, accrues forward).
  3. **Drop trend** entirely (accept the feature loss).
  → Decide during the build; do not let the source switch erase trend by default.
- **PriceCharting — not adopted.** Its only edge was used-price coverage, fillable free via rung 2. **Could return later** as an *optional eBay reality-check layer* (a second independent sold signal), not as the primary source.

---

## 7. Stated assumptions & caveats

- **The 0.75 multiplier is calibrated on dense-used sets** (both samples ≥10 lots, n=103) and **assumes thin-used sets behave the same.** Reasonable given the tight distribution, but it is an assumption, not a measurement of the thin sets themselves.
- **Modeled used inherits BL new as ground truth** (rung 2 is `0.75 × BL new`). That leans on the new side being healthy — which it is (**88.8%**) — so the dependency is sound, but errors in a set's new average propagate to its modeled used.
- **Stock values are *asking* prices and overstate market.** Rung 4 uses the **lowest** US listing and treats it as a **floor**, not a fair value, and is tagged `asking`/low-confidence.
- **Region/currency basis:** all figures are **USD**; sold is BrickLink **global** sold (deepest sample); the stock rung is scoped **US** (`country_code=US`). Mixing global-sold with US-stock is acceptable for a low-confidence floor but should be noted in the UI provenance.

---

## 8. Open items for the build — STATUS (built 2026-06-02)

The value layer **shipped** as a read-time overlay (status detail in [`docs/valuation.md`](valuation.md) / [`docs/roadmap.md`](roadmap.md)). Where each build item landed:

1. ⏳ **Static egress IP / VPS** — **STILL OPEN.** The one batch run was manual from a dev machine; productionizing a scheduled run on a static-egress VPS is the main remaining item.
2. ✅ **Batch refresh + cache** — [`scripts/refresh-values.mjs`](../scripts/refresh-values.mjs) (~300 ms/call throttle) writes `value:SET:{n}` + `history:SET:{n}` to Upstash. Pure ladder in [`scripts/lib/deriveValue.mjs`](../scripts/lib/deriveValue.mjs). *Schedule/automation = item 1.*
3. ✅ **Funnel wiring** — `setValueProvenance`/`blOverlayValue` ([`src/utils/portfolio.js`](../src/utils/portfolio.js)) prefer the BL cache, BE fallback; read via [`api/values.js`](../api/values.js) → [`src/utils/valueCache.js`](../src/utils/valueCache.js). Non-destructive (read-time only).
4. ✅ **Provenance basis tags + confidence in the UI** — `valueConfidence`/`lotsLabel` ([`src/utils/valueDisplay.js`](../src/utils/valueDisplay.js)): `sold` (clean) / `sold_thin` / `modeled` / `asking` / `unknown` + the "% estimated" aggregate. (`msrp`/rung-5 not wired — item below.)
5. ➖ **`asOf` sync-write guard** — **N/A for the overlay**: values are a read-time projection, never written back to the synced record, so there's no stale cross-device overwrite to guard. (`asOf` is carried on each value for display/freshness.)
6. ⏳ **Trend decision (§6)** — **STILL OPEN.** Trend still reads BE `price_events_*`; `history:SET:{n}` snapshots now accrue toward option 2 (owned BL history).
7. ✅ **BL tooling deps** — `oauth-1.0a` + `@upstash/redis` are in `package.json` (no more `--no-save`); `scripts/refresh-values.mjs` is maintained tooling.

**Also still open:** **CMF Phase 2** (§5) — the 139 minifig/promo sets are skipped and render as unmarked BE-fallback; **Brickset MSRP rung 5** (brand-new/no-sold stays `unknown`).

---

## Deferral — RESOLVED (2026-06-02)

This record decided the **source**; the build-time reconciliation it deferred is **done**.
[`docs/valuation.md`](valuation.md) and [`docs/value-layer-plan.md`](value-layer-plan.md) have been
rewritten to describe the shipped read-time overlay (BrickLink preferred, BE demoted to fallback) and
now point at the code that backs each claim — see §8 above for the build-item status. This record stays
authoritative on **why** BrickLink (the investigation, §1–§7); the live spec is `valuation.md`.
