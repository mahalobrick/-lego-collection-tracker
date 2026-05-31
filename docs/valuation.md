# BrickLedger — Valuation Spec

**Scope: collection monetary valuation only** — how BrickLedger decides what a set is
worth. One layer of the app; the buy/decision layer and order of operations live in
`docs/app-architecture.md`. Companion to `docs/value-layer-plan.md` (build plan).

## What this layer answers

"What is this set worth right now?" — the current market value shown in My Collection
(value, ROI, forecast boxes). Not buy decisions, deals, or retirement urgency (buy layer).

## The value sources

- **BrickEconomy — aggregate market value.** Modeled value (new/used), 2/5yr forecasts,
  price history, retail. Aggregates eBay/StockX/BrickLink, so **not independent** of
  BrickLink. Cache: `brickEconomySetCache` (24h). **Canonical current-value source.**
- **BrickLink — raw global sold (~6-month).** Real resale **sold** prices, new & used,
  avg/min/max/qty. **Live and working today** via the `bricklink-priceguide` proxy (real API
  calls, HTML-scrape fallback on auth failure) — but currently feeds on-demand **price
  columns only**, NOT the value rollup. Client cache 6h (12h bulk). **Not monthly-limited**;
  the only throttle on our side is the generic 1000 req/60s rate limit. Wiring it into the
  value layer is V4.
- **Brickset — original MSRP (static).** Catalog MSRP/retail + retirement dates. Kept as a
  separate, static "original retail" label — does NOT feed the value rollup.

*(Brickset & Rebrickable also supply metadata/images/pieces/minifigs — not value.)*

## BrickEconomy API reality (verified live in V0)

- `current_value_new` always present. For at-retail (non-retired) sets it **equals retail** —
  sticker price, not a market valuation.
- `current_value_used` (+ low/high band) only when `retired: true`.
- No estimated-vs-sales boolean; confidence is **derived** (retired + price_events presence +
  used band).
