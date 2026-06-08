# P4.4 — Force the enrichment-snapshot push on enrichment-complete

**Status:** READ-ONLY DISCOVERY (this doc). No code touched. Implementation phasing at the end.

## Problem recap

The P4 enrichment snapshot (`bricksetSetCache` + `blValueCache`) rides the cloud backup as the
**sibling field** `backup.enrichmentSnapshot` ([exportBackup.js:47](../src/utils/exportBackup.js)) and
restores on cold-start ([App.jsx:130](../src/App.jsx)). By design the sibling is **invisible to
`dedupHash`**, so a snapshot-only change reads as `no_change` and the normal push **skips** it. The
snapshot therefore reaches the cloud only **opportunistically** — when some `BACKUP_KEYS` field changes
(a collection edit) it rides along. Consequently a push can capture a **mid-enrichment** snapshot
(observed: ~335/600), the next cold-start restores 335 warm then re-climbs to the real ceiling (~460) as
un-snapshotted sets fetch first-time. Every cold-start re-climbs `ceiling − snapshot coverage` until a
**fuller** snapshot is pushed.

**Goal (P4.4):** force a snapshot push when enrichment **completes** (coverage grew), gated so it fires
only on real growth — no push storms, no push when nothing changed — without the user making a manual
data change, and without touching `dedupHash` semantics, the atomic-apply contract, or the sibling-field
invisibility the P4.0 net pins.

---

## 1. Enrichment-complete hook — where the loops live & where they settle

### 1a. Brickset trickle (the minifig/MSRP/pieces climb → `bricksetSetCache`)
- **The loop:** `runBricksetEnrichment(currentSets, forceAll)` —
  [MyCollection.jsx:393–431](../src/MyCollection.jsx).
  - Builds `toFetch` = owned sets missing `minifigs`/`pieces` ([:395–399](../src/MyCollection.jsx)).
  - `for (const item of toFetch)` ([:406](../src/MyCollection.jsx)), `await fetchBricksetSet(clean)`
    ([:409](../src/MyCollection.jsx)) → `cacheBricksetSet(clean, bsData)` writes the cache
    ([:413](../src/MyCollection.jsx)), throttled **400ms** between fetches ([:424](../src/MyCollection.jsx)).
  - **Cycle end:** `setMetaRefreshing(false)` ([:426](../src/MyCollection.jsx)) — the only existing
    "done" signal, a React state flag, not an event.
- **The mount driver (the cleanest settle point):** the once-on-mount async IIFE at
  [MyCollection.jsx:453–465](../src/MyCollection.jsx):
  ```js
  useEffect(() => { (async () => {
    await runBricksetEnrichment(sets, false);   // minifig/pieces trickle
    const fetched = await fetchCmfSeriesRetail(sets);  // CMF -0 retail, sequential
    if (fetched > 0) { …setRetailCaches… }
  })(); }, []);
  ```
  This IIFE **awaits both** Brickset writers in sequence; its completion (just after
  [:462](../src/MyCollection.jsx)) is the single, reliable "this Brickset enrichment cycle is settled"
  point. There is no completion event today — but this `await … await …` chain is a clean place to emit one.

### 1b. BL value overlay (→ `blValueCache`)
- **The effect:** [MyCollection.jsx:339–348](../src/MyCollection.jsx), keyed on `ownedKey`.
  - Warm seed `peekValueCache(ownedNumbers)` ([:342](../src/MyCollection.jsx)).
  - `fetchValues(ownedNumbers).then(map => setValueMap(map))` ([:345](../src/MyCollection.jsx)) — a
    single **batch** read-through (`valueCache.js` `readThrough`, no per-item throttle). The `.then`
    callback ([:345](../src/MyCollection.jsx)) is its settle point.

### 1c. `runDailyBEBatch` — NOT relevant to the snapshot
- [beSyncValues.js:168–204](../src/utils/beSyncValues.js), fired 15s after boot
  ([App.jsx:241–246](../src/App.jsx)). Writes **`brickEconomySetCache`** only — which is **NOT** in the
  snapshot (snapshot = exactly `bricksetSetCache` + `blValueCache`,
  [enrichmentSnapshot.js:16](../src/utils/enrichmentSnapshot.js)). So the BE batch is out of scope for the
  P4.4 hook; ignore it.

