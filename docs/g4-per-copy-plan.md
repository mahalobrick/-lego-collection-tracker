# G4 / Per-Copy Unification — Phased Plan (DRAFT for review)

**Companion to:** [g4-per-copy-discovery.md](g4-per-copy-discovery.md) (the read-only map).
**Status:** Proposal. Not started. Review before the first CC prompt.

## Decisions taken (the fork from discovery §4)
- **Spine = Hybrid.** Synthesize per-copy view on read; persist real `entries[]` only on
  the **first per-copy edit** of a manual set. No big-bang `migrate.js` rewrite.
  *Why:* mirrors the established read-time precedent (`setConditionDisplay`,
  `valueGroups`), upgrades storage one touched set at a time, and is reversible until a
  user actually diverges a copy.
- **Manual sets keep their own key** (`blOwnedSets`), gaining an `entries[]` when edited.
  They do **not** merge into `brickEconomyNormalizedCollection`.
  *Why:* merging drags in the promotion/dedup join and the BE value-sync's row-vs-entries
  semantics — exactly the entanglement we want to keep out of phase one.
- **No storage migration ships in this workstream.** Existing manual records stay
  line-level until touched; the read funnel makes that invisible. The guard test asserts
  the mixed-shape tail is tolerated.
- **Why hybrid beats a one-time `migrate.js` v4:** lazy synthesize-on-read +
  persist-on-edit upgrades only the records a user actually touches, leaning on the
  existing `blOwnedSets` persist effect — so there is no boot-time rewrite of the whole
  collection and no forced sync round-trip of every record, just to add a shape almost no
  set will ever per-copy-edit.

## Acceptance bar — money-neutrality (Phases 1–4)
Materializing per-copy entries changes **only** the per-copy view and per-copy editing. It
must **NEVER** move a headline aggregate — portfolio value, cost basis, net gain, or ROI —
nor the fix-#4 headline reconcile (the `valueKnown` predicate / known-count split must not
regress). Phase 0 snapshots these exact outputs; Phases 1–4 must reproduce them
byte-for-byte. Any phase that moves a money snapshot is wrong by construction, not a
"recompute the baseline" situation.

## Two design invariants to hold throughout
1. **Value stays overlay-driven, never frozen into `entries[]`.** When we persist a
   materialized manual `entries[]`, each copy's `current_value` is `null` (lazy) — exactly
   how the promote path writes it ([beCollection.js:118-133](../src/utils/beCollection.js)).
   Freezing a number would re-open the stale-`current_value` trap (discovery §2).
2. **Lean on the existing persist effect.** `blOwnedSets` is already re-written on every
   `sets` change ([MyCollection.jsx:317-321](../src/MyCollection.jsx)). So once a manual set
   in state carries `entries[]`, it persists **for free** — the write path is mostly
   "put `entries[]` on the in-memory record," not new storage plumbing.

---

## Branch & cadence
- Feature branch `g4-percopy` (multi-phase). One clean green commit per phase; CI green
  before the next. Found-during-work fixes get their own commits.
- Each phase below is one CC prompt. Net-first: Phase 0 lands the characterization net
  before any behavior moves.

---

