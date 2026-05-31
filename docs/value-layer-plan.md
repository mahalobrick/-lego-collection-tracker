# Value Layer — Diagnostic & Phase Plan

> **Status:** DIAGNOSTIC ONLY (no code changed). Foundation for the price-drop feature.
> **Date:** 2026-05-30. **Arc:** opens after the audit-remediation arc closed at `b02eed7`.
> **Value spec:** [`docs/valuation.md`](valuation.md) — the ratified valuation spec (formerly the
> missing `data-sources.md`; see Blocker 0). This doc is the build plan against it; treat its
> "Target" column as the proposal shaped to that spec.

---

## 0. RESOLVED — the spec doc now exists

This was originally framed as "align the code to `docs/data-sources.md`", which did not exist. That
blocker is now **resolved**: the value spec was written as [`docs/valuation.md`](valuation.md)
(the `data-sources.md` name is retired). §1–§2 below were promoted into it, so the "Target"
definitions (condition split, confidence taxonomy, retail-basis/unknown display) are now ratified
spec, not loose proposal.

Historical note: §1 was reconstructed from the *real BrickEconomy API response* plus the three
questions in the originating task; [`docs/valuation.md`](valuation.md) carries those forward as the
canonical contract.

---

## 1. API verification — what BrickEconomy *actually* returns

Resolved against **live API calls** (key from `.env.local`, endpoint `GET /api/v1/set/{num}?currency=USD`),
not assumption. Probed 5 sets spanning the lifecycle: at-retail, exclusive, and long-retired.

### 1a. The open question: separate new/used values?

**Yes — but conditionally, and the split is keyed on `retired`.**

