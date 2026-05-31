# BrickLedger — Engineering Operating Protocol

How work is done in this repo. This doc **states** the process; for any concrete repo fact
(CI path, lint rule, choke point, fixture, decision rationale) it **points at** the canonical
source rather than restating it — so the protocol can't drift from the thing it describes.

## Orientation block (start every working session with this)

Mirror the fresh-session header that [`docs/security.md`](security.md) opens with:

- **Date** — today's date.
- **Commit** — the latest commit you're grounded on (`git rev-parse --short HEAD`).
- **Precondition** — *verify clean tree + N green before touching anything.* Run
  `git status --porcelain` (expect empty) and `npm test` (expect the known count, currently
  235). If either disagrees with what the task claims, **stop and report** — don't build on a
  surprise.

---

## Act carefully (before you change risky code)

1. **Net-first.** Characterize risky code with a *failing* test before you change it — data-destruction
   and sync paths first. POINT-AT: the worked example is the Phase D–F arc in [`docs/audit-action-plan.md`](audit-action-plan.md).
2. **STEP 0 inventory pass.** Before any destructive or wide change, map what exists first; don't guess scope.
   The worked catch: enumerate every consumer via the single registry — POINT-AT: `BACKUP_KEYS` in
   [`src/utils/exportBackup.js`](../src/utils/exportBackup.js).
3. **Diff before apply** on production code. Show the before/after and confirm intent before writing —
   a distinct discipline from #11 (this is *pre*-write review; that's *post*-hoc grounding).

## Phase and commit

4. **Phased work, commit-per-step, each phase ends green.** Split work into phases; every phase lands
   complete with lint + tests passing. POINT-AT: the phase structure in [`docs/audit-action-plan.md`](audit-action-plan.md)
   (Phases D–G) is the template.
5. **Pre-clear gate** — before a `/clear` or phase boundary, all four must hold:
   - [ ] **Committed + clean tree** (`git status --porcelain` empty).
   - [ ] **Docs match reality** (anything you changed is reflected in its canonical doc).
   - [ ] **Tests green** (`npm test` at the known count).
   - [ ] **Resume prompt ready** (see #6).
6. **Resume prompts, fresh-session style.** Hand off with: orientation block (Date / latest commit /
   "verify clean tree + N green"), the discipline for the next step, and the next concrete action.

## Lock by construction

7. **Make bug-classes impossible, don't just document them.** Prefer a lint rule, a dynamic test, or a
   single read-funnel + convention over prose nobody reads. POINT-AT:
   - DATA-4 raw-`setItem` ban → [`eslint.config.js`](../eslint.config.js).
   - SEC-GAP-2 every-`/api`-handler-authenticates → the api-auth dynamic test.
   - 0 = unknown (value) → the `valueAmount()` read-funnel in [`src/utils/value.js`](../src/utils/value.js),
     guarded by `value.zero-unknown.test.js`.

## Docs and decisions

8. **Docs reconciled to reality; point at code-canonical facts, never duplicate.** When a doc and code
   disagree, code wins — the doc is a navigational map, not a second source of truth (the `BACKUP_KEYS`
   lesson). POINT-AT: the "registry wins" framing in [`docs/valuation.md`](valuation.md).
9. **Decisions recorded to disk with rationale + status — the D1/D2 pattern.** The *why* behind each
   choice lives in the plan doc, not in chat; each decision carries a status (OPEN → RESOLVED/RATIFIED).
   This is what makes a `/clear` safe — the reasoning survives the context window. POINT-AT: the D1/D2
   decisions in [`docs/value-layer-plan.md` §5](value-layer-plan.md) (RATIFIED 2026-05-31).

## External data

10. **Pin external data with fixture/contract tests captured from real payloads.** Don't hand-author
    fixtures; capture them live and lock a test to the shape. POINT-AT: [`test-data/be-fixtures/README.md`](../test-data/be-fixtures/README.md).

## Verify against ground truth

11. **Per-phase push → CI re-verifies in a clean env.** Every push runs lint + tests on a fresh checkout;
    trust the Actions run, not channel narration, that a phase is green. POINT-AT: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
12. **Batched / garbled-output guard.** If output looks batched or scrambled, re-ground on git + files —
    trust `git`, CI, and screenshots over narrated "I committed / it passed" claims (distinct from #3:
    that's reviewing a diff you're about to write; this is distrusting a claim already made).
13. **Browser-observable changes end with a real UI smoke.** Seed real fixtures, run the preview, observe
    the actual UI — don't call a previewable change done on tests alone (ties to CLAUDE.md "Goal-driven
    execution" + the preview workflow).

## Scope

14. **Scope discipline.** No mid-phase scope creep. Record out-of-scope findings for a future arc — park
    them in [`docs/roadmap.md`](roadmap.md) rather than chasing them now (the "out of scope" precedent in
    [`docs/security.md`](security.md)).

---

This doc obeys its own rule #8: it **points** at canonical sources rather than copying them, so it can't
drift from the lint config, CI file, registry, or decision log it describes. A resume prompt can orient a
fresh session from here — read the orientation block, run the precondition check, then the relevant cluster.
