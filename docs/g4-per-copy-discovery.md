# G4 / Per-Copy Data-Model Unification — Read-Only Discovery

**Status:** Discovery only. No code changed. Decision deferred.
**Scope:** Map the dual store (line-level vs per-copy `entries[]`), every read/write
path that assumes one shape, the migration/backfill option space, the qty + sync
entanglements, and where a guard test / lint ban would close the class.

**Net finding up front:** the dual store is real, but it is **not** a numbers bug.
The value/cost/gain/ROI layer already normalizes both shapes at read time
(`valueGroups`, below), so a manual (no-`entries[]`) set reports correct money.
The split bites **per-copy *editing* and display**: the SetDetailPanel "Per-Copy
Breakdown" and per-copy condition editing are gated on `entries.length > 0`, so
manual sets silently lack them. No read path crashes on a missing `entries[]` —
every `.entries` access is guarded (`|| []`, `Array.isArray`, `?.`). The split is
a **missing-feature** class, not a crash or a wrong-total class — except the qty
inline-edit, which *is* a live defect on `entries[]`-backed sets (§5).

---

## 1. Creation paths — manual vs imported vs promoted

There are **two physical stores**, both in `BACKUP_KEYS`:

| Store (localStorage key)            | Shape                          | Carries `entries[]`? |
|-------------------------------------|--------------------------------|----------------------|
| `blOwnedSets`                       | line-level records             | **No**               |
| `brickEconomyNormalizedCollection`  | per-set blob rows with `entries[]` | **Yes**          |

They are loaded and concatenated in `MyCollection`'s `useState` initializer
([MyCollection.jsx:161-232](../src/MyCollection.jsx)): blob rows are mapped into UI
rows that carry `entries`, manual rows are loaded as-is (filtered to
`source !== "BrickEconomy"`), then `[...beItems, ...manualItems]`.

### Path A — Imported (entries[]-backed) → the blob
- **BrickEconomy CSV import**: `AppSettings.importBrickEconomyCSV` →
  `normalizeBrickEconomyCollection` ([beCollection.js:58-80](../src/utils/beCollection.js)),
  persisted to `brickEconomyNormalizedCollection` ([AppSettings.jsx:624](../src/AppSettings.jsx)).
  Each raw CSV row is pushed verbatim into `entries[]` ([beCollection.js:77](../src/utils/beCollection.js))
  and the row is rolled up by `aggregateFromEntries` ([beCollection.js:28-48](../src/utils/beCollection.js)).

  Persisted blob row (representative):
  ```js
  {
    setNumber, name, theme, subtheme, year, pieces, retired,
    quantity,                 // == entries.length
    totalPaid, totalValue, totalRetailPrice,
    averagePaid,              // totalPaid / quantity
    retailPrice,              // totalRetailPrice / quantity
    unrealizedGain,           // totalValue - totalPaid
    roiPct,                   // null when totalPaid == 0
    entries: [ /* one per physical copy — raw CSV rows, see §2 */ ],
  }
  ```

### Path B — Manual (line-level, **no** `entries[]`) → `blOwnedSets`
Three writers, all producing a flat record:
- **Add-Set form**: `addSet` ([MyCollection.jsx:855-872](../src/MyCollection.jsx)).
  Persisted shape:
  ```js
  {
    ...lookupData,            // Brickset metadata (pieces, minifigs, dates, retired)
    ...form,                  // setNumber, name, theme, condition, qty, notes, ...
    qty,                      // a scalar number — NOT entries.length
    paidPrice,
    msrp, retailPrice,        // manualMsrpPatch(form.msrp)
    currentValue,
    addedAt,
    // condition is a SINGLE set-level string; source is undefined (≠ "BrickEconomy")
  }
  ```
- **Generic CSV/JSON import**: `applyCollectionImport` →
  `rowsToCollectionSets` ([AppSettings.jsx:515-543](../src/AppSettings.jsx)) — emits
  `{ setNumber, name, theme, qty, paidPrice, currentValue, notes }`. (Drops condition;
  see §7.)
- **Brickset "My Sets" CSV import**: `importBricksetMySetCSV`
  ([AppSettings.jsx:631-646](../src/AppSettings.jsx)) — appends `parseBricksetMySetCSV`
  rows tagged `source: "Brickset"`, line-level.