### 1d. Existing "settled/idle" signals — none usable as-is
There is **no** enrichment-complete event. The only signals are state flags (`metaRefreshing`
[MyCollection.jsx:404/426](../src/MyCollection.jsx); `valueMap` set at [:345](../src/MyCollection.jsx))
and the manual-sync progress states in AppSettings. The data-mutation event bus is
`window … "brickledger:datachange"` ([safeStorage.js](../src/utils/safeStorage.js), consumed at
[App.jsx:282](../src/App.jsx)) — a good **pattern to mirror**, but it does not fire on cache writes
(caches go through `setItemSafe` too, but `bricksetSetCache`/`blValueCache` are in `SYNC_SKIP_KEYS` so
they intentionally do **not** raise `datachange` — that's why they don't churn the push).

**Recommended hook (debounce-after-last-write, via a new event):** emit a new
`window` event `brickledger:enrichmentsettled` at **two** settle points — the Brickset IIFE completion
([MyCollection.jsx:462–463](../src/MyCollection.jsx)) and the value `.then`
([MyCollection.jsx:345](../src/MyCollection.jsx)). App listens with a **debounce** that coalesces the two
(and any re-fires) into one gated push attempt — exactly mirroring the existing
`datachange`→debounced-push effect ([App.jsx:263–285](../src/App.jsx)). The **gate** (§3), not the event
cadence, is the real anti-storm guard, so "fire on every settle" is safe.

---

## 2. The push skip — precise mechanism (why enrichment-only changes don't push today)

`pushToCloudAuth` ([exportBackup.js:31–67](../src/utils/exportBackup.js)):
1. `const backup = buildBackup(new Date())` ([:38](../src/utils/exportBackup.js)) — builds the body from
   **`BACKUP_KEYS` only** ([:312–335](../src/utils/exportBackup.js)).
2. `delete backup.brickEconomySetCache` ([:39](../src/utils/exportBackup.js)).
3. `backup.enrichmentSnapshot = buildEnrichmentSnapshot()` ([:47](../src/utils/exportBackup.js)) —
   attaches the snapshot as a **sibling**, set **after** `buildBackup`, **not** a `BACKUP_KEYS` entry.
4. **The skip:** `const contentHash = dedupHash(backup)` ([:50](../src/utils/exportBackup.js)); then
   `if (contentHash === localStorage.getItem("blLastPushHash")) return { skipped: "no_change" }`
   ([:51](../src/utils/exportBackup.js)).

`dedupHash` ([:76–83](../src/utils/exportBackup.js)) **projects over `BACKUP_KEYS` only**:
```js
for (const k of BACKUP_KEYS) { projection[k.key] = (k.settings ? backup.settings : backup)[k.field]; }
return quickHash(JSON.stringify(projection));
```
`enrichmentSnapshot` is **not** a `BACKUP_KEYS` field, so it is **never read into the projection** →
changing it (or its contents) leaves `contentHash` byte-identical. Pinned by the P4.0 net **PIN 3**
([exportBackup.snapshot.test.js:133–180](../src/utils/exportBackup.snapshot.test.js)) and **PIN 6**
([:312–342](../src/utils/exportBackup.snapshot.test.js), incl. "second push with no change is skipped").

**That is exactly why an enrichment-only change reads as `no_change` and skips** — the desirable property
that keeps enrichment from churning the push, and the property P4.4 must surgically bypass *only* for an
intentional snapshot refresh, leaving the default path's skip semantics intact.

On a successful POST, the push records `blLastCloudPush` + `blLastPushHash`
([:64–65](../src/utils/exportBackup.js)). **`blLastPushHash` is the skip's state.** The existing
"force the push through" idiom elsewhere is `localStorage.removeItem("blLastPushHash")` then push
([App.jsx:163](../src/App.jsx), [App.jsx:227](../src/App.jsx)) — the seed for §4.

---

## 3. The gate — a coverage signature

**Signature (cheap, entry-count based):**
```
sig = `${count(bricksetSetCache)}:${count(blValueCache)}`
```
where `count(x) = Object.keys(x).length`. Source the maps from the helpers the snapshot already uses:
`getBricksetCache()` ([brickset.js:37](../src/utils/brickset.js)) and `getValueCacheRaw()`
([valueCache.js:95](../src/utils/valueCache.js)) — or, cheaper, count the keys of the
`backup.enrichmentSnapshot` object already built at [exportBackup.js:47](../src/utils/exportBackup.js).