| Set | `availability` | `retired` | `current_value_new` | `current_value_used` | used band | `price_events_*` | growth |
|-----|----------------|-----------|---------------------|----------------------|-----------|------------------|--------|
| 10300-1 (BTTF, at retail) | retail | *(absent)* | 199.99 (= retail) | **absent** | absent | absent | absent |
| 75192-1 (UCS Falcon '17) | exclusive | *(absent)* | 849.99 (= retail) | **absent** | absent | absent | absent |
| 21322-1 (Barracuda Bay) | retaillimited | **true** | 372.20 | **298.99** | 265.00 / 355.99 | present | present |
| 75313-1 (AT-AT) | exclusive | **true** | 1393.40 | **821.37** | 672.30 / 1020.41 | present | present |
| 10179-1 (UCS Falcon '07) | retail | **true** | 2659.83 | **1203.32** | 1120.00 / 1443.98 | present | present |

**Findings:**
1. `current_value_new` is **always present**. For sets still at primary retail it simply **mirrors
   `retail_price_us`** — it is *not* a secondary-market value, it's the sticker price.
2. `current_value_used` (+ `current_value_used_low` / `current_value_used_high` band) appears **only
   when `retired: true`** — i.e. only when a secondary market exists. The split the code assumes is
   real, but absent for ~half the lifecycle.
3. The homepage's single blended "Value" is a **BrickLedger invention**, not from the API. The API
   never blends; `beValueForCondition()` averages new+used client-side for `mixed`/null condition.

### 1b. Is there an estimated/listed-vs-sales-derived flag?

**No explicit boolean.** But the source/confidence is *derivable* from fields the API does return:

- **`retired` (+ `retired_date`)** — the primary signal. `retired:true` ⇒ `current_value_new` is
  sales-derived (real secondary market). Absent ⇒ "value" is just retail price (NOT a market value).
- **`current_value_used_low` / `_high`** — an explicit spread band = uncertainty signal for used.
- **`price_events_new[]` / `price_events_used[]`** — dated observation points (the *actual*
  sales-derived evidence). Presence ⇒ value is backed by observations; absence ⇒ it is not.
- **`rolling_growth_lastyear` / `rolling_growth_12months`** — present only with price history.

> **Conclusion:** the "confidence flag" the value layer needs should be **derived** (`retired` +
> presence of `price_events_*` + the used band), not read from a single API field. A still-retail
> set's `current_value_new` must be tagged **"retail price, not market value"** — this is the
> highest-value correction the layer can make.

### 1c. Full observed response schema

```
ALWAYS:   set_number, name, theme, (subtheme), year, pieces_count, minifigs_count, minifigs[],
          availability, retail_price_{us,uk,ca,eu,au}, (ean, upc), released_date,
          current_value_new, forecast_value_new_2_years, forecast_value_new_5_years, currency
RETIRED:  retired:true, retired_date,
          current_value_used, current_value_used_low, current_value_used_high,
          rolling_growth_lastyear, rolling_growth_12months,
          price_events_new[{date,value}], price_events_used[{date,value}]
```

Note: all forecasts are **new-condition only** (`forecast_value_new_*`). No used forecast exists.

### 1d. Deferred to V4 (BrickLink — needs API access not yet wired)

The BrickLink-side questions (sold vs. listed/asking split, 6-month sales avg, currency normalization,
how BL "current items for sale" relates to BE used value) **wait on BrickLink API access** and are
**deferred to V4**. `src/utils/bricklink-client.js` + `api/bricklink-priceguide.js` exist but are not
exercised by the value layer today; `blPriceNew`/`blPriceUsed` appear in the price-history schema but
no live BL value flows into the portfolio rollup. Verify against the real BL price-guide response
before designing the BL condition/source split.

---

## 2. Gap report — current implementation vs. the target shape

Ranked by (effort × risk). The recurring root cause: **value is stored as a bare number, stripped of
its source, condition, and timestamp the moment it lands on a set.**

### 2a. Is value stored with source / condition / timestamp, or as a bare number?

**Bare number.** `applyCache()` (`src/utils/beSyncValues.js:39-66`) writes `currentValue` /
`totalValue` as plain numbers onto each set. Provenance *exists upstream* —
`brickEconomySetCache[key].fetchedAt` (a timestamp) and the raw `data` blob — but it is **discarded**
at the point of assignment. Once written, a `currentValue` of `298.99` carries no record of: which
condition produced it, whether it came from `current_value_new` / `current_value_used` / a blend /
or a retail-price fallback, and as-of when. This is the structural gap the whole layer must close.

### 2b. Are new/used ever merged?

**Yes — deliberately.** `beValueForCondition()` (`beSyncValues.js:15-25`):
- `mixed` or null condition → `(vNew + vUsed) / 2` — a synthetic average that corresponds to **no
  real market price**.
- This blended number then flows into `currentValue` → portfolio `value` rollup
  (`MyCollection.jsx:400`) → ROI / gain-loss. The blend is invisible downstream.

### 2c. Does anything treat a listed/asking/retail price as value?

**Yes, in two places** — the headline correctness gap:
1. `beValueForCondition()` fallback: `if (!vNew && !vUsed) return asNumber(d.retail_price_us)`
   (`beSyncValues.js:18`). For at-retail sets the *real* response has `current_value_new == retail`
   anyway, so the portfolio silently values unowned-appreciation sets at **sticker price** and labels
   it "current value."
2. Set add/lookup seeds value straight from retail: `currentValue: bsData.retail_price_us ? ...`
   (`MyCollection.jsx:633`) and again at `:664`. A freshly-added set's "value" **is its MSRP** until
   a BE sync overwrites it — and if BE only has `current_value_new == retail`, it never diverges.

### 2d. Gap table

| # | Gap | Where | Effort | Risk | Notes |
|---|-----|-------|--------|------|-------|
| G1 | Value stored as bare number — no {source, condition, asOf} | `beSyncValues.js:50-61`, all `currentValue` writes | **High** | **High** | Touches the 36+22+19 currentValue/totalValue sites across MyCollection/WantedList/AppSettings. Schema change → migration. |
| G2 | Retail price treated as current value | `beSyncValues.js:18`, `MyCollection.jsx:633,664` | Med | **High** | Most user-visible correctness bug. Needs the §1b "retail, not market" tag to fix cleanly. |
| G3 | new/used blended into a synthetic average | `beSyncValues.js:19-21` | Low | Med | Cheap to stop blending; harder to decide what to show instead (split vs. condition-driven single). |
| G4 | Used band (`_low`/`_high`) ignored | never consumed | Low | Low | Free confidence signal currently dropped. |
| G5 ✅ RESOLVED | ~~BE `price_events_*` ignored; app keeps its **own** `blPriceHistory` snapshots~~ — closed by the price_events migration (§5): `priceHistory.js` deleted, chart reads `price_events_*` via `priceEventsFromBE`. | (was `priceHistory.js`) | Med | Med | History now comes from the API's real dated observations. The price-drop feature (at-retail) still awaits V4/BrickLink — `price_events_*` are retired-only. |
| G6 | `retired`/`retired_date`/`rolling_growth_*` not used in valuation | partially shown in detail panels only | Low | Low | `retired` is the key confidence discriminator (§1b) yet never gates valuation. |
| G7 | Forecasts stored but unanchored | `SetDetailPanel.jsx:65`, `WantedList.jsx:1213`, etc. | Low | Low | `forecast_value_new_*` stored as bare numbers too; same provenance gap as G1, lower stakes. |

### 2e. Where the code already matches

- Condition→field routing exists and is basically correct (`new/sealed→new`, `used*→used`).
- Forecasts are read from the right fields and displayed (Set/Watch detail panels, WantedList).
- `asNumber()` is consistently applied before arithmetic (per CLAUDE.md money convention).
- BE data is cached with a real `fetchedAt` timestamp — the provenance *exists*, it's just dropped at assignment (G1).

---

## 3. `asNumber` + falsy-zero inventory

### 3a. Inventory

**223 `asNumber()` call sites** (excluding the definition and tests), concentrated in the three
god-modules:

| File | sites |
|------|------:|
| `src/WantedList.jsx` | 64 |
| `src/MyCollection.jsx` | 61 |
| `src/BudgetDashboard.jsx` | 59 |
| `src/utils/formatting.js` | 9 (incl. def) |
| `src/SetDetailPanel.jsx` | 8 |
| `src/AppSettings.jsx` | 6 |
| `src/utils/beSyncValues.js` | 5 |
| `src/PurchaseDetailPanel.jsx` | 5 |
| `src/WatchDetailPanel.jsx` | 4 |
| `src/utils/importBudgetExcel.js` | 1 |

`asNumber()` (`formatting.js:1-4`) returns **`0` for null / undefined / "" / unparseable**. That is
the falsy-zero generator: "no data" and "genuinely zero" collapse to the same `0`.

### 3b. Falsy-zero conflation points in the value domain

This is the same class as the budget bug, now in valuation. Every place an unknown/no-data value
becomes a silent `0`:

1. **Portfolio value rollup — `MyCollection.jsx:400`**
   `value += asNumber(s.totalValue) || asNumber(s.currentValue) * qty`. A set with **unknown** value
   contributes **`0`** to the portfolio total — *and* drags `avgValue` (`:406`), understates `value`,
   and inflates apparent loss in `gainLoss`/`roi` (`:428-429`). Unknown ≠ $0, but the math says it is.
2. **Condition value buckets — `MyCollection.jsx:416,420-422`**
   `current_value: asNumber(s.currentValue)` then `Number(e.current_value) || 0` → unknown-value sets
   counted as `0` inside `newSetsValue` / `usedSetsValue`.
3. **`beValueForCondition` guards — `beSyncValues.js:18,22-24`**
   `if (!vNew && !vUsed)` and `vNew || vUsed`: a falsy `0` from a present-but-zero field is
   indistinguishable from absent. (Low real-world risk — true value is rarely 0 — but it's the same
   trap, and it silently routes to the retail fallback = G2.)
4. **`applyCache` skip — `beSyncValues.js:47,57`** `if (!val) return s`: correct *behavior* (don't
   overwrite with junk), but it means a $0/unknown result leaves the **stale** prior value with no
   "unknown" marker — the UI can't tell "fresh $0" from "never valued."
5. **Display — `money()` (`formatting.js:31-38`)** `money(undefined)` → `asNumber` → `0` →
   **"$0.00"**. An unknown value renders identically to a worthless set. This is the user-facing face
   of the bug: the homepage will show `$0.00`, not "—" or "not valued."
6. **Forecast display guards — `SetDetailPanel.jsx:177,181`, `WantedList.jsx:847-848,2188`**
   `{(forecast2yr || forecast5yr) && ...}` / `item.forecast2yr ? money(...) : "—"`: a legitimately
   falsy forecast is dropped. Low stakes (forecasts are rarely 0) but same pattern.

> **Implication for the value layer:** valuation needs a first-class **"unknown / not valued"** state
> distinct from `0`. A bare-number store (G1) cannot represent it; this is the second structural
> reason to give value a `{value, source, condition, asOf}` shape with an explicit unknown.

---

## 4. Proposed V1+ phase plan

Sequenced stopgap → schema → consumers, mirroring the audit-action-plan house style. **Nothing here
is started; this is the proposal to shape against.**

- **V0 — Ratify the spec (DONE).** §0 resolved: the spec is [`docs/valuation.md`](valuation.md).
  Display contract settled there: condition-split per set, combined new+used portfolio total, plus
  how "retail, not market" (basis tag) and "unknown" ("—", excluded from totals) surface in the UI.
  Everything below builds against it.

- **V1 — Provenance schema (addresses G1, falsy-zero #1–#5).** Introduce a structured value shape
  `{ value, source: 'new'|'used'|'blended'|'retail'|'unknown', condition, asOf }` produced by
  `beValueForCondition` (returns the struct, not a number) and persisted by `applyCache`. Add a
  migration. Keep a `valueNumber()` accessor so the 200+ `asNumber(s.currentValue)` sites can migrate
  incrementally. **Highest blast radius — gate behind tests first.**

- **V2 — Stop laundering retail as value (G2).** Tag retail-fallback values `source:'retail'`; render
  them visibly distinct (e.g. "MSRP — not yet valued") and **exclude or flag** them in portfolio
  value/ROI. Stop seeding `currentValue` from `retail_price_us` at add-time, or seed it explicitly as
  `source:'retail'`.

- **V3 — Confidence + stop blending (G3, G4, G6).** Derive the confidence flag from
  `retired` + `price_events_*` + used band. Replace the synthetic new/used average with the ratified
  V0 display contract. Surface `current_value_used_low/high` as a confidence band.

- **V4 — Real price history + BrickLink (G5 + deferred §1d).** Consume BE `price_events_new/used`
  directly (the substrate for the **price-drop feature**) instead of the home-grown `blPriceHistory`
  snapshots; reconcile or retire the latter. Wire BrickLink price-guide and resolve the deferred BL
  sold-vs-listed / 6-month-avg / currency questions against the real BL response.

- **V5 — Lock it in.** Tests for: retail-not-laundered-as-value, unknown ≠ $0 in rollups, no
  client-side blending unless ratified, provenance survives a sync→reconcile→export round-trip
  (this layer touches the highest-blast-radius sync code — see CLAUDE.md Deep-Dive A).

---

## 5. `price_events` migration — Phases 1–4 (COMPLETE)

> **Status: DONE (all four phases, 2026-05-31).** Phase 1 pinned the shape from real fixtures.
> Phase 2 added the pure read adapter [`src/utils/priceEvents.js`](../src/utils/priceEvents.js)
> (`priceEventsFromBE`), fixture-tested ([`priceEvents.test.js`](../src/utils/priceEvents.test.js),
> 15 tests against all 5 real fixtures), dark. Phase 3 repointed the
> [`WatchDetailPanel`](../src/WatchDetailPanel.jsx) price-history chart onto
> `priceEventsFromBE(cached).new` (the BE blob already in scope at lines 28–32), dropping the dead
> `blPriceNew` line + `hasBL` legend; `length < 2 → return null` is the "no history" state (events are
> retired-only → empty for at-retail). **Phase 4 (teardown) done** — the local price-history
> subsystem is fully retired: the value + `blPriceNew` + `blPriceUsed` trend arrows in `WantedList`,
> the always-empty `wlPriceTrendData` aggregate + its "Avg BL Price Trend" card, the two
> `recordPriceSnapshot` writer calls, and `src/utils/priceHistory.js` itself (with its
> `getPriceHistory`/`getPriceTrend`/`recordPriceSnapshot` exports) are all deleted.
>
> **D1 — RESOLVED:** the chart renders the `new` series only; `used` is mapped by the adapter but
> unrendered until V4. **D2 — RESOLVED:** the *dead BL schema* = the `blPriceNew`/`blPriceUsed` keys
> in the price-history *snapshot* schema (only ever fed `{msrp, value}`); these died with
> `priceHistory.js`. The **live BrickLink `item.blPriceNew/blPriceUsed/*Min/*Max` fields + their 4
> wanted-list columns were PRESERVED** — they are populated by the BrickLink price-guide fetch
> (`WantedList.jsx` ~L1340), distinct from the dead snapshot schema. Only the (always-null) trend
> *arrow* was removed from those cells; the live price value display stays.
>
> **No test-count change** (235 → 235): `priceHistory.js` had no test file. **Device-local
> `blPriceHistory` key left in place** — not in any sync/backup registry, never pushed, self-clears
> on sign-out; no migration needed. A user's persisted (stale) `price-trend` card degrades to the
> render chain's `: null` terminator (harmless empty card only if previously made visible; default
> was `visible:false`). UI-smoked: wanted-list table shows currentValue + live BL columns with **no
> arrows**, no aggregate trend chart, no console errors; WatchDetailPanel chart unaffected.
>
> The "valuation.md asserts it" unknown is a real, pinned contract:
> [`test-data/be-fixtures/`](../test-data/be-fixtures/) + [`scripts/capture-price-events.mjs`](../scripts/capture-price-events.mjs).
> **Strategic note carried forward:** `price_events_*` are retired-only → honest history for retired
> sets, but **not** an at-retail deal-watch signal (that awaits V4 / BrickLink).

**Pinned shape** (full contract + per-case matrix in the fixtures README):
- `price_events_new[]` / `price_events_used[]` = arrays of `{ date: "YYYY-MM-DD" (string), value: number }`.
- **Newest-first (DESC)**; the chart sorts ASC → adapter must re-sort.
- **A fixed ~12-point, newest-first, retired-only window** — exactly 12 points in every present case.
  Framing correction vs. the docs' earlier "deeper than 60 days": BE events are **deeper in calendar
  span** (12 points stretch ~6+ months) but **sparser** than the app's 60 *daily* points, and **absent
  for ALL at-retail sets**. So this is not "more of the same history" — it is real, irregular,
  retired-only history replacing a dense-but-shallow synthetic one.
- Presence is keyed on retirement: **both keys entirely absent** (not `[]`/`null`) for non-retired sets;
  `price_events_used` can be absent while `_new` is present (presence is `used ⊆ new`).
- **Already in the cached `data` object → NO new network call** for sets the daily/manual BE sync has
  already fetched (`beSyncValues.fetchSet` stores the whole `data` blob; the proxy is a verbatim passthrough).
  The adapter reads `brickEconomySetCache[key].data.price_events_*`. Only never-synced sets need a fetch,
  which the existing sync already performs.

**Strategic note (Arc 3 / deal-watch):** BE `price_events_*` are **retired-only** → they are **NOT a
deal-watch signal for at-retail sets** (which is where price drops are actionable). The deal-watch feature
(Arc 3) therefore depends on **V4 / BrickLink**, not on this migration. This warm-up gives honest history
for retired sets; it does not unlock price-drop alerts.

Fixtures (real): `10300-1`, `10307-1`, `10363-1` (at-retail, events absent — the **unknown-history** case),
`71460-1` (retired, new-only events), `30432-1` (retired, new+used events). The genuine ~3% **no-value**
set (null `current_value_new`) is a value-layer gap, **not** captured and **not** blocking this migration
(unknown-*history* is covered by the at-retail fixtures).

### Decisions — RATIFIED (2026-05-31)

- **D1 — new-only chart. RATIFIED.** Render **only the new series now**. Refinement: the **Phase 2
  adapter maps BOTH `price_events_new` AND `price_events_used`** (each `?? []`), likely as **two
  separate series** in its return shape — so **V4 adds the used line with zero rework** (just render the
  already-mapped second series). The adapter does the full mapping; Phase 3 renders new-only. New-only is
  always satisfiable (`pe_new` present whenever any events exist); the used series is conditional and its
  *rendering* waits for V4.

- **D2 — delete the dead BL schema in Phase 4. RATIFIED.** Delete **both** the dead `blPriceNew` /
  `blPriceUsed` fields **and** the always-empty `WantedList.wlPriceTrendData`. **Do NOT
  repoint/resurrect `wlPriceTrendData`** — it is removed, not migrated. These are **not placeholders**:
  V4 adds a real BL series via the **same read-from-cache adapter pattern** (D1), so there is nothing to
  preserve. `recordPriceSnapshot` only ever writes `{ msrp, value }`, so today these never populate and
  the WatchDetailPanel blue line / the trend chart never draw.

  **Phase 3 live-repoint targets are exactly two:** the **WatchDetailPanel value chart** and the
  **`getPriceTrend` arrows**. `wlPriceTrendData` is NOT a repoint target — it is deleted in Phase 4.

### Phase 2 — the read adapter (DONE)

[`priceEventsFromBE(data)`](../src/utils/priceEvents.js) — pure, no I/O; caller passes the cached
`brickEconomySetCache[key].data` blob. Returns `{ new: [{date,value}], used: [{date,value}] }` — two
**separate** series (not merged by date; new/used dates differ). Each input read defensively (`?? []`);
absent (non-retired) → empty series. Re-sorted **ASC** (BE delivers DESC). D1: callers render only `new`;
`used` is mapped anyway so V4 adds the used line with zero rework.

**0 = unknown discipline** — applied via the single-sourced [`value.js` `valueAmount`](../src/utils/value.js)
(valuation.md rule 6): a `price_event` whose value is missing / `0` / unparseable is **unknown → omitted**,
never a `$0` point; a point with no usable date is also dropped (can't place it on the axis). No zeros in the
real fixtures — defensive, and consistent with every other value read. VALUE-side rule (not the cost asymmetry).

**Tested** against all 5 real fixtures: `30432-1` (new+used, both ASC, len 12/12), `71460-1` (new len 12,
used `[]`), `10300-1`/`10307-1`/`10363-1` (both `[]` — the "no history" case) + synthetic 0/null/missing-date
omission and null/undefined/non-array inputs (pure, no throw).

---

## Appendix — verification commands

```
# API shape (key from .env.local) — at-retail vs retired:
curl -s "https://www.brickeconomy.com/api/v1/set/10300-1?currency=USD" -H "x-apikey: $KEY"  # new only
curl -s "https://www.brickeconomy.com/api/v1/set/10179-1?currency=USD" -H "x-apikey: $KEY"  # +used,+events

# Inventory:
grep -rn "asNumber" src --include="*.jsx" --include="*.js" | grep -v "\.test\." | wc -l   # 223
```
