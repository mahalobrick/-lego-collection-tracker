# Enrichment / Caching Layer — Phased Plan + Phase-2 Measurements

**Status:** Plan of record. Phase 2 (measure + plan) complete; no code changed in P2.
**Date:** 2026-06-06 · **HEAD at P2:** `32bc2d3` · **Branch:** `main`
**Companion:** [`docs/enrichment-audit.md`](enrichment-audit.md) — the read-only discovery audit
this plan builds on. Where a measurement here contradicts an audit assumption, it is called out
inline (**RECONCILE**).

**Goal of the workstream:** one shared, persisted enrichment cache (TTL refresh) that every
surface reads from, and — if and only if it fits the backup budget — a synced snapshot so a
fresh device / re-login shows complete data immediately (no "climbing numbers").

---

## The 5-phase shape

| Phase | What | Touches sync registry? | Status |
|---|---|---|---|
| **P1** | Memoize Wanted + Budget Overview chart datasets (render-recompute fix, §5 of audit) | No | ✅ **DONE** — `c1e3e56` (Wanted), `32bc2d3` (Budget). Behavior-neutral. |
| **P2** | Measure the backup budget + capture this plan to disk | No (read-only + 1 doc write) | ✅ **DONE** (this doc) |
| **P3** | Generalize `valueCache.js` → shared enrichment cache; route the ~7 caches through it; warm-seed MC charts | No | ⬜ Pending |
| **P4** | Snapshot enrichment into `BACKUP_KEYS`/sync for cross-device cold-start | **Yes (highest-risk)** | ⬜ **GATED** — see GO/NO-GO below |
| **P5** | Hygiene: consolidate the 3 Rebrickable-Fill paths; make `clearApiCache` clear all ~7 caches | No | ⬜ Pending |

P1 maps to audit **Option A**; P3 to **Option C** (persist+unify, device-local, NOT in
`BACKUP_KEYS`); P4 to **Option D/E** (the only options that fix cross-device cold-start).

---

## Phase-2 measurements

All sizes are **compact JSON** (`JSON.stringify`, no pretty-print) — the wire shape. Measured
against real data: the local full-backup exports in `~/Desktop/Brickledger/`
(`brickledger-backup-2026-06-05.json` for the synced payload; `…-06-03.json` for a populated
`brickEconomySetCache`). The collection is **600 sets** — the live ~600 the plan targets.

### 1a. Current backed-up payload (what `/api/sync` POSTs today)

The POST body is `buildBackup()` **minus `brickEconomySetCache`** (deleted before push,
`exportBackup.js:38`). Measured on the 2026-06-05 export:

| Field (BACKUP_KEYS) | Compact bytes | Items |
|---|---:|---|
| `brickEconomyNormalized` | 394,710 | 600 (658 B/set) |
| `budgetPurchases` | 7,576 | 25 |
| `settings` | 6,818 | 9 |
| `wantedList` | 2,705 | 4 |
| `portfolioHistory` | 974 | 13 |
| `brickEconomySyncInfo` | 477 | 18 |
| everything else (stores, budgets, scalars, wrapper) | ~150 | — |
| **TOTAL synced POST body** | **413,585 B ≈ 404 KB** | |

`brickEconomyNormalized` is **95%** of the payload; it carries the computed
`currentValue`/`totalValue`/`roiPct` per set plus an `entries[]` array per set.

### 1b. Projected enrichment payload (the caches NOT currently synced), × 600 sets

| Cache | B/entry | Method | × 600 |
|---|---:|---|---:|
| `brickEconomySetCache` | 1,477 | **measured** (34 real entries in 06-03 export) | **865 KB** |
| `bricksetSetCache` | ~828 | modeled from `api/brickset-set.js` shape (incl. image/thumbnail/brickset URLs) | **485 KB** |
| `blValueCache` | ~185 | modeled from `{record:{new,used},fetchedAt}` shape | **108 KB** |
| **TOTAL enrichment (all 3, full payloads)** | | | **≈ 1.42 MB** |