**Why entry-counts suffice for "coverage grew":** each enrichment write **adds a key** —
`cacheBricksetSet` puts `brickset_<n>` per fetched set ([brickset.js:31–33](../src/utils/brickset.js));
`fetchValues` writes one key per requested number ([valueCache.js:62–73](../src/utils/valueCache.js)). So
coverage growth is monotonic key growth; counts capture it without hashing the (large) cache contents.
(A light content hash is unnecessary for the stated gate "fires only when coverage GREW", and would
defeat the cheapness goal.)

**Storage key:** `blLastSnapshotSig` — device-local, **NOT** in `BACKUP_KEYS` (so it stays invisible to
`dedupHash`/census, same class as `blLastPushHash`), `bl`-prefixed (so the sign-out wipe superset clears
it, [exportBackup.js:218](../src/utils/exportBackup.js)). Written via `setItemSafe`.

**Comparison (grew, not merely changed):** parse both counts; force-push fires iff **either** count is
**strictly greater** than the stored sig's:
```
grew = (bsNow > bsPrev) || (valNow > valPrev)   // absent sig ⇒ prev = 0:0
```
Strict-greater (not `!==`) means an eviction/TTL drop that *shrinks* a count never triggers a push, and a
no-op settle never does. This is the core anti-storm property.

---

## 4. The force-push path — bypass the `no_change` skip without touching its semantics

**Where it slots:** a new exported fn in `exportBackup.js` + a small flag on `pushToCloudAuth`, driven by
a new App effect.

**Design A (recommended) — a `force`/reason flag on `pushToCloudAuth`:**
```js
export async function pushToCloudAuth(getToken, { snapshotRefresh = false } = {}) {
  …build backup, attach snapshot (unchanged)…
  const contentHash = dedupHash(backup);
  if (!snapshotRefresh && contentHash === localStorage.getItem("blLastPushHash"))
    return { skipped: "no_change" };          // default path unchanged
  …POST…
  setItemSafe("blLastPushHash", contentHash); // STILL recorded (idempotent — BACKUP_KEYS unchanged)
  setItemSafe("blLastSnapshotSig", snapshotSig(backup.enrichmentSnapshot)); // NEW, every success
  return json;
}
```
Key points:
- The flag bypasses **only the equality short-circuit**. `dedupHash` is still computed and
  `blLastPushHash` still recorded (its value is unchanged because no `BACKUP_KEYS` field moved — so it's
  idempotent and the next *normal* push still correctly skips). **`dedupHash` semantics, the projection,
  and the sibling invisibility are untouched.**
- `blLastSnapshotSig` is recorded on **every** successful push — normal *and* forced — so the
  opportunistic push and the force-push **share** the gate state (defuses double-push, §5).

**The gated wrapper (the actual P4.4 entry point):**
```js
export async function pushSnapshotIfGrown(getToken) {
  const sigNow = snapshotSigFromCaches();           // count bricksetSetCache + blValueCache
  if (!grew(sigNow, localStorage.getItem("blLastSnapshotSig")))
    return { skipped: "snapshot_no_growth" };
  return pushToCloudAuth(getToken, { snapshotRefresh: true });
}
```

**Wiring (App.jsx):** a new effect mirroring [App.jsx:263–285](../src/App.jsx), listening for
`brickledger:enrichmentsettled`, **debounced at ~15s** (deliberately matching the existing
`brickledger:datachange` push window at [App.jsx:280](../src/App.jsx) for consistency) and **gated on
`syncReadyRef.current` + signed-in** (identical guards to the existing pushes), calling
`pushSnapshotIfGrown(getToken)`.

**Seed the baseline on restore (critical, §5):** in `applyCloudBackup`
([App.jsx:130–131](../src/App.jsx)), right after `restoreEnrichmentSnapshot(cloud.enrichmentSnapshot)`,
set `blLastSnapshotSig` from the restored snapshot's counts. Otherwise a freshly-restored device (caches
already at cloud ceiling, `blLastSnapshotSig` absent ⇒ prev `0:0`) would force-push the *same* coverage it
just pulled.

**Cost / leanness:** `/api/sync` stores **one whole JSON blob per user** (no partial-update endpoint), so
a force-push re-uploads the **entire `BACKUP_KEYS` blob + snapshot** — same cost as any normal push. It
**cannot** push "snapshot-only" leaner without an API change (out of scope; not worth it). The gate bounds
this to roughly **one extra full-blob POST per coverage-growth step per cold session** — typically 1.

