# Curated MSRP — gap report, design proposal & as-built

**Status:** ✅ **BUILT** (2026-06-17, Opus 4.8) per the confirmed decisions — see "As-built" below.
The design proposal that follows is preserved as the spec; this header records what shipped.
**Generated:** 2026-06-16 (Opus 4.8); revised against the **real** curated CSV. Aligns with
`docs/engineering-protocol.md` (net-first, phase-and-commit).

---

## As-built (2026-06-17)

Built to **Option C** with the confirmed decisions: promo=C; headline sourced-only + "(~$X est.)";
confidence in provenance, not on the card; no low-confidence sub-flag; 30566 sourced, source tagged
"converted (UK→USD)"; curated_sourced is canonical (no "researched" chip); codegen with the CSV as the
single source of truth.

**Partition shipped (over the real 600-set collection):** `491 sourced · 67 estimated · 41 promo·ARV ·
1 not-listed = 600` (was `471 priced · 41 promo · 88 not-listed`). The +20 sourced + 67 estimated + 41
promo-ARV come from the curated 129; 30625 (tier=none) stays not-listed. Headline $ = the sourced sum
only; the estimated ($637.89) and promo-ARV ($855.59) per-unit totals are disclosed separately, never
folded in. (`portfolio.retail.test.js` pins the exact +20/67/41/1 against the in-repo CSV.)

**Segment ≠ tier reconciliation (documented in code + here):** the CSV has **94 estimated rows**, but
the card's **estimated segment is 67** — the other **27** estimated-tier rows are *promos*, which Option
C keeps in the **promo·ARV** bucket (a GWP value is never a sticker MSRP). So: card sourced 20 = 20
sourced-tier non-promos; card estimated 67 = 67 estimated-tier non-promos; card promo·ARV 41 = 14
sourced-tier + 27 estimated-tier promos. (Code: `portfolioRetail` JSDoc + `retailCoverageNote` JSDoc.)

**Files / where it lives:** `docs/curated-msrp.csv` (source of truth, `!`-excepted in `.gitignore`) →
`scripts/gen-curated-msrp.mjs` (`npm run gen:curated-msrp`) → `src/utils/curatedMsrp.js` (generated,
drift-guarded). Ladder: `RETAIL_SOURCE_ORDER` + `setRetailProvenance` + `portfolioRetail` in
`portfolio.js`; `retailFor` in `MyCollection.jsx`; `retailCoverageNote` + valued-promo cell/tooltip in
`valueDisplay.js`. No network, never `source:"brickeconomy"` — Phase 3c intact.

**Commits (net-first, RED-first per step):** `chore(data)` land CSV + gitignore → `feat(be)` codegen +
drift guard → `feat(be)` curated rungs (basis tagging) → `feat(be)` 4-way partition + retailFor →
`feat(be)` card (4-segment note + valued-promo) → `docs` (this as-built). Full suite **891 passing**,
lint clean.

---

**Input.** The curated table is committed at **`docs/curated-msrp.csv`** (the source of truth; columns
`set_number, name, year, bucket, msrp, confidence (A/B/C/D), tier (sourced|estimated|none), source`;
**129 rows** = the no-MSRP universe = `docs/msrp-no-msrp-sets.csv`). Verified tallies:

| tier | rows | Σ msrp (per-unit) |
|---|---:|---:|
| sourced | **34** | $552.35 |
| estimated | **94** | $1,184.62 |
| none | **1** (30625 only) | — |

Confidence skew: **A 22 · B 13 · C 81 · D 13** — i.e. **63% (81/129) are confidence-C** and only 35 are A/B.
The estimated tier is dominated by two uniform placeholders: **36 rows "Retail polybag standard" ($4.99)** and
**12 magazine rows all $7.37** (a single £5.50×1.34 estimate, every row flagged "— verify"). These are real
data-quality caveats the "estimated" disclosure must carry honestly.

---

## 1. The retail-resolution ladder (as-is)