## Phase 0 — Characterization net (no behavior change)
**Goal:** pin today's behavior so every later phase visibly flips a known line.
- New `src/utils/percopy.characterization.test.js`:
  - manual set vs `entries[]`-backed set with identical holdings → **identical**
    value/gain/ROI (locks the "money is already correct" finding so refactors can't move it).
  - manual set → SetDetailPanel per-copy section **absent**; entries set → **present**.
  - qty edit on a BE set → **does not persist** + `entries.length` unchanged (characterize
    the *current* defect, so Phase 4 flips it red→green).
**Exit:** tests green, documenting the status quo. **Risk:** none (test-only).

## Phase 1 — The read funnel `materializeEntries(set)` (utils + test only, not wired)
**Goal:** one materializer, the `entries` analog of `valueGroups`.
- New module `src/utils/percopy.js` → `materializeEntries(set)`:
  - `entries[]`-backed set → passthrough (its real copies).
  - manual set → `qty` identical descriptors `{ condition: set.condition, paid_price,
    current_value: null, … }` (lazy value, invariant #1).
  - Pure, total over both shapes, never throws on a missing `entries[]`.
- Unit test `src/utils/percopy.test.js`.
- **Not wired to any component yet** — same shape as condition.js's Phase-1 "utils + guard
  test only."
**Exit:** module + test green. **Risk:** none (dead code until Phase 2).

## Phase 2 — Wire DISPLAY through the funnel (additive, read-only)
**Goal:** kill the *viewing* asymmetry — manual sets show a Per-Copy Breakdown too.
- SetDetailPanel renders per-copy rows from `materializeEntries(item)` instead of
  `item.entries` directly ([SetDetailPanel.jsx:217-294](../src/SetDetailPanel.jsx)).
- For a manual set the rows render **read-only** (no edit buttons yet — editing is Phase 3).
- The Phase-0 "per-copy section absent for manual" test flips; update it to assert
  "present, read-only."
**Exit:** manual sets display per-copy rows; money unchanged. **Risk:** low — display only,
no writes.

## Phase 3 — The write path: persist-on-first-per-copy-edit
**Goal:** per-copy **condition** editing works on manual sets, uniformly.
- `editCopyCondition` ([MyCollection.jsx:1166-1175](../src/MyCollection.jsx)): drop the
  `source === "BrickEconomy"` early return. For a manual set, materialize → apply the
  per-copy patch → set `entries[]` on the in-memory record. The existing `blOwnedSets`
  effect persists it (invariant #2). BE sets keep their current blob-persist path.
- SetDetailPanel shows the per-copy condition buttons for manual sets now too.
- Test: editing one copy of a 2-qty manual set → record gains a real `entries[]`, set reads
  **Mixed**, survives reload.
**Exit:** per-copy condition editing uniform across both stores. **Risk:** medium — first
real write path; the characterization net + the reload test are the guard.

## Phase 4 — Qty unification (closes backlog #2, **both** halves)
**Goal:** changing qty means add/remove a copy, uniformly — the dead-number defect dies.
- `updateSet(…, "qty", …)` ([MyCollection.jsx:1177-1217](../src/MyCollection.jsx)):
  - materialize first, then **add/remove `entries[]` rows** to match the new qty (new rows
    inherit the set-level condition, `current_value: null`).
  - **BE set:** add a `"qty"` branch to the blob persist so it actually saves (the backlog
    #2 persistence gap) AND `entries.length` now tracks qty (the desync half).
  - **Manual set:** persists via the existing effect.
- The Phase-0 qty defect test flips red→green.
**Exit:** qty is meaningful and persistent on both stores. **Risk:** medium — touches the
value copy-count; the identical-holdings characterization test guards the totals.

## Phase 5 — Lock the class (guard test + lint ban)
**Goal:** make the dual-store footgun unrepresentable going forward.
- Have `valueGroups` delegate to `materializeEntries` so there is literally **one**
  materializer (behavior-identical; the Phase-0 identical-holdings test proves it).
- `src/utils/percopy.invariant.test.js`: the chosen invariant (tolerance during the tail,
  trending to "per-copy reads route through the funnel").
- `eslint.config.js`: a `no-restricted-syntax` esquery selector banning bare
  `<set>.entries.map(` / `<set>.entries[` **outside** the funnel module, exempting
  `percopy.js` + `portfolio.js` + `condition.js` (same machinery and same honest
  "guarded reads can't be caught" caveat as `noUnknownAsZero`).
**Exit:** class guarded by test + lint. **Risk:** low — codifies the end state.

## Out of scope (separate commits, only if you want them)
- `rowsToCollectionSets` dropping condition on import (discovery §7).
- `aquired_date` misspelling cleanup (discovery §7).
- Dead `origin: "purchase"` marker (discovery §7).

---

## Sequencing rationale
Net-first (P0) → inert funnel (P1) → display (P2) → write (P3) → qty (P4) → lock (P5) is
**strictly additive**: each phase is independently shippable and green, the risky writes
(P3/P4) land only after the characterization net and the read funnel exist, and the lint
ban (P5) comes last so it can't fight code that's still mid-migration. The hybrid spine
means we never run a boot-time migration over everyone's data — the worst-case blast radius
of any phase is one set the user just touched.
</content>
