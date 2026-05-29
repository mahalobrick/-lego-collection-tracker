# BrickLedger — Security Audit

- **Date:** 2026-05-28
- **Commit:** `8ae56e38ee3a452c84c4994d3f8c5d216827f10c` (`8ae56e3`)
- **Branch:** `main` (clean working tree, no uncommitted changes)
- **Scope:** This repository only (`/Users/S/lego-app`). The sibling `brick-finder` project referenced in `.claude/launch.json` is **out of scope**. Target environment: production deploy at `lego-app-rust.vercel.app`.
- **Method:** Inline grounding (git history, `npm audit`, dependency/postinstall inventory, secret scan) followed by a 6-agent adversarial review across all 19 categories, with independent verification of every Critical/High finding. All findings are anchored to real file:line at the commit above.

---

## 1. Executive Summary

**Overall security posture: ACCEPTABLE** — with one High-severity issue to fix before any wider/public sharing.

For a vibe-coded app this is in notably good shape on the fundamentals that usually go wrong: **no committed secrets** (verified across full git history), **authorization on the sync endpoint is correct** (IDOR-closed — the storage key is derived from the verified Clerk token, never from client input), **no client-side XSS sinks**, a **safe CORS allow-list**, and a **clean dependency tree** (the two `npm audit` moderates are not reachable in this app). The serious problems are concentrated in one place: a row of **API proxy endpoints that were never put behind auth**.

### Top 3 — fix this week
1. 🔴 **`APISEC-1` — Unauthenticated API proxies spend the owner's API keys.** Anyone who reads the public repo can hit `/api/brickset-set`, `/api/brickeconomy-set`, `/api/brickfanatics-retiring`, etc. directly (no browser, so CORS is irrelevant) and burn your metered BrickEconomy/Brickset quotas and ScraperAPI credits, and use your deployment as a free anonymizing scraping proxy. **This is the one finding that materially matters.**
2. 🟡 **`BIZLOGIC-1` — Shared-browser data leak on sign-in.** If user A's data is still in localStorage and user B signs in to an empty cloud account on the same browser, A's collection/spending is pushed up into B's account. A real confidentiality + integrity bug, and a regression in the Phase 4 reconciliation logic.
3. 🟡 **`HEADERS-1` — No security response headers** (no CSP, `X-Frame-Options`, HSTS, `nosniff`). Clickjacking is the concrete risk; everything else is defense-in-depth.

### Top 5 high-priority overall
`APISEC-1` (High) · `BIZLOGIC-1` (Med) · `HEADERS-1` (Med) · `AUTH-1` (Med, `verifyToken` missing `authorizedParties`) · `APISEC-2` (Low, fail-open rate limiter — bundled with the APISEC-1 fix).

### Finding counts
| Severity | Count |
|---|---|
| 🚨 Critical | 0 |
| 🔴 High | 1 |
| 🟡 Medium | 3 |
| 🟢 Low | 8 |
| ℹ️ Info | 11 |
| **Total** | **23** |

### Estimated remediation effort
**Phase 0 + 1 (the real work): ~half a day.** The dominant task is wiring the shared Clerk `authenticate()` helper into ~8 proxy handlers and updating their client call sites (`APISEC-1`). Everything else in Phases 0–2 is trivial-to-moderate. Medium/Low/Info cleanup is a few more hours, mostly optional.

---

## 2. Reconnaissance Artifacts

### 2a. Codebase Map (one page)

- **Type:** Single-page React app + serverless API, deployed on Vercel.
- **Client:** React 19 + Vite 8 SPA. Entry `src/main.jsx` (wraps app in `ClerkProvider`; monkey-patches `localStorage.setItem` to emit a `brickledger:datachange` event). Main orchestration in `src/App.jsx` (cloud-sync reconciliation, auto-push, sign-out wipe). Feature surfaces: `MyCollection.jsx`, `WantedList.jsx`, `BudgetDashboard.jsx`, `AppSettings.jsx`. Charts via `recharts`; CSV via `papaparse`; XLSX via `exceljs`; fuzzy search via `fuse.js`; toasts via `react-hot-toast`.
- **Server (`/api/*.js`, Vercel functions, CommonJS):**
  - `sync.js` — the only authenticated endpoint. Clerk JWT → per-user Redis JSON at `brickledger:user:{userId}`. Has a per-user rate limiter.
  - `_cors.js` — shared CORS + `internalError()` helper.
  - **Proxy endpoints** (spend owner API keys): `brickeconomy-collection.js`, `brickeconomy-set.js`, `brickset-search.js`, `brickset-set.js`, `brickset-themes.js`, `bricklink-auth.js`, `bricklink-priceguide.js`, `brickfanatics-retiring.js` (ScraperAPI), `lego-last-chance.js`.
