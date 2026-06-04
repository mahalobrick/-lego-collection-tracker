# Backlog — parked items

Things discovered-but-deferred during other work, captured so they aren't lost. Each entry
notes what it is, why it's parked, and where to start. Not a roadmap (see `roadmap.md`); this is
the "we noticed this, not now" list.

---

## 1. CMF retail / images discovery

**What:** Collectible Minifigures (CMF) series sets (`71xxx-N` figures) need their own retail-price
and image handling. CMF figures share a base set number (`71052`, etc.) and the per-figure
retail/image story differs from regular sets; the purchase-ledger join already special-cases the
CMF base-number match (`buildPurchaseMap` / `baseSetNumber` in `src/utils/portfolio.js`), but
retail provenance and thumbnails for individual figures are unverified.

**Why parked:** out of scope of the conditions arc; needs its own discovery pass before any build.

**Start at:** `setRetailProvenance` / `retailFor` (MyCollection) and `setImageUrl` (`formatting.js`)
for how regular sets resolve retail + image, then map what CMF figures actually carry.

---

## 2. BE-set qty persistence gap

**What:** Editing a BrickEconomy set's **quantity** still only updates in-memory state — it is not
written back to the `brickEconomyNormalizedCollection` blob, so it reverts on reload. (The Phase-2
persistence work closed the **paid** and **condition** gaps for BE sets; qty was deliberately left
in-memory to keep each step scoped.)

**Why parked:** qty has more downstream effects than paid/condition (blob alias `qty↔quantity`,
plus `totalPaid` and `totalValue` both rescale with qty), so it deserves its own step rather than
being bolted onto a condition/paid commit.

**Start at:** `updateSet` in `src/MyCollection.jsx` — the `field === "qty"` path currently falls to
the in-memory `else` branch. Route BE-set qty through `persistBESetEdit` with a qty patch
(`quantity` blob alias + rescaled `totalPaid`/`totalValue`), and add a reload smoke. The rails
(`persistBESetEdit`, `revalueBESet`) already exist.

---

## 3. Ledger ↔ MyCollection reconciliation audit

**What:** Per `docs/paid-model-decision.md` §3, the Purchases ledger (`blPurchases`) is the canonical
source for paid, and a set's per-set `totalPaid` / `entries[].paid_price` are a *projection* of it.
The Phase-2 paid true-up writes `totalPaid`/`averagePaid`/`entries[].paid_price` directly to the BE
blob without touching the ledger — so a manual true-up can now diverge from the ledger it's supposed
to derive from. Need an audit of where the two can disagree and a decision on the intended
direction of truth after a manual edit (re-derive from ledger? write a ledger entry? accept the
override and flag it?).

**Why parked:** it's a data-model/decision question, not a bug to patch in passing; affects the paid
provenance classification (`setPaidProvenance` ledger/manual/msrp) and should be decided before more
paid-editing surfaces are added.

**Start at:** `docs/paid-model-decision.md` §3–§4, `buildPurchaseMap` / `setPaidProvenance` in
`src/utils/portfolio.js`, and the Phase-2 `persistBESetEdit` paid path in `src/MyCollection.jsx`.

---

## 4. Headline tile reconciliation — partial-coverage Net Gain  *(next priority)*

**What:** The My Collection Overview headline tiles don't reconcile as `Net Gain = Value − Cost`
when the collection holds sets with a known **cost** but an **unknown value**. Value and Net Gain
are computed on the value-known subset (`portfolioValue` / `portfolioGain` exclude unknown-value
sets); Cost Basis is inclusive (`totalSpent` counts every set). Worked example: one valued set
(value $777, cost $200) plus unvalued-but-paid sets (cost $260) → Value **$777**, Cost **$460**,
Net Gain **$577**; but $777 − $460 = $317 ≠ $577. The $260 gap is exactly the cost of the
unvalued sets — in Cost, excluded from Gain/Value.

**Why parked / not a bug in this work:** pre-existing behavior of the null-aware portfolio layer
(`src/utils/portfolio.js`). `portfolioGain` deliberately drops unknown-value sets so their cost
doesn't read as a phantom loss. The promotion-value-laundering fix did **not** introduce it — it
made promoted sets carry honestly-unknown value (instead of laundering paid→value), which grew the
unknown-value population and so made the pre-existing non-reconciliation visible in the headline.

**Decision needed:** how the three tiles should present partial coverage. Options: (a) a coverage
note on Net Gain ("over N of M sets with known value"); (b) scope the displayed Cost to the
value-known subset in the gain context; (c) a "cost of unvalued sets" disclosure. Settle the
intended reconciliation contract before changing any number — it is a presentation decision, not a
math bug.

**Start at:** the `stats` useMemo in `src/MyCollection.jsx` (`costBasis = totalSpent(sets)` vs
`value = portfolioValue(...)` / `gainLoss = portfolioGain(...)`), and the Collection Value /
Cost Basis / Net Gain card rendering. The funcs live in `src/utils/portfolio.js`.

---

## Conditions arc — remaining cleanup (not blocking)

- **BE-ingest token normalization.** The BrickEconomy import stores raw condition tokens
  (`usedasnew`, `usedcomplete`, `usedincomplete`, underscored `used_*`). The display layer already
  buckets every token to New/Used/Mixed via `src/utils/condition.js`, so this is cosmetic-at-source
  cleanup, not a correctness gap. Start at `normalizeBrickEconomyCollection` (`src/utils/beCollection.js`).