### Path C — Promoted from Wanted / Budget (entries[]-backed) → the blob
A promoted purchase produces a **byte-identical per-copy shape to an import**, by
design (the promotion-laundering fix's single-writer invariant):
- Wanted: `promoteToCollection(buildCopyEntries({…}))` ([WantedList.jsx:204](../src/WantedList.jsx)).
- Budget: same call ([BudgetDashboard.jsx:1175, 1236](../src/BudgetDashboard.jsx)).
- `buildCopyEntries` ([beCollection.js:118-133](../src/utils/beCollection.js)) makes
  `qty` identical per-copy items; `promoteToCollection`
  ([beCollection.js:222-229](../src/utils/beCollection.js)) folds them into the blob
  (`promoteIntoBlob`, append-or-create) and writes **only** the blob — `blOwnedSets`
  is never touched.

  Per-copy item written by `buildCopyEntries`:
  ```js
  {
    set_number, name, theme,
    condition,                // param-driven (default "new")
    paid_price,               // Number(paidPerUnit) || 0
    current_value: null,      // LAZY — never seeded from paid/MSRP
    retail_price: retail ?? null,
    acquired_date, origin: "purchase", notes: "",
  }
  ```

### Divergence
- **Only Path B lacks `entries[]`.** Paths A and C are both per-copy. So the "dual
  store" is precisely **`blOwnedSets` (3 writers) vs the blob (2 writers)**.
- A promoted set folding onto an existing **manual-only** match is **skipped and
  surfaced** as a warning ([beCollection.js:198-201](../src/utils/beCollection.js)) —
  the dual store is the explicit reason it declines to merge ("can't combine a legacy
  flat manual entry and a blob row without the (deferred) dual-store unification").
  **This discovery's workstream is what that comment defers to.**

---

## 2. `entries[]` record shape

Two sub-shapes share one logical schema (snake/Title-case readers absorb the import
variant):

| Field (canonical)         | Import (Path A) reader                | Promote (Path C) writer | Read at |
|---------------------------|---------------------------------------|-------------------------|---------|
| `condition`               | `condition`                           | `condition`             | [condition.js:52-63](../src/utils/condition.js), [portfolio.js:68](../src/utils/portfolio.js), [SetDetailPanel.jsx:223-256](../src/SetDetailPanel.jsx) |
| `paid_price` / `Paid`/`paid` | any                                | `paid_price`            | [portfolio.js:411,537](../src/utils/portfolio.js), [SetDetailPanel.jsx:11](../src/SetDetailPanel.jsx), [beCollection.js:32](../src/utils/beCollection.js) |
| `current_value`/`Value`/`value` | any                              | `current_value: null`   | [portfolio.js:70](../src/utils/portfolio.js), [SetDetailPanel.jsx:229](../src/SetDetailPanel.jsx), [beCollection.js:33](../src/utils/beCollection.js) |
| `retail_price`/`Retail`   | any                                   | `retail_price`          | [beCollection.js:34](../src/utils/beCollection.js) |
| `acquired_date` (also misread as `aquired_date`) | both spellings     | `acquired_date`         | [MyCollection.jsx:177](../src/MyCollection.jsx), [SetDetailPanel.jsx:240](../src/SetDetailPanel.jsx) |
| `notes`                   | `notes`                               | `notes: ""`             | [MyCollection.jsx:212](../src/MyCollection.jsx) |
| `origin`                  | (absent)                              | `origin: "purchase"`    | provenance marker — **written but not read anywhere** found |
| `retired_date`, `released_date`, `minifigs_count`, `pieces_count` | import-only | (absent) | `entries[0]` only, [MyCollection.jsx:183-211](../src/MyCollection.jsx) |

**Per-copy fields actually written post-creation:**
- `condition` → `reconcileConditionEdit` ([portfolio.js:439,441](../src/utils/portfolio.js)).
- `paid_price` → `reconcilePaidEdit` ([portfolio.js:411](../src/utils/portfolio.js)).
- whole `entries[]` re-aggregated on promote-append ([beCollection.js:186](../src/utils/beCollection.js)).

**Note:** `entries[].current_value` is import-time/stale by design — the BE value-sync
writes the **row's** `totalValue`, not `entries[].current_value`
([beCollection.js:181-194](../src/utils/beCollection.js)). Any backfill/migration that
re-derives row value from `entries[]` would silently revert synced value.

---

## 3. Line-level vs per-copy assumption inventory

### Handles both (normalizes between shapes) — the existing bridges
- **`condition.js setConditionDisplay`** ([condition.js:51-64](../src/utils/condition.js)) —
  `entries[]` → New/Used/**Mixed**; manual → `conditionBucket(set.condition)`, never Mixed.
  *The read-time condition-normalization precedent.*
- **`portfolio.js valueGroups`** ([portfolio.js:65-74](../src/utils/portfolio.js)) —
  `entries[]` → one group per copy; **manual → a single group of `qty` same-condition
  units** (`units: asNumber(s.qty) || 1`). *The reason manual money is correct.* Feeds
  `resolveCopies` → `blOverlayValue` → all of value/gain/ROI.
- **`reconcilePaidEdit`** ([portfolio.js:406-414](../src/utils/portfolio.js)) — always
  patches `totalPaid`; patches `entries[].paid_price` only when present.
- **`reconcileConditionEdit`** ([portfolio.js:433-442](../src/utils/portfolio.js)) —
  manual → `{ condition }` set-level; `entries[]` → per-copy/bulk patch.
- **`paidEqualsRetail`** ([portfolio.js:531-543](../src/utils/portfolio.js)) —
  `(s.entries || []）` with `qty` fallback.
- **MyCollection BE loader** ([MyCollection.jsx:172-214](../src/MyCollection.jsx)) — maps
  blob `entries[]` → UI row; manual loaded raw ([MyCollection.jsx:220-225](../src/MyCollection.jsx)).
- **`allEntries` flatMap** ([MyCollection.jsx:534](../src/MyCollection.jsx)) —
  `s.entries?.length ? s.entries : [{ condition, current_value, retired }]` synthesizes a
  single pseudo-entry for manual sets (already a read-time materialize, in miniature).

### Assumes per-copy (`entries[]`) — degrades on manual sets
- **SetDetailPanel "Per-Copy Breakdown"** ([SetDetailPanel.jsx:217-294](../src/SetDetailPanel.jsx)) —
  rendered only when `entries.length > 0`. Manual set → **section hidden** (silent
  missing feature; no crash).
- **Per-copy condition edit** `editCopyCondition` ([MyCollection.jsx:1166-1175](../src/MyCollection.jsx)) —
  early-returns unless `source === "BrickEconomy"`; `onEditCopyCondition` is only wired
  when `detailSet.entries.length` ([MyCollection.jsx:2076-2077](../src/MyCollection.jsx)).
  Manual set → **per-copy editing unavailable**.
- **`openSetDetail`** ([SetDetailPanel.jsx:30-35](../src/SetDetailPanel.jsx)) — re-reads
  the blob by setNumber; returns `null` for a manual set, so the panel falls back to the
  in-memory line-level `s` (the panel's `item` shape thus differs by source — see §7).

### Assumes line-level (`qty` scalar, single `condition`)
- **`addSet`** ([MyCollection.jsx:855-872](../src/MyCollection.jsx)) — creates a
  line-level record.
- **Edit form** ([MyCollection.jsx:2545-2583](../src/MyCollection.jsx)) — single
  condition pill ([2563](../src/MyCollection.jsx)), scalar `qty` input ([2574](../src/MyCollection.jsx)).
- **Qty inline cell** ([MyCollection.jsx:2453-2475](../src/MyCollection.jsx)) → `updateSet(…, "qty", …)`.
- **`rowsToCollectionSets`** / **`importBricksetMySetCSV`** (AppSettings, §1 Path B).

### What a manual set does with no `entries[]` (per requirement)
- Money (value/cost/gain/ROI): **correct** — `valueGroups` synthesizes `qty` units.
- Condition: shows a single New/Used bucket; **never Mixed**.
- Per-copy panel + per-copy condition edit: **silently absent** (not a crash, not a $0).
- Qty: a real editable field (persists; see §5) — opposite of the BE-set qty defect.

---

## 4. Migration / backfill question

### The read-time precedent
- Condition: `setConditionDisplay` ([condition.js:51-64](../src/utils/condition.js)) — the
  binary/Mixed view is **derived on every read**, nothing "mixed" is ever stored.
- Value: `valueGroups` ([portfolio.js:65-74](../src/utils/portfolio.js)) already
  **synthesizes a per-copy view of a manual set at read time** (`qty` identical units).
- One-time storage migration precedent: `migrate.js`
  ([migrate.js:16-55](../src/utils/migrate.js)) — `blMigrated_vN` flags, runs on boot,
  idempotent, skips applied steps.

### Can read-time synthesis produce `entries[]` for a manual set?
**Yes, for display** — a `materializeEntries(set)` peer of `valueGroups` could emit `qty`
copies, each `{ condition: set.condition, paid_price: paidPrice, current_value: …, … }`.
This is exactly what `valueGroups`/`allEntries` already do internally.

**Reconstructable** from a line-level record: copy *count* (`qty`), each copy's
*condition* (= the set-level one), *paid* (`paidPrice` or `totalPaid/qty`), *value* (via
the overlay). **Not reconstructable:** per-copy *divergence* — a different condition,
paid, value, or acquired-date per copy. A synthesized `entries[]` is N **identical**
copies; the single `acquiredDate` cannot be spread to distinct per-copy dates.

**The hinge:** synthesis is fine until the **first per-copy edit**. The moment a user
flips one copy of a manual set to Used, that divergence has nowhere to live unless real
`entries[]` is **persisted** for that set. So any read-time path needs a companion
write-on-first-edit story.

### Option space (mapped, not chosen)
1. **Read-time-only synthesis.** `materializeEntries(set)` on read; never persisted.
   *Pro:* zero migration, fully reversible, mirrors the condition precedent.
   *Con:* per-copy *edits* need a separate persist path; on its own it makes the panel
   *render* per-copy rows but can't yet *save* a divergent edit.
2. **One-time storage migration** (`migrate.js` v4). Walk `blOwnedSets`, attach
   `entries[]` derived from `qty`/`condition`/`paidPrice`, write back.
   *Pro:* one shape afterward; consumers simplify.
   *Con:* must round-trip through sync + dedup-hash (§5); irreversible-ish; still leaves
   the **two-key** split (`blOwnedSets` vs blob) unless it also decides whether manual
   sets move into the blob.
3. **Hybrid: synthesize-on-read + persist-on-first-per-copy-edit.** Display via
   `materializeEntries`; the first per-copy edit writes real `entries[]` back to
   `blOwnedSets` for that set only.
   *Pro:* no big-bang; data upgrades lazily, only when touched.
   *Con:* a long-lived mix of shapes in one key; two code paths during the tail.

*(Independent sub-decision under any option: do manual sets keep their own
`entries[]`-bearing `blOwnedSets` key, or get merged into
`brickEconomyNormalizedCollection`? That changes §5's sync surface.)*

---

## 5. Entanglements

### Qty inline-edit — a live BE-set defect (backlog #2 is half of it)
Flow: cell ([MyCollection.jsx:2453-2475](../src/MyCollection.jsx)) →
`updateSet(index, "qty", value)` ([MyCollection.jsx:1177-1217](../src/MyCollection.jsx)).
- `field === "qty"` runs `reconcilePaidEdit` ([1187](../src/MyCollection.jsx)) → recomputes
  `totalPaid` and remaps `entries[].paid_price`, **but does not change `entries[].length`**.
- The persist branch ([1195-1216](../src/MyCollection.jsx)) matches only
  `paidPrice` / `condition` / `msrp` for BE sets — **`"qty"` matches none**, so it falls to
  the `else` ([1215](../src/MyCollection.jsx)): `setSets` only, **in-memory**.

Consequences split by shape:
- **BE / `entries[]`-backed set:** (a) the new qty **never persists to the blob → reverts
  on reload** (this is backlog #2's "persistence gap"); (b) `entries[].length` is unchanged,
  so blob `quantity` and the per-copy view **desync**, and because value counts **entries**
  (`valueGroups` → one per entry), bumping qty **adds no value copy and no per-copy row** —
  qty becomes a dead number. *The desync (b) is the more misleading half and is not named
  in backlog #2 (see §7).*
- **Manual / line-level set:** `qty` is a real scalar; `valueGroups` uses `units: qty`,
  `reconcilePaidEdit` updates `totalPaid`, and the `blOwnedSets` persist effect
  ([MyCollection.jsx:317-321](../src/MyCollection.jsx)) writes it. **Persists correctly.**

So qty is the one inline field whose correctness is *inverted* by the dual store: right on
manual sets, broken on `entries[]`-backed sets. Unifying onto `entries[]` is what lets a
qty change mean "add/remove a copy" uniformly.

### Cloud sync / BACKUP_KEYS
- **Both** keys are registered: `blOwnedSets` → `ownedSets` and
  `brickEconomyNormalizedCollection` → `brickEconomyNormalized`, `kind: "array"`,
  `census: true` ([exportBackup.js:128-130](../src/utils/exportBackup.js)).
- An `entries[]` shape change **rides sync as-is**: build/apply/push/dedup-hash all derive
  from this one registry, and arrays are serialized whole. The dedup hash is content-based,
  so a shape change just yields a new hash — **no census/hash code change needed** for
  options that keep the same keys (read-time synthesis, or migration writing `entries[]`
  back into `blOwnedSets`).
- The census sums **both** keys (`countList(blOwnedSets) + countList(brickEconomyNormalized)`,
  [exportBackup.js:103](../src/utils/exportBackup.js) and [221](../src/utils/exportBackup.js)),
  so even the "merge manual sets into the blob" sub-option keeps the count correct.
  **Only** a *key rename/removal* would touch the registry — none of the §4 options require it.

---

## 6. Guardability — making the dual-store class impossible

### Guard test (precedent: [value.zero-unknown.test.js](../src/utils/value.zero-unknown.test.js), [exportBackup.integrity.test.js](../src/utils/exportBackup.integrity.test.js))
- A new `src/utils/percopy.invariant.test.js` pinning the chosen invariant. Two candidate
  shapes depending on the §4 decision:
  - *Pre-unification (tolerance):* "every per-copy read tolerates a missing `entries[]`"
    (manual set → no throw, money equals the entries-backed equivalent).
  - *Post-unification (construction):* "every persisted owned set carries `entries[]` of
    length `qty`" — a lock-by-construction invariant that makes a line-level record
    unrepresentable.
- A characterization test (peer of `valueGain.characterization.test.js`) pinning that a
  manual set and an `entries[]`-backed set with identical holdings produce identical
  value/gain/ROI — so a migration can't silently move a number.

### Lint ban (precedent: `noRawSetItem` / `noUnknownAsZero` in [eslint.config.js](../eslint.config.js))
- Same machinery: a `no-restricted-syntax` esquery selector banning bare per-copy reads
  (`<set>.entries.map(` / `<set>.entries[`) **outside** a sanctioned funnel module — forcing
  per-copy access through a single `forEachCopy(set)` / `materializeEntries(set)` (the
  `entries` analog of `valueGroups` / `setValueProvenance`), with file-scoped overrides for
  the funnel module + `condition.js` + `portfolio.js` (exactly how the value ban exempts
  `valueDisplay.js`/`portfolio.js`/`value.js`).
- **Honest known gap** (mirroring the existing rules' own caveats): guarded reads
  (`s.entries || []`, `Array.isArray(s.entries)`) are legitimate and structurally
  indistinguishable from the funnel's own internals to esquery — so convention + the guard
  test own that gap; the lint only stops a *bare unguarded* per-copy read creeping into a
  component.

---

## 7. Found-during-discovery (logged, NOT fixed)

- **Qty/BE desync is two defects, backlog #2 names one.** Beyond the persistence gap (§5),
  editing qty on a BE set leaves `entries[].length` (and the per-copy view + value copy
  count) untouched — so qty silently means nothing on those sets. The display-desync half
  is the more misleading one and isn't captured in backlog #2's wording.
- **`rowsToCollectionSets` drops condition** ([AppSettings.jsx:515-524](../src/AppSettings.jsx)) —
  generic CSV/JSON import maps no condition column, so imported manual sets default to "new".
  Data-fidelity gap, not per-copy-specific.
- **`aquired_date` misspelling** is read alongside `acquired_date`
  ([MyCollection.jsx:177](../src/MyCollection.jsx), [SetDetailPanel.jsx:240](../src/SetDetailPanel.jsx))
  but the promote writer emits the correct `acquired_date`
  ([beCollection.js:128](../src/utils/beCollection.js)) — the misspelled branch now only
  matches legacy BE-CSV import data. Latent inconsistency.
- **Panel `item` shape varies by source** — `openSetDetail`
  ([SetDetailPanel.jsx:30-35](../src/SetDetailPanel.jsx)) hands the panel a *blob row* for BE
  sets but the *UI row* `s` for manual sets. Tolerated today, but a second place the dual
  shape leaks to a consumer boundary.
- **`origin: "purchase"`** ([beCollection.js:129](../src/utils/beCollection.js)) is written
  to promoted copies but read nowhere found — dead provenance unless a future feature uses it.

---

## Appendix — file/line index
- `src/utils/beCollection.js` — aggregation, `buildCopyEntries`, `promoteIntoBlob`, `promoteToCollection`
- `src/utils/condition.js` — `conditionBucket`, `setConditionDisplay` (read-time precedent)
- `src/utils/portfolio.js` — `valueGroups`/`resolveCopies` (both-shape value), `reconcilePaidEdit`, `reconcileConditionEdit`, `paidEqualsRetail`
- `src/utils/migrate.js` — one-time `blMigrated_vN` migration precedent
- `src/utils/exportBackup.js` — `BACKUP_KEYS`, census
- `src/MyCollection.jsx` — loader/merge, `addSet`, `updateSet`, `editCopyCondition`, qty cell
- `src/SetDetailPanel.jsx` — per-copy breakdown (gated on `entries.length`)
- `src/AppSettings.jsx` — BE CSV import (blob), generic + Brickset import (line-level)
- `eslint.config.js` — `noRawSetItem` / `noUnknownAsZero` ban precedent
</content>
</invoke>
