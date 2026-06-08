# P4 — Enrichment Snapshot in Sync (cold-start warm-up): Discovery + Design

**Status:** Discovery / design only. **No code changed.** **STOP before any build.**
**Date:** 2026-06-06 · **Branch:** `main` · Companions:
[`docs/enrichment-plan.md`](enrichment-plan.md) (5-phase shape + the P4 GO/NO-GO gate + budget),
[`docs/enrichment-p3-plan.md`](enrichment-p3-plan.md) (the shared `enrichmentCache` module P4 builds on),
[`docs/audit-action-plan.md`](audit-action-plan.md) (Phase D — the sync registry).

**P4 goal (to build later, not here):** snapshot the device-local enrichment caches into the cloud
backup so a fresh device / sign-out→sign-in starts **warm** — no ~600-fetch, 4–7-minute Brickset
minifig trickle. P4 is the ONLY phase that touches the highest-blast-radius code in the repo (the
sync round-trip: `buildBackup` / `pushToCloudAuth` / `applyBackupToLocalStorage` / `dedupHash` /
`hasAnyLocalData`, all derived from `BACKUP_KEYS`). Per the gate in `enrichment-plan.md`, P4 ships
**only behind a characterization net** that pins current sync behaviour as provably non-regressive.

This doc is sections 1–7 of the kickoff: blast-radius map · cache-set + sizes · snapshot mechanism ·
restore/TTL round-trip · the net · phasing · risks.

---

## 1. Sync machinery — the blast-radius map (read-only)

A full sync round-trip and the invariants the P2 gate named. All of it derives from **one registry**,
`BACKUP_KEYS` (`src/utils/exportBackup.js:128`), so census / build / apply / push-guard / dedup-hash
cannot drift (SYNC-CRIT-1 / A4 / A11, Phase D).

### 1.1 The round-trip

**PUSH** (`pushToCloudAuth`, `exportBackup.js:30`):
1. `if (!hasAnyLocalData()) return {skipped:"no_data"}` — the push-guard uses the **same census** as
   the fresh-device check, so a sold-everything / budget-only device still claims its cloud slot.
2. `backup = buildBackup(now)` — registry-driven read of every `BACKUP_KEYS` key (`:303`).
3. `delete backup.brickEconomySetCache` (`:38`) — the one build-only cache is **stripped before push**
   ("large and fully regeneratable"). It stays in the *local file* export, only the *cloud push* drops it.
4. `contentHash = dedupHash(backup)`; `if (contentHash === blLastPushHash) return {skipped:"no_change"}`.
5. `POST /api/sync` with the Clerk bearer token → Upstash `set` one JSON string under
   `brickledger:user:{userId}` (`sync.js`).
6. On success: `setItemSafe("blLastCloudPush", …)` + `setItemSafe("blLastPushHash", contentHash)`.

**PULL + APPLY** (`reconcileOnSignIn` → `applyCloudBackup`, `App.jsx:127`/`:111`):
- `fetchFromCloudAuth` GETs the blob; a failed fetch leaves auto-push **frozen** (`syncReadyRef=false`,
  A2) so a later push can't clobber a newer cloud copy.
- Branches: cloud-empty (claim by pushing), **fresh device** (`!hasAnyLocalData` → silent pull + reload),
  both-have-data (timestamp + dirty-check → silent pull / keep-local / conflict dialog), foreign-device
  (BIZLOGIC-1 wipe).
- `applyCloudBackup` → `applyBackupToLocalStorage(cloud)` (atomic) → on `ok`, `markSynced` → `reload()`.

### 1.2 The invariants P4 must not break

