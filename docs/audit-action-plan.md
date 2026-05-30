# BrickLedger — Audit Action Plan

> Companion to `docs/architecture-audit.md` (audit `w3xaymfl9`, committed `7cfbaa9`).
> The audit's checklist lists findings by severity. **This doc sequences the work** — it
> groups findings by shared root cause and orders them so we never refactor untested
> destruction logic before the tests that make it safe exist.

> **Status (Phase E complete, 2026-05-29):** Steps 1–2 are **DONE**; Step 3's **registry half
> (Phase D)** and its **guarded-write half (Phase E)** are **DONE**. `SYNC-CRIT-1`, `A4`, `A11`
> are **CLOSED** by the registry; **`OBS-2` is CLOSED (both halves)** by the guarded `setItem`
> choke point (`setItemSafe` in `src/utils/safeStorage.js`) — every production write (96 sites)
> now routes through it; a `QuotaExceeded` failure both **surfaces a user banner** (no silent
> loss) and is **checked by the sync/restore writers** so a dropped write can't be marked synced
> or clobber the cloud copy; the former global `main.jsx` monkey-patch is gone. **`DATA-4`'s API half is DONE** (the proper
> guarded API replaces the runtime patch); its **enforcement** (no-bypass PreToolUse hook /
> `.claude/rules`) is **deferred to Phase G**. **`A2` is CLOSED (Phase F):** a failed cloud fetch
> no longer enables auto-push, so stale local can't clobber newer cloud. **Still open in Step 3:**
> the `🔒` hooks (Phase G). See *Phase F*, *Phase E*, and *Phase D — outcome* at the foot of this doc.

## The core insight

Several top findings are the **same bug in different places**, not independent issues:

| Symptom finding | Shared root cause |
|---|---|
| `SYNC-CRIT-1` — census (`summarizeLocal`, 3 buckets) narrower than overwrite scope (`applyBackupToLocalStorage`, 17 keys) | No single canonical definition of "the user's data keys" — census, overwrite, push-guard, and wipe each carry their own ad-hoc list, and they've drifted |
| `A4` — sign-out wipe destroys never-pushed data | (same) |
| `OBS-2` — unguarded `setItem` → silent quota loss · ✅ CLOSED (Phase E) | No single guarded write path |
| `DATA-4` — code bypasses the patched `setItem` · ⚠️ API done (Phase E); enforcement → Phase G | (same) |

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
**Closes by construction:** `SYNC-CRIT-1` ✅, `A4` ✅, `A11` ✅ (registry-driven, Phase D), `OBS-2` ✅ (guarded write, Phase E), `DATA-4` ⚠️ (API Phase E / enforcement Phase G); **fix alongside:** `A2` ✅ (Phase F); **lands** the `🔒` hooks ⬜ (Phase G).

> **Phase D landed the registry half:** `BACKUP_KEYS` now drives census + apply + build +
> push-guard + dedup-hash + the A4 wipe-guard. **Phase E landed the guarded-write half:** all
> writes route through `setItemSafe` (`src/utils/safeStorage.js`), closing `OBS-2`. **Phase F
> closed `A2`** (fetch-fail no longer enables auto-push). **Still open in this step:** the `🔒`
> hooks (incl. `DATA-4` no-bypass enforcement) — Phase G.

Scope is the **11 censused data keys** + the sync state machine. It does **NOT** include the
6 view-config keys' census completion — that's an explicit deferred future step (**Step 5**).
- One canonical key list drives census + overwrite + push-guard + wipe (they can no
  longer drift).
- ✅ **Done (Phase E):** all writes route through one guarded `setItem` wrapper (`setItemSafe`,
  quota-safe, single choke point) — `OBS-2` closed.
- ✅ **Done (Phase F):** `A2` — fetch-fail used to flip `syncReadyRef=true` → stale push could
  clobber newer cloud. Now a failed fetch leaves auto-push frozen; the ref flips true only on a
  confirmed successful reconcile. Third sync-state-machine correctness bug. See *Phase F* below.
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

## Phase F — outcome (A2: fetch-fail must not enable auto-push)

**What closed (full suite green + production build clean):** `A2`. The fetch-fail catch in
`reconcileOnSignIn` (`src/App.jsx`) used to set `syncReadyRef.current = true`, which let a later
debounced/interval auto-push send this device's (possibly stale) local data up and **clobber a
newer cloud copy**. A failed fetch means the cloud state is **UNKNOWN**, not confirmed-clean — so
the catch now simply logs and returns, leaving `syncReadyRef` at its top-of-function `false`.
`syncReadyRef` now flips `true` **only on a confirmed successful reconcile** (cloud-empty claim,
silent pull, or same-user-local-current); a subsequent reload retries the fetch.