- **Auth model:** Clerk (`@clerk/react` client, `@clerk/backend` `verifyToken` server-side). Session JWT sent as `Authorization: Bearer` to `/api/sync`. No cookies-based session in app code (Clerk-managed).
- **Data model:** Primary store is **browser `localStorage`** (keys `bl*` / `brickEconomy*`): owned sets, wanted list, purchases, budget, settings. Cloud mirror is a single JSON blob per user in Upstash Redis (`brickledger:user:{userId}`), accessed via REST.
- **External integrations:** Clerk (auth), Upstash Redis (sync), BrickEconomy / Brickset / BrickLink / ScraperAPI / Brick Fanatics / lego.com (data, via server proxies).
- **Deployment surface in code:** `vercel.json` (build config + SPA rewrites; **no headers, no auth**), `vite.config.js` (local dev API middleware mirroring the Vercel functions). No `Dockerfile`, no `middleware.js`, no CI config in repo.

### 2b. Trust Boundary Diagram (text)

```
                          UNTRUSTED                          |            TRUSTED (server-side secrets)
                                                             |
[ Browser / attacker curl ] --(1)--> /api/sync ─────────────●  Clerk verifyToken  ──> Upstash Redis (per-user key)
        |                                                    |        ✓ boundary enforced (Bearer JWT)
        |                                                    |
        +------------(2)--> /api/brickset-* ────────────────○  process.env.BRICKSET_API_KEY  ──> brickset.com
        +------------(2)--> /api/brickeconomy-* ────────────○  process.env.BRICKECONOMY_API_KEY ──> brickeconomy.com
        +------------(2)--> /api/brickfanatics-retiring ────○  process.env.SCRAPERAPI_KEY ──> api.scraperapi.com ──> brickfanatics
        +------------(2)--> /api/lego-last-chance ──────────○  (no key) ──> lego.com
                                                             |
[ localStorage (per-device) ] <--(3)--> React app (no boundary; fully attacker-readable on a shared device)

● = trust boundary correctly enforced (auth checked)
○ = trust boundary NOT enforced — untrusted input crosses straight to a secret-bearing upstream call  ← APISEC-1
(1) authenticated, IDOR-safe.   (2) UNAUTHENTICATED — the core problem.   (3) shared-device exposure → BIZLOGIC-1/2.
```

**Where untrusted data enters:** every `/api` route (query/body/headers), every file import (CSV/XML/XLSX parsed in-browser), and `localStorage` on a shared device. **Where it crosses to trusted:** only `/api/sync` enforces the crossing; the proxy routes do not.

### 2c. Attack Surface Summary (every externally reachable entry point)

| Entry point | Auth? | Rate-limited? | Spends a secret? | Notes |
|---|---|---|---|---|
| `POST/GET /api/sync` | ✅ Clerk JWT | ✅ 60/60s/user (fail-open) | KV token | IDOR-safe |
| `GET /api/brickeconomy-collection` | ❌ | ❌ | `BRICKECONOMY_API_KEY` | APISEC-1 |
| `GET /api/brickeconomy-set` | ❌ | ❌ | `BRICKECONOMY_API_KEY` | APISEC-1 |
| `GET /api/brickset-search` | ❌ | ❌ | `BRICKSET_API_KEY` | APISEC-1 |
| `GET /api/brickset-set` | ❌ | ❌ | `BRICKSET_API_KEY` | APISEC-1 |
| `GET /api/brickset-themes` | ❌ | ❌ | `BRICKSET_API_KEY` | APISEC-1 |
| `GET /api/brickfanatics-retiring` | ❌ | ❌ | `SCRAPERAPI_KEY` (5 credits/call) | APISEC-1, worst $ impact |
| `GET /api/lego-last-chance` | ❌ | ❌ | none (proxy to lego.com) | APISEC-1 (proxy abuse) |
| `GET /api/bricklink-priceguide` | ⚠️ requires `x-bl-session-token` | ❌ | user-supplied token | Not a bare-secret spend |
| `POST /api/bricklink-auth` | ❌ | ❌ | token exchange | leaks response shape (APISEC-3) |
| File imports (CSV/XML/XLSX) | n/a (client-only) | — | — | No server upload; FILEUPLOAD-1 |
| Google Fonts `@import`, Clerk CDN | n/a | — | — | TPR-1 / TPR-2 |

---

## 3. Findings by Category

> Format: **ID — Title** · Severity · Confidence · Effort. Evidence is quoted to file:line. Exploit scenarios given for High/Medium.

### Category 1 — Secrets & Credentials

**SECRET-1 — No committed secrets anywhere in repo or git history (verified)** · ℹ️ Info · Confirmed · trivial
`git log --all` + per-blob grep across all revisions for `sk_`/`pk_`/`AKIA`/`BEGIN PRIVATE KEY` and assigned secret values returned **zero** hits. Only tracked env file is `.env.example` (placeholders). `.env.local` (on disk) is git-ignored and untracked. `.gitignore` covers `.env*`, `.claude/`, `.vercel/`, `*.csv`, `collection.json`. **No action needed.**

**SECRET-2 — Server secrets read only from `process.env`; errors don't leak key material** · ℹ️ Info · Confirmed · trivial
All keys via `process.env` only. `internalError()` (`api/_cors.js:45-52`) logs server-side but returns only `{error:"Internal server error"}`. No `process.env` logged anywhere. *Minor note:* `brickfanatics-retiring.js:166` builds the ScraperAPI URL on `http://` — switch to `https` if the vendor supports it so the key doesn't transit cleartext.

