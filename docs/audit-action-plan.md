# BrickLedger — Audit Action Plan

> Companion to `docs/architecture-audit.md` (audit `w3xaymfl9`, committed `7cfbaa9`).
> The audit's checklist lists findings by severity. **This doc sequences the work** — it
> groups findings by shared root cause and orders them so we never refactor untested
> destruction logic before the tests that make it safe exist.

> **Status (Phase D complete, 2026-05-29):** Steps 1–2 are **DONE**; Step 3's **registry half
> is DONE**. `SYNC-CRIT-1`, `A4`, and `A11` are **CLOSED** — the census, overwrite (apply),
> build, push-guard, dedup-hash, and the A4 sign-out wipe-guard all now derive from one registry
> (`BACKUP_KEYS` in `src/utils/exportBackup.js`), so they can't drift again. A11's
> formerly-`it.fails` regression is now a normal passing test. **Still open in Step 3:** the
> guarded `setItem` choke point (`OBS-2`/`DATA-4`), `A2`, and the `🔒` hooks. See *Phase D —
> outcome, decisions & residuals* at the foot of this doc.

## The core insight

Several top findings are the **same bug in different places**, not independent issues:

| Symptom finding | Shared root cause |
|---|---|
| `SYNC-CRIT-1` — census (`summarizeLocal`, 3 buckets) narrower than overwrite scope (`applyBackupToLocalStorage`, 17 keys) | No single canonical definition of "the user's data keys" — census, overwrite, push-guard, and wipe each carry their own ad-hoc list, and they've drifted |
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

### 1. Stopgap the Critical — minimal, now · ✅ DONE
**Closes:** `SYNC-CRIT-1`
- Widen the `summarizeLocal` census to match `applyBackupToLocalStorage`'s full key set.
- Gate the fresh-device pull behind the existing `cloudNewer` / `localDirty` guard.
- Small, targeted, no refactor. Just stop the silent overwrite.
- **Do not** restructure anything else in this step.

### 2. Lock it with regression tests · ✅ DONE
**Addresses:** zero-tests gap on the highest-stakes path; protects step 3
- Turn the red-team repro into a failing test: *budget-only (or sold-everything) first
  session must not be overwritten by stale cloud data.*
- Add the `A4` case: *sign-out must not destroy never-pushed local data.*
- Confirm step 1 makes both pass.
- This is the right place to start testing regardless — data-destruction paths first.

### 3. Structural fix — shared key registry + guarded write path · ⚠️ PARTIAL (registry half done, Phase D)
**Closes by construction:** `SYNC-CRIT-1` ✅, `A4` ✅, `A11` ✅ (registry-driven, Phase D), `OBS-2` ⬜, `DATA-4` ⬜; **fix alongside:** `A2` ⬜; **lands** the `🔒` hooks ⬜.

> **Phase D landed the registry half:** `BACKUP_KEYS` now drives census + apply + build +
> push-guard + dedup-hash + the A4 wipe-guard. **Still open in this step:** the guarded
> `setItem` choke point (`OBS-2`/`DATA-4`), `A2`, and the `🔒` hooks — deferred to a later phase.

Scope is the **11 censused data keys** + the sync state machine. It does **NOT** include the
6 view-config keys' census completion — that's an explicit deferred future step (**Step 5**).
- One canonical key list drives census + overwrite + push-guard + wipe (they can no
  longer drift).
- All writes route through one guarded `setItem` wrapper (quota-safe, single choke point).
- Fix `A2` in the same pass (fetch-fail flips `syncReadyRef=true` → stale push clobbers
  newer cloud) — third sync-state-machine correctness bug.
- ✅ **Done (Phase D):** `A11` — `dedupHash` is now a projection over the registry's synced
  key-set, so the device-local `autoExportDays` no longer rides in the hash. The regression
  test (formerly `it.fails`) is now a normal passing test. See *Phase D* + the `A11` section below.
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

### 5. (Deferred — future) Complete the census for the 6 view-config keys
**NOT part of Step 3.** The 6 default-on-mount view-config keys (`blOwnedColumns`,
`blAcquisitionColumns`, `blPurchaseColumns`, `blDashboardWidgetSettings`,
`blCollectionItems`, `blOwnedColWidths`) stay `census:false` until their component-inline
defaults are centralized — export each from one module and import it back into
`MyCollection`/`WantedList`/`BudgetDashboard` — so the census can compare against the
default and flip them `census:true`. Touches the three god-modules, so it's sequenced
**after** the god-module decomposition (Step 4). Low severity: view config, not data;
both red-team data-loss cases are already covered by the 11 censused keys.

---

## Registry exclusions & a Phase-B finding (`A11`)