| Invariant | Where | What it guarantees | What breaks it |
|---|---|---|---|
| **Registry single-source** | `BACKUP_KEYS` (`:128`); build `:309`, apply `:283`, census `:157`, hash `:69` all iterate it | census / build / apply / push-guard / dedup-hash can't drift | Adding a key to *some* of those paths but not the registry; OR adding a registry key with the wrong `census`/`kind`. |
| **dedup-hash (A11)** | `dedupHash` (`:67`) — a **projection over `BACKUP_KEYS` only** (stable order), excludes timestamp + caches + device prefs | A local build and a pulled cloud backup hash identically when synced data matches → no redundant re-push; background caches never mark the device dirty | Putting a **frequently-rewritten** key into the projection → every refresh changes the hash → push churn. |
| **census (SYNC-CRIT-1 / A4)** | `hasAnyLocalData` (`:156`) — iterates `census:true` keys, defaults-aware | A genuinely fresh device reads as empty → the legitimate **silent cloud pull** happens; a device with real unsynced data reads as non-empty → never silently overwritten | A regeneratable artifact counted as "data" → a fresh device looks dirty, skips the pull, and **stays cold** (defeats P4) — or worse, blocks the pull. |
| **atomic apply (OBS-2)** | `applyBackupToLocalStorage` (`:256`) — snapshots every key, **rolls back all-or-nothing** on a quota failure | A mixed local state can never exist; a failed restore reads as CLEAN and a reload's auto-push computes `no_change` → good cloud copy untouched | A restore step that writes **outside** the atomic block and is *not* rolled back on failure → partial state that escapes to cloud. |
| **A4 unsynced-wipe refusal** | `clearLocalUserData` (`:200`) — refuses to wipe when `hasAnyLocalData() && localContentHash() !== blLastPushHash`; wipe scope is a **superset** of the registry (bl/brickEconomy/brickset prefix) | Sign-out never destroys unsynced edits; a shared device still wipes caches by prefix | Making the wipe scope or the A4 guard depend on enrichment (it must derive from `census:true` user data only). |

**Net for P4:** the cheapest, safest place to add an enrichment snapshot is a path that touches
**none** of the registry-derived projections — i.e. a sibling field in the push body that `dedupHash`
and `hasAnyLocalData` already ignore *by construction*, plus a restore step that runs **after** the
atomic apply succeeds. That is exactly how `brickEconomySetCache` already lives outside the registry
(build-only, hash-invisible). P4 reuses that architectural slot — see §3.

---

## 2. Which caches to snapshot (sized vs the 10 MB request limit)

The binding constraint is Upstash's **10 MB max request size** (`enrichment-plan.md:72`), not record
size. Per-entry figures: `brickEconomySetCache` is **measured** (1,477–1,499 B/entry across the 05-29
and 06-03 desktop exports — confirmed this session); `bricksetSetCache`/`blValueCache` are **modeled**
(they aren't in `buildBackup`, so no on-disk export carries them — Sam can size them live from
`localStorage` if an exact number is wanted before P4.2).

| Cache | Decision | B/entry | × 600 | Why |
|---|---|---:|---:|---|
| **`bricksetSetCache`** | ✅ **SNAPSHOT** | ~828 (modeled) | **~485 KB** | **The cold-start win.** This is the minifig/pieces trickle (~600 sequential `fetchBricksetSet` @ 400 ms ≈ 4–7 min, `enrichment-plan.md:141`). A synced snapshot makes a fresh device paint counts immediately and refetch nothing. |
| **`blValueCache`** | ✅ **SNAPSHOT** | ~185 (modeled) | **~108 KB** | The value column's **cold-start safety net for the BL-primary roadmap.** Today BE's synced `brickEconomyNormalizedCollection` carries values, so the value climb is already a fast single batch — but BE is slated for removal; once it's gone, `blValueCache` IS the value source and a cold device would re-batch all ~600 from BrickLink. Snapshotting it now (cheap, +108 KB) is the insurance that the BL-primary cutover doesn't reintroduce a cold-start value gap. |
| **`blPriceGuideCache`** | ❌ **EXCLUDE** | ~ (n/a) | — | **Background / on-demand, not a cold-start surface.** Only `SetDetailPanel` reads it (per-set, when a user opens a detail panel), and a single price-guide fetch is fast. Its TTL is **6 h single / 12 h bulk** — far shorter than the round-trip cadence, so a synced entry is almost always **stale on restore** → it would refetch anyway → near-zero cold-start benefit for pure payload cost. Leave device-local. |
| **`brickEconomySetCache`** | ❌ **EXCLUDE (confirm stays out)** | 1,477 (measured) | (865 KB) | **Confirmed stays excluded.** It's already `delete`d before push (`exportBackup.js:38`) — large, fully regeneratable by the daily BE batch, AND BE is slated for removal. Re-including it would fight the BL-primary direction and add the most bytes for a cache that's going away. P4 leaves the strip exactly as-is. |
| blob caches (`bricksetThemesCache`, `legoLastChanceCache`, `blBFRetirementCache`) | ❌ EXCLUDE | tiny | — | Single-blob, cheap one-shot refetch on a fresh device (`enrichment-plan.md:66`). Not per-set, not the trickle. |