---

## 5. Risks & interactions

| Risk | How the design defuses it |
|---|---|
| **Push storm** (event fires repeatedly) | The **strict-greater gate** (§3) is the guard, not the debounce. After the first force-push records `blLastSnapshotSig`, further settles at the same coverage return `snapshot_no_growth`. Debounce just coalesces. |
| **Double-push with the opportunistic push** | Both the normal and the forced push record `blLastSnapshotSig` on success (§4). If an opportunistic push already captured full coverage, the force-push sees no growth → skips. They share one gate. |
| **Mid-climb capture (the original bug)** | The event fires at the **IIFE completion** ([MyCollection.jsx:462](../src/MyCollection.jsx)) = cycle ceiling, not mid-loop. Worst case a partial settle pushes, then a later settle with a *grown* sig pushes once more — bounded by growth steps, not a storm. |
| **Fresh device re-pushes what it just pulled** | Seed `blLastSnapshotSig` from the restored snapshot in `applyCloudBackup` (§4) so a restored-to-ceiling device shows no growth. |
| **Push fires during reconciliation/conflict** | The new effect is gated on `syncReadyRef.current` (+ signed-in), identical to [App.jsx:252](../src/App.jsx)/[:271](../src/App.jsx). It never pushes before reconcile decides who wins. |
| **`dedupHash` / census / sibling-invisibility (P4.0 PINs 1–3,6)** | Force-push touches **no** `BACKUP_KEYS` field, never alters the projection, and adds only the non-registry `bl`-prefixed `blLastSnapshotSig`. The default (`snapshotRefresh:false`) path keeps the exact `no_change` skip — **PIN 6's "second push skipped" must still pass**. |
| **Atomic-apply / OBS-2 (PIN 4)** | Untouched — force-push is a push-side change; apply/restore are unchanged. The `applyCloudBackup` seed of `blLastSnapshotSig` runs **outside** the atomic block (after `restoreEnrichmentSnapshot`, like the existing post-apply cache step) and via `setItemSafe`, so a quota failure there is cold-but-correct. |
| **A4 unsynced-wipe (PIN 5)** | `blLastSnapshotSig` is not census/registry data; the A4 verdict (`localContentHash` vs `blLastPushHash`) is unchanged. |
| **Cache TTL / staleness** | Whole-entry snapshot with verbatim timestamps already handles this ([enrichmentSnapshot.js:11–14](../src/utils/enrichmentSnapshot.js)); force-push changes only *when* the snapshot is pushed, not its shape. |
| **`blLastPushHash` drift** | The forced push still records `blLastPushHash` (unchanged value) → the next normal push's skip behaves exactly as before. Never leave it unrecorded. |

---

## 6. Recommended phasing (net → build)

1. **P4.4.1 — net (characterization, no prod code):** extend
   [exportBackup.snapshot.test.js](../src/utils/exportBackup.snapshot.test.js) (or a sibling) to pin:
   (a) `pushToCloudAuth(getToken, { snapshotRefresh:true })` **POSTs even when `dedupHash === blLastPushHash`**,
   while the default call still returns `no_change` (PIN 6 unchanged);
   (b) the gate: `pushSnapshotIfGrown` POSTs only when a count grew, else `snapshot_no_growth`;
   (c) `blLastSnapshotSig` is recorded on every successful push and is invisible to `dedupHash`/census;
   (d) the `applyCloudBackup` restore seeds `blLastSnapshotSig` so a restored device shows no growth.
2. **P4.4.2 — build (push side):** add the `snapshotRefresh` flag + `blLastSnapshotSig` recording +
   `pushSnapshotIfGrown` + `snapshotSig` helper in `exportBackup.js`. Seed `blLastSnapshotSig` in
   `applyCloudBackup`.
3. **P4.4.3 — build (hook side):** emit `brickledger:enrichmentsettled` at the two settle points in
   `MyCollection.jsx`; add the debounced, `syncReadyRef`-gated listener effect in `App.jsx`.
4. **P4.4.4 — verify:** the existing P4.0 net stays green (no regression to PINs 1–7); manual cold-start
   check that a completed enrichment cycle pushes a full-coverage snapshot and the *next* cold-start comes
   back fully warm without re-climbing.