**SECRET-3 — Stale `x-backup-secret` header in CORS allow-list** · 🟢 Low · Confirmed · trivial
`api/_cors.js:39` advertises `x-backup-secret` in `Access-Control-Allow-Headers`, but no consumer exists (leftover from the deleted `cloud-backup.js`). Misleading; could invite reintroduction of a shared-secret path. **Fix:** remove `x-backup-secret` (and `Authorization` if no route consumes it — verify the Clerk JWT path).

### Category 2 — Authentication

**AUTH-1 — `verifyToken` called without `authorizedParties`/audience** · 🟡 Medium · Likely · trivial
`api/sync.js:73-80` calls `verifyToken(token, { secretKey })` with no `authorizedParties`. Clerk validates signature/expiry but does **not** enforce the `azp` (authorized-party) claim without it — so any session JWT minted by the *same Clerk instance* (e.g. another app sharing the instance, or a token from a different origin) verifies as a valid BrickLedger user.
**Exploit:** if the Clerk instance is ever shared across apps, or an attacker obtains a session token via a different Clerk-frontend origin on the same instance, that token authenticates to `/api/sync` and reads/writes that `sub`'s cloud backup. Low likelihood on a single-app hobby deploy → Medium.
**Fix:** pass `authorizedParties: [process.env.APP_ORIGIN, ...DEV_ORIGINS]` to `verifyToken`. Trivial.

### Category 3 — Authorization

**AUTHZ-1 — sync.js storage key derived from the verified token, not client input (no IDOR)** · ℹ️ Info · Confirmed · trivial
`authenticate()` returns `payload.sub` from `verifyToken()` (`api/sync.js:74-77`); the Redis key is built solely from that (`brickledger:user:${userId}`, line 105). Neither GET nor POST reads any id from `req.query`/`req.body`/headers. **User A cannot read or write user B's data.** This is the correct pattern — the #1 vibe-coded failure mode is *absent* here. ✓

### Category 4 — Input Validation & Injection

No injectable sinks were confirmed. Proxy URL construction uses `String(req.query.x || "")` with `encodeURIComponent` before interpolation, and outbound hosts are hard-coded (no user-controlled host → no SSRF-to-arbitrary-host). The one real concern in this area is *access*, not *injection* — covered by APISEC-1. XML imports were checked for XXE: browser `DOMParser` does not resolve external entities, so XXE does not apply. No prototype-pollution deep-merge of parsed input was found. **Category essentially clean.**

### Category 5 — Cross-Site Scripting (XSS)

Clean. No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, or `document.write` in `src/`. React's default escaping covers user/imported content. No `javascript:`-scheme anchor sinks were confirmed reachable from imported data. (A CSP would still be valuable as defense-in-depth — see HEADERS-1.)

### Category 6 — CSRF / CORS

**CORS-1 — CORS allow-list is safe** · ℹ️ Info · Confirmed · trivial
`api/_cors.js:13-43` reflects the request Origin **only if** it's in `ALLOWED_ORIGINS` (`APP_ORIGIN` + fixed localhost), sets `Vary: Origin`, never emits `Access-Control-Allow-Origin: *`, never sets `Allow-Credentials`, and uses no substring/regex origin match. Bearer-token auth (not cookies) means classic CSRF doesn't apply. ✓ **Caveat:** CORS is *not* access control — it does not stop curl/server-to-server abuse of the unauthenticated proxies (APISEC-1).

### Category 7 — API Security

**APISEC-1 — Unauthenticated proxy endpoints let anyone spend the owner's API keys** · 🔴 **High** · Confirmed (verified) · moderate
*Files:* `brickeconomy-collection.js`, `brickeconomy-set.js`, `brickset-search.js`, `brickset-set.js`, `brickset-themes.js`, `brickfanatics-retiring.js`, `lego-last-chance.js`, `bricklink-auth.js` (and `bricklink-priceguide.js` partially — see correction).
*Evidence:* None of these handlers call `authenticate()` (only `sync.js` does). They go straight from `setCors()` to a `fetch()` carrying the owner's secret key — e.g. `brickeconomy-collection.js:19` (`x-apikey: BRICKECONOMY_API_KEY`), `brickset-search.js:27` (`apiKey=${BRICKSET_API_KEY}`), `brickfanatics-retiring.js:167` (`SCRAPERAPI_KEY`, 5 credits/JS-render, 1000/mo free tier). There is **no `middleware.js`**, **no auth in `vercel.json`**, and **no rate limiter** on any of them. CORS is irrelevant — it only restricts *browser* reads, not the server-side fetch; a curl with no Origin runs the full handler.
*Exploit:* An attacker reads the public repo, learns the routes, and loops `GET https://lego-app-rust.vercel.app/api/brickfanatics-retiring` — each call burns 5 ScraperAPI credits, so ~200 requests exhaust the monthly free tier and break the feature for real users. Against `/api/brickeconomy-set` and `/api/brickset-search` they burn your metered BrickEconomy/Brickset quotas (possible billing) and use your deployment as a free anonymizing scraper against lego.com/bricklink — your Vercel IP and keys take the blame. CDN `s-maxage` is not a defense: varying `?number=`/`?q=` busts the cache and forces origin fetches.
*Verification scope correction:* `bricklink-priceguide.js:25-31` **requires** an `x-bl-session-token` header (returns 401 without it), so it does not spend a *server-held* secret on a bare request. The "spends the owner's key" claim is precise for the **BrickEconomy / Brickset / ScraperAPI / lego.com** endpoints (≥5 routes); BrickLink routes are proxy-abuse-only.
*Fix:* Extract `authenticate()` into a shared helper; at the top of every proxy handler: `const userId = await authenticate(req); if (!userId) return res.status(401).json({error:'unauthorized'});`. Then apply the per-user rate limiter to the proxies too. Update client call sites to send the Clerk Bearer token (the pattern already exists in `src/utils/exportBackup.js` `pushToCloudAuth`).

