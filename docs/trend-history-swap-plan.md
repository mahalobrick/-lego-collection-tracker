# Trend/history BE→BL swap — align pass (read-only, no code)

**Scope:** read what exists, report, propose. Point the per-set trend chart at the BL
`history:SET:{n}` keyspace and retire the BrickEconomy (BE) `price_events` read. Nothing changed.
Redis was probed **read-only** (SCAN / TYPE / LLEN / LRANGE only — **no writes issued**).

---

## TL;DR

- The **only** BE `price_events` consumer is the **Price History LineChart in `WatchDetailPanel.jsx`**
  ([:158-195](../src/WatchDetailPanel.jsx#L158)) — the watch/wanted-item detail panel. It reads
  `priceEventsFromBE(cached).new` ([:162](../src/WatchDetailPanel.jsx#L162)), shape
  `[{date:"YYYY-MM-DD", value:number}]` ASC. The owned `SetDetailPanel` has **no** trend chart.
- `history:SET:{n}` exists and is healthy: **461 keys** (= full owned coverage, matches `value:SET`),
  a Redis **LIST**, newest-first, element `{asOf, new, used}`. **Depth is shallow now: median 5,
  max 7** snapshots/set.
- **Central risk:** the BE chart lives in the **wanted** panel, but `history:SET` covers **owned**
  sets only (the cron work-list). A naive 1:1 repoint would show *nothing* for unowned wanted sets —
  exactly the sets that panel targets. Resolve the coverage decision before/at the swap.

---

## 1. BE consumer map

| | Detail |
|---|---|
| Component | **`WatchDetailPanel.jsx`** — "Price History" section, [:157-195](../src/WatchDetailPanel.jsx#L157) |
| Chart | recharts `LineChart` ([:169](../src/WatchDetailPanel.jsx#L169)), `dataKey="date"` (X), `dataKey="value"` (Y), gold line, `connectNulls` |
| Data read | `const history = priceEventsFromBE(cached).new;` ([:162](../src/WatchDetailPanel.jsx#L162)) |
| `cached` source | `localStorage["brickEconomySetCache"][key].data` ([:28-32](../src/WatchDetailPanel.jsx#L28)) → `.price_events_new` / `.price_events_used` |
| Adapter | `priceEventsFromBE(data)` — **only export** of [`src/utils/priceEvents.js:32`](../src/utils/priceEvents.js#L32). Maps BE DESC events → clean **ASC** `[{date, value}]`, drops unknown/0 via `valueAmount`, drops dateless points |
| Expected shape | `[{ date: "YYYY-MM-DD", value: number }]`, oldest→newest |
| Hidden when | `history.length < 2` → returns null ([:163](../src/WatchDetailPanel.jsx#L163)) ("no history" state) |
| Rendered where | `WatchDetailPanel` mounts from **`WantedList.jsx:3071`** and **`MyCollection.jsx:2139`** (watch highlights) — same component, both wanted/watch context |

**Used anywhere else?** **No.** `priceEventsFromBE` and the `price_events_*` fields have exactly one
consumer (this chart). Other panels read `brickEconomySetCache` for *metadata/current value only*
(`current_value_*`, `retail_*`, `pieces`, `year`) — never the dated series. So removing the
`price_events` read affects **only** this chart; nothing else regresses.

> **`blPortfolioHistory` is unrelated and out of scope.** The MyCollection portfolio AreaChart
> ([:1753-1799](../src/MyCollection.jsx#L1753)) plots a **device-local daily snapshot**
> (`blPortfolioHistory`, `[{date,value,paid}]`), written locally ([:483-490](../src/MyCollection.jsx#L483)).
> It is not BE-sourced and is not part of this swap.

## 2. BL history data — shape + current depth (live Redis probe)

| Property | Value |
|---|---|
| Keyspace | `history:SET:{n}` |
| Key count | **461** (= the 461 `value:SET` keys → full owned-collection coverage) |
| Redis type | **list** (written `LPUSH` newest + `LTRIM` ~520 cap, per [`refresh-values.mjs:11`](../scripts/refresh-values.mjs#L11)) |
| Order | **newest-first** (index 0 = latest) |
| Element shape | `{ "asOf": "2026-06-07T03:00:01.779Z", "new": 119.56, "used": 89.67 }` — note `new`/`used` are **plain value numbers**, NOT the `{amount,basis,lots}` record that `value:SET` stores |
| **Depth now** | **min 5, median 5, max 7, mean 5.47** — distribution: `{5:315, 6:77, 7:69}` |
| Run stamps seen | `2026-06-02T00:57:57Z` (tail) … `2026-06-07T03:00:01Z` (head) |

**Sparseness implication:** post-swap the chart starts at **~5 points** for most sets (max 7),
growing **+1 per cron run (≈weekly)**. Versus BE's ~12 points over ~6 months. So initially
**shallower but broader** (all 461 owned sets vs BE's retired-only series) and self-deepening. Every
owned set already clears the `<2` guard, so a chart bound to owned sets would render for all of them.

## 3. Read-path recommendation

**Endpoint: a new `/api/history` mirroring `/api/values`** (do NOT overload `/api/values` — different
data, different Redis op, different cadence). Reuse the proven pipeline from
[`api/values.js`](../api/values.js): `setCors → requireAuth → rateLimitAllow({bucket:"proxy"}) →
(timeout read) → field-select → typed-error envelope`. **One difference that matters:** `value:SET`
are strings (single `MGET`); `history:SET` are **lists**, so `/api/history` must issue a **pipeline
of `LRANGE key 0 -1`** (Upstash REST `/pipeline`, raw `fetchWithTimeout` to keep the no-bare-fetch /
timeout lock), then field-select each element to `{date, value}`. Bound by `MAX_SETS` like values.js.
Read-only; no BL call (it serves what the cron wrote, same as values.js).

**Client: a history cache mirroring [`valueCache.js`](../src/utils/valueCache.js)** via the
[`createEntryCache`](../src/utils/enrichmentCache.js#L80) factory — e.g. `blHistoryCache`
(`key:"blHistoryCache"`, `ttlMs: 24h`, `valueField:"series"`, `tsField:"fetchedAt"`, `ts: MS_TS`,
`keyFn: trim`, `validate:` shape guard), exposing `fetchHistory(setNumbers)` (`readThrough` →
`/api/history`) + `peekHistoryCache`. **Fetch granularity:** detail panels open one set at a time, so
**on-demand single-set fetch on panel open** (cached, TTL'd) is the cleanest fit — no need for a
bulk collection-wide sweep like the value overlay. (The factory's batch `readThrough` is available if
a future multi-set view wants it.) Not in `BACKUP_KEYS` (regeneratable, device-local).

## 4. Swap + removal

**Add a BL adapter** `historyFromBL(series)` (mirror `priceEventsFromBE`, same output contract):
- input: the list `[{asOf, new, used}, …]` (newest-first)
- output: `{ new: [{date, value}], used: [{date, value}] }`, **ASC** (reverse the list),
  `date = asOf.slice(0,10)`, `value = valueAmount(new|used)` (drop 0/null/dateless points — identical
  discipline to `priceEventsFromBE`).

**Repoint the consumer (one line):** replace
`const history = priceEventsFromBE(cached).new;` ([WatchDetailPanel:162](../src/WatchDetailPanel.jsx#L162))
with the BL series for that set (from `peekHistoryCache`/`fetchHistory` → `historyFromBL(series).new`).
**The chart block ([:164-194](../src/WatchDetailPanel.jsx#L164)) is untouched** — same
`[{date,value}]` ASC shape, same `<2` guard, same dataKeys. The mapping is behavior-neutral to the
renderer.

**Remove the BE read (scoped):**
- delete the `priceEventsFromBE` call + its import in `WatchDetailPanel.jsx`;
- delete [`src/utils/priceEvents.js`](../src/utils/priceEvents.js) (sole consumer confirmed);
- **keep** the `brickEconomySetCache` read at [WatchDetailPanel:28-32](../src/WatchDetailPanel.jsx#L28)
  IF that panel still uses `cached` for other fields — verify before touching it (the `price_events_*`
  fields stop being read, but the blob may still serve metadata in that panel). Removal here is only
  the `price_events` branch, not necessarily the whole BE-cache read.

**Coverage decision to make at swap time (the §TL;DR risk):** `history:SET` = owned sets; this chart
is in the **wanted** panel. Pick one, explicitly:
- **(a) Keep BE as fallback** for unowned wanted sets (BL when a `history:SET:{n}` exists, BE
  `price_events` otherwise) — smallest regression, but doesn't fully drop BE.
- **(b) Expand the cron work-list** to include wanted set numbers (off-repo `refresh-values.mjs`
  change) so `history:SET` covers wanted sets too — then BE drops cleanly.
- **(c) Move the chart to owned `SetDetailPanel`** (which has none today) where coverage already
  matches, and accept that unowned wanted items lose the trend.

## 5. Recommended phasing

- **Phase 0 — net (test-first).** Characterization test pinning the current WatchDetailPanel chart
  output for a BE fixture; a `historyFromBL` unit test asserting **byte-shape parity** with
  `priceEventsFromBE` output (`[{date,value}]` ASC, unknowns dropped); a contract test for the
  `/api/history` response shape. These are the regression net for the later removal.
- **Phase 1 — endpoint + cache (no consumer yet).** Ship `/api/history` (LRANGE-pipeline, auth,
  rate-limit, field-select) + `blHistoryCache` (`createEntryCache`) + `fetchHistory`/`peekHistoryCache`.
  Reachable but unconsumed (the same "Step 1" posture `api/values.js` used). Verify read-only, no BL
  egress, typed errors.
- **Phase 2 — chart swap + BE-read removal.** Resolve the §4 coverage decision; repoint the
  consumer via `historyFromBL`; once `price_events` is unreferenced, delete `priceEventsFromBE` +
  `priceEvents.js` and the `price_events` read. Net from Phase 0 guards the shape.

**Post-swap sparseness (confirmed):** ≈ **current depth (median 5, max 7 points)**, **+1/week** as the
cron `LPUSH`es — broader coverage than BE (all 461 owned sets vs retired-only) but shallower history
until it accrues. Every owned set already clears the `<2` guard.

---

**Probe integrity:** the Redis reads above used only `SCAN`, `TYPE`, `LLEN`, and `LRANGE` (all
read-only). **No `SET`/`DEL`/`LPUSH`/`LTRIM`/`EXPIRE` or any mutating command was issued.** Cron
cadence, logs, and daemon status remain an off-repo VPS check.