| piece | location | behaviour |
|---|---|---|
| `RETAIL_SOURCE_ORDER` | `src/utils/portfolio.js:199` | `["brickset", "manual", "cmf"]` |
| `setRetailProvenance(sources,{condition,promo})` | `portfolio.js:219` | walks the order; first source with `valueAmount > 0` → `toValue({source, basis:"retail"})`. No source + `promo` → `{amount:null, basis:"promo"}`. Else `null`. |
| `retailFor(set)` | `src/MyCollection.jsx:219` | sources: `brickset`=`bricksetRetailEntry().data.retail_price_us`, `manual`=`set.msrp`, `cmf`=`cmfEraRetail(n)`; `promo`=`isPromoNoRetail(set)`. |
| `bricksetRetailEntry(cache,n)` | `src/utils/brickset.js:75` | ladder `[n, base, base-0, base-1]`, first `retail_price_us > 0`. |
| `cmfEraRetail(n)` | `src/utils/cmfRetail.js:53` | **bundled** series→era table (no network). The model for the curated table. |
| `portfolioRetail(sets, retailFor)` | `portfolio.js:389` | `{total, known, promo, notListed}`; invariant **known + promo + notListed === sets.length**. |
| card render | `MyCollection.jsx:1424` | `formatAggregateValue(retailValue, known)` + `retailPricedNote(known,total) · retailGapNote(promo,notListed)`. |
| per-row marker | `valueDisplay.js:188` `retailSourceMarker` | a non-canonical rung is already marked: `source:"manual"` → "manual" chip. **Precedent for marking a curated rung.** |

**Rung placement & ranking.** Two curated rungs — a sourced RRP belongs with the real-RRP rungs, an estimate is
a last-resort fill below the principled cmf era price:

```
RETAIL_SOURCE_ORDER = ["brickset", "manual", "curated_sourced", "cmf", "curated_estimated"]
```
brickset (canonical API RRP) ≻ manual (user override) ≻ **curated_sourced** (researched real RRP, beats the cmf
*guess*) ≻ cmf (era bag price) ≻ **curated_estimated** (estimate, last). For the 129 targets the brickset/cmf
rungs are null anyway, so this order rarely collides — but it keeps a real RRP from ever losing to an estimate.

---

## 2. Reuse the existing "estimated" provenance — don't invent a parallel

Two established sourced-vs-estimated mechanisms; reuse the shared pattern.

- **Cost axis — the "430 estimated at MSRP".** `setPaidProvenance` (`portfolio.js:597`) tags cost
  `source ∈ {ledger, manual, msrp, none}`; `"msrp"` = paid defaulted to retail. `costBasisBreakdown`
  (`portfolio.js:615`) splits `realCost` vs `msrpCost/msrpCount`; `estimatedCostNote` (`valueDisplay.js:246`)
  renders **"430 estimated at MSRP (~$Y)"**; row chip `paidConfidence` → "MSRP?". This is *cost*
  estimated-by-defaulting-to-MSRP — **a different axis** from "the MSRP figure itself is an estimate."
- **Value axis — the direct analog.** `isEstimateBasis` (`portfolio.js:90`, basis `modeled|modeled_thin|asking`)
  → `estimatedValueShare` (`portfolio.js:344`) renders **"% estimated"**; row chip `valueConfidence` → "est."

**Shared pattern to reuse:** *a basis/source on the `Value` → a portfolio breakdown counter → a `~`/"est."
disclosure note → a per-row marker.* The curated layer is the **third instance** (new `basis:"estimated"`
parallel to the existing `basis:"promo"`), not a new concept.

---

## 3. Partition + card after import — exact, with the promo decision

The 88 not-listed are all non-promo and route by curated tier; the 41 promos are the design crux. Today's
invariant `known + promo + notListed === total` extends to **`sourced + estimated + promo + notListed === total`**
(`known` splits into sourced+estimated; promo & notListed retained).

### The crux: 14 of the 41 promos are tier=`sourced`