Smaller caches (`bricksetThemesCache`, `legoLastChanceCache`, `blBFRetirementCache`,
`blPriceGuideCache`) are single-blob or tiny and not per-set; excluded from the projection
(they're cheap single re-fetches on a fresh device, audit §2).

**Trimmed-projection alternative** (P4 fallback): sync only the derived fields each surface
actually reads — per-set `{minifigs, pieces, retail, value}` ≈ 150 B/set × 600 ≈ **88 KB**.

### 1c. The Upstash limit that applies to `/api/sync`

`/api/sync` stores the whole backup as **one Redis string** under `brickledger:user:{userId}`
via the Upstash REST `/set` (sync.js:37-43). Two operational limits apply (confirmed in
Upstash docs, June 2026):

- **Max request size: 10 MB** (Free **and** Pay-as-you-go — identical). This bounds the POST
  body to `/set` and the GET read. **This is the binding constraint.**
- **Max record size: 100 MB** (both plans). Not a concern at our scale.

Sources: [Upstash — max request size troubleshooting](https://upstash.com/docs/redis/troubleshooting/max_request_size_exceeded),
[Upstash — Pricing & Limits](https://upstash.com/docs/redis/overall/pricing).
(Earlier audit Q1 left this as "check the dashboard" — now resolved from docs. If the account
is on a **Pro/Enterprise** plan the request limit can be higher still; 10 MB is the floor.)

### 1d. Verdict — does (a)+(b) fit under (c)?

| Scenario | Synced size | vs 10 MB limit |
|---|---:|---|
| Today (a only) | 404 KB | 4% — fine |
| a + full enrichment (Option D, all 3 caches) | **1.82 MB** | **18% — 🟢 GREEN** |
| a + trimmed projection (Option E, ~88 KB) | 492 KB | 5% — green |
| a + full enrichment at 2× growth (~1,200 sets) | ~3.6 MB | 36% — still green |

**🟢 GREEN.** Even the heaviest option (sync all three full caches) lands at **1.82 MB against a
10 MB request ceiling** — and stays green through a collection doubling. **Backup size does NOT
gate P4.** (This refines audit §6 Option D, which named backup-size as "the big one": at 600
sets on a 10 MB limit it is comfortably non-binding. The *real* P4 risk is sync blast-radius,
not size — see GO/NO-GO.)

### 2. Dead-code / persistence confirms

- **Q3 — Are BE-set minifigs/pieces ever persisted to a synced key?**
  **`pieces`: YES. `minifigs`: NO.** Measured on the 600-set synced
  `brickEconomyNormalizedCollection`: **600/600** carry a top-level `pieces` **and** an
  `entries[].pieces_count`; **0/600** carry `minifigs` (no top-level field, none in `entries[]`).
  `runBricksetEnrichment` patches both into React state + `bricksetSetCache` only, and never
  writes them back to the normalized collection — but `pieces` rides along because the BE
  importer already stored it in the normalized row.
  **RECONCILE — audit §4 Step 4 is half-wrong:** it claims a fresh device has
  `minifigs==null && pieces==null` and that pieces visibly climb. In fact **pieces display
  immediately from the synced collection; only minifigs are null and only minifigs climb.**
  The re-fetch *count* is unchanged (the `toFetch` filter at `MyCollection.jsx:395` skips a set
  only when minifigs **and** pieces are both present → minifigs-null still re-fetches all ~600),
  but the **cold-start display gap is smaller than the audit implied** — pieces are not part of
  the climb.

- **Q4 — Is `brickEconomyOwnedSets` (read at `WantedList.jsx:293`) live or dead?**
  **DEAD / legacy.** Exactly one reference in the whole repo — that read — and **zero writers**
  in `src/` or `api/`. It always resolves to `"[]"` and contributes nothing to the
  `ownedSetNumbers` Set (harmless no-op). Confirms the BE collection lives **only** in
  `brickEconomyNormalizedCollection`; a cache redesign can assume that single home. (Safe P5
  delete candidate.)

- **Q5 — Does `clearApiCache` clear only 2 of ~7 caches?** **Confirmed — clears 2, misses 6.**
  `clearApiCache` (`AppSettings.jsx:983-987`, the "Clear Cache" button at `:1277`) removes only:
  - `brickEconomySetCache`
  - `brickEconomyCollectionCache` *(not even in the active cache inventory — likely vestigial)*

  It **misses**: `bricksetSetCache`, `blValueCache`, `blPriceGuideCache`, `bricksetThemesCache`,
  `legoLastChanceCache`, `blBFRetirementCache`. (Two caches are cleared elsewhere by separate
  controls: a "Clear cache" link at `:1262` drops `bricksetSetCache`; `disconnectBrickLink`
  at `:999-1002` drops `blPriceGuideCache` + BL tokens. There is **no** single "force full
  re-enrich" control — P5 should make `clearApiCache` clear all ~7.)

### 3. Cold-start cost (theoretical, from the throttles in code)

| Engine | Work on cold start | Client pacing | Est. wall-clock |
|---|---|---|---|
| **Brickset enrichment** (`runBricksetEnrichment`) | ~600 sets re-fetched (minifigs-null ⇒ all qualify) | **sequential, 400 ms** between each (`MyCollection.jsx`) | 600 × (400 ms + RTT) ≈ **4–7 min** |
| **BL value overlay** (`fetchValues`) | all ~600 numbers | **ONE batched POST** to `/api/values` (no per-set client throttle) | **~seconds** (single round-trip) |
| **BE daily batch** (`runDailyBEBatch`) | 50/day, 400 ms apart | 50-set cap/day | ~20 s/day, full rebuild over ~12 days (background, invisible — values already display from synced collection) |

**Brickset enrichment dominates wall-clock** by ~2 orders of magnitude: ~600 sequential calls at
a 400 ms floor (≥4 min) vs one batched value call (seconds). **RECONCILE — resolves audit Q2:**
the long visible "climb" is the **minifigs trickle** (Brickset, ~4–7 min); the value/gain/ROI
"climb" is a fast snap (one batched BL call) not a long trickle. A profiled cold start would
confirm the exact wall-clock, but the estimate is decisive on *which engine dominates*
(Brickset), so profiling is **optional** unless P4 design needs the absolute number.

---

## Storage topology

This Vercel account has **two** projects on **two** Redis providers, so before P4 writes more
into the synced blob we confirmed which store this repo's `/api/sync` actually binds. Mapped
from repo/config/**env-var names only** — no live Redis store was connected, authenticated
against, or read (per the P2 guardrail; live-data presence is Sam's dashboard check).

| | Project | Store | Provider / size |
|---|---|---|---|
| A | `lego-app` | `upstash-kv-green-canvas` | Upstash, 256 MB |
| B | `lego-collection-tracker` | `redis-bole-ball` | Redis Cloud, 30 MB |

**0a — Which project does THIS working copy link to?**
`.vercel/project.json` → `projectName: "lego-app"`, `projectId: prj_XrfQRtMyDrRMxWVGLjqQn1ScUxd6`,
`orgId: team_VoGkpEmFcLfewFogRrlxuShl`. So the linked Vercel project is **`lego-app`** (project A).
(`.vercel/` is git-ignored / local-only per its own README, so this reflects *this machine's* link,
not a committed fact — Sam should confirm the same link on any other deploy box.)

**0b — Which store does `/api/sync` bind?** **Upstash, definitively.** `sync.js:48-49` reads
exactly `process.env.KV_REST_API_URL` + `process.env.KV_REST_API_TOKEN`, then hits a **hand-rolled
REST client** (`upstashClient`, `sync.js:25-45`) at `${url}/get/{key}` and `${url}/set/{key}?ex=…`
— the Upstash REST API shape, **not** `@upstash/redis`, **not** `redis`/`ioredis`, **not** a
`REDIS_URL` connection string. The same `KV_REST_API_URL`/`KV_REST_API_TOKEN` pair is read by
`_ratelimit.js:21-22` and `values.js:31-32` — one store backs sync + rate-limit + value cache.
`KV_REST_API_*` are the **Vercel-KV (Upstash) integration** variable names.

**0c — Any sign of a second-provider / two-project deploy?** **No code path touches Redis Cloud.**
- **Repo-wide grep:** zero references to `redis-bole-ball` / `bole-ball` / `green-canvas` /
  `redis-cloud` / `rediss://`. `ioredis` is gone (security DEP-1, resolved). `@upstash/redis` is a
  dep but used **only** by batch tooling `scripts/refresh-values.mjs`, which "reuses the existing
  `KV_REST_API_*` REST creds" (`:54-55`) and reads `brickledger:user:*` from the **same** Upstash
  keyspace `sync.js` writes — confirming a single shared store, not a split.
- **`.env.local` carries `REDIS_URL` + `KV_URL`** (alongside `KV_REST_API_URL`/`_TOKEN`/
  `_READ_ONLY_TOKEN`), but **no `api/` code reads `REDIS_URL` or `KV_URL`** — they're the rest of
  the Vercel-KV/Upstash auto-injected bundle (`docs/security.md:145` labels `REDIS_URL`/`KV_URL`
  "(Upstash provisioning)"). Their presence is **not** a Redis Cloud binding.
- **The one real two-project signal:** the **GitHub repo is named `mahalobrick/-lego-collection-tracker`**
  (`deploy/brickledger-refresh.{service,timer}`, `docs/deploy-batch.md:55`) — i.e. it shares its
  name root with project **B**, while this working copy is Vercel-linked to project **A**
  (`lego-app`). So **one GitHub repo may be wired to both Vercel projects' Git integrations.** That
  is a deploy-routing question, not a data-split in code: this code only ever speaks
  `KV_REST_API_*` (Upstash); on a project lacking those vars `getKv()` returns `null` and
  `/api/sync` 503s `not_configured` (`sync.js:57-59`) — it never falls back to `REDIS_URL`. So if
  project B (Redis Cloud only) deploys this code, **its sync is simply non-functional**, not
  writing to a second store.

**0d — Why is `brickEconomySetCache` stripped before push?** `pushToCloudAuth` does
`delete backup.brickEconomySetCache; // large and fully regeneratable` (`exportBackup.js:38`),
right after `buildBackup()` and **before** the dedup-hash + POST. Note `buildBackup` still
*includes* it (`:322`) so the **local file export** carries it for offline restore; only the
**cloud push** drops it. **The exclusion is deliberate and the reason is payload size, not
freshness/correctness** — the comment states it plainly ("large and fully regeneratable"; it is
re-fetched from BrickEconomy by the daily batch). **For P4:** re-including it is feasible on size
(verdict GREEN — +865 KB → ~1.8 MB ≪ 10 MB), but the audit Option-D **staleness round-trip**
concern still applies (a synced cache round-trips `fetchedAt`, so a pulled snapshot could read as
fresh-forever / always-stale). So size doesn't block re-inclusion; prefer the trimmed projection
or explicit `fetchedAt` handling regardless.

**0e — Conclusion.**
- **Canonical from code:** project **`lego-app`** + the **Upstash** store it binds via
  `KV_REST_API_URL`/`KV_REST_API_TOKEN`. P4 must write to **this one store**. The
  `lego-collection-tracker` / Redis-Cloud project has **no binding in this code** and is not a
  data destination for sync.
- **Cannot be determined locally (hand to Sam — dashboard):** (1) that the redacted
  `KV_REST_API_URL` host actually resolves to `upstash-kv-green-canvas` (mapped from var *names*
  only, value not read); (2) whether the `-lego-collection-tracker` GitHub repo is also connected
  to Vercel project B's Git integration (a two-project deploy); (3) which project owns the
  **production domain**; (4) live data presence — key count / data size in each store, and whether
  **both** actually hold real `brickledger:user:*` backups (a split would mean users on two stores).

---

## P4 — GO / NO-GO gate

**Trigger to revisit:** before any `BACKUP_KEYS` change. P4 is the only phase that touches the
highest-blast-radius code in the repo (the sync registry: census / overwrite / build /
push-guard / dedup-hash, all derived from `BACKUP_KEYS`, plus the A4 unsynced-wipe guard).

### Gate 0 — Resolved to ONE canonical store (topology): ⚠️ **GO-with-confirm**
From code, the canonical target is **`lego-app` + Upstash** (§ Storage topology, 0e). No code
path writes to the Redis Cloud store, so P4 has a single destination on paper. **Precondition
before writing:** Sam confirms on the dashboards that (a) the production domain is served by
`lego-app`, and (b) there is no second live store holding real `brickledger:user:*` backups (no
user split). If a split exists, P4 must not ship until it's collapsed to one store — else a larger
synced blob would diverge across two backends.

### Gate 1 — Backup size (the 1d verdict): ✅ **GO**
1.82 MB worst-case vs a 10 MB request ceiling (4% today → 18% with full enrichment, green
through 2× growth). **Size is not the constraint.** This gate is satisfied.

### Gate 2 — Sync blast-radius (the real gate): ⛔ **NO-GO until a characterization net exists**
Per audit §6 Option D, before adding any entry to `BACKUP_KEYS` we must first land a
**characterization test net** over current sync behavior (census classification, dedup-hash
stability, atomic apply/rollback, A4 unsynced-wipe refusal). Only with that net green do we
add the enrichment snapshot. Specifically the snapshot entry must decide, with tests:
- **census flag** — `census:false` (an enrichment snapshot is regeneratable, must NOT make a
  fresh device read as "has unsynced data" and skip the cloud pull — SYNC-CRIT-1 / A4 class).
- **hash side** — whether it sits inside the dedup-hash projection. If **in**, every background
  refresh marks the device dirty → push churn. If **out** but in the body, that reintroduces the
  census/hash drift the registry was built to prevent (A11). Leaning **out of the hash**, synced
  opportunistically on the next user-data push.
- **TTL round-trip** — the pulled snapshot needs a believable `fetchedAt` or it's treated as
  fresh-forever / always-stale.
- **`setItemSafe` / funnel bans** — the new shared module (P3) must not trip DATA-4 or the
  per-copy `.entries` ban; extend the guard tests.

### Fallback if a future re-measure goes over budget (e.g. collection grows past ~3,000 sets)
Not needed at current scale, but if the full-payload path ever approaches the 10 MB request
limit, prefer in order:
1. **Trimmed projection (Option E):** sync only derived `{minifigs, pieces, retail, value}` per
   set (~88 KB / 600) instead of full API payloads — kills the visible climb at ~6% of the full
   cost. Full caches stay device-local (P3) and regeneratable.
2. **Compress** the snapshot field before push (the body is already JSON; gzip would cut the
   normalized collection ~5–8×) — more code, only if (1) is insufficient.

**Decision:** P4 proceeds **only** after P3 lands the shared cache and a characterization net is
green. Size is GO; topology is GO-with-confirm (one canonical store: `lego-app` + Upstash, pending
Sam's dashboard check for a user split); blast-radius is the hold. Build the net first.

---

## What P2 did NOT do
No code changes, no dev server, no progress-tracker edits. Network limited to the Upstash docs
lookup for limit 1c. Measurements are static-analysis + real-export sizes; the cold-start
wall-clock (3) is an estimate from code throttles, not a runtime profile.
