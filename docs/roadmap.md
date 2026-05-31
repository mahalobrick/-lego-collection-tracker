# BrickLedger — Roadmap

A living plan: arcs and phases with status. Update statuses as phases land. Companions:
`docs/valuation.md` (value spec), `docs/app-architecture.md` (layers + source map),
`docs/value-layer-plan.md` (value build plan), `docs/audit-action-plan.md` (closed audit arc).

**Status labels:** Done · Now · Next · Planned · Backlog

## Where we are

The architecture-audit arc is closed. The value layer — the foundation everything else reads
from — has its core complete: the provenance type, correct mixed/unknown handling, surfacing,
and honest ROI / cost-basis have all shipped. The remaining value-arc threads are the BrickLink /
price-history work (`price_events` migration, then V4).

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
- **Done** — V2c: surfacing — unknown reads `—`; at-retail marked by tooltip; ROI left as-is (a below-MSRP buy correctly reads its discount, e.g. +25%); "N of M sets have no value data" note.
- **Done** — V2 cleanup: ROI is honest about unknown-value AND zero-cost sets. *Decision settled:* total cost basis stays **inclusive** (honest "total spent", $0 adds $0); the **percentage** ROI is computed only over `{value known, cost > 0}` (excludes unknown-value and $0/GWP, no ÷0), with an "N excluded from ROI" note; net gain = `Σ(value − cost)` over value-known sets (a $0-cost set contributes its full value). *Follow-up:* a genuine-free/GWP label is **deferred** — the stored shape can't tell a real free $0 from an unrecorded cost, and a dedicated marker would be a new persisted field (sync-surface decision).
- **Done** — unknown ≠ 0 sweep: closed the falsy-zero class **by construction**. The two flagged leaks (per-row Gain cell showed a phantom −$cost; Value-by-Theme counted unknown as $0) plus Theme Performance, Most Valuable Sets, the value/gain sorts, the portfolio-history snapshot, and the set detail panel (set-level + per-copy) now all route through the null-aware funcs in `portfolio.js` (`setGain`, `groupRollup`, `setValueProvenance`, `portfolioValue/Gain/ROI`). Convention recorded in CLAUDE.md; per-row gains reconcile to the headline Net Gain (tested). *Remaining (separate surfaces, not falsy-zero-critical):* CSV import/export gain/roi columns (sync-shape adjacent) and the wanted-list potential-ROI.
- **Planned** — `price_events` migration *(suggested next — the quick warm-up)*: replace the app's own 60-day rolling `blPriceHistory` (`priceHistory.js`) with BrickEconomy's real `price_events_*`.
- **Planned** — V4 *(the big one, after `price_events`)*: wire BrickLink sold prices into the value waterfall (BrickLink genuine-sample → BrickEconomy fallback) — the leap from modeled value to real-market-anchored value. The proxy is already live for on-demand columns; gated on confirming it runs on real API auth (50-min session) vs the scrape fallback before BrickLink becomes the primary value source.

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