**APISEC-2 — Rate limiter is fail-open and easily out-scaled; only protects sync.js** · 🟢 Low · Confirmed · moderate
`api/sync.js:40-52` does a non-atomic `INCR` then a separate `EXPIRE` only when `count===1`, wrapped in a try/catch that **swallows errors and proceeds** ("fail-open"). If Upstash is slow/down or creds are wrong, the limit silently disables. Also: if the first `INCR` succeeds but `EXPIRE` fails, the key never expires and the user is **permanently throttled**. And it does nothing for the unauthenticated proxies. **Fix:** atomic pipeline/Lua (or `@upstash/ratelimit`); decide fail-open vs fail-closed deliberately (prefer fail-closed + metric for an abuse control); extend to the proxies once authenticated.

**APISEC-3 — Verbose/introspective error responses leak upstream internals to anonymous callers** · 🟢 Low · Confirmed · trivial
`bricklink-auth.js:73-76` returns `keys: Object.keys(data)`; several handlers return `preview: text.slice(0,300)` of the upstream body (`brickeconomy-collection.js:45`, `brickeconomy-set.js:55`, `brickset-search.js:37`, `brickset-set.js:56`); `brickfanatics-retiring.js:180-182` returns upstream status. Because these are unauthenticated, an attacker can distinguish `401` (key invalid) vs `429` (key valid, quota hit) to fingerprint your key state. **Fix:** drop `keys`/`preview` or gate behind a debug flag; return generic `502`. (Resolves alongside APISEC-1.)

**APISEC-4 — `BF_DEBUG` raw-HTML endpoint is double-gated and safe** · ℹ️ Info · Confirmed · trivial
`brickfanatics-retiring.js:187-191` requires **both** `process.env.BF_DEBUG==='1'` **and** `?debug=1`. Unreachable in prod with `BF_DEBUG` unset; returns only public article HTML. Just ensure `BF_DEBUG` is never set in production.

### Category 8 — Data Exposure

**DATAEXP-1 — API error responses echo raw upstream bodies / response key names** · 🟢 Low · Confirmed · trivial
Same `preview`/`keys` exposure as APISEC-3, viewed as data exposure: `bricklink-auth.js:60,75` and the `preview` fields leak third-party API response shapes/partial payloads to any caller. **No owner secret keys are ever echoed** (the `internalError()` helper suppresses `err.message`). **Fix:** drop `preview`/`keys` or gate to non-production.

*(No source maps in prod — Vite's default `build.sourcemap` is off. No `/.git` exposure on a static Vercel deploy. `/api/sync` GET returns only the caller's own data.)*

### Category 9 — Cryptography

Clean. The former AES-GCM/PBKDF2 passphrase crypto was fully removed in Phase 7 (verified — no `crypto.subtle`/`deriveKey`/`encryptPayload` remain). The only non-crypto randomness is the wanted-list id (`wl_<timestamp>_<short random>`), used as a local React/list key — **not security-relevant**. No hand-rolled crypto, no weak algorithms, no hardcoded IVs.

### Category 10 — Dependencies & Supply Chain

**DEP-1 — `ioredis` is a dead dependency (zero references)** · 🟢 Low · Confirmed · trivial
`package.json:14` declares `ioredis ^5.11.0`; **zero** importers in `src/`+`api/` (its only consumer, the deleted `cloud-backup.js`, is gone; sync uses Upstash REST). Pulls ~8 transitive packages for nothing. **Fix:** `npm uninstall ioredis`.

**DEP-2 — `exceljs → uuid` "Missing buffer bounds check" moderate is NOT exploitable here** · ℹ️ Info · Confirmed · trivial
The CVE affects `uuid` v3/v5/v6 **only when a caller passes a user-controlled `buf` output arg**. `exceljs`'s only `uuid` use is `uuidv4()` with **no arguments** (write path, conditional-formatting GUIDs). This app uses `exceljs` for **read** only (`importBudgetExcel.js`), which never reaches that path. **Unreachable.** Optional: `overrides` to silence `npm audit`.

