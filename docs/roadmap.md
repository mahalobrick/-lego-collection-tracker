# BrickLedger — Roadmap

A living plan: arcs and phases with status. Update statuses as phases land. Companions:
`docs/valuation.md` (value spec), `docs/app-architecture.md` (layers + source map),
`docs/value-layer-plan.md` (value build plan), `docs/audit-action-plan.md` (closed audit arc).

**Status labels:** Done · Now · Next · Planned · Backlog

## Where we are

The architecture-audit arc is closed. The value layer — the foundation everything else reads
from — has its core nearly complete; surfacing (V2c) is the current phase.

## Arc 1 — Architecture audit & remediation — Done

Data-loss / sync / enforcement findings closed by construction: the `BACKUP_KEYS` registry,
the `setItemSafe` choke point, atomic apply/rollback, the eslint `DATA-4` raw-`setItem` ban,
the dynamic api-auth test, and CI (lint + test on push/PR).

## Arc 2 — Value layer — Now

Correct, provenanced set valuation. This is the foundation the buy layer and price-drop feature
will consume, so it comes first.

- **Done** — V0: gap report + live BrickEconomy API findings.
- **Done** — Docs: `valuation.md`, `app-architecture.md` (integrations folded in).
- **Done** — V1: value provenance type `{amount, source, condition, basis, asOf}` + characterization tests.
- **Done** — V2a: extract rollup to a tested pure function; derive provenance at read time; BrickLink basis fix (sold = market).
- **Done** — V2b: value mixed sets per-copy by condition (retire the synthetic `(new+used)/2` blend); exclude unknown-value sets from count-based metrics.
- **Now** — V2c: surfacing — unknown reads `—`; at-retail marked by tooltip; ROI left as-is (shows purchase margin vs retail, tooltip carries the "retail not market" caveat); "N of M sets have no value data" note.
- **Next** — V2 cleanup: reconcile ROI / cost-basis over unknown-value sets (consistent exclusion, matching the avg-value fix).
- **Planned** — `price_events` migration: replace the app's own 60-day rolling `blPriceHistory` (`priceHistory.js`) with BrickEconomy's real `price_events_*`.
- **Planned** — V4: wire BrickLink sold prices into the value waterfall (BrickLink genuine-sample → BrickEconomy fallback). The proxy is already live for on-demand columns; gated on confirming it runs on real API auth (50-min session) vs the scrape fallback before BrickLink becomes the primary value source.

## Arc 3 — Buy / decision layer — Planned (next major arc)

Consumes the value layer; answers "should I buy, and when?" Designed to **generalize to other
users' buy structures** — a configurable weighting over a shared signal set, not a hardcoded
retirement-first pipeline.

- Signals: retirement urgency (Brick Fanatics), last-chance (LEGO.com), deal trackers
  (Brickhawk / Brickhound), release notifications, personal want algorithm, budget headroom.
- **Planned** — Price-drop / deal-watch: the headline feature this arc enables. Alerts on price
  movement, honest about freshness (only as fresh as the cache cadence — monthly-ish, not real-time).

## Enhancements — Backlog

- **Two-metric ROI**: split *purchase margin* (value vs what you paid / vs MSRP) from *market
  appreciation* (value vs retail over time). Richer for a buy-below-retail strategy; deferred
  from V2c (option 3) once the core value layer is solid.
- **OBS-4**: a "sync paused" UX signal + in-session retry (today, recovery from a frozen sync = reload).

## Structural debt — Planned

- God-module decomposition: `churn-wantedlist` (~3,579 lines); `MyCollection.jsx` is also large.
- View-config census ("Step 5" from the audit).
- Money/value type — partially addressed by the V1 provenance type.

## Engineering practices — adopt as we go

- **PR-based workflow** so CI *gates* merges (today it runs post-hoc on `main`).
- **API fixtures / contract tests** — record real BrickEconomy / BrickLink responses; test
  derivation against them so an API shape change is caught.
- **Feature-flag new subsystems** (e.g. price-drop) — ship plumbing dark, flip on when ready.
- **Keep docs reconciled to reality; single sources of truth** — the `blStores` / `dedupHash`
  lesson: never let a doc or snapshot become a second source that drifts from code.
