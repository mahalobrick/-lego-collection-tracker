# BrickLedger — Paid / Cost-Basis Decision Record

> **Status:** DECIDED (paid model). Net-additive doc — describes the model + rules only.
> **Date:** 2026-06-02. **Decides:** what "paid" (cost basis) *means*, where it is sourced, and how
> it is surfaced. Sibling to [`docs/value-source-decision.md`](value-source-decision.md) (which owns
> *market value*); this record owns *cost*. Cross-links, doesn't duplicate.
>
> **No collection data in this doc** — model and rules only (no set numbers, prices, or census counts).
> The one-time migration is recorded as an *event* (§5); its inputs/outputs live in **gitignored**
> `outputs/` (full-collection backup + change-table — never committed; see [`.gitignore`](../.gitignore)).

---

## 1. Decision

**A set's "paid" is its all-in cash cost, and the Purchases ledger is the source of truth.**

1. **All-in cash.** Paid = what actually left the wallet: line subtotal (`faceValue × qty`) **+ tax + shipping**, **net of any manually-applied gift cards / rewards**. Not MSRP, not pre-tax sticker.
2. **Ledger is canonical.** The budget **Purchases ledger** (`blPurchases` / `budgetPurchases`) is the system of record for paid. A set's per-set `totalPaid` in MyCollection is **derived/migrated from the ledger**, not authored independently — where the two disagree, the ledger wins.
3. **Provenance, not a single number.** Every set's cost basis is tagged at read time as **`ledger` / `manual` / `msrp` / `none`** (§4). The Overview **headlines the total** cost and uses the provenance split as a **quality disclosure** (§6) — mirroring the value layer's "% estimated" discipline.

---

## 2. Paid model — the all-in cash formula

Single-sourced in [`src/utils/formatting.js`](../src/utils/formatting.js) so every consumer reads the same number:

| Quantity | Definition | Function |
|---|---|---|
| line subtotal | `faceValue × qty` (`faceValue` = **unit price**) | `lineTotal` (fallback when no stored `total`) |
| **line total** | `faceValue × qty + tax + shipping` (stored at write time) | `lineTotal(p)` → `p.total` |
| **cash paid (all-in)** | `total − gcApplied`, floored at 0 | **`lineCashPaid(p)`** |