**DEP-3 — Direct deps all well-known and pinned via committed lockfile** · ℹ️ Info · Confirmed · trivial
`package-lock.json` committed & consistent (lockfileVersion 3, 217 pkgs, 0 missing-integrity, all `resolved` → `registry.npmjs.org`). All 10 prod deps high-traffic/well-maintained, no typosquats. Only install scripts: `@clerk/shared` (benign) + `fsevents` (standard macOS optional). A `node_modules` grep for `.ssh`/`.aws/credentials`/`.npmrc`/`GITHUB_TOKEN`/`NPM_TOKEN`/`GH_TOKEN` found only Vite reading `.npmrc` (legit, dev-time). **No dependency reads SSH/AWS creds or token env vars.**

### Category 11 — File Upload

**FILEUPLOAD-1 — Client-side imports only; parsers lack size/row bounds but write only to local `localStorage`** · ℹ️ Info · Confirmed · trivial
No server upload endpoint exists. Imports read `file.text()`/`file.arrayBuffer()` in-browser → `localStorage`. No max size/row cap in `parseExcelFirstSheet`, but a pathological file can only OOM/hang the **user's own** tab (self-DoS). Filenames never build a path. No traversal, no server write, no cross-user exposure. Optional: cap `file.size` before parsing.

### Category 12 — Headers & Transport

**HEADERS-1 — No security response headers configured** · 🟡 Medium · Confirmed · moderate
`vercel.json` has **no `headers` block** (verified across `vercel.json`, `vite.config.js`, `api/`). Missing: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`, `Strict-Transport-Security`, `Referrer-Policy`.
**Exploit:** (1) **Clickjacking** — with no frame-ancestors, `lego-app-rust.vercel.app` can be iframed; a Clerk-logged-in user could be UI-redressed into destructive actions (overwrite/import cloud backup, delete data). (2) No CSP means any future HTML-injection bug escalates straight to script exec. (3) No HSTS → first-visit downgrade not app-pinned (Vercel does redirect to HTTPS, but the browser isn't pinned).
**Fix:** add a `headers` array to `vercel.json` for all routes: a `Content-Security-Policy` (allow Clerk + Brickset/BrickEconomy image/API origins + Google Fonts; `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `Referrer-Policy: strict-origin-when-cross-origin`. Ship CSP as `report-only` first to avoid breaking Clerk, then enforce.

### Category 13 — Logging & Monitoring

**LOGGING-1 — No sensitive data logged; server errors logged server-side only** · ℹ️ Info · Confirmed · trivial
No `console` statement logs tokens, keys, JWTs, or PII. `internalError()` logs the full error to Vercel logs but returns a generic message. `authenticate()` swallows `verifyToken` failures without logging the token. Client logs HTTP status/generic strings, never token values. ✓

### Category 14 — Business Logic Flaws

**BIZLOGIC-1 — Sign-in on a shared browser can push the previous user's local data into the new user's empty cloud account** · 🟡 Medium · Confirmed · moderate
`reconcileOnSignIn()` (`src/App.jsx:85-107`) computes `summarizeLocal()` from `localStorage` **without first checking the data belongs to the signed-in user.** The cross-user guard (line ~93) only removes `blLastPushHash` — it does **not** clear the actual collection/wanted/purchase data. In the "cloud empty" branch, if `hasLocal` it immediately `pushToCloudAuth()` and sets `blSyncedUserId = userId`.
**Exploit:** On a shared/library computer, victim A builds a collection, then leaves (tab closed, or Clerk session ends without the deferred sign-out-wipe reload firing). Attacker B opens the app and signs into their own empty account. Reconcile sees *cloud empty + local data present* and pushes **A's full collection/wanted-list/purchase history into B's cloud key** — B now permanently holds A's private data on every device B signs into.
**Fix:** before trusting local data on sign-in, verify ownership. If `blSyncedUserId` exists and `!== userId`, treat local data as foreign: **do not push it** — `clearLocalUserData()` (or route to the conflict dialog) first. Only auto-push in the cloud-empty branch when `sameUser`, or when there was no prior signed-in user.

**BIZLOGIC-2 — Sign-out wipe is reload-deferred and can be raced by an in-flight push** · 🟢 Low · Likely · moderate
The shared-browser wipe only runs on a *subsequent* load (`isLoaded && !userId && blSyncedUserId`, `src/App.jsx:65-76`), not synchronously at sign-out. Between Clerk session end and the next reconcile/reload, the prior user's data sits unwiped in `localStorage` (readable via devtools), and a pending debounced/interval push could still fire. **Fix:** wipe synchronously on the sign-out / session-ended event (watch `userId` transition set→null, or a Clerk callback), call `clearLocalUserData()` immediately, and cancel any in-flight push (generation ref).

### Category 15 — Third-Party & Supply Chain (Runtime)

**TPR-1 — Google Fonts via runtime CSS `@import`, no SRI/preconnect** · 🟢 Low · Confirmed · moderate
`src/App.jsx:264` injects `@import url('https://fonts.googleapis.com/...')`. CSS `@import` can't carry SRI; a compromised font CDN could affect styling/privacy (Google sees each user's IP/UA) but **cannot execute JS**. **Fix (low priority):** self-host the woff2 files via local `@font-face`, or constrain `style-src`/`font-src` via CSP.