The curator marked **14 GWPs sourced** — 12 confidence-A official LEGO ARVs / product pages + 2 confidence-B
Brickfact RRPs (the VIP "Adventure Ride" pair), Σ **$308.86**. The other 27 promos are estimated ($546.73). So
**routing promos purely by tier would put $308.86 of GWP ARVs into the "sourced MSRP" headline** — but a GWP ARV
is a *stated/assigned value*, not a sticker price (the card's own `RETAIL_TOOLTIP` says "current retail (sticker)
price"). That is the decision to make. Three coherent options, all exact:

| option | sourced | estimated | promo | not listed | what it does |
|---|---:|---:|---:|---:|---|
| **A · pure tier** (CSV 1:1) | **505** | **94** | 0 | 1 | route every row by its tier; matches the CSV exactly, but 14 GWP ARVs ($308.86) count as *sourced MSRP* and the promo segment vanishes |
| **B · promo→estimated** | 491 | 108 | 0 | 1 | sourced = true RRP only; all 41 GWP values labeled *estimated*; overrides the curator's "sourced" for 14 promos; promo segment vanishes |
| **C · promo keeps its bucket (now valued)** ✅ | **491** | **67** | **41** | **1** | non-promos route by tier (20 sourced + 67 est.); **all 41 promos stay in the `promo` bucket, now carrying their ARV** (14 "sourced" + 27 "est."); a GWP value never conflates with a real-set MSRP |

**Recommendation: C.** It is the only option where a GWP's value never masquerades as a sourced or estimated
*sticker* MSRP, yet the researched ARV is still surfaced — directly answering the key question: **promos stay in
their own bucket, relabeled "promo · ARV", now carrying a value** (neither folded into sourced nor estimated). It
is also the smallest conceptual delta from today's tested partition (the `promo` bucket is *retained*, gaining an
optional amount), so the invariant extends cleanly. Mechanically: `basis:"promo"` gains an `amount` (the ARV) +
a `tier`; for any `isPromoNoRetail` set, a curated value resolves to `basis:"promo"` (carrying amount+tier),
never `retail`/`estimated`.

> **Reconciliation note for C:** the CSV has 94 *estimated rows*, but the card's **estimated segment shows 67**
> — because 27 estimated rows are promos counted in the `promo` bucket. State this in the UI/docs so "94 vs 67"
> isn't read as a bug. (Under A/B the estimated segment is 94/108 and the promo segment is empty.)

### Card breakdown after (Option C)

> **491 sourced · 67 estimated · 41 promo (ARV) · 1 not listed**  (600 ✓; zero-count segments auto-omit via the
> existing `retailGapNote`).

**Headline $ — recommendation:** keep the headline = **sourced sum only** (true RRP; definition unchanged),
disclosing estimated + promo-ARV as labeled counts (and optionally "+ ~$X estimated / ~$Y promo ARV" using the
`~`/"est." idiom). Under C the sourced headline grows only by the **20 non-promo sourced** (≈$243/unit before
qty), so it stays a clean RRP figure and is *not* inflated by the $308.86 of GWP ARVs. (Folding estimated/ARV
into the headline total — the Cost-Basis-card style — is offered as a decision, not recommended for an "MSRP"
figure.)

### 30625

`tier=none`, blank msrp → no curated rung fires → falls through to today's resolution → **stays not-listed**
(its current dead-end bucket). Blank, as required.

---

## 4. Concrete provenance model + file locations

- **Source of truth:** land the CSV at **`docs/curated-msrp.csv`** (currently on the Desktop). Codegen on the
  **header names** (the column order is `…,name,year,bucket,msrp,confidence,tier,source`, not the task's brief
  order — key by name, not position).
- **Bundled module** `src/utils/curatedMsrp.js` (mirrors `cmfRetail.js` — bundled, no network, no runtime CSV
  parse), generated by `scripts/gen-curated-msrp.mjs`:
  ```js
  export const CURATED_MSRP = { "30303-1": { msrp: 3.99, tier: "sourced", confidence: "B", source: "…" }, … };
  export function curatedRetail(setNumber) { … } // → { amount, tier, confidence, source } | null  (tier:"none"/absent → null)
  ```
- **`retailFor`** adds `curated_sourced` / `curated_estimated` keys from `curatedRetail(n)`.
- **`setRetailProvenance`** — surgical: `ESTIMATED_RETAIL_SOURCES = new Set(["curated_estimated"])` tags
  `basis:"estimated"`; and for `isPromoNoRetail` sets, a resolved curated amount is tagged `basis:"promo"`
  (carrying `amount`+`tier`) instead of retail/estimated (Option C).
