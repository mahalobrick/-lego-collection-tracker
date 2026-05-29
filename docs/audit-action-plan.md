# BrickLedger — Audit Action Plan

> Companion to `docs/architecture-audit.md` (audit `w3xaymfl9`, committed `7cfbaa9`).
> The audit's checklist lists findings by severity. **This doc sequences the work** — it
> groups findings by shared root cause and orders them so we never refactor untested
> destruction logic before the tests that make it safe exist.

## The core insight

Several top findings are the **same bug in different places**, not independent issues:

| Symptom finding | Shared root cause |
|---|---|
| `SYNC-CRIT-1` — census (`summarizeLocal`, 3 buckets) narrower than overwrite scope (`applyBackupToLocalStorage`, ~15 keys) | No single canonical definition of "the user's data keys" — census, overwrite, push-guard, and wipe each carry their own ad-hoc list, and they've drifted |
| `A4` — sign-out wipe destroys never-pushed data | (same) |
| `OBS-2` — 111 unguarded `setItem` → silent quota loss | No single guarded write path |
| `DATA-4` — code bypasses the patched `setItem` | (same) |

Both root causes are instances of the audit's architectural finding: **schema-less
`localStorage` with no data layer.** So the durable fix is structural — make the class
impossible — not patch each instance. (Same lesson as the falsy-zero budget bug.)

**The tension:** `SYNC-CRIT-1` is actively losing data (fix now), but the clean fix
refactors destruction logic that currently has **zero tests** (don't refactor blind).
The sequence below resolves it: stopgap → test → refactor.

---

## Sequence

### 1. Stopgap the Critical — minimal, now
**Closes:** `SYNC-CRIT-1`
- Widen the `summarizeLocal` census to match `applyBackupToLocalStorage`'s full key set.
- Gate the fresh-device pull behind the existing `cloudNewer` / `localDirty` guard.
- Small, targeted, no refactor. Just stop the silent overwrite.
- **Do not** restructure anything else in this step.

### 2. Lock it with regression tests
**Addresses:** zero-tests gap on the highest-stakes path; protects step 3
- Turn the red-team repro into a failing test: *budget-only (or sold-everything) first
  session must not be overwritten by stale cloud data.*
- Add the `A4` case: *sign-out must not destroy never-pushed local data.*
- Confirm step 1 makes both pass.
- This is the right place to start testing regardless — data-destruction paths first.

### 3. Structural fix — shared key registry + guarded write path
**Closes by construction:** `SYNC-CRIT-1`, `A4`, `OBS-2`, `DATA-4`; **fix alongside:** `A2`
- One canonical key list drives census + overwrite + push-guard + wipe (they can no
  longer drift).
- All writes route through one guarded `setItem` wrapper (quota-safe, single choke point).
- Fix `A2` in the same pass (fetch-fail flips `syncReadyRef=true` → stale push clobbers
  newer cloud) — third sync-state-machine correctness bug.
- Safe to do now because step 2's tests catch any regression.
- Land the `🔒` hard-enforce candidates here: `SEC-GAP-2` (every `/api` handler
  authenticates first) and `DATA-4` (no bypassing patched `setItem`) as
  PreToolUse hooks / `.claude/rules/*.md`.

### 4. Lower-urgency structural debt — after the data-loss work
Not actively destroying data, so it waits. Same "characterize-then-consolidate" discipline.
- **Money type:** 215 scattered `asNumber()` sites → single enforced money/value type.
  Write tests on money paths (purchase totals, tax/shipping distribution, GC/rewards,
  budget) *before* consolidating.
- **God-module decomposition:** start with `churn-wantedlist` (3,579 lines, top
  churn/fix hotspot) — highest blast radius, so highest payoff to break up.

---

## Guardrails carried from the audit

- Anything that can delete unsynced local data = **Critical**, full stop.
- Don't patch a bug class instance-by-instance when one abstraction removes the class.
- Characterize destruction/money logic with tests **before** refactoring it.
- Keep `CLAUDE.md` lean (index only); detail lives in `docs/architecture-audit.md` and
  `docs/security.md`.