### Chosen set + fresh size projection

**Snapshot = `bricksetSetCache` + `blValueCache`** ≈ **485 + 108 = ~593 KB** (600 sets).

| Scenario | Push body | vs 10 MB |
|---|---:|---|
| Today (no snapshot) | 404 KB | 4% |
| **+ snapshot (BE still present)** | **~1.0 MB** | **~10% — 🟢 GREEN** |
| + snapshot, **after BE removal** (the 394 KB `brickEconomyNormalized` chunk leaves) | ~0.6 MB | 6% — green |
| + snapshot at 2× growth (~1,200 sets, BE present) | ~1.9 MB | 19% — green |

**🟢 GREEN**, consistent with the gate's 1d verdict. Note the snapshot makes the per-push body ~2.5×
today's (404 KB → ~1.0 MB) since `/api/sync` overwrites the whole blob each push — a real bandwidth
cost, **offset** when BE removal drops the 394 KB normalized chunk (§7). Pushes are debounced 15 s /
interval 5 min, so a ~1 MB POST is operationally fine; if it ever isn't, the fallback is a coverage-
gated attach (§3) or a separate Redis key (§7), not on the table for v1.

---

## 3. Snapshot mechanism — separate sibling field, NOT `BACKUP_KEYS`

**Two options weighed:**

**Option A — add `bricksetSetCache`/`blValueCache` to `BACKUP_KEYS`.**
- ✗ `dedupHash` projects **every** `BACKUP_KEYS` entry (`:69`). These caches are rewritten constantly
  (the 400 ms brickset trickle; weekly value refresh) → the hash would change on every cache write →
  **push churn** (re-POST the whole ~1 MB body repeatedly). This is exactly the A11 failure the
  registry was built to prevent.
- ✗ To avoid that you'd have to special-case the hash to skip these keys — which **fragments the
  single-source invariant** ("the hash IS the registry projection") and forces the existing
  `dedupHash`-determinism / census / apply-set tests to change.