**TPR-2 — Clerk loads `clerk-js` from Clerk's CDN at runtime** · ℹ️ Info · Confirmed · trivial
`@clerk/react` injects the clerk-js bundle from Clerk's Frontend API at runtime (URL derived from the public publishable key); no author-controlled SRI is possible. This is the documented Clerk model and an accepted trust anchor (a Clerk CDN compromise would have full DOM/JS access in the auth context). If you add a CSP, whitelist Clerk's domains so auth keeps working.

### Category 16 — AI-Specific Tells

Clean. No `TODO: add auth` on live endpoints, no email-equality backdoors, no try/catch that swallows a security *decision* (the `authenticate()` catch correctly returns `null` = deny), no client-only validation masquerading as a server control. The one genuine AI-tell pattern is the *missing* auth on the proxies (APISEC-1) — copy-pasted handler scaffolding that never had the `authenticate()` line that `sync.js` got.

### Category 17 — Mobile / Native — **N/A**
No native/mobile code. (A mobile *responsive* pass is on the product backlog, but there is no native attack surface.)

### Category 18 — AI / LLM-Specific Risks — **N/A**
No LLM/prompt usage in the application.

### Category 19 — Developer Environment Hygiene

**DEVENV-1 — Only postinstall is `@clerk/shared` telemetry notice (benign, no secret access)** · ℹ️ Info · Confirmed · trivial
Exactly one `postinstall` in the whole tree; zero `preinstall`/`install`. It prints a telemetry notice and writes a version-marker under the OS config dir — reads only path env vars, no project secrets. npm 7+ blocks transitive install scripts by default. Optional: `npm ci --ignore-scripts` in CI.

**DEVENV-2 — (same as DEP-1) `ioredis` dead dependency** · 🟢 Low · Confirmed · trivial — see DEP-1.

---

## 4. Remediation Plan

### 4a. Risk-Ranked Master List

| ID | Category | Finding | Sev | Conf | Effort | Blocks? |
|---|---|---|---|---|---|---|
| APISEC-1 | API Security | Unauthenticated proxies spend owner keys | 🔴 High | Confirmed | moderate | enables APISEC-2/3, DATAEXP-1 fixes |
| AUTH-1 | Auth | `verifyToken` missing `authorizedParties` | 🟡 Med | Likely | trivial | — |
| BIZLOGIC-1 | Logic | Shared-browser sign-in pushes prior user's data | 🟡 Med | Confirmed | moderate | — |
| HEADERS-1 | Headers | No CSP/XFO/HSTS/nosniff | 🟡 Med | Confirmed | moderate | — |
| APISEC-2 | API Security | Fail-open rate limiter, sync-only | 🟢 Low | Confirmed | moderate | pairs with APISEC-1 |
| APISEC-3 | API Security | Verbose error introspection | 🟢 Low | Confirmed | trivial | after APISEC-1 |
| DATAEXP-1 | Data Exposure | Echoes upstream body/keys | 🟢 Low | Confirmed | trivial | after APISEC-1 |
| BIZLOGIC-2 | Logic | Reload-deferred sign-out wipe race | 🟢 Low | Likely | moderate | — |
| SECRET-3 | Secrets | Stale `x-backup-secret` CORS header | 🟢 Low | Confirmed | trivial | — |
| DEP-1/DEVENV-2 | Deps | `ioredis` dead dep | 🟢 Low | Confirmed | trivial | — |
| TPR-1 | 3rd-party | Google Fonts no SRI | 🟢 Low | Confirmed | moderate | — |
| SECRET-1, SECRET-2, AUTHZ-1, CORS-1, APISEC-4, DEP-2, DEP-3, FILEUPLOAD-1, LOGGING-1, DEVENV-1, TPR-2 | various | Confirmed-clean / no-action | ℹ️ Info | Confirmed | trivial | — |

### 4b. Fix Phases

**Phase 0 — Stop the bleeding (today)**
- **APISEC-1** — gate all proxy endpoints behind Clerk auth. This is the only finding that is actively exploitable against a live, shared URL. ~2–4h including client call-site updates. No other finding blocks this; several resolve alongside it.

**Phase 1 — High-severity / this week**
- **BIZLOGIC-1** — ownership check before auto-push on sign-in (~1h). Independent of Phase 0.
- **AUTH-1** — add `authorizedParties` to `verifyToken` (~10 min).
- **HEADERS-1** — add the `vercel.json` headers block; ship CSP report-only first (~1–2h incl. Clerk CSP tuning).

**Phase 2 — Structural foundations (1–2 weeks)**
- **APISEC-2** — replace the rate limiter with an atomic, deliberately fail-closed implementation and apply it to the now-authenticated proxies. Depends on Phase 0.
- **BIZLOGIC-2** — synchronous sign-out wipe + cancel in-flight pushes.

**Phase 3 — Medium (next month)**
- APISEC-3 + DATAEXP-1 (drop `preview`/`keys`), SECRET-3 (CORS cleanup), DEP-1 (`npm uninstall ioredis`).

**Phase 4 — Polish (ongoing)**
- TPR-1 (self-host fonts), DEP-2 (`overrides` to clear `npm audit`), FILEUPLOAD-1 (size cap), `npm ci --ignore-scripts` in CI, Dependabot.