Two keys are touched by the backup round-trip but intentionally **excluded from
`BACKUP_KEYS`** (the user-data *sync* registry). To be documented in a comment beside
`BACKUP_KEYS` when `exportBackup.js` is next edited:

- **`brickEconomySetCache`** — regeneratable BrickEconomy cache; `delete`d before push
  (`exportBackup.js:39`), stripped from `dedupHash` (`:68`), restored only via file-import
  (`AppSettings.importFullBackup`). Correctly outside the sync round-trip.
- **`blAutoExportDays`** — device-local preference (which browser auto-downloads); not
  restored by `apply` (`:232`), survives wipe (`SIGNOUT_KEEP_KEYS`). Correctly out of the
  registry/restore — **but** currently leaks into the hash/push, see `A11`.

### `A11` — device-local pref leaked into the dedup hash + pushed blob (Phase B) · ✅ CLOSED (Phase D)
**Was:** `dedupHash` stripped `exportedAt` + `brickEconomySetCache` but **not** the nested
`settings.autoExportDays`, and `pushToCloudAuth` deleted only `brickEconomySetCache`, so
`autoExportDays` rode in both the dedup fingerprint and the pushed cloud blob. Two devices
with identical user data but different auto-export schedules hashed differently → each read
the other as dirty → spurious push churn / conflict dialogs. **Severity: Medium** (no data
loss; sync churn + UX).
**Fixed:** `dedupHash` is now a **projection over exactly the `BACKUP_KEYS` registry**
(`src/utils/exportBackup.js`), so the timestamp, regeneratable cache, and device-local
`autoExportDays` are excluded by construction. The formerly-`it.fails` regression in
`exportBackup.census.test.js` is now a **normal passing test**.

## Phase D — outcome, decisions & residuals

**What closed (registry-driven; full suite green + production build clean):** `SYNC-CRIT-1`,
`A4`, `A11`. One canonical list (`BACKUP_KEYS`) now drives the census (`hasAnyLocalData`), the
overwrite (`applyBackupToLocalStorage`), the build (`buildBackup`), the push-guard
(`pushToCloudAuth`), the dedup-hash (`dedupHash`), and the A4 sign-out wipe-guard — they can no
longer drift. Net: round-trip + key-set characterization + absent/empty/falsy edge cases + 6 A4
cases + the flipped A11 test.

### Decision — `clearLocalUserData` is intentionally a SUPERSET wipe, NOT registry-driven
The sign-out wipe still clears keys by the `bl`/`brickEconomy`/`brickset` **prefix scan** — a
**superset** of the 17 `BACKUP_KEYS`. It is **deliberately not** narrowed to "iterate the
registry": a registry-only wipe would leave regeneratable caches, sync metadata, and the
**dynamic `brickset*` cache keys** on the device — a **privacy regression on a shared computer**.
The registry governs what the **A4 guard protects** (don't destroy unsynced data), **not** what
the wipe clears. ⚠️ A future "make everything registry-driven" pass must **preserve this
asymmetry** — do not reduce the wipe to the registry key-set.

### Decision — sign-out data retention (the A4 trade-off, ACCEPTED)
`clearLocalUserData()` now **refuses to wipe** when the device holds **unsynced/dirty** censused
data (`localContentHash() !== blLastPushHash`), returning `{ skipped: "unsynced" }`; the sign-out
path in `src/App.jsx` then **keeps the data** for the next sign-in to push rather than destroying
it. The shared-browser **foreign** sign-in still **force-wipes** (`clearLocalUserData({ force:
true })`, BIZLOGIC-1). **Accepted trade-off:** preventing **silent data loss** (Critical
guardrail) outranks the **shared-device leak** in the narrow offline-signout window. Also recorded
in `docs/security.md` Category 14.

### Residual — `SIGNOUT-RETAIN-1` (Medium, accepted-for-now)
The A4 fix means a signed-out, local-first device can **still hold — and the UI may still
display — the prior session's unsynced data** until the next same-user sign-in, and the skipped
wipe gives the user **no feedback** that data was retained. **Severity: Medium** (shared-device
exposure window; silent behavior). **Accepted for now** per the trade-off above. **Follow-up:**
quarantine the preserved data (e.g. a `blPending*` namespace the UI won't render) until same-user
re-auth, and/or offer an explicit **"sign out and clear this device"** action with a data-loss
warning. Closely related to **`A1`** (foreign wipe needs a recoverable backup) — both want a
recover-before-destroy primitive.

## Guardrails carried from the audit

- Anything that can delete unsynced local data = **Critical**, full stop.
- Don't patch a bug class instance-by-instance when one abstraction removes the class.
- Characterize destruction/money logic with tests **before** refactoring it.
- Keep `CLAUDE.md` lean (index only); detail lives in `docs/architecture-audit.md` and
  `docs/security.md`.