- API never blends new/used; any single blended "Value" is a BrickLedger invention to remove.
- Unused today: `price_events_new/used` (real history — prefer over the app's `blPriceHistory`),
  `rolling_growth_*`, `retired_date`. ~96.8% of sets have a value; ~3% none.

## Value rules

1. **Value = sold/market data only.** Listings are a supply signal, never value.
2. **At-retail = retail, tagged as retail-basis.** When the figure is the sticker price
   (at-retail), the value type carries a `basis: retail` tag so the UI labels it as retail/MSRP
   and ROI reads 0 (not a loss or appreciation). Once retired, basis flips to `market`. *(G2)*
3. **Waterfall** (V4, when BrickLink is wired into value): BrickLink ~6mo sold (genuine sample)
   → BrickEconomy fallback. **Fair value** (BrickLink avg/median) — never an acquisition floor.
   *Gating: confirm BrickLink is API-authed, not scrape-derived, before it becomes the primary
   value source.*
4. **By condition per set; combined at the portfolio.** Each set is valued at its tracked
   condition — collection tracks new vs used (use it), purchases assume **new/sealed** — and a
   single set's new and used figures are **never averaged into a synthetic per-set blend**.
   But the **total collection value** legitimately *combines* across the collection: each set
   contributes its own condition's value, summed into one mixed new+used total. That total
   exists today and is preserved. (The provenance type makes condition-split subtotals available
   as a bonus, but the combined total stays the headline number.)
5. **Provenance.** Store `{ amount, source, condition, basis, asOf }` — never a bare number,
   never a silent cross-source overwrite. (Resolves the current `msrp` (Brickset) vs
   `currentValue` (BE) divergence by tagging source explicitly.) *(G1)*
6. **Unknown ≠ 0.** First-class unknown state, rendered "—", **excluded from the combined total**
   (which still sums all known-value sets, new + used) with a "N sets have no value data" note —
   never silently counted as $0. *(falsy-zero)* Two parts, both true today:

   - **0 = unknown, for value.** A stored 0 value and an absent value field are treated
     **identically — both unknown**. No set is genuinely worth $0, so a 0 always means "no data."
     This coalescing is **single-sourced** in `valueAmount()` (`src/utils/value.js`), applied by
     both the set-level funnel (`rawSetValue`) and the SetDetailPanel per-copy breakdown, and
     **locked end-to-end** by `value.zero-unknown.test.js` (a stored `totalValue:0` / `currentValue:0`
     / per-copy `current_value:0` reads "—" and is excluded from totals / avg / ROI). Honest caveat:
     storage **may still hold baked-0 values** from older imports — harmless, because they're
     recovered to unknown on every read; *truly-clean value storage* (never persisting a 0) is a
     future migration bundled with the cost-provenance work, **not done here**. **Asymmetry:** this
     0-means-unknown rule is **VALUE-only** — for COST a $0 can be genuine (a free GWP), handled
     separately (see *Cost basis & ROI*). `toValue`/`normalizeAmount` stay general and keep a 0;
     only the value amount is coalesced, via `valueAmount`.
   - **Routed through null-aware funcs.** Every value/gain consumer — per-row value & gain cells,
     headline totals, avgValue, ROI + ROI leaders, Value-by-Theme, Theme Performance, Most Valuable
     Sets, the portfolio-history snapshot, and the set detail panel (set-level + per-copy) — reads
     through the null-aware functions in `src/utils/portfolio.js` (`setValueProvenance`, `setGain`,
     `setROI`, `portfolioValue/Gain/ROI`, `groupRollup`). No consumer does its own
     `asNumber(value) || 0` or `value − paid`. (Sold-tab realized gains are computed from a known
     sale price; CSV import/export and the wanted-list ROI are separate surfaces, tracked as
     follow-ups.)
7. **Confidence = a genuine recent sold sample exists** (derived). Not source divergence — the
   sources aren't independent.

## Cost basis & ROI

Cost carries the **same null-vs-$0 discipline as value** (rule 6), with one twist:
the stored shape cannot tell a *genuinely-free* $0 (a GWP known to be free) from a
*cost that was never recorded* — there is no free/GWP marker on an owned set, and an
empty paid field stores `0`. So both are treated uniformly as "no usable cost".

- **A percentage ROI is only meaningful when value AND cost are both known and
  cost > 0.** `% ROI` is computed over exactly that subset (`portfolioROI` /
  `setROI` in `src/utils/portfolio.js`); two mirror-image exclusions fall out:
  - *unknown value, known cost* → no computable return → excluded from `% ROI`.
  - *$0 / GWP cost, known value* → return is ÷0 → excluded from `% ROI` (never
    Infinity/NaN). Its full value still counts as **absolute gain**.
- **Absolute dollar totals stay inclusive and honest.** *Total spent* sums every
  set's cost ($0 adds $0); *total value* is unchanged (rule 6); *net gain* is
  `Σ(value − cost)` over **value-known** sets — so an unknown-value set's recorded
  cost no longer drags gain into a phantom loss, and a $0-cost set contributes its
  full value as gain.
- **Surfacing:** a set excluded from `% ROI` (unknown value OR cost ≤ 0) renders
  `—`, with a "N sets excluded from ROI (no value or no cost)" note. A dedicated
  free/GWP label would need a **new persisted field** (a sync-surface change) and is
  deferred until that marker exists.

## Retired status (valuation-relevant)

Retired status (Brickset / BrickEconomy) determines whether a **used** value exists and whether
BrickEconomy reports a real market value vs. echoing retail. (Retirement as a *buy trigger* =
buy layer.)

## Join key

BrickLink item number (incl. minifig variation IDs) — canonical across sources and the item model.

## Canonical sources (settled)

- **Current value:** BrickEconomy `retail_price_us` / `current_value_*` — dynamic, tracks to
  market on retirement. Drives the rollup.
- **Original MSRP:** Brickset — static "original retail" label, separate field, display only.

## Refresh cadence

BrickEconomy 24h cache, BrickLink priceguide 6h (12h bulk), both client-side. Proxies are
stateless. Track each value's `source` + `asOf`; never combine a stale forecast with a fresher
figure without flagging.

## Open decisions

- **Surfacing:** at-retail labeled as retail (basis tag), unknown as "—" and excluded from
  totals — confirm the exact UI/rollup treatment.
- **price_events migration:** the app currently maintains its own price history as a **60-day
  rolling `blPriceHistory`** — daily snapshots, one per set per calendar day, upserted by
  [`src/utils/priceHistory.js`](../src/utils/priceHistory.js) (oldest dropped past 60 entries);
  feeds trend arrows / growth charts. Migration target: reconcile or replace it with
  BrickEconomy's real `price_events_*` (genuine dated history, deeper than 60 days). Decide
  whether to backfill from `price_events_*` or run both during transition.
- **V4 BrickLink robustness:** confirm API-auth vs scrape before promoting BrickLink-sold to the
  primary value source.