- `tax` and `shipping` are **distinct fields**, folded into `total` at entry; `total` is the authoritative figure (the component fields don't always reconstruct it for lot/multi-unit lines).
- **Gift cards / rewards** reduce cash paid via `gcApplied` (manually applied). A record with no `gcApplied` nets nothing — gift cards are *not* inferred.
- Per-set cost basis (the value consumed everywhere) is **`setCost(s)`** in [`src/utils/portfolio.js`](../src/utils/portfolio.js) — `totalPaid`, else `paidPrice × qty`. `setCost` is the bare reader the provenance layer wraps (§4); `totalSpent` sums it.

---

## 3. Source of truth — ledger → MyCollection

- The **Purchases ledger** holds real, per-purchase prices (discounts, tax, shipping). It is canonical for cost.
- MyCollection's per-set `totalPaid` (and per-copy `entries[].paid_price`) are a **projection of the ledger**, reconciled by the migration in §5. Going forward, a logged purchase is the way to record real cost; an unmigrated set's `totalPaid` is only as good as its provenance tag.
- **Join key:** purchases join to sets on the **base set-number** (strip the `-N` variant) so a single CMF *series* purchase matches every owned figure of that series — `buildPurchaseMap()` in [`portfolio.js`](../src/utils/portfolio.js) (`baseSetNumber`).

---

## 4. Paid provenance — read-time classification

The paid analog of `setValueProvenance` / `valueConfidence`. Pure, read-time, null-aware; **single coalescing point** — consumers read `.source`, never re-derive the join or the paid-vs-retail test.

**`setPaidProvenance(s, purchaseMap)` → `{ amount, source }`** ([`portfolio.js`](../src/utils/portfolio.js)):

| `source` | Rule | Meaning |
|---|---|---|
| `ledger` | base set-number has a matching purchase | real, receipt-backed cost |
| `manual` | no purchase, **paid ≠ retail** | a real cost entered without a receipt |
| `msrp` | no purchase, **paid == retail** | a BrickEconomy import *default* — a placeholder, **not** real money |
| `none` | cost ≤ 0 | no paid recorded |

- **paid-vs-retail is compared in CENTS** (`Math.round(×100)`) because stored retail carries float noise (e.g. `59.9899999…`). Matches total-vs-`totalRetailPrice` or unit-vs-`retailPrice`.
- **Unknown retail (≤ 0)** can't equal a positive paid → falls to `manual`. There is no separate unknown-retail bucket.
- **`paidConfidence(prov)`** ([`valueDisplay.js`](../src/utils/valueDisplay.js)): only `msrp` carries a quiet **"MSRP?"** marker + tooltip ("estimated at retail, no purchase record"); `ledger`/`manual`/`none` get none — mirrors `valueConfidence`'s "est." badge.
- **`costBasisBreakdown(sets, purchaseMap)`**: one-pass split into `realCost`/`realCount` (ledger + manual), `msrpCost`/`msrpCount`, `noneCount`, `totalCost` — the paid twin of `portfolioValue` + `knownValueCount`.

---

## 5. The migration that ran (one-time event)

A read-only diagnosis established that most per-set `totalPaid` was an MSRP **default** (paid == retail), while the ledger held the real prices. A single reconciled write then migrated **paid := ledger all-in cash** for the ledger-backed sets — **40 sets** touched, **0** collateral drift (every untouched set/purchase byte-identical), gated on exact reconciliation.

Rules applied:
- **1:1 sets:** `totalPaid` := the purchase's all-in `total`; for a multi-copy set the total is split evenly across its `entries[].paid_price`.
- **CMF lots — even allocation.** A series-lot purchase's all-in total is distributed **evenly across the owned figures** (largest-remainder in cents so the figure sums equal the receipt total exactly; duplicate figures get one share per copy). The ledger lines themselves were normalized to per-figure unit pricing (qty = figures, unit = lot ÷ figures).
- **Ledger structure:** a box/lot SKU was repointed to its series number so the join resolves; a single-line CMF lot expanded to `qty = figure count`.

**Artifacts (gitignored `outputs/`, never committed):** the pre-write full-collection backup (the rollback point) and the dry-run/apply change-tables. The migration scripts were transient (run, then deleted) — this record is the durable trace.

> **Stale-derived caveat:** the migration touched only `totalPaid` + `entries[].paid_price` (the paid fields). Per-set derived fields (`averagePaid`, `unrealizedGain`, `roiPct`) were intentionally left untouched and are stale until recomputed.

---

## 6. Surfacing decision — total headline, provenance as disclosure

Mirrors the value layer ("headline the total, flag the estimated portion"), **not** a real-only headline:

- **Cost Basis card** headlines the **total** cost (all sets, `totalSpent` / `costBasis`). The provenance split is a **quality disclosure** sub-note: **`estimatedCostNote`** → `"N estimated at MSRP (~$Y)"` (the `~` signals placeholder, not real spend) — the cost twin of `estimatedValueNote`'s `"% of value estimated"`.
- **ROI card** computes on the **total cost basis** (`portfolioROI` — total market vs total cost), with **`totalRoiNote`** → `"incl. N estimated at MSRP"` flagging that the denominator includes the placeholder portion.
- **`realCostROI`** (real market vs real cost, MSRP-placeholder excluded) and **`realRoiScopeNote`** are **kept in the code** (exported + tested) for a future real-only view, but are **not** headlined.
- **Rows:** the `paidConfidence` **"MSRP?"** marker appears on placeholder rows via the **TriValueCell PAID line** ([`src/TriValueCell.jsx`](../src/TriValueCell.jsx), `tri-paid`). (The standalone, inline-editable **Paid** column was removed — it duplicated the tri-value PAID line and its edit wrote only the per-unit `paidPrice`, a silent no-op on the `totalPaid`-first `setCost`.)
- **Editing paid:** the **detail-panel** "Paid" input ([`MyCollection.jsx`](../src/MyCollection.jsx) `updateSet`) is the edit affordance. It writes the **canonical**: a paid (or qty) edit reconciles `totalPaid = perUnit × qty` and propagates `perUnit` into `entries[].paid_price`, so `setCost` — and gain/ROI/Cost-Basis/tri-value PAID — move, and the provenance tag reclassifies (`msrp` → `manual`) for free. A logged ledger purchase remains the way to record *all-in* cash (§3).

---

## 7. Code pointers

| Concern | Symbol | File |
|---|---|---|
| All-in cash / line total | `lineCashPaid`, `lineTotal` | `src/utils/formatting.js` |
| Bare per-set paid reader | `setCost`, `totalSpent` | `src/utils/portfolio.js` |
| Ledger join (base-number) | `buildPurchaseMap` | `src/utils/portfolio.js:364` |
| Paid provenance | `setPaidProvenance` | `src/utils/portfolio.js:408` |
| Cost split | `costBasisBreakdown` | `src/utils/portfolio.js:426` |
| Real-cost ROI (kept, not headlined) | `realCostROI` | `src/utils/portfolio.js:449` |
| Row marker | `paidConfidence` | `src/utils/valueDisplay.js:182` |
| Quality disclosures | `estimatedCostNote`, `totalRoiNote`, `realRoiScopeNote` | `src/utils/valueDisplay.js:144/157/169` |
| Overview wiring + row markers | Cost / ROI cards, TriValueCell PAID line | `src/MyCollection.jsx`, `src/TriValueCell.jsx` |
| Canonical paid edit | `reconcilePaidEdit` (called by `updateSet`) | `src/utils/portfolio.js`, `src/MyCollection.jsx` |
| Tests | provenance, breakdown, ROI, notes, DOM-leaf markers | `src/utils/paidProvenance.test.js`, `src/TriValueCell.test.jsx` |

---

## 8. Open trade-offs

- **Gift cards aren't a first-class field.** `lineCashPaid` nets `gcApplied`, but legacy/imported records don't carry it — so cash paid can't reflect a gift card that wasn't entered. Capturing GC at entry is a future improvement.
- **Shipping is rarely recorded.** When entered it folds into `total` (all-in holds); when absent, free-shipping is indistinguishable from un-recorded shipping. `total` remains the authoritative figure.
- **`msrp`-placeholder sets have no ground truth.** A set with no purchase and paid == retail is a default; backups carry the same defaults, so there is nothing to "restore" — the only fix is logging the real purchase (→ `ledger`).
- **Stale derived fields** post-migration (`averagePaid`/`roiPct`) — see §5 caveat.