### 4c. Per-Fix Specification (Phases 0–2)

**APISEC-1**
- *Files:* new `api/_auth.js` (export `authenticate(req)` moved out of `sync.js`); edit each proxy handler in `api/` to call it; update `sync.js` to import it; update client callers (`src/utils/beSyncValues.js`, `src/utils/legoLastChance.js`, Brickset/BrickEconomy/BrickLink client utils, and the Settings/feature components that fetch them) to attach `Authorization: Bearer ${await getToken()}`.
- *Change:* top of each proxy handler — `const userId = await authenticate(req); if (!userId) return res.status(401).json({error:'unauthorized'});` then apply the rate limiter.
- *Test after:* `curl https://<deploy>/api/brickset-set?number=10497-1` with no auth → expect **401**; from the app while signed in → expect **200** with data.
- *Verify it closes the issue:* unauthenticated loop against `/api/brickfanatics-retiring` returns 401 and consumes **zero** ScraperAPI credits (check ScraperAPI dashboard usage before/after).
- *Rollback:* revert the per-handler diff; the shared helper is additive.

**AUTH-1**
- *File:* `api/sync.js` (and `api/_auth.js` after APISEC-1).
- *Change:* `verifyToken(token, { secretKey, authorizedParties: [process.env.APP_ORIGIN, 'http://localhost:5179'] })`.
- *Test:* normal sign-in/sync still works; a token with a foreign `azp` is rejected (hard to forge in test — at minimum confirm no regression).
- *Rollback:* remove the option.

**BIZLOGIC-1**
- *File:* `src/App.jsx` `reconcileOnSignIn()`.
- *Change:* compute `syncedUser = localStorage.getItem('blSyncedUserId')`; if `syncedUser && syncedUser !== userId`, call `clearLocalUserData()` **before** `summarizeLocal()`/any push; only auto-push in the cloud-empty branch when `sameUser` (or no prior user).
- *Test:* (a) sign in as A, add data, sign out, sign in as B (empty cloud) → B's cloud must stay empty, A's data gone from local. (b) Normal same-user multi-device still syncs.
- *Verify:* inspect Redis `brickledger:user:{B}` — must not contain A's sets.
- *Rollback:* revert the branch guard.

**HEADERS-1**
- *File:* `vercel.json` — add `headers`. Start CSP as `Content-Security-Policy-Report-Only`.
- *Test:* load app signed-in; confirm Clerk auth + fonts + charts still work with zero CSP violations in console; confirm `curl -I` shows the headers; confirm the app refuses to render in an iframe.
- *Rollback:* remove the `headers` block.

**APISEC-2 / BIZLOGIC-2** — specs as in their findings above (atomic limiter; synchronous wipe + push cancellation).

### 4d. What NOT to Fix
- **DEP-2 (exceljs→uuid):** unreachable code path; only worth an `overrides` entry for a clean `npm audit`, not a real fix.
- **CORS as proxy protection:** don't try to "tighten CORS" to stop APISEC-1 — CORS cannot stop server-to-server/curl calls. Auth is the only fix.
- **TPR-2 (Clerk CDN):** inherent to Clerk; not a defect.
- **FILEUPLOAD-1 path/traversal hardening:** there is no server upload; only an optional self-DoS size cap.

### 4e. Patterns to Adopt (≤10)
1. **Every `/api` handler authenticates in its first 3 lines** via the shared `authenticate()` — no exceptions, even read-only proxies that spend a key.
2. Derive all per-user storage keys from the **verified token's `sub`**, never from request input (already done in `sync.js` — keep it).
3. Rate-limit **per authenticated user** with an **atomic** counter, and decide fail-open vs fail-closed deliberately per endpoint.
4. Error responses return **generic** messages; full detail goes to server logs only (the `internalError()` helper already models this — use it everywhere, drop ad-hoc `preview`/`keys`).
5. On any auth-state change, **clear local user data before trusting it** for the new identity.
6. Ship security headers from `vercel.json`; add new external origins to CSP as you add integrations.
7. Pin via committed lockfile; run `npm ci` (and consider `--ignore-scripts`) in CI.
8. New dependency = check it's well-known + recently-maintained before adding; remove dead deps promptly.

### 4f. Patterns to Stop
1. **Stop shipping `/api` proxy handlers without an auth check** — the copy-paste scaffold omitted it 8×.
2. Stop returning upstream response bodies / `Object.keys(data)` to clients.
3. Stop deferring security-critical state changes (the sign-out wipe) to "next page load."
4. Stop relying on CORS or CDN caching as if they were access control.
5. Stop leaving removed-feature residue (stale CORS headers, dead deps) — it misleads the next audit.

### 4g. Single Points of Failure
- **Clerk** — if the Clerk instance/account or its CDN is compromised, all auth and all per-user data access is compromised. Mitigate AUTH-1; keep the Clerk secret key tightly held.
- **`CLERK_SECRET_KEY`** — leak = mint/verify any user's tokens against your data. Single most sensitive secret.
- **Upstash Redis (`KV_REST_API_TOKEN`)** — holds every user's full collection/budget/wanted data in plaintext JSON; token leak = read/overwrite all users' cloud data.
- **The shared owner API keys** (BrickEconomy/Brickset/ScraperAPI) — currently spendable by anyone (APISEC-1); even after the fix, one leaked key = quota/billing impact.

