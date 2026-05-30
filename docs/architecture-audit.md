# BrickLedger — Architecture Audit

_Date: 2026-05-29 · Commit: `2a9fa3f` · Method: 26-agent workflow (parallel grounded finders → adversarial verification → 2-pass data-loss red-team). Raw file/git dumps stayed in subagents._

> ▶️ **Execution order:** findings below are ranked by severity; for the *sequenced* work plan (grouped by root cause, stopgap → test → refactor) see [`docs/audit-action-plan.md`](./audit-action-plan.md).

## Executive Summary

BrickLedger is a four-tab React 19 + Vite 8 single-page app whose source of truth is browser `localStorage`, mirrored to a per-user JSON blob in Upstash Redis through a small set of Clerk-authenticated Vercel functions. Post security-hardening the trust boundaries are sound (see `docs/security.md`), but the codebase carries the structural debt typical of fast iteration: four 1,000–3,600-line "god-module" tabs share a **schema-less `localStorage` namespace with no data-access layer**, the cloud backup round-trips a key set that is **defined ad hoc in several places** (so user-authored content silently falls out of it), money handling is **215 scattered `asNumber()` call sites** with no enforced money type, and there is **zero automated test coverage** — most acute precisely on the data-destruction branches and money math. The single highest-impact risk lives in the most-churned subsystem, **cloud-sync reconciliation**: the "is this device empty?" check is narrower than the set of keys a cloud-pull overwrites, producing a verified silent data-loss path (below). None of this is a security regression — it is reliability and maintainability debt — but the data-loss path should be treated as release-blocking.

> ### 🚨 Critical — `SYNC-CRIT-1`: emptiness check narrower than overwrite scope (red-team confirmed ×2)
>
> `reconcileOnSignIn` decides a device is "fresh" via `summarizeLocal()` (`src/utils/exportBackup.js:90-96`), which inspects only **owned sets, wanted, purchases**. When that returns empty and a cloud blob exists, `src/App.jsx:123-129` calls `applyBackupToLocalStorage(cloud)` **unconditionally — no `cloudNewer`, no `localDirty`, no conflict dialog** — and that function (`exportBackup.js:147-175`) overwrites **`blSoldSets`, `blPortfolioHistory`, `blStores`, `blStoreBudgets`, `blAnnualBudget`, and all column/currency/widget settings**. So a device whose only unsynced work lives in those uncounted keys is silently overwritten with stale cloud data. `pushToCloudAuth`'s `hasAnyData` guard (`exportBackup.js:31-34`) shares the same blind spot, so this state can never be pushed either — the local edits are structurally unprotected.
>
> **Realistic triggers:** (1) a budget-first / settings-only first session; (2) a user who sold their whole active collection (`blOwnedSets → []` but `blSoldSets`/`blPortfolioHistory` populated — `MyCollection.jsx:286-288`), then reloads before the 15 s debounce push fires.
>
> Both red-team attempts rated it High because the *primary* buckets (collection/wanted/purchases) **are** correctly protected by the dirty-check + conflict dialog on the both-have-data path. It is recorded here as **Critical** per the audit's standing rule — *any* path that can wipe unsynced local changes is Critical — because the loss is silent, unrecoverable, and reachable in normal use.
>
> **Fix direction:** derive the emptiness census and the overwrite/`hasAnyData` set from **one shared key list**, and gate the fresh-device pull behind the same `cloudNewer`/`localDirty` guard the both-have-data path already uses (`App.jsx:140`). See finding `A10`, `DATA-1`, `API-1`.
>
> **✅ CLOSED (Phase D, 2026-05-29):** the census (`hasAnyLocalData`), the overwrite (`applyBackupToLocalStorage`), the build (`buildBackup`), and `pushToCloudAuth`'s push-guard now **all derive from one shared registry** (`BACKUP_KEYS` in `src/utils/exportBackup.js`). The census counts every overwritten data key, so a sold-everything / budget-only / settings-only device is no longer misread as "fresh" — the fresh-device pull fires only when the device genuinely holds no unsynced data. Locked by characterization + red-team regression tests (`src/utils/exportBackup.census.test.js`, `exportBackup.roundtrip.test.js`). See [`docs/audit-action-plan.md`](./audit-action-plan.md) *Phase D*.

**Security is tracked separately and is the source of truth in [`docs/security.md`](./security.md)** (completed audit + remediation — all High/Med/Low closed, CSP enforced). This document does **not** duplicate it: §6 *Security Touchpoints* reconciles the architecture against it and records the drift/gaps that surfaced (`SEC-DRIFT-1`, `SEC-GAP-1`, `SEC-GAP-2`).

Findings were produced by parallel subagents grounded in real files, then each Critical/High was **independently verified** (CONFIRMED / PLAUSIBLE / REFUTED) and severities adjusted to the verified level — shown in the table's *Verified* column. A dedicated two-pass red-team specifically attempted to construct a local-data-loss sequence; its result is `SYNC-CRIT-1`.

## Severity overview (post-verification)

| Critical | High | Medium | Low |
|---|---|---|---|
| 1 | 4 | 24 | 22 |

> **Post-Phase-G (2026-05-30) — data-loss/sync/enforcement arc fully closed:** Closed across Phases B–G: `SYNC-CRIT-1` (Critical), `A4` · `OBS-2` · `A2` (High), and `A11` · `DATA-4` · `SEC-GAP-2` · `TEST-1` (Medium); enforcement (`DATA-4` lint + `SEC-GAP-2` auth test) is CI-gated (`.github/workflows/ci.yml`). Remaining High open: **`churn-wantedlist`** only (Step 4 decomposition). Remaining open is now lower-urgency structural debt (Step 4: money type / god-module decomposition) + Step 5 (view-config census) — none actively destroying data. The counts above are the original post-verification snapshot. **59 tests green; lint clean.**

## Findings (ranked by verified severity)

