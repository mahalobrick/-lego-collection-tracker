# BrickLedger — Integration Standard

How **every external data source** must behave: the proxy contract, auth, caching, error/timeout/
fallback policy, and the contract-test lock that keeps an upstream schema change from shipping
green. This is the cross-cutting companion to the *what-is-it-worth* spec (`docs/valuation.md`)
and the *how-is-the-app-organized* map (`docs/app-architecture.md`) — neither of those answers
"how must a source plug in," which is what this doc owns.

This is a **standard plus an honest current-conformance audit**, in the target-vs-reality shape of
[`docs/architecture-audit.md`](architecture-audit.md): each section states the **target rule**, then
a **Current conformance** subsection (what complies vs. the gap a later phase closes). It is *not* a
description of current reality — where code and standard disagree, the standard is the target and the
gap is logged in [§9 Remediation backlog](#9-remediation-backlog).

Per protocol rule #8 ([`docs/engineering-protocol.md`](engineering-protocol.md)), this doc **points at**
canonical sources rather than restating them — so it can't drift from the auth helper, the auth test,
the sync registry, or the fixture practice it describes.

- **Scope:** the live, value-/decision-bearing network sources behind `/api/*` — BrickEconomy,
  BrickLink, Brickset, LEGO.com, Brick Fanatics (via ScraperAPI). Clerk (auth boundary) and Upstash
  Redis (sync substrate) are **context**, not subjects — they're covered by [`docs/security.md`](security.md).
  Rebrickable is a **bundled CSV** (no network, no runtime drift) and is largely out of scope.

---

## 1. The integration contract

**Target.** Every `/api` proxy handler follows one pipeline, in this order:

```
setCors  →  requireAuth  →  rateLimitAllow  →  fetch(upstream, { timeout })  →  field-select  →  typed response
```

1. **`setCors`** — short-circuits the `OPTIONS` preflight.
2. **`requireAuth`** — Clerk gate; no handler spends a secret before it (§2).
3. **`rateLimitAllow`** — per-user atomic limiter (§2).
4. **Typed fetch with a timeout** — every upstream `fetch` carries an `AbortSignal.timeout(...)`; a
   slow upstream must never hang the function to its platform ceiling (§4).
5. **Field-select** — the handler maps the upstream payload to a **named, curated shape** it owns,
   rather than echoing the raw body. Field-select makes the proxy the place a contract test pins (§5),
   and keeps an upstream rename from silently reshaping client state.
6. **Typed response** — success returns the curated shape; failure returns a **typed error** the
   client can branch on and surface (§4) — never a bare passthrough of upstream status/body.

### Current conformance

- ✅ **Pipeline order** is uniform across all nine handlers (`setCors → requireAuth → rateLimitAllow →
  fetch`). Verified by reading every `api/*.js`.
- ✅ **Field-select**: Brickset (`brickset-set.js`, `brickset-search.js`, `brickset-themes.js`) and
  BrickLink (`bricklink-priceguide.js`) map to a curated shape.
- ⚠️ **BrickEconomy is raw passthrough** (`brickeconomy-set.js`, `brickeconomy-collection.js` return
  `JSON.parse(text)` verbatim; the full blob is cached client-side). This propagates upstream drift
  straight to the client instead of failing at a curated boundary. Tolerated for now because the BE
  blob has many consumers and `price_events_*` is already pinned (§5) — but it is the reason BE value
  fields are a **P2** contract-test target.
- ❌ **Timeouts** are missing on 4 of 5 live proxies → **P3** (§4).

---

## 2. Auth

**Target.** Every `/api` handler authenticates a Clerk user **before** it spends a server-held secret
or touches user data; per-user rate-limiting follows auth. CORS is **not** the boundary — a curl with
no `Origin` still reaches the handler, so the auth check is the only real gate. Server keys are
`process.env`-only and never reach the client bundle.

**POINT-AT (do not restate):**
- The shared gate and the `authorizedParties`/`azp` enforcement (AUTH-1): [`api/_auth.js`](../api/_auth.js).
- The **by-construction lock** that every handler authenticates: the runtime-discovery regression test
  [`src/api-auth.test.js`](../src/api-auth.test.js) (SEC-GAP-2) — it enumerates `api/*.js` at runtime and
  fails CI if any handler answers anything but 401 unauthenticated, or reaches `fetch` first.
- The atomic, **deliberately fail-open** per-user limiter and its rationale: [`api/_ratelimit.js`](../api/_ratelimit.js).
- The full auth/secret boundary analysis, env-var catalog, and CORS reasoning: [`docs/security.md`](security.md)
  (`APISEC-1`, `SEC-GAP-2`, `CORS-1`, `SECRET-1/2`).

**Rate-limiter fail-open is intentional, not a gap.** `rateLimitAllow` allows the request if the
limiter errors or KV is unconfigured, because every limited endpoint already requires a verified Clerk
user — abuse is bounded to accountable accounts, and a Redis hiccup must not brick a working feature.
The trade-off is logged server-side so it stays observable. The standard **ratifies** this; the only
open refinement is a tighter/​cost-aware (or fail-closed) limit for the ScraperAPI-backed endpoint.

### Current conformance

- ✅ **All nine proxies + `sync.js` gate on `requireAuth`**; locked by `api-auth.test.js`.
- ✅ **No client-bundle key leakage** — zero `import.meta.env`/`VITE_` reads in `src/`; the publishable
  Clerk key is consumed inside `@clerk/react`; all server keys are `process.env`-only in `api/`.
- ✅ **AUTH-1 closed** — `authorizedParties` enforced in `_auth.js`.
- ✅ **Buckets**: `proxy` (1000/60s) for the API proxies, `scrape` (60/60s) for Brick Fanatics.

---

## 3. Caching

**Target.**
1. Each source caches **client-side in localStorage** under a documented key with an explicit TTL.
2. **Integration caches are device-local and regeneratable — never synced.** They must **not** appear
   in the `BACKUP_KEYS` registry. (POINT-AT: the registry is the single source of truth for what syncs —
   `BACKUP_KEYS` in [`src/utils/exportBackup.js`](../src/utils/exportBackup.js); the classification table
   lives in [`docs/security.md`](security.md) §2d.)
3. **Never sync raw integration data.** Only *derived, user-owned* products (e.g. the value baked onto a
   collection record) may sync — and a derived value that syncs must carry an **`asOf`** so a stale
   device can't silently overwrite a fresher figure. (POINT-AT: the provenance shape
   `{amount, source, condition, basis, asOf}` in [`docs/valuation.md`](valuation.md) rule 5.)