### Decision — net-first test renders the real `<App>`
`A2` lives in App-component logic, not a pure util, so the new suite
(`src/App.reconcile.test.jsx`, **2 tests → 47 total**) renders the real `<App>` with the four
god-modules + Clerk + the network boundary (`fetchFromCloudAuth`/`pushToCloudAuth`) mocked, then
drives the reconcile and the 10s auto-push timer with fake timers. The failing test (dirty local +
failed fetch → assert `pushToCloudAuth` never called) was confirmed **red against the old code**;
a passing **control** (successful same-user reconcile → push *does* fire) guards against an
over-correction that would freeze auto-push outright. First App-level integration test in the repo
— the pattern (mock the leaves, mock the network boundary, drive effects under fake timers) is
reusable for the rest of the sync state machine.

## Phase E — outcome & decisions (guarded write path)

**What closed (full suite green + production build clean):** `OBS-2` (**fully** — both halves,
see below), and the **API half of `DATA-4`**. The former global `main.jsx` `setItem` monkey-patch
is replaced by an explicit single choke point — `setItemSafe` in **`src/utils/safeStorage.js`** —
and **all 96 production `localStorage.setItem` sites** now route through it (the only remaining
raw write is the one inside `setItemSafe` itself). Net: a new `safeStorage` unit suite (8 tests:
success / datachange dispatch / quota / non-quota re-throw), a new `exportBackup.integrity` suite
(5 tests: forced-quota apply-abort + no-false-mark-synced), and an updated `buildBackup` read-set
characterization; **43 tests total**.

### Decision — quota-failure policy (the OBS-2 replacement for silent loss)
On `QuotaExceededError` the guard **dispatches `brickledger:storagefull`** (App.jsx renders a
**deduped** `react-hot-toast` banner via a stable id) and **returns `false`** — it does **not**
throw (most of the 96 sites are fire-and-forget event handlers; throwing would crash them). Any
**non-quota** error is **re-thrown** (real bug, not a full disk). One **uniform** guard for all
keys — no critical/cosmetic fork inside the choke point; the integrity-critical callers
(backup/sync) **check the boolean return** (see the integrity half below).

`OBS-2` has **two halves**, both now closed:
- **Surfaced half (E.2b):** the `storagefull` banner — the user is told a write didn't persist
  ("recent changes weren't saved — export a backup now, or free up space").
- **Integrity half (E.4 / E.5):** the boolean return is consumed where a silently-dropped write
  would corrupt state. `applyBackupToLocalStorage` returns `{ ok, applied, failedKey }` and is
  **atomic (E.5)** — it snapshots every key and **rolls back on the first failed write**, so a
  *mixed* local state (some cloud, some old) can never exist; `markSynced` returns
  whether the `blLastPushHash` mark actually stuck. App.jsx's single `applyCloudBackup()` helper
  only marks synced when the restore fully landed — on a full-storage partial it **freezes
  auto-push** (`syncReadyRef=false`) and surfaces an error, closing the hole where a partial local
  pull would be read as clean, auto-pushed up, and **clobber the good cloud backup** — including
  the **partial-apply-then-reload** route (E.5): a failed apply leaves the device byte-for-byte its
  prior self, so after a reload `localContentHash()` still equals `blLastPushHash`, the device reads
  CLEAN, and the auto-push computes `no_change` instead of overwriting cloud. The manual
  Settings restore likewise reports "restore incomplete" instead of success. `pushToCloudAuth`
  never **falsely advances** `blLastPushHash` when the local mark write fails (a failed guarded
  write simply doesn't advance it → a safe redundant re-push, never silent loss).

### Decision — the choke point also OWNS the auto-push trigger
The removed monkey-patch did double duty: guard **and** the change-detected
`brickledger:datachange` dispatch that drives App.jsx's debounced auto-push. `setItemSafe`
carries that forward verbatim (same `SYNC_SKIP_KEYS` + `bl`/`brickEconomy` prefix filter, same
read-before-write change detection). **Consequence:** a *raw* `localStorage.setItem` now silently
bypasses **both** the quota guard **and** auto-sync — confirmed in the browser
(`rawWriteDispatchedDatachange === false`). This is exactly what **Phase G**'s `DATA-4` no-bypass
enforcement (PreToolUse hook / `.claude/rules`) must backstop.

### Residual — `DATA-4` enforcement (deferred to Phase G)
The guarded **API exists and is used everywhere today**, but nothing yet *prevents* a future
raw `setItem` from being introduced. Closing `DATA-4` fully needs the enforcement hook (Phase G),
on top of this API.

**Carry-forward (E.5) — one sanctioned raw-write site:** `applyBackupToLocalStorage` (in
`exportBackup.js`) intentionally uses **raw `setItem`/`removeItem`** for its atomic rollback — the
revert must NOT emit `datachange`/`storagefull`, and it only restores prior values that already
fit, so routing it through `setItemSafe` would be wrong. So Phase G's no-bypass rule will see a
*legitimate* raw write **outside** `safeStorage.js`. **Preferred resolution:** relocate sanctioned
raw writes into `safeStorage.js` (e.g. a `restoreRaw(key, prevValue)` helper) and have the hook
forbid raw `localStorage.setItem` everywhere **except that module** — rather than whitelisting
scattered call sites. The same pattern absorbs any future sanctioned raw write.

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
