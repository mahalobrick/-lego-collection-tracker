# Staleness indicator — Phase 0 (discovery + proposal, no code)

**Scope:** read-only align pass. Trace the cron's `asOf` through the value path; report where it's
available vs missing; propose the smallest additive in-app freshness indicator. **No behavior change,
no code.** Reviewer approves before any build.

**Headline:** `asOf` already survives **end-to-end into `valueMap`** (api → cache → provenance) — it
is simply **never rendered**. So portfolio data-freshness is **computable client-side today with ZERO
api/values change**. The only missing piece is UI: read `asOf` off the cached records and show it.

---

## 1. `asOf` through the value path — survival table

| Hop | File:line | Carries `asOf`? |
|---|---|---|
| Cron writes the payload | `scripts/refresh-values.mjs` → `value:SET:{n}` records `{amount,source,condition,basis,asOf,lots}` | ✅ (uniform per batch) |
| API field-select | [`api/values.js:116`](../api/values.js#L116) `selectCondition` returns `{amount, basis, lots, asOf}` | ✅ **returned to client** |
| API contract (doc) | [`api/values.js:14`](../api/values.js#L14) `{ [set]: { new:{amount,basis,lots,asOf}|null, used:… } }` | ✅ |
| Client cache | [`valueCache.js:46`](../src/utils/valueCache.js#L46) `createEntryCache({valueField:"record", validate:(r)=>isRecord(r)?r:null})` — the **whole record** is stored; `validate` returns it **unchanged** (only shape-checks), so `asOf` is preserved inside `record`. `fetchedAt` is a *separate* device-fetch ms-epoch. | ✅ `asOf` preserved; `fetchedAt` is distinct |
| `fetchValues()` / `peekValueCache()` return | [`valueCache.js:62/84`](../src/utils/valueCache.js#L62) → the record map; **`valueMap[setNumber].new.asOf`** is directly readable | ✅ |
| Provenance | [`portfolio.js`](../src/utils/portfolio.js) `resolveCopies` (`asOf: blc.asOf`), `blOverlayValue` (`asOf: blCopies[0].asOf`), `copyValueProvenance` (`asOf: blc.asOf`) | ✅ carried (set-level uses first copy's `asOf`) |
| **UI render** | — | ❌ **dropped — never displayed** |

**Key distinction (confirmed):** `fetchedAt` = when *this device* fetched the batch (≤24h via the
client TTL). `asOf` = when the *cron* computed the value (the real freshness signal). They are stored
separately; `asOf` rides inside the value record, independent of `fetchedAt`. So even a value served
from a 24h-old device cache still reports the **cron's** `asOf` — exactly what we want, and a stalled
cron correctly surfaces the *old* `asOf` even on a fresh device fetch.

## 2. Is `asOf` surfaced in the UI today?

**No.** A full `src/` grep finds `asOf` only in: the type JSDoc ([`value.js:53`](../src/utils/value.js#L53)),
provenance/cache plumbing, history adapters, and tests/fixtures. The two `asOf:` writes in components
([`SetDetailPanel.jsx:~120`](../src/SetDetailPanel.jsx), [`MyCollection.jsx:~268`](../src/MyCollection.jsx))
are the *retail* provenance tuple passing a Brickset `fetchedAt` — unrelated, and never shown as a
date either. There is **no** existing "updated / as of / last synced / stale / freshness" UI anywhere
in the components. Nothing to extend; this is greenfield UI over data that's already present.

## 3. Proposed minimal build (additive, no API change)

**Freshness = `max(asOf)` across covered sets.** Because the cron stamps `asOf` uniformly per batch
(verified: all 461 `value:SET` keys shared one `asOf` in the freshness probe), the max over the
device's covered records equals the cron's last successful run time. Iterating `valueMap` records'
`new.asOf` / `used.asOf` is precisely "across covered sets" (BE-fallback / deferred-CMF records carry
`asOf: null` and are naturally excluded).

### Files

1. **New pure util — `src/utils/freshness.js`** (strict leaf; imports nothing app-specific):
   - `valuesAsOf(valueMap) → string | null` — newest ISO `asOf` across all `record.new.asOf` /
     `record.used.asOf`; `null` when none (unloaded / all BE-fallback).
   - `freshness(asOf, nowMs) → { days, label, level }` — `days` = floor((now − asOf)/day);
     `label` = "Values updated today" / "…N days ago"; `level` = `"fresh" | "stale"` (and optionally
     `"very-stale"`). `STALE_DAYS = 8` (weekly cron + 1-day grace); optional `VERY_STALE_DAYS = 15`
     (two missed runs).
   - Pure + null-safe → trivially unit-testable; no I/O.

2. **`src/utils/MyCollection.jsx`** — the ONLY component edit. Compute once:
   `const asOf = useMemo(() => valuesAsOf(valueMap), [valueMap]);` and render a small pill in the
   **"Collection Stats" header row** ([`MyCollection.jsx:1381-1388`](../src/MyCollection.jsx#L1381)),
   beside the `<span>Collection Stats</span>` ([:1382](../src/MyCollection.jsx#L1382)) — that flex
   row already holds the sync/gear/collapse buttons, so an inline freshness chip is the least-intrusive
   home. `valueMap` / `valuesReady` are already in scope here.
   - **Render gate:** only when `valuesReady && asOf` (don't show "updated never" while loading or for
     an all-fallback collection).
   - **Unobtrusive default:** muted text (`#5d6f80`), e.g. "↻ Values updated 2 days ago". Past
     `STALE_DAYS` → amber tint (`#f59e0b`) + a hover `title` ("Weekly value refresh may not have run —
     showing values from <date>"). Optional red past `VERY_STALE_DAYS`.

### What api/values must additionally return

**Nothing.** `asOf` is already in the response and in `valueMap`. No proxy change, no cache change, no
provenance change — the build is one new pure util + one header pill. (If a future design preferred
*not* to walk `valueMap` in the component, an optional convenience would be to expose freshness off
the existing `stats` memo in `MyCollection`, but that's a refactor, not a requirement.)

### Threshold logic (summary)

```
STALE_DAYS = 8           // cron is weekly (Sun 03:00) + 1-day grace
days = floor((now - max(asOf)) / 86_400_000)
level = days <= STALE_DAYS ? "fresh" : days <= 15 ? "stale" : "very-stale"   // tints: muted / amber / red
```

### Suggested net (when built)

- `freshness.test.js` — `valuesAsOf` picks the newest across new/used and across sets; returns `null`
  for `undefined`/empty/all-`asOf:null`; `freshness()` day-math + boundary at exactly 8 days (fresh)
  vs 9 (stale); "today" wording at 0 days.
- A small MyCollection render test: pill shows the relative label when `valueMap` has a recent `asOf`,
  is hidden when `valueMap` is `undefined` or all-fallback. (Mirror `SetDetailPanel.history.test.jsx`'s
  harness; assert on the label text, not pixels.)

## 4. Is `history:SET`'s `asOf` an alternate / redundant freshness source?

**Redundant, and inferior for this purpose.** The same cron writes `history:SET:{n}` in the same run,
so the newest history point's `asOf` equals the `value:SET` batch `asOf` ([`api/history.js:131`](../api/history.js#L131)
returns `asOf` per point; `historyCache`/`historyFromBL` preserve it). But:
- **Value `asOf` is already loaded collection-wide** in `valueMap` on the Overview; history is fetched
  **per-set on panel open** ([`SetDetailPanel`](../src/SetDetailPanel.jsx) only), so using it for a
  *portfolio-level* indicator would require a new collection-wide `/api/history` fetch the app doesn't
  currently make.
- It carries no extra signal (same batch stamp).

→ **Use `value:SET` `asOf` from `valueMap`.** History `asOf` is a fine *cross-check* but not needed.

---

### One-line verdict

Freshness is **already computable client-side from `valueMap`** (asOf survives api→cache→provenance,
just isn't shown). Minimal build = **one pure util (`freshness.js`) + one unobtrusive pill in the
MyCollection "Collection Stats" header**, threshold ~8 days. **No api/values or cache change.** History
`asOf` is a redundant alternate, not required.