---

## 5. Verification Checklist (Phase 0 & 1)

| Fix | Command / action | Pass | Fail (incomplete) | Automatable? |
|---|---|---|---|---|
| APISEC-1 | `curl -s -o /dev/null -w "%{http_code}" https://<deploy>/api/brickset-set?number=10497-1` (no auth) | `401` | `200`/`500` (still open) | Yes (integration test) |
| APISEC-1 | Signed-in app fetches the same route | `200` + data | `401` (over-blocked) | Yes |
| APISEC-1 | Loop 50× unauthenticated → check ScraperAPI dashboard delta | **0** credits consumed | credits drop (still spending) | Partly (manual dashboard) |
| AUTH-1 | Normal sign-in + sync | works | sync breaks (origins misconfigured) | Yes (smoke) |
| BIZLOGIC-1 | A adds data → sign out → B signs in (empty cloud) → inspect Redis `brickledger:user:{B}` | empty / only B's | contains A's sets | Yes (scripted) |
| BIZLOGIC-1 | Same-user 2-device sync | still syncs | data lost | Yes |
| HEADERS-1 | `curl -I https://<deploy>/` | shows CSP/XFO/HSTS/nosniff | headers absent | Yes |
| HEADERS-1 | Try to embed app in a test `<iframe>` | refused | renders | Yes |
| HEADERS-1 | Signed-in app, watch console for CSP violations | none | violations (CSP too strict) | Partly |

---

## 6. Open Questions (could not be determined from code)
1. **Vercel project access & env-var scope** — who can read the production env vars (the 4 SPOF secrets)? Is 2FA enforced on the Vercel + Clerk + Upstash accounts?
2. **Is the Clerk instance shared** with any other app/origin? (Determines real severity of AUTH-1.)
3. **API key scopes/limits** — are the BrickEconomy/Brickset/ScraperAPI keys metered with hard billing caps, or can APISEC-1 abuse incur real charges vs just feature breakage?
4. **Upstash data-at-rest** — is the Redis instance encrypted at rest, and who can access the Upstash console? (Cloud data is plaintext JSON.)
5. **Vercel platform headers** — does the Vercel project already inject any security headers at the platform level (outside `vercel.json`)? Assumed no.
6. **Sibling `brick-finder` repo** — explicitly out of scope here; does it share any secrets/infrastructure with BrickLedger?

## 7. Low-Confidence Areas
- **BIZLOGIC-2 (race window)** marked *Likely* not *Confirmed* — exact timing depends on Clerk's session-end behavior and browser event ordering, which can't be fully proven from static code.
- **AUTH-1** marked *Likely* — depends on whether the Clerk instance is ever shared (Open Question #2); the code-level gap is confirmed, the exploitability is conditional.
- **Full transitive `node_modules` behavior** — install-script and credential-path scanning was a thorough spot-check (grep across all package.json lifecycle hooks + sensitive-path strings), not a byte-level review of all 217 packages' runtime code.

## 8. Appendix

**A. `npm audit` (raw summary):** `{"info":0,"low":0,"moderate":2,"high":0,"critical":0,"total":2}` — both moderates are `uuid` (buffer bounds) pulled only by `exceljs`; unreachable in this app (DEP-2).

**B. Postinstall inventory:** `@clerk/shared: postinstall => node ./scripts/postinstall.mjs` (benign telemetry notice). `fsevents` (optional macOS native binding). Zero `preinstall`/`install` scripts.

**C. Secret scan:** `git log --all` + per-blob grep for `sk_`/`pk_`/`AKIA`/`BEGIN PRIVATE KEY` + assigned secret values across full history → **0 hits**. `.env.local` untracked & git-ignored.

**D. Sensitive-path grep in node_modules:** `.ssh` / `.aws/credentials` / `.npmrc` / `GITHUB_TOKEN` / `NPM_TOKEN` / `GH_TOKEN` → only hit was Vite reading `.npmrc` (legitimate).

## 9. Audit Methodology Log
- Inline: `git rev-parse`/`status`/`log --since=30d`; `package.json` deps+scripts dump; `.gitignore` read; `git log --all -- .env .env.local`; `npm audit --json`; node walk of all `node_modules/**/package.json` for lifecycle scripts; read `@clerk/shared/scripts/postinstall.mjs`; `git grep` for committed secrets; `git grep` for `dangerouslySetInnerHTML|innerHTML|eval|new Function|document.write`; `git grep` for `process.env` / `fetch(` / `req.(query|body|headers)` across `api/`.
- Workflow `brickledger-security-audit` (run `wf_0171139c-be2`, 7 agents, 123 tool calls, ~8.7 min): 6 parallel category finders (each reading real files under `/Users/S/lego-app`) → 1 verifier on the High finding (APISEC-1, CONFIRMED). Findings schema-validated.
- This report assembled from the verified workflow output by the main agent.

---
*Diagnosis only. No code was changed. Awaiting greenlight before executing any fix phase.*
