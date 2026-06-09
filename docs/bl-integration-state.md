# BrickLink integration — state of the wiring (read-only align pass)

**Scope:** discovery only. How BrickLink (BL) is actually wired today, whether BL data flows into
displayed value, and what stands between today's role and BL-as-primary (the BrickEconomy-removal
precondition). No code changed; nothing proposed.

**Headline verdict:** **LIVE AND FLOWING for the portfolio value model** — but via a path most
summaries miss. There are **two separate BL mechanisms** in the repo, with different auth, caches,
and roles. The core portfolio value is fed by a **server-side batch → Redis → read-only proxy**
pipeline (no user token, always-on); a *second*, user-token-gated session proxy feeds only the
detail panels and wanted-list lookups. The stale comment in [`api/values.js:4-6`](../api/values.js#L4)
("nothing consumes it yet") is **wrong** — Step 2 shipped.

---

## The two BL paths (the thing to not conflate)

### Path A — VALUE MODEL pipeline (batch → Redis → `/api/values`). **This is BL-primary.**

```
scripts/refresh-values.mjs   (the VPS cron: OAuth1-signed, IP-bound BL creds)
  → api.bricklink.com  (6-mo SOLD price guide, new+used)
  → deriveValue ladder (scripts/lib/deriveValue.mjs — value-source-decision.md §3)
  → Upstash  value:SET:{n}  +  history:SET:{n}
        ⇣  (read, out-of-band — app never calls BL here)
api/values.js   (POST, Clerk auth + rate-limit, MGET value:SET:{n}, 12s timeout)
  → src/utils/valueCache.js   (fetchValues / peekValueCache; blValueCache; 24h device TTL)
  → src/utils/portfolio.js    (setValueProvenance / blOverlayValue / resolveCopies)
  → MyCollection portfolioValue / ROI / value-by-theme / TriValueCell  → DISPLAYED
```

- **Where BL is actually called:** only inside [`scripts/refresh-values.mjs`](../scripts/refresh-values.mjs)
  (OAuth 1.0a HMAC-SHA1, creds `BL_CONSUMER_KEY/SECRET`, `BL_TOKEN/SECRET` from `.env.local`,
  `oauth.authorize()`). The **app never calls BL** for value — it reads a pre-computed cache.
- **The "VPS":** this is where `refresh-values.mjs` runs. The OAuth1 BL creds are **IP-bound**
  (noted in `.env.example`), so the refresh job needs a fixed-IP host — that's the VPS. The repo
  holds the *script*; the host/cron schedule lives **outside this codebase** (cannot be confirmed
  from the repo alone — see STATE).
- **`/api/values`** ([`api/values.js`](../api/values.js)) is a pure Upstash `MGET value:SET:{n}`
  reader (raw REST via `fetchWithTimeout`, not `@upstash/redis`); Clerk-auth'd, 1000 req/60s
  rate-limited, returns `{ [set]: { new:{amount,basis,lots,asOf}|null, used:{…}|null } | null }`.
  No BL call, no secrets — it serves the cache the batch wrote.
- **Auth for this path:** end-user has **no BL credential**. The only BL secret is the batch's
  OAuth1 cred on the VPS. The app↔proxy hop is Clerk JWT (`apiFetch` Bearer).

### Path B — DETAIL/WATCH price-guide overlay (session token → `/api/bricklink-priceguide`). **Secondary, user-gated.**

```
AppSettings: user pastes a BrickStore "access token"  → localStorage blBrickLinkAccessToken
  → api/bricklink-auth.js   (exchanges token → sessionToken via account.prod.member.bricklink.info;
                             hardcoded CLIENT_ID; 50-min session TTL)
  → src/utils/bricklink-client.js  → api/bricklink-priceguide.js
        → api.bricklink.com store/v1 .../price  (x-bl-session-token + x-bl-tpa-client-id headers)
  → blPriceGuideCache  (6h single / 12h bulk TTL)
```

- **Consumers (call sites):** [`SetDetailPanel.jsx:42`](../src/SetDetailPanel.jsx#L42),
  [`WatchDetailPanel.jsx:21`](../src/WatchDetailPanel.jsx#L21),
  [`WantedList.jsx:1288`](../src/WantedList.jsx#L1288), and a manual **bulk sync** in
  [`AppSettings.jsx:1034`](../src/AppSettings.jsx#L1034) (`bulkSyncPrices`). `MyCollection.jsx:13`
  imports it (`hasBrickLinkAuth`/passthrough to the detail panel) but the **core value model does
  not use this path**.
- **Gated by `hasBrickLinkAuth()`** — does nothing until the user pastes a BrickStore token in
  Settings. So this path is **opt-in per-user** and feeds **detail panels + wanted-list rows only**,
  not portfolio headline value.

> **The reconciliation:** the portfolio value you see on MC Overview comes from **Path A** (always
> on, no token). The per-set "BrickLink price" in a detail panel / wanted row comes from **Path B**
> (only if the user authenticated). Two BL sources, two caches (`blValueCache` vs
> `blPriceGuideCache`), two auth models.

---

## 1. CLIENT — where BL calls originate

| Origin | File | Hits | Endpoint | Auth |
|---|---|---|---|---|
| Value cache read | [`src/utils/valueCache.js`](../src/utils/valueCache.js) (`fetchValues`) | `/api/values` (Vercel) | proxy → Upstash MGET | Clerk JWT (apiFetch) |
| Detail/watch price | [`src/utils/bricklink-client.js`](../src/utils/bricklink-client.js):124 | `/api/bricklink-priceguide` | proxy → `api.bricklink.com` | `x-bl-session-token` |
| Session exchange | `bricklink-client.js`:74 | `/api/bricklink-auth` | proxy → `account.prod.member.bricklink.info` | BrickStore access token (user) |
| **Value batch (NOT the app)** | [`scripts/refresh-values.mjs`](../scripts/refresh-values.mjs) | `api.bricklink.com` **direct** | OAuth1 HMAC-SHA1 | `BL_*` env creds |

- **No `VITE_BL_*` client env vars.** The app never holds a BL credential. The only BL secrets are
  the batch's `BL_CONSUMER_KEY/SECRET` + `BL_TOKEN/SECRET` (present in `.env.local`, names mirrored
  in `.env.example`), used **only by the VPS batch**.
- **Hardcoded** `CLIENT_ID = "ca629c09-…"` (a TPA client id, not a secret) in
  [`api/bricklink-auth.js`](../api/bricklink-auth.js) + [`api/bricklink-priceguide.js`](../api/bricklink-priceguide.js).
- **CSP** ([`vercel.json`](../vercel.json)) `connect-src 'self' + Clerk` only — correct, because the
  client never connects to BL directly; all BL egress is server-side (the two `/api/bricklink-*`
  proxies and the off-box batch).

## 2. The VPS / proxy

- **In-repo proxies:** `api/values.js` (Redis reader), `api/bricklink-auth.js` (session exchange),
  `api/bricklink-priceguide.js` (price proxy). These are **Vercel serverless functions**, not a VPS.
- **The actual "VPS"** = the host running `scripts/refresh-values.mjs` on a schedule (needs a fixed
  IP for the IP-bound OAuth1 creds). **No cron/host config exists in the repo** — the schedule and
  box live outside this codebase. The repo proves the *script* exists and is "PRODUCTION tooling
  (maintained)" ([`refresh-values.mjs:1`](../scripts/refresh-values.mjs#L1)); it cannot prove the
  cron is currently firing.

## 3. Data + cache

- **Path A data:** BL **6-month SOLD** price guide, new+used, run through the value ladder
  (sold ≥10 lots → modeled 0.75×new → sold_thin 1–9 → stock/asking → MSRP → unknown). Stored as
  `value:SET:{n}` (authoritative) + `history:SET:{n}` (trend list, LTRIM ~520). Record shape:
  `{ amount, source:"BrickLink", condition, basis, asOf, lots }`.
- **`blValueCache`** ([`valueCache.js`](../src/utils/valueCache.js)): device-local, **24h TTL**,
  `createEntryCache` factory; NOT in `BACKUP_KEYS` (regeneratable, non-syncing). Server (Redis)
  refreshes ~weekly via the batch.
- **`blPriceGuideCache`** (Path B): **6h single / 12h bulk TTL**, ts field `cachedAt`
  (per [`enrichmentCache.js:15`](../src/utils/enrichmentCache.js#L15)).
- **Rate-limit reality:** handled by (a) the polite `THROTTLE_MS=300` between BL calls in the batch,
  (b) the weekly server refresh cadence + 24h device cache, and (c) the `/api/values` 1000/60s
  per-user limit. Path B adds its own 50-min session TTL + 6/12h caches.

## 4. Flow into value

- **`setValueProvenance(s, valueMap)`** ([`portfolio.js`](../src/utils/portfolio.js)): **BL preferred,
  BE fallback.** If `valueMap[setNumber]` has a condition-matched amount (`blOverlayValue` →
  `resolveCopies`, per-copy new→`.new`/used→`.used`), it returns `source: "bricklink"`. Otherwise it
  falls back to `toValue(rawSetValue(s), …)` with `source: "brickeconomy"`.
- **BL's current role vs BE:** BL is the **primary overlay** for displayed portfolio value; **BE is
  demoted to fallback** (cache-miss, deferred CMF, or `unknown` basis), non-destructive (BE fields
  never overwritten). Confirmed consumed in `MyCollection` `stats` (`portfolioValue`/`ROI`/
  `knownValueCount`), `themeChartData`, and per-row `TriValueCell market={setValueProvenance(...)}`.
- **Is displayed value sourced from BL today? YES.** `docs/valuation.md` records a real run
  (`asOf 2026-06-02`, 600 sets): **BE $31,206 → BL $26,228.52 (−16%)**, 461 sets BL-covered,
  139 CMF → BE-fallback, 8.1% estimated. Characterization test
  (`enrichmentCache.characterization.test.js`) pins `portfolioValue === 1050` via the `blValueCache`
  overlay; `valueCache.contract.test.js` locks the `/api/values` shape.

## 5. State — is it flowing?

**Flowing (value model).** Evidence in-repo: shipped consumer wiring (Path A end-to-end), passing
characterization + contract tests, and live numbers dated 2026-06-02 in `valuation.md`/
`value-source-decision.md` (both marked ✅ SHIPPED). No feature flag, stub, early-return gate, or
commented-out value code disables Path A.

**Caveats / dead-ish bits:**
- **Stale/misleading comment** — [`api/values.js:4-6`](../api/values.js#L4) still says "nothing in
  the funnel/display consumes it yet (that is Step 2)." Step 2 shipped; the comment is dead doc.
- **Operational unknown (outside repo):** Path A's freshness depends on the **VPS cron actually
  running**. The repo can't confirm the last successful run; if the cron stalls, the app keeps
  serving the last Redis values (then 24h-stale device cache) with no in-app live-BL backstop.
- **`docs/data-sources.md` referenced in the task does not exist** (only `valuation.md`,
  `value-source-decision.md`, `value-layer-plan.md`, `financial-values-discovery.md`). The BL spec
  lives in `valuation.md` (what-the-code-does) + `value-source-decision.md` (why-BL).
- **Path B is fully wired but inert until a user pastes a BrickStore token** — not dead code, but
  no-op for users who haven't authenticated.

## 6. Gap to BL-primary (the BE-removal precondition)

BL is *already* primary for displayed value; BE removal is blocked by the **fallback dependencies**,
not by missing wiring:

1. **CMF / minifig coverage** — 139 CMF/promo sets currently resolve via **BE fallback**
   (`valuation.md` "CMF Phase 2" deferred). Remove BE and these go to `unknown`.
2. **Brickset MSRP rung 5** — brand-new / no-sold sets (ladder rung 5) not yet wired; they stay
   `unknown` without BE's number.
3. **Trend / history source** — BE `price_events` still backs the portfolio history chart; there is
   **no BL equivalent wired** into the app yet (the batch writes `history:SET:{n}`, but the chart
   reads BE). Open decision in `valuation.md`.
4. **BE is the literal fallback branch** in `setValueProvenance` — removing it means auditing every
   cache-miss/`unknown`-basis path so nothing that currently shows a number regresses to "—".
5. **Operational hardening** — BL-primary leans on an out-of-repo VPS cron with IP-bound creds and
   no in-app live fallback; making BE-removal safe implies monitoring/staleness handling for that
   job (none visible in-repo).
6. **(Consistency, not a hard blocker)** — detail panels/wanted use Path B (session token), the
   portfolio uses Path A (batch). Two BL sources can disagree; unifying them is worth noting before
   declaring BL the single source of truth.

---

### One-line verdict

**Live-and-flowing** (value model, via batch→Redis→`/api/values`, BL-preferred/BE-fallback,
non-destructive overlay) — *not* stubbed or pending-access. The remaining work for **BL-primary /
BE-removal** is closing the **fallback-coverage gaps** (CMF, MSRP rung, trend source) and the
**operational dependency on the off-repo VPS cron**, not any unbuilt integration.