### TTL reference

| Source | localStorage key | TTL | Stored | Synced? |
|---|---|---|---|---|
| BrickEconomy | `brickEconomySetCache` | 24h | full `data` blob | ❌ device-local |
| BrickLink | `blPriceGuideCache` (+ `blSessionToken`) | 6h / 12h bulk; session 50min | field-selected price object | ❌ |
| Brickset (set) | `bricksetSetCache` | 7d | field-selected `data` | ❌ |
| Brickset (themes) | `bricksetThemesCache` | 30d | `string[]` | ❌ |
| LEGO.com | `legoLastChanceCache` | 23h client / 24h CDN | `setCodes[]` | ❌ |
| Brick Fanatics | `blBFRetirementCache` | 7d CDN | `sets[]` | ❌ |

*(The user's BrickLink access token `blBrickLinkAccessToken` is a local secret, never synced — see
`docs/security.md` §2d.)*

### Current conformance

- ✅ **No integration cache is in `BACKUP_KEYS`** — all six are absent (regeneratable), matching the rule.
- ✅ **TTLs** are explicit in each client util.
- ⚠️ **`asOf` on the synced derived value is not enforced.** `beSyncValues` bakes `currentValue`/
  `totalValue` onto the (synced) `blOwnedSets`/`brickEconomyNormalizedCollection` records, so a stale
  device pushes a stale value with no freshness guard on the write. This **borders the audited sync
  layer** — the rule is stated here but **not enforced in this arc** ([§9](#9-remediation-backlog), gap #5, **parked**).

---

## 4. Error / timeout / fallback policy

**Target.**
1. **Every proxy upstream `fetch` carries a timeout.** No exceptions — a slow upstream returns a typed
   error, it never hangs the function.
2. **Every failure is a typed error the client surfaces.** No silent `null`. The client must be able to
   tell "no data exists" from "the fetch broke," and show the latter.
3. **Fallbacks are reachable end-to-end or they don't exist.** A fallback path that the client discards
   is dead code that misleads the next reader — wire it through to the UI or delete it.
4. **The rate-limiter's fail-open is deliberate** (§2) — documented, not silent.

### Current conformance

- ❌ **Timeouts: only Brick Fanatics has one** (`AbortSignal.timeout(45_000)`). BrickEconomy, Brickset,
  BrickLink, and LEGO.com proxies have **no** fetch timeout → **P3**.
- ❌ **Silent failure is the default UX.** Brickset/BrickLink failures return `null` + `console.warn`;
  the UI shows no data with no error signal. Only the BE sync surfaces a "failed" count → **P3** (typed
  error surface).
- ❌ **The BrickLink scrape fallback is a dead no-op** — see the V4 gating answer in [§9](#9-remediation-backlog) → **P3** (decision: remove vs wire, lean **remove**).
- ✅ **Non-JSON/HTML is detected** at the proxy (BE → `502 "returned HTML"`; Brickset → `502 invalid
  JSON`; BrickLink → flags `{format:"html"}`).
- ✅ **Rate-limiter fail-open** is documented and logged (`_ratelimit.js`).

---

## 5. Contract tests — the by-construction lock

**Target.** Each network source is pinned by **at least one fixture captured from a real payload**, plus
a shape test asserting the fields the app consumes. A silent upstream schema change then becomes an
**unmergeable red build** — the same move that made [`src/api-auth.test.js`](../src/api-auth.test.js)
(auth) and `value.zero-unknown.test.js` (0=unknown) durable. **Do not hand-author fixtures** — capture
them live and lock a test to the shape.

**POINT-AT (the established practice this generalizes):** the BrickEconomy `/set` `price_events_*`
contract — real payloads, capture script, presence matrix, and the pinned shape — lives in
[`test-data/be-fixtures/README.md`](../test-data/be-fixtures/README.md), tested by
[`src/utils/priceEvents.test.js`](../src/utils/priceEvents.test.js). Every new source's contract test
should follow that file's pattern (capture script → fixtures → shape test).

### Current conformance

| Source / endpoint | Pinned? | By / gap |
|---|---|---|
| BE `/set` `price_events_*` | ✅ | 5 fixtures + `priceEvents.test.js` |
| BE `/set` **value fields** (`current_value_*`, `retail_price_us`, `forecast_*`, `retired`) | ✅ | **P2 done** — `beSetValueFields.contract.test.js` pins the consumed-field shape against the 5 real fixtures (presence matrix + drift guards in `be-fixtures/README.md`) |
| BE `/collection/sets` | n/a | **P2 finding** — the network endpoint has **no client consumer** (zero `brickeconomy-collection` callers in `src/`); the real collection normalizer reads a **BE CSV export** (`normalizeBrickEconomyCollection`/`parseBECollectionCSV` in `AppSettings.jsx`), which is out of the network-source scope (like Rebrickable). Nothing to pin → [§9](#9-remediation-backlog) gap #8 |
| **BrickLink** priceguide (API-session shape) | ❌ | **P2 blocked** — unreachable in this env (no BL keys in `.env.local`; session token is per-user/live/50-min). Needs a real payload captured from the running app → [§9](#9-remediation-backlog) gap #1 |
| **Brickset** set/search/themes | ❌ | unpinned → **P4** |
| Rebrickable CSV columns | ❌ | bundled CSV, no runtime drift → trivial/optional |

**The asymmetry to remember:** field-select proxies (Brickset/BrickLink) hide drift as silent `null`s;
the passthrough proxy (BE) propagates drift to the client. Neither is caught without a contract test —
only `price_events` is locked today.

---

## 6. Per-source reference table

| Source | Proxy endpoint(s) | Client util | Proxy pattern | Cache key | Precedence (value layer) |
|---|---|---|---|---|---|
| **BrickEconomy** | `brickeconomy-set`, `brickeconomy-collection` | `beSyncValues.js` | raw passthrough ⚠️ | `brickEconomySetCache` | **canonical current value** + price history |
| **BrickLink** | `bricklink-auth`, `bricklink-priceguide` | `bricklink-client.js` | field-select | `blPriceGuideCache` | sold sample — **display-only today; value-layer = V4** |
| **Brickset** | `brickset-set/search/themes` | `brickset.js` | field-select | `bricksetSetCache`/`bricksetThemesCache` | MSRP **label** + retirement (not in rollup) |
| **LEGO.com** | `lego-last-chance` | `legoLastChance.js` | field-select | `legoLastChanceCache` | buy layer (last-chance) |
| **Brick Fanatics** | `brickfanatics-retiring` | (`blBFRetirementCache` reader) | field-select | `blBFRetirementCache` | buy layer (retirement) |
| **Rebrickable** | — (bundled CSV) | `rebrickable.js` | n/a | in-memory | metadata fallback |

**Join key across all sources:** the BrickLink item number (normalized, `-1` suffix stripped). Full
precedence rules and the BE-vs-Brickset `retail_price_us` source-tag (G1) live in
[`docs/valuation.md`](valuation.md).

---

## 7. Adding a new source — checklist

1. **Proxy** in `api/` follows the §1 pipeline: `setCors → requireAuth → rateLimitAllow → fetch(timeout)
   → field-select → typed response`. (Auth lands you in `api-auth.test.js` automatically — it
   auto-discovers new handlers.)
2. **Secret** is `process.env`-only; never `VITE_`/client-bundled. Add it to the env catalog in
   [`docs/security.md`](security.md) §2e.
3. **Client util** in `src/utils/` caches in localStorage with an explicit TTL; the key is
   **device-local** and **stays out of `BACKUP_KEYS`**. If it derives a value that *does* sync, that
   value carries `asOf` (§3).
4. **Contract test** — capture a real fixture (capture script under `scripts/`, fixtures under
   `test-data/`), pin the consumed-field shape, following the be-fixtures pattern (§5).
5. **Failure is a typed error the UI surfaces** (§4) — no silent `null`; any fallback is wired
   end-to-end or omitted.
6. **Document it**: a row in §6 here, the source map in [`docs/app-architecture.md`](app-architecture.md),
   and (if value-bearing) the precedence in [`docs/valuation.md`](valuation.md).

---

## 8. The V4 gating answer (BrickLink)

`docs/valuation.md` gates V4 (BrickLink as a primary *value* source) on confirming BrickLink runs on
real API auth, not the scrape fallback. **Answer, from reading the code:**

> **BrickLink is API-authed; the scrape fallback is a dead no-op.** The proxy
> [`api/bricklink-priceguide.js`](../api/bricklink-priceguide.js) tries the real BrickLink store API
> (`api.bricklink.com/.../price`) with a **50-minute session token** minted by `bricklink-auth`; on
> auth/parse failure it falls back to scraping `catalogPG.asp` and returns `{ raw, format: "html" }`.
> **But the client discards exactly that** — `bricklink-client.js:120`: `if (data.format === "html")
> return null` — and there is **no client-side HTML parser**. So today BrickLink data reaches the UI
> **only** via the real API session; if it fails, the client silently gets `null`.

So: V4's premise (real API auth) holds in practice, and the "scrape fallback" is the dead code P3
resolves (lean **remove**). This is the fact V4 depends on; the V4 build is a separate arc.

---

## 9. Remediation backlog

The ranked gaps from the STEP-0 map, each tagged to the phase that closes it. **Net-first**
([`docs/engineering-protocol.md`](engineering-protocol.md) #1): the P2 contract tests will likely
*surface* today's silent drift — that's the point.

| # | Gap | Phase |
|---|---|---|
| 1 | No BrickLink contract test (+ dead fallback) — the V4 blocker | **P2** (test, *blocked: gated on BrickLink API connection; pin when connected*) + **P3** (dead-code removal, proceeds now) |
| 2 | No fetch timeouts on 4 of 5 live proxies | **P3** |
| 3 | Silent failure is the default UX (Brickset/BL → `null`, no UI signal) | **P3** |
| 4 | Schema-drift blind spots (passthrough propagates; field-select masks) | **P2** (BE ✅) / **P4** (Brickset) |
| 5 | Modeled value frozen into synced records without an `asOf` write-guard | **Parked** |
| 6 | ✅ **CLOSED (P2)** — BE value-field shape now pinned (`beSetValueFields.contract.test.js`) | ~~P2~~ done |
| 7 | Dead code (`bricklink-priceguide.js:104-106` no-op block; self-clearing `blPriceHistory`) | **P3** (with #1) |
| 8 | `/api/brickeconomy-collection` is an **unconsumed proxy** — no client caller; the real collection store is CSV-normalized (`normalizeBrickEconomyCollection`). Either remove the dead endpoint or wire it; the CSV-column contract is out of network scope. | **P3** (decide remove vs wire) |

### Phases

- **P2 — Contract tests for the value-bearing sources** *(the lock; net-first)*. Capture real fixtures
  and pin shapes for: **BrickLink** API-session priceguide, **BE value fields** (`current_value_*`,
  `retail_price_us`), and **BE `/collection/sets`**. Generalizes the be-fixtures practice; expect it to
  expose today's unpinned drift. Closes gaps #1(test), #4(BE), #6.
  - **Status (2026-05-31): P2's delivered lock is the BE value-field contract.** **BE value fields ✅ done**
    — `beSetValueFields.contract.test.js` pins the consumed-field shape (44 assertions, green; no BE drift
    found). Two net-first findings reshaped the rest of P2: **(a)** `/collection/sets` has **no consumer** —
    the target rested on a false premise (the real normalizer is CSV-driven), reclassified to gap #8 (P3
    remove-vs-wire); **(b)** the **BrickLink contract test is blocked: gated on the BrickLink API
    connection; pin when connected.** BrickLink is a per-user-connected integration (an access token mints a
    ~50-min session) and is not connected in this env, so no real BL payload exists to capture — and we will
    **not** fabricate one (protocol #10 / §5: capture live, never hand-author). All BL-DATA-dependent work
    (this contract test, API-session validation, V4-as-value-source) stays gated on connecting BrickLink;
    the BL **proxy-code** cleanups need no data and proceed in P3. P2 is otherwise complete — it carries no
    open code item, only this connection-gated capture.
- **P3 — Resilience hardening.** (a) Add `AbortSignal.timeout(...)` to the 4 unguarded proxies, with a
  **by-construction lock**: an auto-discovery test (sibling to `api-auth.test.js`) asserting every proxy
  has a timeout **and** returns a typed error — so a new proxy that omits either fails CI. (b) A typed
  error surface so client failures are visible — **no silent `null`**. (c) Resolve the dead BL fallback
  — **decision: remove vs wire, lean REMOVE** — and clear the §9 #7 dead code. Closes gaps #2, #3, #7,
  #1(fallback).
  - **Console findings (recorded 2026-05-31; apply in S5/S6).** From a live browser-console pass:
    - **Brickset → typed envelope (S5).** Map upstream `404` → `kind:"not_found"`, `400` →
      `kind:"bad_request"` (both already in the §4 enum). No new shape needed.
    - **`not_found` renders QUIETLY (S6).** An expected Brickset `404` — gear/promo numbers like `5007428`
      that Brickset simply doesn't catalog — is **"no data," not an error**: no toast, no `console.error`.
      Only `timeout` / `upstream_error` / `rate_limited` surface a real failure signal (§4.2). This is the
      one place the typed-error surface must distinguish "absent" from "broke" by *kind*.
    - **Client-side number validation before the call (S6, new sub-item).** Skip identifiers Brickset
      can't serve *before* spending the request: the **L-prefixed IDs** (`L0002221`/`L0002232`/`L0002288`)
      are malformed → guaranteed `400`; never send them. The `5007xxx` cases are **valid-format but
      uncatalogued**, so they can't be pre-filtered — they are the quiet `not_found` case above.
  - **Non-issues (recorded so they aren't chased):** `contentscript.js`/`ObjectMultiplex` console noise is
    a **browser extension**, not app code; the manifest `timeout` warning + `apple-mobile-web-app-capable`
    deprecation are **PWA cosmetics**. Neither is in scope.
- **P4 — Brickset contract test.** Pin the `.asmx → data` field-select mapping. (Rebrickable is
  trivial/optional — a bundled CSV with no runtime drift.) Closes gap #4(Brickset).
- **Exit criterion (not a work phase).** Once BrickLink is fixture-pinned (P2) and its fallback is
  resolved (P3), the `valuation.md` V4 gating question is **answered by a test**, not narration. The V4
  build — wiring BrickLink sold prices into the value waterfall — is a **separate arc** (roadmap.md Arc 2).
- **Parked — gap #5 (`asOf`-guarded sync write).** Borders the already-audited sync layer; the rule is
  stated (§3) but **not enforced in this arc**.

---

## Relationship to other docs

This doc **supersedes** the loose "API fixtures / contract tests" bullet in
[`docs/roadmap.md`](roadmap.md) §Engineering-practices — that intent is now a concrete standard with a
phased lock here. It obeys protocol rule #8: it **points at** `_auth.js`, `api-auth.test.js`,
`BACKUP_KEYS`, and the be-fixtures README rather than copying them, so it can't drift from the code it
describes.