| Sev | ID | Finding | Area | Effort | Verified |
|---|---|---|---|---|---|
| Critical | `SYNC-CRIT-1` | "Fresh device" emptiness census is narrower than the cloud-pull overwrite scope → silent loss of unsynced sold-sets / portfolio / stores / budget / settings | [Deep-Dive A — Cloud-Sync Reconciliation](#area-deepA-sync) | moderate | CONFIRMED (red-team ×2) · ✅ CLOSED (Phase D) |
| High | `OBS-2` | 111 unguarded localStorage.setItem calls — QuotaExceededError causes silent data loss | [Error Handling, Observability & Testing](#area-errors-testing) | moderate | CONFIRMED → **CLOSED (Phase E; hardened E.5)** |
| High | `A2` | Cloud fetch failure sets syncReadyRef=true, letting a stale local push overwrite newer cloud | [Deep-Dive A — Cloud-Sync Reconciliation](#area-deepA-sync) | moderate | CONFIRMED · ✅ CLOSED (Phase F) |
| High | `A4` | Sign-out wipe destroys local data that was never pushed (offline / failed-sync sign-out) | [Deep-Dive A — Cloud-Sync Reconciliation](#area-deepA-sync) | moderate | CONFIRMED · ✅ CLOSED (Phase D) |
| High | `churn-wantedlist` | WantedList.jsx is the repo's top churn + fix hotspot and is uncovered by Deep-Dives A/B | [Deep-Dive C — Churn-Based Hotspot Discovery](#area-deepC-churn) | significant | CONFIRMED |
| Medium | `A1` | Foreign-data wipe silently deletes local data with no prompt or backup | [Deep-Dive A — Cloud-Sync Reconciliation](#area-deepA-sync) | moderate | PLAUSIBLE → Medium |
| Medium | `DATA-1` | User-authored content keys are excluded from the cloud backup and file export — silently lost on any restore/pull | [Data & State](#area-data-state) | moderate | CONFIRMED → Medium |
| Medium | `DATA-2` | Owned-set collection is split across two localStorage keys with no single accessor — partial-collection drift | [Data & State](#area-data-state) | significant | CONFIRMED → Medium |
| Medium | `MB-1` | Four god-module tabs share a schema-less localStorage namespace with no data layer | [Module Boundaries, Coupling & API Contracts](#area-coupling-api) | requires-rewrite | CONFIRMED → Medium |
| Medium | `API-1` | buildBackup / applyBackupToLocalStorage drop user content (blDealLog, blCustomFieldsSchema) | [Module Boundaries, Coupling & API Contracts](#area-coupling-api) | moderate | CONFIRMED → Medium |
| Medium | `OBS-1` | No React error boundary — any render throw blanks the whole app silently | [Error Handling, Observability & Testing](#area-errors-testing) | moderate | CONFIRMED → Medium |
| Medium | `TEST-1` | Zero test infrastructure — no test runner, no tests, no CI | [Error Handling, Observability & Testing](#area-errors-testing) | moderate | CONFIRMED → Medium · ✅ CLOSED (vitest + 59 tests across Phases D–G; CI workflow Phase G) |
| Medium | `TEST-2` | Sync reconciliation logic (data-destruction branches) is untested | [Error Handling, Observability & Testing](#area-errors-testing) | significant | CONFIRMED → Medium |
| Medium | `TEST-3` | Money math and import parsers are untested | [Error Handling, Observability & Testing](#area-errors-testing) | moderate | CONFIRMED → Medium |
| Medium | `A5` | Server is unconditional last-write-wins with no version/CAS; concurrent tabs/devices silently clobber | [Deep-Dive A — Cloud-Sync Reconciliation](#area-deepA-sync) | significant | CONFIRMED → Medium |
| Medium | `DATA-3` | cloudNewer comparison can silently overwrite local data if blLastCloudPush is missing while blLastPushHash survives | [Data & State](#area-data-state) | moderate | — |
| Medium | `DATA-4` | Sync depends entirely on the monkey-patched setItem; any bypass writes data that never syncs | [Data & State](#area-data-state) | trivial | ✅ CLOSED (guarded API Phase E; ESLint ban + CI enforcement Phase G) |
| Medium | `API-2` | bricklink-auth.js manual request-stream read is dev-broken (consumed by Vite middleware) | [Module Boundaries, Coupling & API Contracts](#area-coupling-api) | trivial | — |
| Medium | `SEC-GAP-2` | No tooling enforces the 'every /api handler authenticates first' invariant | [Security Touchpoints (× docs/security.md)](#area-security-recon) | moderate | ✅ CLOSED (dynamic auth test + CI enforcement, Phase G) |
| Medium | `OBS-3` | Swallowed sync push errors give no persistent failure signal | [Error Handling, Observability & Testing](#area-errors-testing) | moderate | — |
| Medium | `OBS-4` | reconcileOnSignIn treats a fetch failure as a silent 'local wins' decision | [Error Handling, Observability & Testing](#area-errors-testing) | moderate | — |
| Medium | `OBS-5` | buildBackup does unguarded JSON.parse of every localStorage key | [Error Handling, Observability & Testing](#area-errors-testing) | moderate | — |
| Medium | `A6` | Cloud-empty claim push and debounce/interval push failures are silently swallowed | [Deep-Dive A — Cloud-Sync Reconciliation](#area-deepA-sync) | moderate | — |
| Medium | `A7` | applyBackupToLocalStorage is non-atomic and field-conditional; partial apply marked as fully synced | [Deep-Dive A — Cloud-Sync Reconciliation](#area-deepA-sync) | moderate | — |
| Medium | `A8` | dedupHash relies on unsorted JSON.stringify of objects with insertion-order-dependent keys | [Deep-Dive A — Cloud-Sync Reconciliation](#area-deepA-sync) | moderate | — |
| Medium | `A9` | No hash-version tag: any buildBackup/BACKUP_VERSION change invalidates all stored dirty hashes (version skew) | [Deep-Dive A — Cloud-Sync Reconciliation](#area-deepA-sync) | moderate | — |
| Medium | `B1` | Write-side total/cashPaid formula duplicated in 6+ sites instead of centralized next to lineTotal/lineCashPaid | [Deep-Dive B — Money / Ledger Logic (architectural lens)](#area-deepB-money) | moderate | — |
| Medium | `churn-appsettings` | AppSettings.jsx: high churn with falsy-zero reset bugs, config surface uncovered by A/B | [Deep-Dive C — Churn-Based Hotspot Discovery](#area-deepC-churn) | moderate | — |
| Medium | `churn-collection-dup` | MyCollection.jsx and WantedList.jsx co-change 10x — likely duplicated stat/column UI | [Deep-Dive C — Churn-Based Hotspot Discovery](#area-deepC-churn) | significant | — |
| Low | `A3` | Silent same-user pull window can drop edits made within the 60s skew/last-push gap | [Deep-Dive A — Cloud-Sync Reconciliation](#area-deepA-sync) | moderate | PLAUSIBLE → Low |
| Low | `B2` | Excel import emits a non-canonical schema; gift-card data is silently dropped from cash-paid math | [Deep-Dive B — Money / Ledger Logic (architectural lens)](#area-deepB-money) | moderate | PLAUSIBLE → Low |
| Low | `DEP-1` | uuid override silently jumps exceljs's dependency two majors (8 → 11) with no guarding test or comment | [Component Map, Tech Stack & Dependencies](#area-map-stack) | trivial | — |
| Low | `STACK-2` | ClerkProvider relies on implicit env-var key resolution with no explicit prop or guard | [Component Map, Tech Stack & Dependencies](#area-map-stack) | trivial | — |
| Low | `STACK-3` | No Node engine pin for the Vercel serverless functions | [Component Map, Tech Stack & Dependencies](#area-map-stack) | trivial | — |
| Low | `MAP-4` | Stale reference to deleted api/cloud-backup.js in sync.js comment | [Component Map, Tech Stack & Dependencies](#area-map-stack) | trivial | — |
| Low | `STACK-5` | Vite 8 / Rolldown is a very new major bundler for a production app with no lockstep on the experimental toolchain | [Component Map, Tech Stack & Dependencies](#area-map-stack) | trivial | — |
| Low | `DATA-5` | Dead/legacy key brickEconomyOwnedSets read but never written | [Data & State](#area-data-state) | trivial | — |
| Low | `API-3` | /api/sync called via raw fetch, bypassing the shared apiFetch wrapper | [Module Boundaries, Coupling & API Contracts](#area-coupling-api) | moderate | — |
| Low | `API-4` | Set-number validation regex and error envelopes duplicated/inconsistent across proxies | [Module Boundaries, Coupling & API Contracts](#area-coupling-api) | moderate | — |
| Low | `MB-2` | Widget/chart-config reconcile algorithm copy-pasted across three tabs | [Module Boundaries, Coupling & API Contracts](#area-coupling-api) | moderate | — |
| Low | `MB-3` | Dead/legacy localStorage keys read or referenced but never written | [Module Boundaries, Coupling & API Contracts](#area-coupling-api) | trivial | — |
| Low | `MB-4` | Set-number normalization duplicated inline across tabs and utils with divergent rules | [Module Boundaries, Coupling & API Contracts](#area-coupling-api) | moderate | — |
| Low | `SEC-DRIFT-1` | ScraperAPI key sent over cleartext http:// (security.md SECRET-2 note un-acted) | [Security Touchpoints (× docs/security.md)](#area-security-recon) | trivial | — |
| Low | `SEC-GAP-1` | CSP connect-src predates the authenticated proxies — confirm no browser-direct upstream calls | [Security Touchpoints (× docs/security.md)](#area-security-recon) | trivial | — |
| Low | `OBS-6` | Rate limiter fails open with only a console log — no alerting | [Error Handling, Observability & Testing](#area-errors-testing) | moderate | — |
| Low | `A10` | soldSets / portfolioHistory are synced but excluded from hasLocal/summarize emptiness checks | [Deep-Dive A — Cloud-Sync Reconciliation](#area-deepA-sync) | trivial | — |
| Low | `B3` | Excel importer drops legitimate $0 purchases | [Deep-Dive B — Money / Ledger Logic (architectural lens)](#area-deepB-money) | trivial | — |
| Low | `B4` | DEFAULT_ANNUAL_BUDGET constant duplicated across 3 files (one with divergent casing) | [Deep-Dive B — Money / Ledger Logic (architectural lens)](#area-deepB-money) | trivial | — |
| Low | `B5` | Template-literal escaping bug in import toast — renders literal backslash-quotes | [Deep-Dive B — Money / Ledger Logic (architectural lens)](#area-deepB-money) | trivial | — |
| Low | `B6` | No enforced money type — 215 asNumber() call sites rely on author discipline | [Deep-Dive B — Money / Ledger Logic (architectural lens)](#area-deepB-money) | requires-rewrite | — |
| Low | `churn-vite-proxy-mirror` | vite.config.js has a 67% fix-ratio from hand-mirroring /api proxies | [Deep-Dive C — Churn-Based Hotspot Discovery](#area-deepC-churn) | moderate | — |

---

<a id="area-map-stack"></a>

## 1. Discover & Map · 2. Tech Stack & Dependencies

### Overview

BrickLedger is a React 19 + Vite 8 single-page app deployed on Vercel. The client is a four-tab SPA whose primary store is browser `localStorage`; a thin set of Vercel serverless functions under `/api` act as (a) authenticated proxies that hide third-party API keys and (b) a per-user cloud-sync blob store backed by Upstash Redis. Authentication is Clerk (client widget + server token verification). There is no relational database — cloud state is a single JSON blob per Clerk user at Redis key `brickledger:user:{userId}`.

### Entry points & build/run

| Concern | Source of truth | Notes |
|---|---|---|
| HTML entry | `index.html` → `/src/main.jsx` | PWA manifest + apple-touch meta; single `#root` mount |
| App bootstrap | `src/main.jsx` | Monkey-patches `localStorage.setItem` to emit `brickledger:datachange` only on real value changes; runs `runMigrations()`; mounts `<ClerkProvider afterSignOutUrl="/">` |
| Dev server | `npm run dev` → `vite` | `vite.config.js` pins `port: 5179, strictPort: true`; a `local-api` plugin re-implements Vercel's handler signature so `/api/*` runs as dev middleware (`API_ROUTES` map, lines 36–47) |
| Build | `npm run build` → `vite build` | `vercel.json` `buildCommand: vite build`, `outputDirectory: dist`, `framework: null` |
| Env loading (dev) | `vite.config.js` lines 11–18 | Manually parses `.env.local` into `process.env` for the local API middleware (Vite normally only exposes `VITE_`-prefixed vars to the client) |
| Prod headers/CSP | `vercel.json` `headers` | Enforced CSP, HSTS, `X-Frame-Options: DENY`, etc. (see `docs/security.md`) |

### Component / data-flow map

```
                          BROWSER (SPA, ESM)
 ┌──────────────────────────────────────────────────────────────────────┐
 │  index.html → src/main.jsx (ClerkProvider, setItem patch, migrate)     │
 │                                │                                       │
 │                            src/App.jsx  ── sync orchestration          │
 │            (reconcileOnSignIn, 15s-debounced auto-push, conflict modal)│
 │                                │                                       │
 │   TABS:  MyCollection.jsx   BudgetDashboard.jsx   WantedList.jsx       │
 │          AppSettings.jsx    (+ *DetailPanel.jsx panels)                │
 │                                │                                       │
 │   recharts (charts) · fuse.js (search) · react-hot-toast · exceljs     │
 │   (lazy xlsx import) · papaparse (CSV)                                 │
 │                                │                                       │
 │   src/utils/: formatting, exportBackup, beSyncValues, brickset,        │
 │     bricklink-client, rebrickable, legoLastChance, priceHistory,       │
 │     notifications, columnDefaults, importBudgetExcel, migrate          │
 │                                │                                       │
 │   localStorage  ◄── primary store (bl* / brickEconomy* keys)           │
 │   public/sets.csv + themes.csv  ◄── shipped Rebrickable catalog        │
 └───────────────┬──────────────────────────────┬───────────────────────┘
                 │ apiFetch() attaches Clerk      │ Clerk widget (JWT mint,
                 │ session JWT as Bearer          │ window.Clerk global)
                 ▼                                ▼
 ┌───────────────────────────────┐      ┌──────────────────────────┐
 │  VERCEL /api (CommonJS)        │      │  Clerk (auth provider)    │
 │  shared: _auth · _ratelimit ·  │◄─────┤  VITE_CLERK_PUBLISHABLE_  │
 │          _cors                 │ verify│  KEY (client),            │
 │                                │ Token │  CLERK_SECRET_KEY (server)│
 │  sync.js ──────────────► Upstash Redis (KV_REST_API_URL/TOKEN)    │
 │   (per-user JSON blob, rate-limited 60/min, 1yr TTL)              │
 │                                                                   │
 │  PROXIES (Clerk-gated, server-held keys):                         │
 │   brickeconomy-set/-collection ─► brickeconomy.com (BE key)       │
 │   brickset-set/-search/-themes ─► brickset.com (Brickset key)     │
 │   bricklink-auth/-priceguide   ─► bricklink.com / api.bricklink   │
 │   brickfanatics-retiring       ─► brickfanatics.com via ScraperAPI│
 │   lego-last-chance             ─► lego.com last-chance page       │
 └───────────────────────────────────────────────────────────────────┘
```

`apiFetch()` (`src/utils/apiFetch.js`) is the single client→server gateway: it waits for `window.Clerk.loaded`, attaches the session JWT, and is consumed by 11 modules. Client→route fanout (grep of `/api/...` literals): `sync` ×6, `brickeconomy-set` ×5, `brickfanatics-retiring`/`brickset-search` ×3 each, the rest 1–2.

### Languages / frameworks / runtime

- **Language:** JavaScript only (JSX in `src`, CommonJS in `/api`). No TypeScript — `@types/papaparse` is the only `@types` package and provides no checking benefit without `tsc`. `package.json` has no `"type"` field, so `/api/*.js` resolve as CommonJS (`require`/`module.exports`) while `src/*` are ESM transformed by Vite. (inferred from `require()` in `/api`, `import` in `src`.)
- **Frontend:** React 19.2.6 / react-dom 19.2.6 (scheduler 0.27.0).
- **Build:** Vite 8.0.14 with `@vitejs/plugin-react` 6.0.2. Vite 8 ships the **Rolldown** bundler — `rolldown@1.0.2` is resolved in the lockfile and `esbuild` is absent. The `chunkSizeWarningLimit: 1000` + comment confirm exceljs (~930 KB) is lazy-loaded.
- **Server runtime:** Vercel serverless (Node). No `engines` field pins a Node version (see finding STACK-3).
- **Auth:** `@clerk/react` 6.7.2 (client), `@clerk/backend` 3.4.14 (`verifyToken` in `api/_auth.js`).

### Key libraries (resolved versions from `package-lock.json`, lockfileVersion 3, 208 packages)

| Package | Declared | Resolved | Role | Status |
|---|---|---|---|---|
| react / react-dom | ^19.2.6 | 19.2.6 | UI | current |
| vite | ^8.0.14 | 8.0.14 | build (Rolldown) | current, very new major |
| @vitejs/plugin-react | ^6.0.2 | 6.0.2 | JSX/HMR | current |
| @clerk/react | ^6.7.2 | 6.7.2 | auth widget/hooks | current |
| @clerk/backend | ^3.4.14 | 3.4.14 | server token verify | current |
| recharts | ^3.8.1 | 3.8.1 | charts (pulls d3-scale 4.0.2, d3-shape 3.2.0, victory-vendor 37.3.6) | current |
| exceljs | ^4.4.0 | 4.4.0 | xlsx import/export (replaced SheetJS — see `importBudgetExcel.js`) | maintained but slow release cadence |
| papaparse | ^5.5.3 | 5.5.3 | CSV parse | current |
| fuse.js | ^7.3.0 | 7.3.0 | fuzzy search | current |
| react-hot-toast | ^2.6.0 | 2.6.0 | toasts | current |
| uuid (override) | ^11.1.1 | 11.1.1 | forced transitive | see DEP-1 |

`npm audit` → **0 vulnerabilities** (verified this session). `npm outdated` → **empty** (all deps at latest satisfying range). The security posture on deps matches `docs/security.md` ("Dependency hygiene").

### `overrides: { "uuid": "^11.1.1" }` — verified

The ONLY consumer of `uuid` in the tree is `exceljs`, which declares `uuid: ^8.3.0` and imports it as `const {v4: uuidv4} = require('uuid')` (`node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js:1`). The override jumps it two majors to 11.1.1. uuid v11 still exports `v4` (verified: `MAX,NIL,parse,stringify,v1,...,v4,v5,...`), so the named import resolves and the override is functionally safe today. Its purpose was to eliminate the legacy uuid@8 (which historically pulled deprecated transitive crypto shims) and keep a single uuid copy (one node in the lockfile). This is a deliberate, working hardening rather than a bug — but it is silent and undocumented (DEP-1).

### Observations folded into findings

- `ClerkProvider` carries no `publishableKey` prop (`src/main.jsx:31`); it relies on Clerk auto-reading `VITE_CLERK_PUBLISHABLE_KEY` — works but is non-obvious (DEP/STACK-2).
- `api/sync.js:20` comment "same as cloud-backup.js" references a file that no longer exists in `/api` (only present in a stale worktree). Stale comment (LOW).
- Rate limiter (`api/_ratelimit.js`) and sync both inline a hand-rolled Upstash REST client rather than `@upstash/redis` — zero added deps, intentional.

<a id="area-data-state"></a>

## 3. Data & State

BrickLedger has **no database**. The browser's `localStorage` is the authoritative store for all user content; the cloud (`/api/sync` → Redis key `brickledger:user:{clerkUserId}`) holds a single **derived JSON snapshot** of a subset of those keys. React component state is a third copy, hydrated from `localStorage` on mount and written back via save-effects. This three-layer arrangement (React state ⇄ localStorage ⇄ cloud blob) is the central source of drift risk.

### 3.1 Data-flow map

```
                 hydrate on mount (useState initializer)
   localStorage  ───────────────────────────────────────►  React component state
   (source of    ◄───────────────────────────────────────  (save useEffect -> setItem)
    truth)                writes
        │
        │  setItem patch (src/main.jsx) fires "brickledger:datachange"
        │  ONLY when stored value actually changed & key not in SYNC_SKIP_KEYS
        ▼
   App.jsx debounced/interval auto-push  ──── buildBackup() ───►  POST /api/sync
        ▲                                                          (Redis, plaintext,
        │  fetchFromCloudAuth + applyBackupToLocalStorage         keyed by userId)
        └──────────────────────────────────────────────────────────────┘
                         pull on sign-in / conflict resolve
```

There is **no live cross-tab or cross-component reactivity** through localStorage. Components re-read localStorage on mount/tab-switch only; the `datachange` event drives *sync*, not UI refresh. A value written by one open component is not observed by a sibling until a re-render re-reads the key (e.g. `ownedSetNumbers` in `WantedList.jsx:295` explicitly relies on tab-switch re-renders as its "refresh trigger" — fragile by design, inferred).

### 3.2 localStorage key inventory

**User content (source of truth; in cloud backup):**
| Key | Entity | In `buildBackup`? |
|---|---|---|
| `blOwnedSets` | Manually-added/imported owned sets | yes (`ownedSets`) |
| `brickEconomyNormalizedCollection` | BrickEconomy-sourced owned sets (normalized) | yes (`brickEconomyNormalized`) |
| `brickEconomyCollectionSyncInfo` | BE collection sync metadata | yes (`brickEconomySyncInfo`) |
| `blSoldSets` | Sold-set history | yes (`soldSets`) |
| `blPortfolioHistory` | Portfolio value timeseries | yes (`portfolioHistory`) |
| `blWantedList` | Wanted/watch items | yes (`wantedList`) |
| `blPurchases` | Budget purchases | yes (`budgetPurchases`) |
| `blStores`, `blStoreBudgets`, `blAnnualBudget` | Budget config | yes |
| `blDisplayCurrency`, `blOwnedColumns`, `blAcquisitionColumns`, `blPurchaseColumns`, `blDashboardWidgetSettings`, `blCollectionItems`, `blOwnedColWidths` | Display prefs | yes (`settings`) |

**User content NOT in the backup (silent data-loss surface — see DATA-1):** `blCustomFieldsSchema` (user-defined wanted-list custom field definitions, `WantedList.jsx:236/244`), `blDealLog` (user deal log, `WantedList.jsx:112/127`), `blBudgetItems` / `blWLItems` (customizable category/column config), `blBudgetChartTypes` / `blCollChartTypes` / `blWLChartTypes`, `blOwnedSort` / `blOwnedSortDir`, dismissal flags (`blPriceDropDismissed`, `blOwnedRetireDismissed`, `blLCAlertDismissed`).

**Caches (regeneratable, wiped on sign-out):** `brickEconomySetCache` (explicitly stripped before push, `exportBackup.js:37`), `brickEconomyCollectionCache`, `bricksetSetCache`, `blPriceGuideCache`, `blBFRetirementCache`, `legoLastChanceCache`.

**Sync/metadata (SYNC_SKIP_KEYS):** `blLastPushHash`, `blLastCloudPush`, `blSyncedUserId`, `blLastAutoExport`, `blLastTab`, `blLastNotifyDate`, plus tokens `blSessionToken`, `blBrickLinkAccessToken`. Migration flags: `blMigrated_v1..v3`.

**Dead key:** `brickEconomyOwnedSets` — read at `WantedList.jsx:298` but written nowhere (always `[]`); legacy leftover.

### 3.3 Source-of-truth & drift analysis per entity

- **Owned sets — split-brain by design.** There are *two* owned-set lists: `blOwnedSets` (manual + Brickset + BrickLink imports) and `brickEconomyNormalizedCollection` (BrickEconomy imports). Every consumer must read and concatenate both (`MyCollection.jsx:153/202`, `BudgetDashboard.jsx:1130-1131`, `AppSettings.jsx:540-541`, `WantedList.jsx:297-299`). `beSyncValues.js:42-62` **dual-writes** both lists in one pass. This is the single biggest drift hazard: any consumer that reads only one list (or filters `source` incorrectly, e.g. `MyCollection.jsx:700`, `AppSettings.jsx:678`) sees a partial collection. Counts (`summarizeLocal`/`summarizeBackup`) correctly sum both, but value/stat math is duplicated across three feature files and can diverge.
- **Wanted list — single source `blWantedList`**, clean. But its dependent `blCustomFieldsSchema` is not synced (DATA-1).
- **Purchases/budget — single source `blPurchases`**, clean; `blBudgetItems` config not synced.
- **Settings — split:** display prefs are synced under `settings`; `autoExportDays` is intentionally device-local (not restored, `exportBackup.js:172`). Consistent.
- **Caches vs synced data:** `brickEconomySetCache` is intentionally excluded from the cloud copy and from `dedupHash` (`exportBackup.js:66`) so a freshly-built local backup and a pulled cloud backup hash identically. This is correct, but means **current values** (`currentValue`/`totalValue` baked into `blOwnedSets`/`normalized` by `beSyncValues`) are synced while the cache that produced them is not — after a fresh-device pull the displayed values are frozen until the daily BE batch re-runs.

### 3.4 The `localStorage.setItem` patch (`src/main.jsx:17-28`) · ✅ SUPERSEDED (Phase E) + DATA-4 CLOSED (Phase G)

> **Historical:** the global `main.jsx` monkey-patch described below was **removed in Phase E** and
> replaced by an explicit choke point, `setItemSafe` in `src/utils/safeStorage.js` (same
> change-detect + `SYNC_SKIP_KEYS`/prefix filter, plus a quota guard). The "bypass writes silently
> don't sync" risk (last bullet) is now **closed (Phase G)** by an ESLint ban on raw
> `localStorage.setItem` (sole sanctioned site `safeStorage.js`), CI-enforced — a bypass fails lint
> instead of silently not-syncing. See [`audit-action-plan.md`](./audit-action-plan.md) *Phase E/G*.

The patch wraps `setItem` to dispatch `brickledger:datachange` **only when `_origGetItem(key) !== String(value)`** and the key starts with `bl`/`brickEconomy` and isn't in `SYNC_SKIP_KEYS`. Implications:
- Mount-time save-effects that re-serialize identical data (very common here — every tab has a `useEffect(() => setItem(...), [state])` that fires on first render) correctly produce **no** push. Good.
- The equality check is a raw string compare, so **key-order or formatting changes in JSON count as a change** even when semantically identical (e.g. a `.map` that rebuilds objects in a different field order). Combined with the dual-write in `beSyncValues`, the daily batch can mark data dirty and trigger a push even when nothing meaningful changed — usually harmless because `pushToCloudAuth` re-checks `dedupHash` against `blLastPushHash` and skips (`exportBackup.js:40-41`).
- The patch is the *only* coupling between writes and sync. Any future code that writes through a stashed `_origSetItem` reference, or sets a key before `main.jsx` runs, bypasses sync silently. Worth a path-scoped rule (DATA-4).

### 3.5 Reconciliation & conflict (`App.jsx:91-180`)

The sign-in reconciliation is genuinely careful (foreign-device wipe, cloud-empty claim, fresh-device pull, conflict modal — never silently destroys unsynced edits). Two real correctness gaps:
- **`cloudNewer` uses a 60s skew window vs `blLastCloudPush`** (`App.jsx:135`), but `localTime` is the *last push* time, not the last *local edit* time. Local dirtiness is checked separately via hash (`localDirty`), so the logic holds — but if `blLastCloudPush` is missing (e.g. wiped) while `blLastPushHash` survives, `cloudNewer` is always true and `localDirty` may be false, silently overwriting local. Edge case, see DATA-3.
- **`markSynced` on pull stores `dedupHash(cloud)`** (`exportBackup.js:80`). Because `dedupHash` excludes the absent cache, this correctly matches a subsequent local `buildBackup`. Verified consistent.

### 3.6 Findings

See structured findings DATA-1 … DATA-5.

<a id="area-coupling-api"></a>

## 4. Module Boundaries & Coupling

### Module map

```
                        ┌─────────────┐
                        │  main.jsx   │ monkey-patches localStorage.setItem →
                        │             │ emits 'brickledger:datachange'
                        └──────┬──────┘
                               │ runMigrations()
                        ┌──────▼──────┐
                        │   App.jsx   │ sync orchestration, conflict modal, tab router
                        └──────┬──────┘
            ┌──────────────┬───┴────────┬──────────────┐
            ▼              ▼            ▼              ▼
     MyCollection    WantedList   BudgetDashboard  AppSettings
       (2674)          (3579)        (2559)          (1637)
            │              │            │              │
            └──────────────┴────────────┴──────────────┘
                     ▲ ALL four read/write a SHARED, UNTYPED
                     │ localStorage namespace (no data layer):
                     │   blOwnedSets, blWantedList, blPurchases,
                     │   blStores, brickEconomyNormalizedCollection,
                     │   brickEconomySetCache …
            ┌────────┴────────────────────────────────┐
            ▼ utils (well-factored, mostly clean)      ▼
  formatting · apiFetch · exportBackup · beSyncValues · brickset
  bricklink-client · rebrickable · legoLastChance · priceHistory
  columnDefaults · migrate · notifications · importBudgetExcel
```

The `utils/` layer is genuinely good: small, single-purpose, dependency-light modules with clear exports (`formatting.js`, `apiFetch.js`, `columnDefaults.js`, `beSyncValues.js`). No circular imports exist between utils — the dependency graph is a clean DAG (`beSyncValues → formatting + apiFetch`, `brickset → apiFetch`, etc.).

The problem is entirely at the **tab layer**. The four feature components are god modules (1637–3579 lines, 35–89 hooks each) that communicate through a shared, schema-less `localStorage` bag rather than through props, context, or a data module. There is no "collection store" or "purchases store" abstraction — the array shapes live only in the heads of whoever wrote each `JSON.parse(localStorage.getItem(...))` call.

### Cross-tab write coupling (the core risk)

`localStorage` is being used as a mutable global database that every tab writes to directly. The same keys are written from multiple tabs:

| Key | Written by |
|-----|-----------|
| `blOwnedSets` | MyCollection, WantedList, BudgetDashboard, AppSettings |
| `blWantedList` | MyCollection, WantedList, BudgetDashboard, AppSettings |
| `blPurchases` | MyCollection, WantedList, BudgetDashboard, AppSettings |
| `blStores` | BudgetDashboard, AppSettings |
| `brickEconomyNormalizedCollection` | AppSettings, beSyncValues (also read by 3 tabs) |
| `brickEconomySetCache` | MyCollection, WantedList, BudgetDashboard, AppSettings, beSyncValues |

(verified by grepping `localStorage.setItem` per file). Because there is no single owner for any entity, a shape change to a "wanted" item or "purchase" requires hunting through 4 × ~2500-line files. Any tab that re-serializes one of these arrays from a partial in-memory copy can silently drop fields written by another tab. This is the highest-leverage structural issue in the codebase.

### Stale / dead keys (leaky abstractions)

- `brickEconomyOwnedSets` is **read** in `src/WantedList.jsx:298` (to build `ownedSetNumbers`) but is **never written** anywhere in `src/`. It is a dead legacy key; the read silently returns `[]`. Either the migration that populated it was removed, or this is a copy-paste relic.
- `brickEconomyCollectionCache` appears only in the `main.jsx:14` `SYNC_SKIP_KEYS` set and a `localStorage.removeItem` in `src/AppSettings.jsx:1021` — it is never written either. Both references are dead.

### Duplicated logic across tabs

1. **Widget/chart-config reconcile block.** `MyCollection.jsx:99–120`, `WantedList.jsx` (`DEFAULT_WL_ITEMS` + `blWLChartTypes` + savedKeys/missing merge) and `BudgetDashboard.jsx:140–151` all implement the *same* algorithm: load `DEFAULT_*_ITEMS`, load `bl*ChartTypes`, build `typeMap`/`labelMap` from defaults, find `missing` defaults not in saved, concat. This is three near-identical copies of a non-trivial merge — a bug fix in one (e.g. handling a renamed widget key) will not propagate to the others. It belongs in a `utils/widgetConfig.js` helper parameterized by the defaults array + storage key.
2. **`Fuse` fuzzy-search setup** is instantiated independently in `WantedList.jsx:589` and `BudgetDashboard.jsx:393` with hand-tuned options each time.
3. **Owned-set-number normalization** (`String(s.setNumber||"").replace(/-1$/,"")`) is repeated inline dozens of times across all tabs and several utils (`beSyncValues.js`, `bricklink-client.js`, `legoLastChance.js`, `rebrickable.js`); `rebrickable.js` has a private `normalizeSetNum` that does exactly this but isn't exported/shared. A single exported `normalizeSetNumber()` in `formatting.js` would remove the drift risk (note `rebrickable` also strips leading zeros — the variants already disagree).

### What's clean

`utils/formatting.js` is the correct model: it centralizes `asNumber`/`money`/`lineTotal`/`lineCashPaid`/`priorityScore` and all four tabs import from it rather than re-implementing. The data-fetch proxies' client wrappers (`brickset.js`, `bricklink-client.js`, `legoLastChance.js`) cleanly encapsulate cache+fetch behind a function boundary. No refactor needed there.

## 5. API & Contracts

### Endpoint inventory

All `/api/*` handlers share the same envelope: `setCors(...)` preflight short-circuit → `requireAuth`/`authenticate` (Clerk Bearer) → `rateLimitAllow` → work. Auth and rate-limiting are uniformly applied (good — see `docs/security.md` APISEC/AUTH sections; not re-audited here).

| Endpoint | Method | Inputs | Auth | Success shape |
|----------|--------|--------|------|---------------|
| `sync` | GET | — | Clerk (`authenticate`) | the stored backup object (raw) |
| `sync` | POST | `req.body` (full backup; validated only `data && data.version`) | Clerk | `{ ok, savedAt }` |
| `brickeconomy-set` | GET | `?number`, `?currency` | Clerk (`requireAuth`) | BE passthrough JSON |
| `brickeconomy-collection` | GET | — | Clerk | BE passthrough JSON |
| `brickset-search` | GET | `?q` / `?theme` / `?setNumber` | Clerk | `{ sets[], total }` |
| `brickset-set` | GET | `?number` | Clerk | `{ data: {...30 fields} }` |
| `brickset-themes` | GET | — | Clerk | `{ themes: string[] }` |
| `bricklink-auth` | POST | body `{ accessToken }` (manual stream read) | Clerk | `{ sessionToken }` |
| `bricklink-priceguide` | GET | `?number`, header `x-bl-session-token` | Clerk + BL session | `{ avg_price_new, …, source }` or `{ raw, format:"html" }` |
| `lego-last-chance` | GET | `?number` (optional) | Clerk | `{ setCodes[], sets[], total }` or `{ isLastChance, total }` |
| `brickfanatics-retiring` | GET | `?number` (optional), `?debug` | Clerk | `{ sets[], total }` or `{ retiring, ... }` |

### Client ↔ server contract issues

**5.1 Two clients for `/api/sync` — `exportBackup.js` bypasses `apiFetch`.** Every other call site uses `apiFetch()` (which `waitForClerk()` then attaches the Bearer). `pushToCloudAuth`/`fetchFromCloudAuth` (`src/utils/exportBackup.js:46,136`) instead call raw `fetch("/api/sync", ...)` and thread a `getToken` fn through from `useAuth()`. Two parallel auth-attachment mechanisms for the same backend is an inconsistency that invites drift (e.g. the `waitForClerk` race fix that motivated commit `4e2d469` does not protect these calls — they rely on the caller already having a token).

**5.2 `bricklink-auth.js` manual body read breaks in dev (dev/prod divergence).** `api/bricklink-auth.js:20–30` drains the request stream itself (`req.on('data')...`) instead of reading `req.body`. But the Vite dev middleware (`vite.config.js:80–90`) *already* consumes the stream into `req.body` for any `application/json` POST — and the BrickLink client sends exactly that content-type (`src/utils/bricklink-client.js:51`). In `npm run dev` the `data`/`end` listeners are attached after the stream is exhausted, so `body` resolves to `""` → `JSON.parse("")` throws → 400 "Invalid JSON body". Every other POST-ish handler (`sync`) reads `req.body`. This handler should too; the manual stream read is the odd one out and is silently dev-broken.

**5.3 `buildBackup` ↔ `applyBackupToLocalStorage` shape mismatch — user content silently not synced/restored.** `buildBackup()` (`exportBackup.js:177`) serializes a fixed key set, and `applyBackupToLocalStorage()` (`:147`) restores exactly those. But several keys holding **genuine user content** are written by tabs yet absent from the backup contract:
- `blDealLog` (`WantedList.jsx:111,127` — the user's tracked price-drop deal history) — **not** in `buildBackup`. Lost on device migration / cloud restore.
- `blCustomFieldsSchema` (`WantedList.jsx:235,244` — defines the user's custom columns). The custom *values* live in `item.customFields` and **are** carried inside `wantedList`, but the *schema* defining those columns is not. After a cloud pull on a fresh device, every wanted item has orphaned `customFields` data with no column to display it. This is a partial-data-loss / corruption-class contract gap, not just a missing preference.
- `blWLItems` / `blBudgetItems` widget layouts are dropped, while the equivalent `blCollectionItems` *is* preserved (as `settings.collectionItems`). Asymmetric and surprising — three sibling features, only one round-trips.

There is no shared schema constant or test asserting `buildBackup` keys === `applyBackupToLocalStorage` keys, so this drift is invisible and will recur every time a tab adds a persisted key.

**5.4 `dedupHash` correctness depends on `buildBackup` field stability.** `dedupHash` (`exportBackup.js:65`) strips `exportedAt` + `brickEconomySetCache` then hashes `JSON.stringify(rest)`. Because `buildBackup` builds the object with fixed key order this is stable today, but it is an implicit contract: any reorder of `buildBackup`'s literal, or a value whose serialization is non-deterministic, silently changes the hash and causes a spurious full re-push (or, worse, a missed push). Worth a comment at minimum.

**5.5 Uneven input validation across proxies.** `brickeconomy-set`, `brickset-set`, `bricklink-priceguide` all validate `?number` against `/^\d{3,8}-\d+$/` (good, and duplicated 3×). But `brickset-search`'s `?q`/`?theme` are passed straight into the upstream `params` JSON with no length/charset bound, and `sync` POST validates only that `data.version` is truthy — it does not check `version` is a number, does not bound payload size, and `applyBackupToLocalStorage` trusts every array/object field's *type* but not its *contents*. The set-number regex should be a shared validator in a server util (e.g. `api/_validate.js`) rather than copy-pasted.

**5.6 Inconsistent error envelopes.** Error bodies vary: `{ error }`, `{ error, message }`, `{ error: "no_key", message }`, `{ error: "brickset_error", message }`. Clients special-case string-matched codes (`json.error === "no_key"` in `brickset.js:25,47,83`; `json.error === "no_key"` for 503). These magic strings are an undocumented client/server contract — renaming a server error code silently breaks client branches with no type check. The 502/404/400 status-vs-body mapping also differs per handler (`brickset-set` returns 404 `not_found`; `brickset-search` returns 200 with empty `sets`).

### Recommendation summary

The proxy layer is structurally sound and uniformly secured; its weaknesses are duplication (set-number regex, error shapes) and one dev-only bug (5.2). The real architectural debt is (a) the schema-less shared-`localStorage` coupling between four god-module tabs, and (b) the hand-maintained, untested `buildBackup`/`applyBackupToLocalStorage` contract that is already dropping user content (5.3).

<a id="area-security-recon"></a>

## Security Touchpoints (× docs/security.md)

`docs/security.md` is a point-in-time audit at commit `8ae56e3` (2026-05-28) that diagnosed the app and laid out a phased remediation plan. The four commits since then are that plan landing. This section maps where auth/authz/secrets/input-handling/trust-boundaries **actually live in the current tree** and grades each documented finding as **supported**, **drifted**, or a **gap**. Net: the code now *supports* the documented target posture on every High/Medium finding; the only residual is one Low/Info nit (`SECRET-2` scraperapi scheme) plus structural gaps that prose can't enforce.

### Trust boundary — as-built (compare to security.md §2b)

```
                 UNTRUSTED                         |        TRUSTED (server secrets)
 [ browser / curl ] --Bearer JWT-->                |
        |                                           |
        |   /api/sync ──────────────────────────────● requireAuth → verifyToken(azp✓) → Upstash (brickledger:user:{sub})
        |   /api/brickeconomy-set ──────────────────● requireAuth → rateLimit → BRICKECONOMY_API_KEY
        |   /api/brickeconomy-collection ───────────● requireAuth → rateLimit → BRICKECONOMY_API_KEY
        |   /api/brickset-{set,search,themes} ──────● requireAuth → rateLimit → BRICKSET_API_KEY
        |   /api/brickfanatics-retiring ────────────● requireAuth → rateLimit(bucket=scrape,60/60) → SCRAPERAPI_KEY  ⚠ http://
        |   /api/lego-last-chance ──────────────────● requireAuth → rateLimit → (no key) lego.com
        |   /api/bricklink-auth ────────────────────● requireAuth → rateLimit → token exchange
        |   /api/bricklink-priceguide ──────────────● requireAuth → rateLimit → user x-bl-session-token
 [ localStorage ] <--> React app                   |
        ● = boundary now ENFORCED (was ○ in security.md §2b for the proxies)
```

Every `●` above was an open `○` (unauthenticated) in the audit's diagram for the proxies. The single shared chokepoint is `api/_auth.js` `requireAuth()`, imported by all 9 handlers + `sync.js`. The dev path is **not** a drift: `vite.config.js:33-44` mounts the *real* handler modules via `require()`, so `requireAuth`/`rateLimitAllow` run identically in `npm run dev` and on Vercel — no second, weaker auth implementation to drift.

### (a) Where the architecture SUPPORTS security.md

| security.md finding | Where it now lives in code | Status |
|---|---|---|
| **APISEC-1** (High) unauthenticated proxies | `requireAuth(req,res)` is lines 8-9 of every proxy (`brickeconomy-set.js:8`, `brickset-search.js:8`, `brickfanatics-retiring.js:157`, `lego-last-chance.js:86`, `bricklink-auth.js:8`, `bricklink-priceguide.js:8`, `brickset-themes.js:13`, `brickeconomy-collection.js:8`) | Resolved — matches §4e pattern 1 |
| **AUTH-1** (Med) `verifyToken` missing `authorizedParties` | `api/_auth.js:29-32` passes `authorizedParties: AUTHORIZED_PARTIES` (`APP_ORIGIN` + localhosts) | Resolved |
| **AUTHZ-1** (Info) key from token not client input | `api/sync.js:58,68` derives key solely from `authenticate()`'s `sub` | Still correct (preserved) |
| **APISEC-2** (Low) fail-open non-atomic limiter | `api/_ratelimit.js:18` single atomic Lua `INCR`+`EXPIRE`; applied to all proxies (`bucket:"proxy"`) and sync (`bucket:"sync"`) | Resolved (atomicity); fail-open kept *deliberately* + documented `_ratelimit.js:9-14` |
| **APISEC-3 / DATAEXP-1** (Low) verbose error introspection | No `preview:`/`keys:` remain anywhere in `api/`; handlers now return generic `502` (`brickeconomy-set.js:63`, `brickset-set.js:64`, `bricklink-auth.js:68`) | Resolved |
| **HEADERS-1** (Med) no security headers | `vercel.json` `headers` block: CSP (enforced, not report-only — commit `2a9fa3f`), `X-Frame-Options: DENY`, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | Resolved + exceeds (added Permissions-Policy) |
| **BIZLOGIC-1** (Med) shared-browser push of prior user's data | `src/App.jsx:97-109` `foreign` guard wipes local via `clearLocalUserData()` *before* any `summarizeLocal()`/push; cloud-empty branch only reached after wipe | Resolved — matches §4c spec |
| **BIZLOGIC-2** (Low) reload-deferred sign-out wipe | `src/App.jsx:76-81` wipes synchronously on the `userId`→null transition; push effects' cleanups (`App.jsx:201,227`) cancel in-flight pushes | Resolved |
| **SECRET-3** (Low) stale `x-backup-secret` CORS header | Gone from `api/_cors.js:39`; `Authorization` + `x-bl-session-token` now legitimately consumed by `_auth.js` / `bricklink-priceguide.js:35` | Resolved |
| **DEP-1** (Low) dead `ioredis` | Removed from `package.json` | Resolved |
| **TPR-1** (Low) Google Fonts `@import` | CSP `font-src 'self'` + commit `ebcbee2` "self-host fonts"; no `fonts.googleapis.com` in CSP | Resolved |
| **CORS-1 / LOGGING-1 / SECRET-1** (Info) | `_cors.js:27-43` allow-list intact; `internalError()` (`_cors.js:49-52`) logs server-side, returns generic | Preserved |

### (b) Where the architecture UNDERMINES / has DRIFTED

- **`SECRET-2` minor note is the one un-acted item.** `api/brickfanatics-retiring.js:176` still builds the ScraperAPI URL on `` `http://api.scraperapi.com` ``. The `SCRAPERAPI_KEY` is in the query string, so it transits cleartext to ScraperAPI over plain HTTP — the exact thing the audit flagged. ScraperAPI supports `https://`. Low severity (the request leaves Vercel's egress, not a user network) but it is a literal, trivial deviation from a documented recommendation that every other Phase 0-4 item honored. (See finding `SEC-DRIFT-1`.)
- No other drift found. Notably, the audit's warned-against anti-patterns (§4f) are absent: no proxy ships without `requireAuth`, no `preview`/`keys` echoes, no deferred security state change, no CORS-as-access-control.

### (c) GAPS — code not in security.md, or documented-but-unenforced

- **CSP `connect-src` may be too tight for the proxies' upstreams — verify, then it's fine (inferred).** `vercel.json` CSP `connect-src 'self' https://*.clerk.accounts.dev`. The proxy fetches are server-side (Vercel function → brickeconomy/brickset/scraperapi), so they are *not* governed by the browser CSP; the browser only ever calls same-origin `/api/*` (`'self'`). This is correct and an *improvement* over the report-only state security.md last saw. No gap, but it is new surface the audit predates — documented here so the next reviewer knows the proxies intentionally need no extra `connect-src` entries. (See finding `SEC-GAP-1`, informational.)
- **The two highest-value invariants are enforced only by convention, not by tooling.** ✅ **CLOSED (Phase G).** security.md §4e pattern 1 ("every `/api` handler authenticates in its first 3 lines") and §4f pattern 1 ("stop shipping proxy handlers without an auth check") were prose. The original APISEC-1 bug was precisely a copy-paste scaffold that omitted the auth line 8×; nothing in the repo prevented the 10th proxy from repeating it. **Both invariants are now tool-enforced, CI-gated** (`.github/workflows/ci.yml` runs `npm run lint && npm test` on every PR + push to main): `SEC-GAP-2` by a dynamic per-handler auth-required test (`src/api-auth.test.js`, enumerates `api/*.js` at runtime → asserts 401 + no upstream fetch when unauthenticated), and `DATA-4` by an ESLint ban on raw `localStorage.setItem`. The CC-only `.claude/rules`/`PreToolUse` route was deliberately *not* taken — a lint + a test are tool-agnostic and catch any contributor/agent. (See finding `SEC-GAP-2`; [`audit-action-plan.md`](./audit-action-plan.md) *Phase G*.)
- **`BF_DEBUG` raw-HTML path (APISEC-4) is now behind auth too** (`brickfanatics-retiring.js:157` runs before the `:198` debug check), so it is double-gated *and* authenticated — strictly better than documented. No action; noted so it isn't re-flagged.
- **`KV_REST_API_TOKEN` / cloud data still plaintext JSON at rest** (`sync.js:88`) — this is an accepted posture in security.md §3 Cat 9 and Open Question #4, not a code defect. Out of scope of this section; flagged only as a continuing single-point-of-failure (§4g) the code does nothing to mitigate (nor was it asked to).

<a id="area-errors-testing"></a>

## 7. Error Handling & Observability

### Summary
Server-side error handling is consistent and disciplined; client-side is the weak spot. The `/api` layer routes all 500s through a single `internalError()` helper (`api/_cors.js:49`) that logs server-side with a context tag and returns a generic body — good, and consistent with `docs/security.md` ("Error message leakage"). The rate limiter (`api/_ratelimit.js`) is a deliberate, documented fail-open with logging.

The client, by contrast, has **no error boundary anywhere** (grep for `ErrorBoundary`/`componentDidCatch`/`window.onerror`/`unhandledrejection` returns nothing), **111 `localStorage.setItem` calls** that can throw `QuotaExceededError` with no guard, and a cluster of empty `catch {}` blocks around real data writes and sync. Import/CSV/XML error surfacing in `AppSettings.jsx` is actually a bright spot — almost every parse path ends in a specific `toast.error(...)`.

```
                         OBSERVABILITY MAP
  ┌──────────────────────────── CLIENT ────────────────────────────┐
  │  React tree  ── (NO error boundary) ──▶ white screen on throw   │
  │  localStorage.setItem (×111) ── QuotaExceeded ──▶ silent loss   │
  │  sync push/pull errors ──▶ console.warn / swallowed .catch(()=>)│
  │  CSV/XLSX/XML import   ──▶ toast.error(specific msg)   ✓ GOOD   │
  └─────────────────────────────────────────────────────────────────┘
  ┌──────────────────────────── SERVER (/api) ──────────────────────┐
  │  try/catch ──▶ internalError(res,err,ctx) ──▶ console.error +    │
  │               generic 500 body                          ✓ GOOD  │
  │  rate limiter error ──▶ console.error + FAIL-OPEN (allow)        │
  └─────────────────────────────────────────────────────────────────┘
  No log aggregation / Sentry / client telemetry anywhere.
```

### Key issues
1. **No React error boundary** — any render-time throw blanks the whole SPA with no recovery and no signal. For a 1000–2800-line vibe-coded app over untyped `localStorage` data, this is the single highest-leverage gap.
2. **Unguarded `localStorage.setItem` (×111) + monkey-patched setter** — `src/main.jsx:21` wraps `setItem`; if the underlying write throws (quota, Safari private mode), it propagates into whatever component triggered the write, and the 22 empty `catch {}` blocks that wrap data writes (e.g. `src/MyCollection.jsx:799` adding a purchase) swallow it entirely → silent data loss, the Critical-severity class this audit cares about.
3. **Swallowed sync errors** — `App.jsx:196` and `App.jsx:221` push with `.catch(() => {})` / empty catch; a persistently failing push shows no UI signal beyond the transient indicator flipping back to idle. `reconcileOnSignIn` (`App.jsx:95`) logs a `console.warn` then sets `syncReadyRef=true` and returns — a fetch failure becomes a silent "local wins" decision.
4. **No client telemetry** — only 8 `console.*` calls total in `src/`; nothing is shipped off-device, so production client bugs are effectively un-debuggable.

## 8. Testing

### Summary
**There is zero test infrastructure.** Confirmed by: no `*.test.*`/`*.spec.*` files anywhere outside `node_modules`; no `vitest`/`jest`/`mocha`/`playwright`/`cypress` in `package.json` or `node_modules/.bin`; `package.json` scripts are only `build` and `dev`; no `.github/` directory → no CI. Every change ships unverified except by the manual preview-server workflow described in `CLAUDE.md`.

This is high-risk because the app's most consequential logic is exactly the kind that silently produces wrong-but-plausible output: **sync reconciliation** (`App.jsx:91-158` — six branches deciding keep-local vs pull-cloud vs wipe vs conflict, governing user data destruction), **money math** (`src/utils/formatting.js` `asNumber`/`lineTotal`/`lineCashPaid`, used across all three feature tabs), and **import parsers** (`src/utils/importBudgetExcel.js`, plus the CSV/XML parsers in `AppSettings.jsx`) that turn arbitrary user files into stored records.

### Minimal first harness (recommendation, in priority order)
1. Add `vitest` (Vite-native, zero extra config) + an `npm test` script + a one-line GitHub Action.
2. **Pure-function unit tests first** (no DOM needed): `asNumber`/`lineTotal`/`lineCashPaid` edge cases (`"$1,234.56"`, `null`, legacy `amount` vs `total` vs `faceValue`, negatives), `dedupHash`/`localContentHash` stability (`exportBackup.js:65`), `buildBackup`↔`applyBackupToLocalStorage` round-trip.
3. **Reconciliation truth table**: extract the branch logic of `reconcileOnSignIn` into a testable pure function over `{cloud, local, sameUser, cloudNewer, localDirty, foreign}` and assert each of the six outcomes — this is the one place a bug deletes user data.
4. **Parser fixtures**: feed `importBudgetExcel` and the BrickEconomy/Brickset/Rebrickable/BrickLink parsers a handful of real export files and assert row counts + key fields.

<a id="area-deepA-sync"></a>

## Deep-Dive A — Cloud-Sync Reconciliation

Scope: `src/App.jsx` (sign-in reconciliation, conflict resolvers, sign-out wipe, push effects), `src/utils/exportBackup.js` (apply/push/fetch/markSynced/dedupHash/clearLocalUserData/buildBackup), `src/main.jsx` (datachange patch + `SYNC_SKIP_KEYS`), `api/sync.js` (server blob store). This is a per-user JSON blob model with **no merge** — every reconciliation outcome is "one whole side wins, the other is discarded." That whole-blob design is the root cause of most findings below.

### Flow map (sign-in)

```
isLoaded && userId  ──► reconcileOnSignIn()                       App.jsx:65-87
   │
   ├─ fetch cloud (fetchFromCloudAuth)                            App.jsx:94
   │     └─ throws ──► syncReadyRef=true, RETURN (push local up)  App.jsx:95   [FINDING A2]
   │
   ├─ foreign = syncedUser && syncedUser !== userId               App.jsx:98
   │     └─ if foreign & hasLocal ──► clearLocalUserData()         App.jsx:107  [FINDING A1]
   │
   ├─ cloud == null (404/503/401 all map to null)                 App.jsx:112  exportBackup.js:139
   │     ├─ hasLocal ──► pushToCloudAuth (claim)                  App.jsx:115
   │     └─ set syncedUser=userId, ready=true
   │
   ├─ !hasLocal  ──► applyBackupToLocalStorage(cloud); reload     App.jsx:123-128
   │
   └─ both have data:
        cloudNewer = cloudTime > localTime + 60_000               App.jsx:135
        localDirty = localContentHash() !== blLastPushHash         App.jsx:136
        ├─ sameUser && cloudNewer && !localDirty ──► PULL+reload  App.jsx:140  [FINDING A3]
        ├─ sameUser && !cloudNewer ──► keep local, push           App.jsx:149
        └─ else ──► setSyncConflict(...) modal                    App.jsx:157
                     ├─ Use cloud ──► apply+markSynced+reload     App.jsx:160
                     └─ Keep local ──► force push                 App.jsx:169
```

### 1. Data-loss branches

Every path that calls `applyBackupToLocalStorage` (overwrite) or `clearLocalUserData` (delete):

| Path | Location | Destroys unsynced local edits? |
|---|---|---|
| Foreign-data wipe | App.jsx:107 | **Yes — CRITICAL (A1)**: misidentified "foreign" data is silently deleted, no modal, no backup. |
| Cloud-empty claim push | App.jsx:115 | No (pushes local up). But push failure is swallowed (A6). |
| Fresh-device silent pull | App.jsx:123 | Edge: only when `hasLocal` is false, so nothing to lose. Safe. |
| Same-user silent pull | App.jsx:140 | Guarded by `!localDirty` + `cloudNewer`. **Mostly safe, but the 60s skew + hash gives a narrow window (A3).** |
| Conflict "Use cloud" | App.jsx:160 | Yes — but user-chosen, with summary shown. Acceptable. |
| Sign-out wipe | App.jsx (sign-out path) | **✅ CLOSED (A4, Phase D)**: `clearLocalUserData()` now refuses to wipe unsynced/dirty data (`{skipped:"unsynced"}`) and the caller keeps it; force-wiped only on the foreign path. |
| `fetch` throws → ready=true | App.jsx:95 | Indirect: opens door for a stale push to overwrite cloud (A2). |

The remaining unguarded destructive path is **A1 (foreign wipe)** — it still deletes without any user prompt or automatic local backup. (**A4 (sign-out wipe) is CLOSED in Phase D**: it no longer destroys unsynced data — see the table above. A1's recover-before-wipe fix is still open; both A1 and the A4 residual `SIGNOUT-RETAIN-1` want the same recover-before-destroy primitive.)

### 2. Idempotency & ordering

- **Two tabs / concurrent runs**: `syncReadyRef` is a per-tab `useRef` — it does **not** coordinate across tabs. Two signed-in tabs each run `reconcileOnSignIn`, each push on their own debounce/interval/visibility timers. Last-write-wins at `api/sync.js:88` (`kv.set`, no CAS, no version check). See A5.
- **Racing pushes within a tab**: interval (App.jsx:198), 10s timer (197), visibility (199), and 15s debounce (213) can all call `pushToCloudAuth` concurrently. `pushToCloudAuth` is not mutually exclusive; two in-flight POSTs can interleave, and the `blLastPushHash` write (exportBackup.js:55) is set only on the resolving call — generally benign because payloads are identical, but the dirty-check is racy.
- **Partial/interrupted apply**: `applyBackupToLocalStorage` (exportBackup.js:147-175) writes ~18 keys sequentially with no transaction. A crash/quota-error mid-loop leaves a **half-cloud / half-local Frankenstate**; `markSynced` then records the *full* cloud hash, so `localDirty` reads false and the corruption is never re-pulled. See A7.
- **Out-of-order sign-in/out**: the wipe at App.jsx:77-81 is synchronous on `userId→null` and reloads, which is reasonable. But `reconcileOnSignIn` is async and not cancelled if `userId` changes mid-flight (no abort token); a pending pull could apply *after* sign-out. Low likelihood but unguarded.

`syncReadyRef` is **not sufficient**: it only gates pushes within one tab during one reconciliation; it provides nothing for cross-tab, post-apply, or sign-out-mid-fetch ordering.

### 3. Dedup hash (`quickHash`/`dedupHash`)

- `quickHash` (exportBackup.js:13-17) is djb2 → 32-bit (`>>> 0`). Deterministic for identical input strings; **collision space is only 2³²**, fine for dirty-checking but it is used as the *sole* skip gate for pushes — a collision means a real edit is never pushed (silent staleness). Low probability, real consequence.
- **Input normalization is the real risk (A8)**: `dedupHash` does `JSON.stringify(rest)` with **no key sorting**. `buildBackup` emits a fixed literal key order, so a single client is self-consistent. But the value of `brickEconomySyncInfo`/`storeBudgets` come from `JSON.parse` of arbitrary objects whose key order is insertion-dependent — two clients that built those objects in different orders hash differently for identical data, defeating dedup and causing redundant pushes / false conflicts.
- **Version skew (A9)**: `dedupHash` strips only `exportedAt` + `brickEconomySetCache`. If `buildBackup` shape changes (new field, renamed field, the literal v2 `version:2` at line 179 vs `BACKUP_VERSION=2` at 144), **every existing `blLastPushHash` instantly mismatches** → every client force-pushes on next boot, and cross-version clients see each other as perpetually "dirty," forcing conflict modals. There is no hash-version tag stored alongside `blLastPushHash`.
- Note: `version` IS included in the hash (only `exportedAt`/cache stripped), so bumping `BACKUP_VERSION` alone changes all hashes.

### 4. Source-of-truth divergence

- Server (`api/sync.js`) is a dumb last-writer-wins blob — it never compares `exportedAt`/version of incoming vs stored (line 88 just overwrites). So **client timing alone decides truth.** A device with a stale clock makes `cloudNewer` (App.jsx:135) wrong in both directions.
- `cloudNewer` trusts `cloud.exportedAt` (a client-generated timestamp, line 132) against `blLastCloudPush` (also client-set, exportBackup.js:54). Both are client clocks on possibly different machines → the `+60_000` fudge is a guess, not a guarantee. Two devices with >60s clock skew can ping-pong overwrite each other.
- `localDirty` (App.jsx:136) trusts `blLastPushHash`, which `markSynced` sets to the *cloud* backup's hash. If `applyBackupToLocalStorage` silently dropped a field (e.g. cloud had a malformed `storeBudgets` that failed the `typeof === "object"` guard at exportBackup.js:162), local ≠ cloud but the hash says "synced" → divergence is invisible forever. See A7.

---

Most of these collapse to one structural truth: **a whole-blob, last-write-wins, client-clock-timestamped store with a non-versioned dirty hash and no merge.** It is acceptable for a single-user-single-device hobby app and dangerous the moment two devices or two tabs are active.

<a id="area-deepB-money"></a>

## Deep-Dive B — Money / Ledger Logic (architectural lens)

### Verdict
The money layer has a **real but partial** centralization story. `src/utils/formatting.js` defines the canonical value primitives — `asNumber()`, `lineTotal()`, `lineCashPaid()`, `money()` — and the budget read paths correctly route through `lineTotal`/`lineCashPaid`. That is the right shape. The gaps are: (1) the *write-side* total/cashPaid formula is hand-duplicated in 6+ places instead of living next to its read-side twins; (2) there is no single "money value" type — `asNumber()` is sprinkled across **215 call sites** as a discipline, not enforced by structure; (3) the Excel/CSV import path produces a **different field schema** than the canonical helpers read, silently dropping gift-card data; (4) the prior annual-budget falsy-zero bug was fixed *locally* in three files with a duplicated `DEFAULT_ANNUAL_BUDGET` constant rather than structurally.

### Centralization map

```
src/utils/formatting.js  (canonical primitives)
  ├─ asNumber()      ── 215 call sites (MyCollection 61, WantedList 64, Budget 59, +others)
  ├─ money()         ──  ~169 call sites
  ├─ lineTotal()     ── read-side: faceValue?? amount × qty, honors `total`
  └─ lineCashPaid()  ── read-side: cashPaid, else lineTotal − gcApplied
                         ▲ NO write-side counterpart exists ▼

WRITE-SIDE (duplicated, NOT centralized) — identical formula in:
  MyCollection.jsx:782-783, MyCollection.jsx:2543-2544
  WantedList.jsx:169-170,   WantedList.jsx:3236-3237
  BudgetDashboard.jsx:1067-1068, BudgetDashboard.jsx:1979-1980
    total    = Math.round((faceValue*qty + tax + shipping)*100)/100
    cashPaid = Math.max(0, Math.round((total - gcApplied)*100)/100)

IMPORT (separate schema island):
  importBudgetExcel.js → {amount, giftCardUsed, cashSpent}
    ✗ canonical helpers read {faceValue, gcApplied, cashPaid} — giftCardUsed/cashSpent ignored
```

### Falsy-zero assessment
The codebase is mostly *safe* against falsy-zero because the overwhelming majority of `|| 0` / `|| 1` defaults collapse to a value that is identical to the intended fallback (amounts default to 0, qty defaults to 1). The recurrence is **not structurally prevented** — it's prevented by the author consistently choosing `|| 0` for amounts and `|| 1` for qty by hand. The one place that genuinely matters (annual budget, the prior bug) was fixed with the correct `stored !== null ? Number(stored) : DEFAULT` guard, but that guard is **copy-pasted in three files** with a duplicated constant, so a fourth reader could easily reintroduce `asNumber(...) || 0`. Concrete remaining at-risk sites are below (mostly low severity, but they are the structural smell).

### Rounding / precision
Precision is handled **consistently and correctly** on the write path: every per-line `total` and `cashPaid` is rounded to cents (`Math.round(x*100)/100`) at persist time, and the order-level tax/shipping/GC distribution uses a proper last-line-absorbs-remainder pattern (`reDistributeLines`, BudgetDashboard.jsx:806-830) so cent allocations always sum back to the order total. Aggregations (`spent`, `storeTotals`) reduce already-rounded cent values and `money()` only display-rounds, so float drift is bounded and not a practical risk. The inconsistency is *structural duplication of the rounding expression*, not divergent rounding behavior.

<a id="area-deepC-churn"></a>

## Deep-Dive C — Churn-Based Hotspot Discovery

Method: `git log` over the full 74-commit history on `main`. 25 commits (34%) match fix/bug/revert/hotfix/crash patterns — a high defect-rework ratio consistent with a vibe-coded app. Conclusions only below; raw output omitted per instructions. All findings verified against real files (line counts via `wc -l`).

### Ranked hotspots

| File | Commits | Fix-commits | LOC | Rationale |
|---|---|---|---|---|
| `src/WantedList.jsx` | 27 | 12 | 3579 | Highest churn AND highest fix-churn in the repo. Largest file by far. Repeated UI-state fixes (hover-chip rewritten 3× across commits `02c76fd`→`c331992`→`34548f7`; TDZ crash `a1ccde8`). **Not covered by A/B.** |
| `src/App.jsx` | 24 | 10 | 458 | Sync orchestration core (Deep-Dive A). Dense fix history; co-changes with `exportBackup.js` (12×) — a tight sync coupling cluster. Covered by A. |
| `src/AppSettings.jsx` | 20 | 7 | 1637 | Settings UI repeatedly restructured (4a56b07, c3ed748, f4aaff7) plus falsy-zero money bugs (fe07675). Partial money overlap (B), but the UI/config churn itself is **not covered by A/B.** |
| `src/MyCollection.jsx` | 18 | 6 | 2674 | Second-largest file; co-changes with WantedList 10× (shared stat/column logic). Money logic partly in B, but the bulk-edit/column UI is **not covered.** |
| `src/BudgetDashboard.jsx` | 13 | 8 | 2559 | Highest fix-ratio among feature tabs (8/13 ≈ 62%). Money/stat heavy — squarely Deep-Dive B. |
| `src/utils/exportBackup.js` | 13 | 6 | 244 | Sync/backup serialization — Deep-Dive A. |
| `vite.config.js` | 9 | 6 | 95 | 6/9 commits are fixes. It mirrors `/api` as dev middleware; churn signals dev/prod parity drift in the proxy layer. **Not covered by A/B.** |

### Co-change clusters

- **Sync cluster:** `App.jsx` ↔ `exportBackup.js` (12×) ↔ `main.jsx` (6×) ↔ `AppSettings.jsx` (7×) ↔ `cloud-backup.js` (4×). This is the Deep-Dive A surface; the strength of the coupling confirms sync logic is spread across 4–5 files that must move together.
- **Feature-tab cluster:** `WantedList.jsx` ↔ `MyCollection.jsx` (10×) ↔ `BudgetDashboard.jsx` (7×) ↔ `formatting.js` (5×) ↔ `columnDefaults.js`. Stat-card, column-selector, and money-formatting changes ripple across all three giant tabs simultaneously — a sign of copy-pasted logic rather than shared components (inferred).

### Future-scrutiny candidates (NOT covered by Deep-Dive A or B)

```
                 ┌──────────────────────────────────────────┐
                 │  Feature-tab cluster (shared stat/column  │
                 │  UI, NOT factored into components)         │
                 └──────────────────────────────────────────┘
   WantedList.jsx(3579) ──10×── MyCollection.jsx(2674)
        │  \                          │
        │   \__7×__ BudgetDashboard ──┘   (B owns money math here)
        │
   formatting.js ──5×── columnDefaults.js
```

1. **`src/WantedList.jsx` — top priority.** 27 commits / 12 fixes / 3579 lines. The single most churned and most defect-prone file, and it is neither the sync core (A) nor primarily money math (B). Its fix history is dominated by *interactive UI state* (hover chips, inline editing, keyboard-shortcut TDZ, gear menus). A 3579-line single-file component with this defect density is the strongest candidate for a focused decomposition/state-management review.

2. **`src/AppSettings.jsx`.** 20 commits / 7 fixes / 1637 lines. Repeatedly restructured and home to falsy-zero reset bugs (`fe07675`). The settings/config-persistence surface (not sync transport, not stat math) warrants its own pass for state-reset and zero-handling correctness.

3. **`src/MyCollection.jsx`.** 18 commits / 2674 lines. Co-changes lockstep with WantedList — the shared column/stat UI is duplicated, not shared. A review of whether these two giants can share components would address churn at both.

4. **`vite.config.js`.** 9 commits / 6 fixes. Tiny file with a 67% fix-ratio. It hand-mirrors every `/api` proxy as dev middleware, so each new/changed endpoint risks dev↔prod drift. Worth a review for whether the mirroring can be generated/shared rather than maintained by hand.

---

## Hard-enforcement candidates (hooks / path-scoped rules)

CLAUDE.md is guidance, not enforcement. These invariants should be enforced mechanically. **Three of the four are now mechanically enforced and CI-gated (Phase G)** via `.github/workflows/ci.yml` (`npm run lint && npm test` on every PR + push to main) — landed as a lint + a test rather than the originally-sketched CC-only hooks, so they're tool-agnostic. **B6 (money type) remains the open candidate** (Step 4):

- **OBS-2** ✅ CLOSED (Phase E) — 111 unguarded localStorage.setItem calls — QuotaExceededError causes silent data loss → all writes route through the guarded `setItemSafe` choke point (`src/utils/safeStorage.js`), enforced by the DATA-4 lint below.
- **DATA-4** ✅ CLOSED (Phase G) — Sync depended entirely on the monkey-patched setItem; any bypass wrote data that never syncs → patch replaced by `setItemSafe` (Phase E); raw `localStorage.setItem` now **banned by ESLint** (`eslint.config.js`, sole sanctioned site `safeStorage.js`).
- **SEC-GAP-2** ✅ CLOSED (Phase G) — No tooling enforced the 'every /api handler authenticates first' invariant → now a **dynamic per-handler auth-required test** (`src/api-auth.test.js`) that enumerates `api/*.js` at runtime and asserts 401 + no upstream fetch when unauthenticated.
- **B6** ⬜ OPEN (Step 4) — No enforced money type — 215 asNumber() call sites rely on author discipline (`src/MyCollection.jsx (61), src/WantedList.jsx (64), src/BudgetDashboard.jsx (59), +SetDetailPanel/AppSettings/PurchaseDetailPanel/WatchDetailPanel; canonical def src/utils/formatting.js:1-3`)


## Actionable Checklist

_Work top-down. `🔒` = candidate for hard enforcement (PreToolUse hook or path-scoped `.claude/rules/*.md`) rather than relying on prose._

### Critical
- [x] **SYNC-CRIT-1** · ✅ CLOSED (Phase D) — "Fresh device" emptiness census is narrower than the cloud-pull overwrite scope → silent loss of unsynced sold-sets / portfolio / stores / budget / settings — _moderate_ · `src/App.jsx:100-101,123-129; src/utils/exportBackup.js`
      ↳ DONE: census (`hasAnyLocalData`), overwrite (`applyBackupToLocalStorage`), build, and `pushToCloudAuth`'s push-guard now **all derive from the `BACKUP_KEYS` registry**. The census counts every overwritten data key, so `!hasLocal` (→ silent pull) is true only for a genuinely empty device. Locked by `exportBackup.census.test.js` + `exportBackup.roundtrip.test.js`.

### High
- [x] **OBS-2** — 111 unguarded localStorage.setItem calls — QuotaExceededError causes silent data loss — _moderate_ · CLOSED (Phase E; hardened E.5): all writes route through guarded `setItemSafe`; cloud restore is atomic (snapshot + rollback). No-bypass enforcement (`🔒`) tracked under **DATA-4 / Phase G**.
      ↳ Add a safeSetItem(key,value) wrapper that on QuotaExceededError surfaces a toast.error ('Storage full — export a backup and clear caches') and ideally evicts regeneratable caches (brickEconomySetCache, bricksetSetCache) before retrying. Route the highest-value writes (blPurchases, blOwnedSets, blWantedList) through it, and never wrap those writes in an empty catch.
- [x] **A2** · ✅ CLOSED (Phase F) — Cloud fetch failure sets syncReadyRef=true, letting a stale local push overwrite newer cloud — _moderate_ · `src/App.jsx:94-95`
      ↳ DONE: the fetch-fail catch in `reconcileOnSignIn` now logs and returns, leaving `syncReadyRef=false`; the ref flips true only on a **confirmed successful reconcile**, so a failed pull can no longer enable a push that overwrites unseen cloud. Locked by `src/App.reconcile.test.jsx` (dirty-local + failed-fetch ⇒ no push; control: successful reconcile ⇒ push fires).
      ↳ **Follow-up — A2 frozen-sync resilience (accepted-for-now):** a failed fetch leaves auto-push **frozen until the next reload** — there is no automatic in-session retry/backoff and no user-facing "sync paused" signal. Accepted as the safe default (frozen-but-correct beats stale-push-clobber); revisit with a bounded retry + a sync-status indicator. Sibling finding **OBS-4** (fetch-fail treated as silent "local wins") is addressed by the same change; this note is its residual.
- [x] **A4** · ✅ CLOSED (Phase D) — Sign-out wipe destroys local data that was never pushed (offline / failed-sync sign-out) — _moderate_ · `src/App.jsx (sign-out path), src/utils/exportBackup.js (clearLocalUserData)`
      ↳ DONE: `clearLocalUserData()` compares `localContentHash()` vs `blLastPushHash` and **refuses to wipe** unsynced/dirty data (`{skipped:"unsynced"}`); the App sign-out path keeps the data for the next sign-in instead of reloading. Foreign path passes `{force:true}` (BIZLOGIC-1). +6 A4 regression tests. **Residual `SIGNOUT-RETAIN-1`** (no user feedback / shared-device retention window) tracked in the action plan; **A1** (foreign recover-before-wipe) still open.
- [ ] **churn-wantedlist** — WantedList.jsx is the repo's top churn + fix hotspot and is uncovered by Deep-Dives A/B — _significant_ · `src/WantedList.jsx (3579 lines)`
      ↳ Schedule a dedicated review/decomposition pass: extract the hover-preview, inline-edit, and keyboard-shortcut state into smaller hooks/components; this is the highest-ROI target for reducing future regressions.

### Medium
- [ ] **A1** — Foreign-data wipe silently deletes local data with no prompt or backup — _moderate_ · `src/App.jsx:106-109 (clearLocalUserData call), src/utils/exportBackup.js:107-117`
      ↳ Before clearLocalUserData() on the foreign path, if hasLocal, route through the SAME conflict modal (or auto-export a local backup to Downloads first). Never delete unsynced content without either user confirmation or a recoverable on-device backup. At minimum, call exportFullBackup() synchronously before wiping foreign-but-nonempty data.
- [ ] **DATA-1** — User-authored content keys are excluded from the cloud backup and file export — silently lost on any restore/pull — _moderate_ · `src/utils/exportBackup.js:177-208 (buildBackup) and :147-175 (applyBackupToLocalStorage)`
      ↳ Decide per key whether it is user content (must sync) or device-local prefs (must survive sign-out, like blAutoExportDays). At minimum add blCustomFieldsSchema, blDealLog, blBudgetItems, blWLItems to buildBackup/applyBackupToLocalStorage and bump BACKUP_VERSION. Add an automated test or a single canonical KEY_REGISTRY (key -> {sync, signoutKeep}) that buildBackup, applyBackupToLocalStorage, clearLocalUserData, and SYNC_SKIP_KEYS all derive from, so a new key can't silently fall through every layer.
- [ ] **DATA-2** — Owned-set collection is split across two localStorage keys with no single accessor — partial-collection drift — _significant_ · `blOwnedSets + brickEconomyNormalizedCollection; read sites MyCollection.jsx:153/202, BudgetDashboard.jsx:1130-1131, AppSettings.jsx:540-541/1062-1063/1086-1087, WantedList.jsx:297-299, beSyncValues.js:94-95/137-138`
      ↳ Introduce a single src/utils/collection.js with getOwnedSets()/setOwnedSets() (or a getAllOwned() that returns the merged view plus source-tagged writers) and route all read/write sites through it. Do not change the storage split now (requires-rewrite); just centralize access so the merge rule lives in one place. Until then, treat the two keys as a known invariant.
- [ ] **MB-1** — Four god-module tabs share a schema-less localStorage namespace with no data layer — _requires-rewrite_ · `src/MyCollection.jsx, src/WantedList.jsx, src/BudgetDashboard.jsx, src/AppSettings.jsx`
      ↳ Introduce a thin data-layer module per entity (e.g. utils/collectionStore.js, purchaseStore.js) that owns read/write/shape for each key, and have tabs go through it instead of touching localStorage directly. Even a documented TypeScript-style JSDoc typedef per entity in one place would reduce the ripple risk substantially.
- [ ] **API-1** — buildBackup / applyBackupToLocalStorage drop user content (blDealLog, blCustomFieldsSchema) — _moderate_ · `src/utils/exportBackup.js:147-208; src/WantedList.jsx:111,235`
      ↳ Add blDealLog and blCustomFieldsSchema (and the WL/Budget widget layouts) to both buildBackup and applyBackupToLocalStorage; bump BACKUP_VERSION. Define the backed-up key set once (a shared array) and derive both functions from it, or add a unit test asserting buildBackup keys === applyBackupToLocalStorage keys.
- [ ] **OBS-1** — No React error boundary — any render throw blanks the whole app silently — _moderate_ · `src/App.jsx:231 (root render); src/main.jsx:33 (ReactDOM.createRoot)`
      ↳ Add a top-level ErrorBoundary wrapping <App/> in main.jsx that renders a fallback (with a 'reload' and 'export backup' button so users can rescue their data) and logs the error. Optionally add a window.addEventListener('unhandledrejection', ...) to catch swallowed async rejections.
- [x] **TEST-1** · ✅ CLOSED (Phase G) — Zero test infrastructure — no test runner, no tests, no CI — _moderate_ · `package.json (scripts: build, dev only); no *.test.* files; no .github/ directory`
      ↳ DONE: vitest + `npm test` (59 tests across Phases D–G) + `.github/workflows/ci.yml` running `npm run lint && npm test` on every PR and push to main. The targeted suites below (TEST-2/3) remain the next layer.
- [ ] **TEST-2** — Sync reconciliation logic (data-destruction branches) is untested — _significant_ · `src/App.jsx:91-158 (reconcileOnSignIn); src/utils/exportBackup.js:65-83,107-117 (dedupHash/markSynced/clearLocalUserData)`
      ↳ Extract the branch decision into a pure function over {cloud, hasLocal, sameUser, foreign, cloudNewer, localDirty} returning an action enum, and unit-test the full truth table including the conflict and foreign-wipe cases.
- [ ] **TEST-3** — Money math and import parsers are untested — _moderate_ · `src/utils/formatting.js:1-17 (asNumber/lineTotal/lineCashPaid); src/utils/importBudgetExcel.js; CSV/XML parsers in src/AppSettings.jsx (~lines 580-960)`
      ↳ Start the test suite here: table-driven tests for asNumber/lineTotal/lineCashPaid edge cases (currency strings, null, negatives, legacy fields) and fixture-based tests feeding real export files to importBudgetExcel and the BrickEconomy/Brickset/Rebrickable/BrickLink parsers, asserting row counts and key fields.
- [ ] **A5** — Server is unconditional last-write-wins with no version/CAS; concurrent tabs/devices silently clobber — _significant_ · `api/sync.js:82-93 (POST handler, kv.set with no compare)`
      ↳ Add optimistic concurrency: store and check a version/revision (or exportedAt) on the server, reject POSTs whose base revision is stale (409), and have the client re-reconcile on conflict. At minimum, dedupe pushes across tabs via a BroadcastChannel/localStorage lock.
- [ ] **DATA-3** — cloudNewer comparison can silently overwrite local data if blLastCloudPush is missing while blLastPushHash survives — _moderate_ · `src/App.jsx:132-146 (reconcileOnSignIn) with markSynced/clearLocalUserData in src/utils/exportBackup.js:79-83,107-117`
      ↳ Treat the sync metadata as one unit: store {hash, pushedAt, userId} under a single key written atomically in markSynced, and read it as a unit in reconcile. Alternatively, when blLastCloudPush is missing but local data exists, fall through to the conflict modal instead of the silent-pull branch.
- [x] **DATA-4** `🔒` · ✅ CLOSED (Phase G) — Sync depends entirely on the monkey-patched setItem; any bypass writes data that never syncs — _trivial_ · `src/main.jsx:17-28 (localStorage.setItem patch) and SYNC_SKIP_KEYS at :11-16`
      ↳ DONE: the runtime patch was replaced by an explicit choke point (`setItemSafe` in `src/utils/safeStorage.js`, Phase E), and raw `localStorage.setItem` is now **banned by ESLint** (`eslint.config.js`, `no-restricted-syntax`; sole sanctioned site `safeStorage.js` — `setItemSafe` + the relocated `restoreRaw`), CI-gated. The chosen mechanism is a tool-agnostic lint, not the CC-only `.claude/rules`/PreToolUse hook originally sketched. Scope is `setItem` (writes); raw `removeItem` is unrestricted (verified to touch only wipe/cache/transient keys, no syncable user data — Phase G removeItem audit).
- [ ] **API-2** — bricklink-auth.js manual request-stream read is dev-broken (consumed by Vite middleware) — _trivial_ · `api/bricklink-auth.js:20-38; vite.config.js:80-90; src/utils/bricklink-client.js:51`
      ↳ Read accessToken from req.body (with a fallback to manual stream read only if req.body is undefined), matching the sync handler. Verify the BrickLink auth flow works under npm run dev.
- [x] **SEC-GAP-2** `🔒` · ✅ CLOSED (Phase G) — No tooling enforces the 'every /api handler authenticates first' invariant — _moderate_ · `.claude/ (no rules dir / no PreToolUse hook); pattern lives only as prose in docs/security.md §4e.1 & §4f.1`
      ↳ DONE: a **behavioural CI test** (`src/api-auth.test.js`) — stronger than the grep alternative — **dynamically enumerates** every non-helper `api/*.js` at runtime and asserts each returns 401 to an unauthenticated request *without* reaching the secret-bearing upstream `fetch`, so a new handler that omits the auth line fails CI automatically. Also pins `sync.js`'s pre-auth `getKv()` failing closed (503, no secret/data path). Recorded as a control cross-link in `docs/security.md` (under APISEC-1). Chosen over a `withAuth` refactor (would touch the whole boundary and still need the test).
- [ ] **OBS-3** — Swallowed sync push errors give no persistent failure signal — _moderate_ · `src/App.jsx:196 (interval push .catch(()=>{})); src/App.jsx:221 (debounced push empty catch resets status to idle)`
      ↳ Track consecutive push failures; after N failures set a sticky syncStatus='error' with a visible badge/toast ('Cloud backup failing — your latest changes are only on this device'). Do not reset to idle on catch.
- [ ] **OBS-4** · ◑ Data-safety half DONE (Phase F); UX half open — reconcileOnSignIn treats a fetch failure as a silent 'local wins' decision — _moderate_ · `src/App.jsx:94-95`
      ↳ DONE (Phase F, same change as **A2**): a fetch error no longer silently enables a push — `syncReadyRef` stays `false` (push deferred) on any failed fetch. **Still open (the A2 frozen-sync resilience follow-up):** surface a "sync paused" toast and add a bounded retry/backoff, rather than staying frozen until the next reload with no signal.
- [ ] **OBS-5** — buildBackup does unguarded JSON.parse of every localStorage key — _moderate_ · `src/utils/exportBackup.js:177-208 (buildBackup); :147 (applyBackupToLocalStorage)`
      ↳ Wrap each JSON.parse in buildBackup with a safe-parse helper that falls back to the default ([] / {}) and counts/logs failures, so one bad key degrades gracefully instead of disabling all backup paths.
- [ ] **A6** — Cloud-empty claim push and debounce/interval push failures are silently swallowed — _moderate_ · `src/App.jsx:115 (catch {}), App.jsx:196 (.catch(()=>{})), App.jsx:221-223`
      ↳ Surface push failures (retry indicator / toast) and do not set blSyncedUserId / treat the account as claimed until at least one push has succeeded. Keep ready=false (or a 'dirty, retry pending' state) until a confirmed successful push.
- [ ] **A7** — applyBackupToLocalStorage is non-atomic and field-conditional; partial apply marked as fully synced — _moderate_ · `src/utils/exportBackup.js:147-175, markSynced 79-83, App.jsx:124/141/162`
      ↳ Either snapshot-and-rollback on failure, or after applying, recompute localContentHash() and compare to dedupHash(cloud); if they differ, do not markSynced (leave dirty so it re-pushes/re-pulls). Distinguish 'field absent in backup' from 'field present but invalid'.
- [ ] **A8** — dedupHash relies on unsorted JSON.stringify of objects with insertion-order-dependent keys — _moderate_ · `src/utils/exportBackup.js:65-68, buildBackup 177-208 (storeBudgets:194, brickEconomySyncInfo:186)`
      ↳ Hash a canonicalized form: a stable stringify that recursively sorts object keys. Apply it inside dedupHash so any backup shape hashes deterministically across clients regardless of key insertion order.
- [ ] **A9** — No hash-version tag: any buildBackup/BACKUP_VERSION change invalidates all stored dirty hashes (version skew) — _moderate_ · `src/utils/exportBackup.js:65-68 + 144 (BACKUP_VERSION) + 179 (version:2 literal), blLastPushHash usage App.jsx:136 / exportBackup.js:41,55`
      ↳ Store a hashVersion alongside blLastPushHash; on boot, if it differs from the current algo/schema version, recompute rather than treating as dirty. Derive the literal `version` from BACKUP_VERSION (single source) and exclude purely-cosmetic schema additions from the dedup input, or version the dirty check explicitly.
- [ ] **B1** — Write-side total/cashPaid formula duplicated in 6+ sites instead of centralized next to lineTotal/lineCashPaid — _moderate_ · `src/MyCollection.jsx:782-783, src/MyCollection.jsx:2543-2544, src/WantedList.jsx:169-170, src/WantedList.jsx:3236-3237, src/BudgetDashboard.jsx:1067-1068, src/BudgetDashboard.jsx:1979-1980`
      ↳ Add `computePurchaseTotals({faceValue, qty, tax, shipping, gcApplied})` → `{total, cashPaid}` to src/utils/formatting.js and replace all six inline blocks with a call. This makes lineTotal/lineCashPaid (read) and computePurchaseTotals (write) a single source of truth.
- [ ] **churn-appsettings** — AppSettings.jsx: high churn with falsy-zero reset bugs, config surface uncovered by A/B — _moderate_ · `src/AppSettings.jsx (1637 lines)`
      ↳ Audit AppSettings for remaining falsy-zero (0/'' treated as unset) patterns in config read/write; ensure asNumber()/explicit null checks per CLAUDE.md money convention.
- [ ] **churn-collection-dup** — MyCollection.jsx and WantedList.jsx co-change 10x — likely duplicated stat/column UI — _significant_ · `src/MyCollection.jsx (2674) + src/WantedList.jsx (3579)`
      ↳ Identify the duplicated column-selector/stat-card code across the two tabs and extract shared components; reduces the lockstep churn at the root.

### Low
- [ ] **A3** — Silent same-user pull window can drop edits made within the 60s skew/last-push gap — _moderate_ · `src/App.jsx:132-146`
      ↳ Tighten the silent-pull condition: require localTime>0 (an actual prior push) AND drop or shrink the 60s fudge, OR compare a stored cloud content hash rather than only timestamps. Treat hash equality as advisory, not authoritative, for destructive overwrites.
- [ ] **B2** — Excel import emits a non-canonical schema; gift-card data is silently dropped from cash-paid math — _moderate_ · `src/utils/importBudgetExcel.js:98-108 (giftCardUsed/cashSpent/amount), normalized at src/BudgetDashboard.jsx:463-479 (applyImportedPurchases)`
      ↳ Either (a) make importBudgetExcel emit the canonical schema (`gcApplied`, derive `cashPaid` via the shared computePurchaseTotals from B1), or (b) have applyImportedPurchases map giftCardUsed→gcApplied / cashSpent→cashPaid. Prefer (a) so the importer speaks the same money vocabulary as everything else.
- [ ] **DEP-1** — uuid override silently jumps exceljs's dependency two majors (8 → 11) with no guarding test or comment — _trivial_ · `package.json (overrides block); consumer node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js:1`
      ↳ Add a one-line comment in package.json (or a note in docs/security.md 'Dependency hygiene') stating the override de-dupes/upgrades exceljs's transitive uuid@8 and that exceljs only uses uuid.v4. Pin to a caret-major you have tested (^11) and re-verify after any exceljs or uuid bump. Optionally add a smoke test that round-trips an xlsx export to catch a broken `v4` import.
- [ ] **STACK-2** — ClerkProvider relies on implicit env-var key resolution with no explicit prop or guard — _trivial_ · `src/main.jsx:31`
      ↳ Pass the key explicitly: `publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}` and throw a clear startup error if it is falsy, so a missing key fails fast and loud at boot rather than degrading silently.
- [ ] **STACK-3** — No Node engine pin for the Vercel serverless functions — _trivial_ · `package.json (no "engines" field); affects all /api/*.js`
      ↳ Add `"engines": { "node": ">=20" }` (or the exact major you target) to package.json and confirm the matching runtime in Vercel project settings, so local dev, CI, and prod agree.
- [ ] **MAP-4** — Stale reference to deleted api/cloud-backup.js in sync.js comment — _trivial_ · `api/sync.js:20`
      ↳ Update the comment to note the inline Upstash REST client is duplicated in api/_ratelimit.js (the actual second copy), or extract a shared `api/_kv.js` so sync.js and _ratelimit.js share one client and one comment.
- [ ] **STACK-5** — Vite 8 / Rolldown is a very new major bundler for a production app with no lockstep on the experimental toolchain — _trivial_ · `vite.config.js (build.rollupOptions.manualChunks); package-lock.json (rolldown@1.0.2, esbuild absent)`
      ↳ Keep vite/rolldown pinned via the lockfile (already lockfileVersion 3) and treat Vite minor/patch bumps as changes that need a build + smoke-test of the lazy exceljs chunk and the recharts vendor chunk before deploy. No code change required now.
- [ ] **DATA-5** — Dead/legacy key brickEconomyOwnedSets read but never written — _trivial_ · `src/WantedList.jsx:298 (read), no writer anywhere in src`
      ↳ Remove the brickEconomyOwnedSets read at WantedList.jsx:298 and the corresponding spread; confirm no other consumer references it (none found).
- [ ] **API-3** — /api/sync called via raw fetch, bypassing the shared apiFetch wrapper — _moderate_ · `src/utils/exportBackup.js:46,136`
      ↳ Migrate the sync calls to apiFetch (it reads window.Clerk.session.getToken itself), dropping the getToken parameter threading, OR document explicitly why sync intentionally uses an injected token. Pick one auth mechanism.
- [ ] **API-4** — Set-number validation regex and error envelopes duplicated/inconsistent across proxies — _moderate_ · `api/brickeconomy-set.js:33; api/brickset-set.js:31; api/bricklink-priceguide.js:28; api/brickset-search.js:50`
      ↳ Extract a shared api/_validate.js (set-number + bounded query) and standardize on one error envelope (e.g. {error: code, message}). Centralize the client-side error code constants so they aren't free-floating strings.
- [ ] **MB-2** — Widget/chart-config reconcile algorithm copy-pasted across three tabs — _moderate_ · `src/MyCollection.jsx:99-120; src/WantedList.jsx (DEFAULT_WL_ITEMS merge); src/BudgetDashboard.jsx:140-151`
      ↳ Extract a utils/widgetConfig.js helper parameterized by the defaults array and storage key; have each tab call it.
- [ ] **MB-3** — Dead/legacy localStorage keys read or referenced but never written — _trivial_ · `src/WantedList.jsx:298 (brickEconomyOwnedSets); src/main.jsx:14 + src/AppSettings.jsx:1021 (brickEconomyCollectionCache)`
      ↳ Remove the brickEconomyOwnedSets read (and the brickEconomyCollectionCache references) after confirming no migration still produces them, or document why they are retained.
- [ ] **MB-4** — Set-number normalization duplicated inline across tabs and utils with divergent rules — _moderate_ · `src/utils/beSyncValues.js:31,44,55; src/utils/bricklink-client.js:84,145; src/utils/legoLastChance.js:59; src/utils/rebrickable.js:82; multiple tab sites`
      ↳ Export one normalizeSetNumber() from formatting.js (decide leading-zero policy once) and replace the inline copies.
- [ ] **SEC-DRIFT-1** — ScraperAPI key sent over cleartext http:// (security.md SECRET-2 note un-acted) — _trivial_ · `api/brickfanatics-retiring.js:176`
      ↳ Change the URL literal to `https://api.scraperapi.com` (ScraperAPI supports TLS). One-character-class edit; no other change needed.
- [ ] **SEC-GAP-1** — CSP connect-src predates the authenticated proxies — confirm no browser-direct upstream calls — _trivial_ · `vercel.json (CSP connect-src 'self' https://*.clerk.accounts.dev)`
      ↳ No change now. Document the rule: new external data sources must be proxied through /api (authenticated) rather than added to connect-src, keeping the secret-bearing boundary server-side and the CSP tight.
- [ ] **OBS-6** — Rate limiter fails open with only a console log — no alerting — _moderate_ · `api/_ratelimit.js:43-46`
      ↳ At minimum, count fail-open occurrences; longer term, fail-closed (or apply a tighter static cap) specifically for the cost-bearing ScraperAPI endpoints (brickfanatics-retiring) so a KV hiccup can't run up a bill.
- [ ] **A10** — soldSets / portfolioHistory are synced but excluded from hasLocal/summarize emptiness checks — _trivial_ · `src/App.jsx:100-101 (summarizeLocal sets/wanted/purchases), src/utils/exportBackup.js:90-96 summarizeLocal, 30-34 pushToCloudAuth hasAnyData`
      ↳ Include soldSets/portfolioHistory (and purchases/stores) in the hasLocal and hasAnyData emptiness tests so any synced field counts as 'has data' before a silent pull or push-skip.
- [ ] **B3** — Excel importer drops legitimate $0 purchases — _trivial_ · `src/utils/importBudgetExcel.js:96`
      ↳ Change the guard to skip only truly empty rows, e.g. `if (!store && !amount && !col(3)) return;` or gate on the presence of a store/item rather than amount === 0.
- [ ] **B4** — DEFAULT_ANNUAL_BUDGET constant duplicated across 3 files (one with divergent casing) — _trivial_ · `src/AppSettings.jsx:16, src/utils/exportBackup.js:10, src/BudgetDashboard.jsx:15 (named DEFAULT_annualBudget)`
      ↳ Export DEFAULT_ANNUAL_BUDGET from a single module (formatting.js or a constants file) and import it in all three. Optionally add a `readMoneyPref(key, default)` helper that bakes in the `stored !== null` guard so no reader can reintroduce `asNumber(x) || 0` on a budget value.
- [ ] **B5** — Template-literal escaping bug in import toast — renders literal backslash-quotes — _trivial_ · `src/BudgetDashboard.jsx:496`
      ↳ Pre-compute the plural outside the template: `const dupWord = skipped === 1 ? 'duplicate' : 'duplicates';` and interpolate `${skipped} ${dupWord} skipped`.
- [ ] **B6** `🔒` — No enforced money type — 215 asNumber() call sites rely on author discipline — _requires-rewrite_ · `src/MyCollection.jsx (61), src/WantedList.jsx (64), src/BudgetDashboard.jsx (59), +SetDetailPanel/AppSettings/PurchaseDetailPanel/WatchDetailPanel; canonical def src/utils/formatting.js:1-3`
      ↳ Not worth a full rewrite for a vibe-coded SPA, but (a) keep all new money math behind the formatting.js helpers (lineTotal/lineCashPaid/computePurchaseTotals) so raw arithmetic shrinks over time, and (b) consider a lightweight ESLint rule or a path-scoped .claude/rules note that arithmetic on *.faceValue/.tax/.shipping/.gcApplied/.paidPrice/.currentValue must be wrapped in asNumber(). Flagging as the structural ceiling, not an urgent fix.
- [ ] **churn-vite-proxy-mirror** — vite.config.js has a 67% fix-ratio from hand-mirroring /api proxies — _moderate_ · `vite.config.js (95 lines)`
      ↳ Review whether the dev middleware can import/reuse the actual /api handlers (or be generated) instead of being maintained by hand, eliminating the recurring drift fixes.

---
_Generated from workflow `wf_f8c73317-ddc`. Security source of truth: [`docs/security.md`](./security.md)._