- ✗ `census` would need a deliberate `census:false` (a snapshot must not make a fresh device read as
  "has unsynced data" — gate's named requirement); doable, but combined with the hash special-case it's
  death by a thousand registry exceptions.

**Option B — a separate sibling field `backup.enrichmentSnapshot` (RECOMMENDED).**
- ✓ **`dedupHash` ignores it for free.** The hash is a projection over `BACKUP_KEYS` only, so a sibling
  field is **invisible to the dirty-check by construction** — no churn, no hash edit. (Same reason
  `brickEconomySetCache` and `blAutoExportDays` don't perturb the hash today.)
- ✓ **`hasAnyLocalData` ignores it for free.** It iterates `census:true` registry keys; the snapshot
  caches aren't registry keys → a fresh device with only a restored snapshot still reads as empty →
  the **silent pull still fires** (gate requirement met without a `census` flag at all).
- ✓ **`applyBackupToLocalStorage` ignores it for free** — it iterates `BACKUP_KEYS`, so the atomic
  apply block is untouched; restore is a **separate step after** apply succeeds (§4), keeping the
  all-or-nothing guarantee intact.
- ✓ **Lowest blast radius:** the only sync-machinery edits are (1) `pushToCloudAuth` attaches the
  sibling, (2) `applyCloudBackup` restores it. Both purely additive; **every existing sync test stays
  green untouched.** This is the inverse of the `brickEconomySetCache` strip — same non-registry slot,
  attach instead of delete.

**Module-chokepoint wiring (lean on P3's single chokepoint, not scattered code).**
The shared `enrichmentCache` already exposes per-instance `getRaw()` (whole map) and `saveRaw(map)`
(write verbatim + reconcile memo) — the exact primitives a snapshot/restore needs. Propose:

```
// brickset.js   — instance already private; add two thin exports:
export const getBricksetSnapshot   = () => bricksetCache.getRaw();
export const restoreBricksetSnapshot = (map) => bricksetCache.saveRaw(map);
// valueCache.js — same two:
export const getValueSnapshot      = () => cache.getRaw();
export const restoreValueSnapshot  = (map) => cache.saveRaw(map);

// a new tiny aggregator (e.g. src/utils/enrichmentSnapshot.js) — the ONE place that
// knows the snapshot's shape; imports the per-cache helpers, not the instances:
export function buildEnrichmentSnapshot() {
  return { v: 1, bricksetSetCache: getBricksetSnapshot(), blValueCache: getValueSnapshot() };
}
export function restoreEnrichmentSnapshot(snap) {
  if (!snap || typeof snap !== "object") return;
  if (snap.bricksetSetCache) restoreBricksetSnapshot(snap.bricksetSetCache);
  if (snap.blValueCache)     restoreValueSnapshot(snap.blValueCache);
}
```

`buildEnrichmentSnapshot()`/`restoreEnrichmentSnapshot()` are the only two functions sync code calls —
the cache internals (`setItemSafe`, memo reconciliation, the lint-banned raw writes) stay inside the
module. The aggregator carries its own `v:` so the shape can evolve without colliding with the backup
`version` field.

**Lint-ban interaction:** restore writes go through `saveRaw → setItemSafe` (DATA-4 compliant) and the
managed-key `removeItem`/`clear` ban (407bbaa) is untouched — nothing in P4 raw-writes a managed key.

---

## 4. Restore + TTL round-trip (cold-start seeding)

**The TTL round-trip is correct for free because we snapshot whole entries, not values.**
`getRaw()` returns each entry **with its `fetchedAt`/`cachedAt` intact**; `saveRaw()` writes the map
**verbatim — it does NOT re-stamp or re-validate** (`enrichmentCache.js:156`). So on restore:
- a **fresh** entry (within TTL of its original `fetchedAt`) → `peek`/`readThrough` serve it → **no
  refetch** (the cold-start win).
- a **stale** entry (past TTL) → `staleKeys` flags it → the existing background refresh picks it up.
- a malformed/absent `fetchedAt` → `ts.parse` → `NaN` → treated as not-fresh → background refresh.

This **sidesteps the "fresh-forever / always-stale" trap** the gate raised for BE re-inclusion: because
the snapshot embeds real timestamps, restored entries respect TTL exactly as if this device had fetched
them itself. No synthetic `fetchedAt` handling is needed.

**The boot hook: `App.jsx` `reconcileOnSignIn` → `applyCloudBackup` (`:111`).** Seed **before** the
post-apply reload so the reloaded surfaces hydrate from a populated `localStorage`:

```
function applyCloudBackup(cloud) {
  const restore = applyBackupToLocalStorage(cloud);   // atomic — unchanged
  if (!restore.ok) { /* freeze auto-push, toast — unchanged */ return false; }
  restoreEnrichmentSnapshot(cloud.enrichmentSnapshot); // ← NEW: after a SUCCESSFUL apply, before reload
  markSynced(cloud, userId);
  return true;
}
```

Placement rationale:
- **After** `applyBackupToLocalStorage` succeeds — the snapshot is regeneratable, so it must never
  block or fail the user-data restore. A `saveRaw` quota failure is swallowed inside the module
  (`enrichmentCache.js:100`) → at worst the device stays cold-but-correct (degrades to today's
  behaviour), never a partial user-data state. The atomic guarantee (§1.2) is preserved because
  restore lives **outside** the atomic block and writes only caches.
- **Before** the `setTimeout(reload)` in both the fresh-device path (`App.jsx:169`) and the
  silent-pull path (`:186`). After reload: MyCollection's initial-state hydration reads the now-seeded
  `bricksetSetCache` (`MyCollection.jsx:170`) → minifigs/pieces paint on first render, and
  `runBricksetEnrichment`'s state-presence gate short-circuits → **no trickle**; `peekValueCache` finds
  fresh value entries → no value re-batch.
- `saveRaw` also reconciles the **in-memory memo**, so even **without** the reload the seed is coherent
  for any memo-aware reader (the P3.7 coherence property).

**Push side (`pushToCloudAuth`, `exportBackup.js:37`):** attach the sibling right after the existing
strip, leaving the dedup-hash flow untouched:
```
const backup = buildBackup(new Date());
delete backup.brickEconomySetCache;            // unchanged
backup.enrichmentSnapshot = buildEnrichmentSnapshot();  // ← NEW sibling; NOT in dedupHash
const contentHash = dedupHash(backup);          // unchanged — projects BACKUP_KEYS only
```

**Completeness caveat (the one real wrinkle).** Because the snapshot is *out of the dedup-hash*, a push
that changes **only** enrichment computes `no_change` and **skips** — so the snapshot rides up
**opportunistically on the next user-data push**, not on its own. Consequence: the cloud snapshot can
lag a just-completed local enrichment until the user next edits data. Two ways to handle it, weighed in
§6 phasing:
- **(v1, recommended) opportunistic ride-along** — accept the lag; most active users edit within a day,
  by which point the cloud snapshot is complete. A partial cloud snapshot still warms the cold device
  *partially* (strictly better than today). Simplest, zero churn.
- **(optional P4.4) a coverage-gated forced push** — track `blLastSnapshotHash` over a **coarse
  coverage key** (sorted set-number list + count, NOT per-entry `fetchedAt`), and fire **one** forced
  push when it changes and stabilises (after the enrichment pass completes). Guarantees a complete cloud
  snapshot without per-write churn, at the cost of a little more sync logic.

---

## 5. Characterization net — pin CURRENT sync behaviour BEFORE touching it (the gate)

Land these **first**, all green on `main` before any P4 code, so the snapshot addition is provably
non-regressive. They **extend** the existing net (`exportBackup.census.test.js`,
`exportBackup.integrity.test.js`, `exportBackup.roundtrip.test.js`), which already pins census = 11
keys, dedupHash-determinism (A11), atomic rollback (OBS-2), A4 refusal, and build↔apply round-trip — P4
adds the **sibling-field invariance** layer on top:

1. **Byte-identical existing push payload (the golden).** Pin the EXACT current push body
   (`buildBackup` minus `brickEconomySetCache`) over a fixture so P4.2's `enrichmentSnapshot` is
   provably *additive*: every pre-existing field is byte-identical, only the new sibling appears.
2. **dedupHash invariance to the sibling.** `dedupHash(backup)` is **identical** whether
   `backup.enrichmentSnapshot` is absent, present-empty, or present-full — and regardless of its
   contents. (Extends the A11 determinism test to the new field. This is the anti-churn proof.)
3. **census invariance (SYNC-CRIT-1 / A4).** A device whose ONLY populated keys are
   `bricksetSetCache` + `blValueCache` (no user data) → `hasAnyLocalData() === false` → still pulls
   silently. Pin that the snapshot caches are invisible to the census (they aren't in `BACKUP_KEYS`).
4. **apply-set invariance.** `applyBackupToLocalStorage` still writes **exactly** `BACKUP_KEYS` and
   **never** touches `bricksetSetCache`/`blValueCache` (restore is a separate path). Re-asserts the
   existing "apply's setItem key-set == BACKUP_KEYS" test holds with a snapshot present in the backup.
5. **atomic-apply unchanged.** The OBS-2 rollback tests still pass with `enrichmentSnapshot` present in
   the cloud object — i.e. a quota-failed user-data apply rolls back fully and the snapshot restore
   (which runs only on `ok`) never executed.
6. **snapshot ↔ restore round-trip + TTL.** `buildEnrichmentSnapshot()` → `restoreEnrichmentSnapshot()`
   preserves `fetchedAt`/`cachedAt` **verbatim**; with a faked clock, a fresh entry restores fresh
   (`peek` returns it), a stale entry restores stale (`staleKeys` includes it). The TTL round-trip
   proof (§4).
7. **money / enrichment golden across the round-trip.** A fixture collection pushed → snapshotted →
   restored renders **byte-identical** displayed value / gain / ROI **and** minifigs / pieces (the G4
   money-neutrality bar, extended to the snapshot path).
8. **A4 + sign-out unchanged.** `clearLocalUserData` still refuses unsynced wipes and still clears the
   snapshot caches by prefix; the guard still derives from `census:true` only.

---

## 6. Phasing — G4-style, one green commit each

| Commit | Scope | Required? | Acceptance |
|---|---|---|---|
| **P4.0 — Characterization net (FIRST)** | Land §5 (1–8). No P4 code yet. | **YES** (the gate) | All §5 green on `main`; existing sync net still green. Encodes byte-identical-payload + dedupHash/census/apply/atomic invariance to a sibling field. |
| **P4.1 — Snapshot helpers, INERT** | Add `getBricksetSnapshot`/`restoreBricksetSnapshot` (`brickset.js`), `getValueSnapshot`/`restoreValueSnapshot` (`valueCache.js`), and `enrichmentSnapshot.js` (`build`/`restore`). **Nothing in sync calls them.** | YES | Module unit tests + §5.6 round-trip green; `npm run lint` clean (writes via `saveRaw`/`setItemSafe`); production behaviour unchanged (no caller). |
| **P4.2 — Wire into PUSH** | `pushToCloudAuth` attaches `backup.enrichmentSnapshot = buildEnrichmentSnapshot()` after the BE strip. | YES | §5.1/§5.2 green — `dedupHash` unchanged, existing payload fields byte-identical, snapshot present but hash-invisible. The push now carries the snapshot. |
| **P4.3 — Restore on cold-start** | `applyCloudBackup` calls `restoreEnrichmentSnapshot(cloud.enrichmentSnapshot)` after a successful `applyBackupToLocalStorage`, before reload. | YES | §5.5/§5.6/§5.7 green; atomic guarantee intact (restore outside the block, only on `ok`). |
| **P4.4 — Coverage-gated forced push (OPTIONAL)** | `blLastSnapshotHash` over a coarse coverage key → one forced push when enrichment completes (§4). | No — defer/drop | Cloud snapshot converges without per-write churn; no regression to §5.2 (coverage hash is separate from `dedupHash`). |
| **P4.5 — Verify the cold-start win (Vercel preview)** | Source device with complete enrichment + one data push → second device / sign-out→sign-in. | YES (proof) | Cold load **WITH snapshot = warm**: minifigs/pieces + values paint on first render, **no `/api/brickset-set` burst** in the Network panel, no 4–7-min climb. Contrast against a no-snapshot baseline (the trickle). |

---

## 7. Risks

- **Sync blast-radius (the real gate).** *Mitigated by the separate-sibling design (§3):* the
  registry-derived projections (`dedupHash`, `hasAnyLocalData`, `applyBackupToLocalStorage`) are
  **untouched** → the entire existing sync net stays green. The only edits are two additive lines in
  `pushToCloudAuth` and one in `applyCloudBackup`, both outside the registry. P4.0's net pins this.
- **Budget — re-confirmed 🟢.** ~1.0 MB push body (10% of the 10 MB request limit) with BE present;
  ~0.6 MB after BE removal; ~1.9 MB at 2× growth. Per-push body grows ~2.5× (whole-blob overwrite) —
  a bandwidth cost, offset by BE removal dropping the 394 KB normalized chunk. If push size ever bites,
  fall back to coverage-gated attach (P4.4) or a separate Redis key (bigger blast radius — out of scope).
- **Restore staleness — avoided by construction.** Snapshotting whole entries round-trips
  `fetchedAt`/`cachedAt`, so restored entries respect TTL (fresh → no refetch; stale → background
  refresh). The "fresh-forever / always-stale" trap the gate flagged for BE doesn't apply.
- **Snapshot completeness lag.** Out-of-hash means the snapshot rides opportunistic user-data pushes,
  so the cloud copy can trail a just-finished local enrichment. v1 accepts it (partial warm > cold);
  P4.4 closes it if needed (§4).
- **`blValueCache` datachange churn (no change from today).** `blValueCache` is **not** in
  `SYNC_SKIP_KEYS` so its writes already fire `datachange` today — but with the snapshot **out of
  `dedupHash`**, those debounced pushes compute `no_change` and skip exactly as they do now. P4 must
  **not** make a value-cache write start producing real pushes. (`bricksetSetCache` is already in
  `SYNC_SKIP_KEYS`, so its trickle never triggers.) The P3 §6a optional cleanup — add `blValueCache`
  to `SYNC_SKIP_KEYS` — is adjacent and would remove the wasted no-op trigger; flag, don't bundle.
- **Not snapshotting BE — confirmed correct.** `brickEconomySetCache` stays stripped (`exportBackup.js:38`):
  large, regeneratable by the daily batch, and **slated for removal**. `blValueCache` is the BL-primary
  value safety net that *replaces* BE's synced values, which is why it's IN the snapshot while BE is OUT.

---

## What this discovery did NOT do
No code changes, no dev server, no tracker edits. Sizes are the modeled §1b figures plus a fresh
measured `brickEconomySetCache` (1,477–1,499 B/entry) from the 05-29 / 06-03 desktop exports;
`bricksetSetCache`/`blValueCache` are modeled (not on disk) and can be sized live from `localStorage`
before P4.2 if an exact number is wanted. Build starts at **P4.0 (the net)** only after sign-off.

---

### Report summary (for the kickoff)

- **Cache-set:** snapshot **`bricksetSetCache`** (~485 KB — the actual cold-start win) **+ `blValueCache`**
  (~108 KB — BL-primary value safety net). Exclude `blPriceGuideCache` (background/on-demand, 6 h TTL →
  stale on restore) and `brickEconomySetCache` (confirmed stays stripped — regeneratable + BE removal).
  Total ≈ **593 KB** → push body **~1.0 MB / 10%** of the 10 MB limit — 🟢 GREEN through BE removal and 2× growth.
- **Mechanism:** a **separate sibling field `backup.enrichmentSnapshot`**, NOT `BACKUP_KEYS`. It's
  invisible to `dedupHash` and `hasAnyLocalData` *by construction* (both are registry-only projections),
  so zero churn, zero census drift, and the existing sync net stays green — lowest blast radius. Wired
  through two module helpers (`buildEnrichmentSnapshot`/`restoreEnrichmentSnapshot`) over the existing
  `getRaw`/`saveRaw` chokepoint, not scattered.
- **Restore/TTL:** snapshot **whole entries** → `fetchedAt`/`cachedAt` round-trip verbatim via `saveRaw`
  (no re-stamp) → fresh restores fresh (no refetch), stale restores stale (background refresh). Seeded
  in `applyCloudBackup` **after** a successful atomic apply, **before** the reload, so reloaded surfaces
  hydrate warm.
- **Phasing:** P4.0 net → P4.1 inert helpers → P4.2 wire push → P4.3 restore on cold-start →
  (P4.4 optional coverage-gated push) → P4.5 Vercel-preview proof (cold load = warm, no trickle).
- **STOP — no code written.** Build begins at P4.0 only after sign-off.
