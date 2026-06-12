# BrickEconomy `/set` fixtures — `price_events_*` contract

Real `GET /api/v1/set/{num}?currency=USD` payloads captured live on **2026-05-31** (key from
`.env.local`). This is the **contract** the Phase 2 `price_events` read adapter is tested against — the
first entry in the API-fixture practice the audit arc recommended. Do not hand-edit — these are now a
**frozen snapshot**: the capture generator (`scripts/capture-price-events.mjs`) was removed in the BE
teardown (Phase 1, see [`docs/be-removal-plan.md`](../../docs/be-removal-plan.md)); BE is no longer re-captured.

Each file is the **verbatim** proxy/​API response: `{ "data": { …set fields… } }`. The app's BE cache
stores exactly this `data` object (`beSyncValues.fetchSet`: `data: json.data || json`).

## The pinned shape

`price_events_new` and `price_events_used` are **arrays of observation points**:

```jsonc
"price_events_new": [
  { "date": "2026-05-15", "value": 5.99 },   // newest first
  { "date": "2026-05-01", "value": 6.26 },
  …                                          // 12 entries observed in every present case
  { "date": "2025-12-09", "value": 10.15 }   // oldest last
]
```

- **`date`** — string, strict `YYYY-MM-DD` (all observed). No time component.
- **`value`** — JSON number (float), in the requested `currency` (USD here). Positive in all real data
  (no `0` / `null` observed — but the adapter must still treat 0/absent as **unknown**, see Phase 2 note).
- **Order** — **descending (newest first)**. The chart consumer sorts ascending today, so the adapter
  must re-sort.
- **Length** — exactly **12** in every present case → BE appears to return a fixed ~12-point window,
  *not* full history. (Deeper than the app's value-only daily series in practice, but **not** unbounded;
  pin this expectation.)

## Per-case presence matrix

Presence is **keyed on retirement / secondary-market existence** — the whole `price_events_*` +
`current_value_used*` + `rolling_growth_*` + `retired:true` cluster appears together, or not at all.

| Fixture | case | `retired` key | `current_value_new` | `current_value_used` | `price_events_new` | `price_events_used` |
|---|---|---|---|---|---|---|
| `10300-1.json` | (b) at-retail (BTTF DeLorean) | absent | 199.99 (= retail) | absent | **absent** | **absent** |
| `10307-1.json` | (b) at-retail (Eiffel Tower) | absent | 629.99 (= retail) | absent | **absent** | **absent** |
| `10363-1.json` | (b) at-retail, 2025 (da Vinci) | absent | 49.99 (= retail) | absent | **absent** | **absent** |
| `71460-1.json` | (a′) retired, **new-only events** | true | 99.99 | 82.99 | **12** | **absent** |
| `30432-1.json` | (a) retired, **new + used events** | true | 5.99 | 4.12 | **12** | **12** |

**Key facts the adapter must honor:**

1. **Both keys are entirely absent (not `[]`, not `null`) when the set isn't retired.** Read defensively
   (`data.price_events_new ?? []`). This is the **unknown-history case** for the migration — every
   at-retail set (the bulk of a live collection) has no events. Render "no history", never an empty/zero plot.
2. **`price_events_used` can be absent while `price_events_new` is present** (`71460-1`, and observed in
   the wild on `30716`, `40758`, `77072`, `11030`, `11037`). Presence is `used ⊆ new` — never saw used
   present without new. So a new-only chart is always satisfiable when *any* events exist; a used series is not.
3. The companion fields (`current_value_used_low/high`, `rolling_growth_lastyear`, `rolling_growth_12months`,
   sometimes `retired_date`) travel with `price_events_*`. Not needed for the warm-up; noted for V4/price-drop.

## Value-field contract (integration-standard §5, P2)

The same five fixtures also pin the **value fields** the rollup and the value-bearing detail
panels consume — tested by [`src/utils/beSetValueFields.contract.test.js`](../../src/utils/beSetValueFields.contract.test.js).
This is the lock §5 logs as P2 (the value-field *shape* was previously only asserted via the
*derived* output in `value.characterization.test.js`, never the upstream shape directly).

**Consumed value fields → reader:**

| Field | Type | Reader | Present in |
|---|---|---|---|
| `current_value_new` | number > 0 | `beValueForCondition` (beSyncValues.js:22) | **all 5** |
| `retail_price_us` | number > 0 | value fallback (beSyncValues.js:24) + MSRP label | **all 5** |
| `forecast_value_new_2_years` | number > 0 | SetDetailPanel/WatchDetailPanel/WantedList | **all 5** |
| `forecast_value_new_5_years` | number > 0 | SetDetailPanel/WatchDetailPanel/WantedList | **all 5** |
| `current_value_used` | number > 0 | `beValueForCondition` (beSyncValues.js:23) | retired only |
| `current_value_used_low` / `_high` | number (band) | (V4/price-drop) | retired only |
| `retired` | boolean `true` | value provenance (beSyncValues.js:75,90) | retired only — **absent**, not `false`, at-retail |
| `retired_date` | `YYYY-MM-DD` string | `entries[0]?.retired_date` (MyCollection:195) | **inconsistent** — `71460-1` yes, `30432-1` no |

**Drift guards the test pins:**

1. **`current_value_new_low`/`_high` are NOT delivered by BE.** Only the *used* value carries a
   `low`/`high` band (and only on retired sets). The orientation listed `(+low/high)` for NEW as a
   candidate — reality has no new band in any captured payload. No production code reads it, so this is
   benign **today**; the absence is pinned so a consumer can't quietly assume it exists.
2. **At-retail invariant:** `current_value_new === retail_price_us` (new value mirrors the sticker
   price), and the entire `retired`/`current_value_used*` cluster is **absent** (not `null`/`false`).
3. **`retired_date` is not a guaranteed retired field** — present on `71460-1`, absent on `30432-1` —
   so it is pinned *where present* (type only), not required.

## Not captured: the genuine ~3% no-*value* set

valuation.md notes ~3% of sets have **no `current_value_new` at all**. That is a *value-layer* gap, distinct
from "no price_events" — and it is **not blocking** this migration: the unknown-*history* case is already
covered by the at-retail fixtures (events absent). Every reachable popular/at-retail set returned a value
(at-retail sets mirror `retail_price_us`); the true null-value sets are obscure and weren't found by probing.
If a null-`current_value_new` fixture is wanted for the value layer, capture one separately (Sam can paste a
known offender's devtools payload, or extend the script's set list).