- **`portfolioRetail`** — add the `estimated` bucket + `estimatedTotal`; promo bucket gains an optional
  `promoValued` count / `promoTotal`. Returns `{total, known/sourced, estimated, estimatedTotal, promo, promoValued, notListed}`.
- **Per-row marker** — extend `retailSourceMarker` (`valueDisplay.js:188`): `curated_estimated` → "est.";
  `curated_sourced` → "researched" (or no chip); promo-ARV → keep the existing "Promo" treatment + the tier in
  the tooltip. Reuses the `valueConfidence`/`paidConfidence` idiom.

---

## 5. No BrickEconomy reintroduction (confirmed)

The curated source is a **static, bundled, research-derived** table (`docs/curated-msrp.csv` → `curatedMsrp.js`):
no network, no BE API, never `source:"brickeconomy"` / `basis:"brickeconomy"`. Phase 3c removed the **runtime BE
retail rung**; this adds **new, independent** provenance under its own source names, so the Phase-3c invariant
holds. (Some CSV rows *cite* "BrickEconomy original retail price" as research provenance — e.g. 30420, 30543 —
but that is a static figure copied into the maintainer table, **not** a BE fetch; the value's `source` is
`curated`, never `brickeconomy`.)

---

## 6. Net-first build outline (for review — not built)

1. **NET (red tests first).**
   - `portfolio.retail.test.js`: extend the 3-way `toEqual` to the 4-way shape (add `estimated`; keep `promo`);
     add cases — non-promo `curated_sourced`→sourced, `curated_estimated`→estimated, **promo + curated value →
     `promo` bucket carrying the amount**, `30625`→notListed. Invariant `sourced+estimated+promo+notListed===count`.
   - `setRetailProvenance` test: `curated_estimated`→basis `estimated`; `curated_sourced`(non-promo)→`retail`;
     promo+curated→`promo` w/ amount; ranking (brickset≻curated_sourced≻cmf≻curated_estimated).
   - `MyCollection.msrpCoverage.test.jsx`: extend the card text to the new "· M estimated · P promo (ARV)"
     segments; keep "71034 cmf → sourced/priced" green.
2. **Curated table.** `scripts/gen-curated-msrp.mjs` (CSV→`curatedMsrp.js`, keyed by header) + generated module;
   `curatedRetail` unit test (tier routing, `30625→null`, unknown→null, malformed/blank-msrp guarded).
3. **Ladder wiring.** `RETAIL_SOURCE_ORDER` + `ESTIMATED_RETAIL_SOURCES` + the promo-override; `retailFor` keys.
4. **Partition.** `portfolioRetail` estimated/promo-valued buckets → makes step-1 NET pass.
5. **Card.** `retailEstimatedNote` (+ promo-ARV note) formatter; render the 4-segment sub; `retailSourceMarker`
   curated branch; the "94 vs 67" reconciliation note.
6. **Docs.** Update `docs/msrp-gap-sets.md` (coverage now "491 sourced + 67 estimated + 41 promo-ARV; not-listed
   → 1") and this plan's "as-built". **Pre-clear gate:** clean tree, tests green, docs match.

### Decisions to confirm before any build
1. **Promo handling:** **C** (own bucket, valued — recommended) vs A (pure tier; GWP ARVs → sourced) vs B (all promo → estimated).
2. **Headline $:** sourced-only + "(~$X est.)" disclosure *(recommended)* vs sourced+estimated total.
3. **Confidence/quality gate:** surface confidence (A/B/C/D) per row? Treat the 12 magazine $7.37 + 36 "$4.99 polybag standard" placeholders any differently (e.g. a "low-confidence" sub-flag)? 30566 is a £→$ conversion ($4.68) tagged sourced — keep as sourced or mark "converted"?
4. **Sourced-curated marker:** "researched" chip vs treat as canonical (no chip).
5. **Codegen vs hand-authored** `curatedMsrp.js` (recommend codegen; CSV stays single source of truth).
