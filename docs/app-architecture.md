# BrickLedger — App Architecture

How the app is organized: the order of operations, the four data layers, and the full
source map. For *how value is determined* see `docs/valuation.md`; for the value-layer
build plan see `docs/value-layer-plan.md`.

## Order of operations

The app follows the lifecycle of a set through ownership:

1. **Want** — desire, budget, deal-watch. "Should I buy this, and when?"
2. **Purchased** — budget maintenance, buy decisions recorded. "I've committed to it."
3. **My Collection** — owned; quantity, condition, current market value. "I have it; what's it worth?"

Budget spans all three. Each stage is driven by a different layer below.

## The four layers

| Layer | Answers | Sources | Surfaces in |
|---|---|---|---|
| **Valuation** | What is it worth now? | BrickEconomy (market), BrickLink (sold), Brickset (MSRP label) | My Collection: value, ROI, forecasts |
| **Buy / decision** | Should I buy, and when? | Brick Fanatics (retirement), LEGO.com (last chance), deals trackers (Brickhawk/Brickhound), release notifications, personal want algorithm, budget | Want: urgency badges, deal alerts, wishlist scoring |
| **Metadata** | What is this set? | Brickset, Rebrickable | All stages: images, pieces, minifigs, themes |
| **Budget** | What can I spend? | Excel "All Buys" import, manual entry | Want + Purchased |

Infra cuts across all: Clerk (auth), Upstash Redis (cloud sync + rate limits), Vercel (hosting),
ScraperAPI (Cloudflare-bypass for the Brick Fanatics scrape).

## Buy / decision layer — designed to generalize

The owner's current structure is **retirement-weighted** (Brick Fanatics retirement waves drive
most buy urgency, feeding deals trackers; new-release buys are weighted by release notifications +
a personal want algorithm + budget). But the app is meant to fit **other users' buy structures**,
so this layer should be a **configurable weighting over a common signal set** — retirement urgency,
last-chance status, deal/price signals, release recency, personal want, budget headroom — not a
hardcoded retirement-first pipeline. One user's weights ≠ another's; the signals are shared, the
scoring is per-user.

## Source map

| Source | Type | What it does | /api proxy | Client module (`src/`) | Auth / key | Cost / limits |
|---|---|---|---|---|---|---|
| BrickEconomy | External API | Set values (new/used), 2/5yr forecasts, price history, retail | `brickeconomy-set`, `brickeconomy-collection` | `beSyncValues.js` | `BRICKECONOMY_API_KEY` (`x-apikey` header) | Paid; per-key quota → 429 on overuse |
| Brickset | External API | Catalog facts: MSRP, retirement dates, pieces, minifigs, images, themes | `brickset-set`, `brickset-search`, `brickset-themes` | `brickset.js` | `BRICKSET_API_KEY` | Free tier w/ key; v3.asmx API |
| BrickLink | External API | Resale sold prices (new & used, avg/min/max) | `bricklink-auth`, `bricklink-priceguide` | `bricklink-client.js` | User `blBrickLinkAccessToken` → session token; hardcoded `CLIENT_ID` | Per-user token; 50-min session, 6h price cache |
| LEGO.com | Scraper | "Last Chance to Buy" list → urgency badges | `lego-last-chance` | `legoLastChance.js` | none (direct fetch) | Free; CDN 24h / client 23h |
| Brick Fanatics | Scraper | Retiring-sets list + waves/dates | `brickfanatics-retiring` | (`blBFRetirementCache` reader) | `SCRAPERAPI_KEY` | via ScraperAPI; CDN-cached 7d |
| ScraperAPI | Scraping proxy | Renders pages past Cloudflare (Brick Fanatics only) | (inside `brickfanatics-retiring`) | — | `SCRAPERAPI_KEY` | Free 1k credits/mo (JS render = 5/call) |
| Clerk | Auth | Login + the token gating every API call | (all `/api`) | `App.jsx`, `apiFetch.js`, `@clerk/react` | `VITE_CLERK_PUBLISHABLE_KEY` (client), `CLERK_SECRET_KEY` (server) | Free tier |
| Upstash Redis | Storage | Cloud backup + rate-limit counters | `sync` | `exportBackup.js` | `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Free tier; 1yr TTL on backups |
| Vercel | Hosting | Runs the `/api` functions + CDN | — | — | `VERCEL_OIDC_TOKEN` (deploy) | Free / hobby tier |
| Rebrickable | Bundled CSV | Offline set lookup (name/year/theme/parts), no network | — | `rebrickable.js` (papaparse) | none (bundled) | Free download; manually refreshed |
| Seed CSV / `collection.json` | Bundled data | `BrickEconomy-Sets (8).csv` + `collection.json` — sample/seed collection for import & testing | — | `AppSettings.jsx` (import) | none | — |
| Excel import | File upload | Reads the "All Buys" budget sheet → purchases | — | `importBudgetExcel.js` (exceljs) | none | Client-only; lazy-loaded |

**BrickLink auth mechanics:** the browser never holds a server key for BrickLink. The user pastes
their own access token (`blBrickLinkAccessToken`, entered in Settings); `bricklink-auth` exchanges
it for a **~50-minute session token**, and the proxy also carries a hardcoded `CLIENT_ID`.
`bricklink-priceguide` requires that session token (401 without it), so it is the one proxy that
does *not* spend an owner-held secret.

**Security boundary:** **CORS is not the security boundary — the Clerk token check on every `/api`
request is.** CORS only restricts *browser* reads; the auth gate is what stops server-to-server /
curl abuse of the key-bearing proxies. See [`docs/security.md`](security.md) (`APISEC-1`).

## Feature → source → cache map

| Feature | Trigger | Source | Cached as (TTL) | Shows up in |
|---|---|---|---|---|
| Set value + forecasts | App open (daily batch of 50) / Sync Values | BrickEconomy | `brickEconomySetCache` (24h) | Collection value, ROI, forecast boxes |
| Set facts + MSRP + retirement | Add/look up a set | Brickset | `bricksetSetCache` (7d) | Add forms, retirement urgency |
| Theme list | Theme dropdowns render | Brickset | `bricksetThemesCache` (30d) | Theme filter/select dropdowns |
| Catalog search | Typing in Wanted List search | Brickset | (uncached — transient) | Search result lists |
| Resale prices | Manual / bulk sync | BrickLink | `blPriceGuideCache` (6h; 12h bulk) | Price columns |
| Last Chance list | App open | LEGO.com | `legoLastChanceCache` (23h) | "Last Chance" badges, alerts |
| Retiring waves | App open | Brick Fanatics (via ScraperAPI) | `blBFRetirementCache` (7d) | Retirement dates/waves |
| Offline lookup | Instant | Rebrickable CSV | in-memory | Name/theme/parts fallback |
| Budget Excel import | User picks an `.xlsx` file | User's file (`importBudgetExcel.js`) | → writes `blPurchases` | Budget tab purchase rows |
| Price history | On demand (read) | BrickEconomy `price_events_*` via `priceEventsFromBE` | `brickEconomySetCache[key].data` (read-only adapter) | WatchDetailPanel price chart (retired-only) |
| Auth on every request | Every `/api` call | Clerk (`apiFetch.js` attaches JWT) | — (token in memory) | Gates every server feature |
| Cloud sync | Sign-in / after edits | Upstash Redis | `blLastPushHash` | All data, across devices |

## Libraries / tooling

Runtime ships to users; build/test/lint are dev-only. Full list lives in `package.json`.

| Package | Type | Role here |
|---|---|---|
| react / react-dom (v19) | Runtime | UI framework — the whole SPA |
| @clerk/react | Runtime | Client-side auth UI + session/JWT |
| recharts | Runtime | All charts (value curve, budget, breakdowns) |
| exceljs | Runtime (lazy) | Excel read/write — budget import/export (**replaced vulnerable SheetJS**) |
| papaparse | Runtime | CSV parsing — Rebrickable dataset + imports |
| fuse.js | Runtime | Fuzzy search across sets / wanted items |
| react-hot-toast | Runtime | Toast notifications |
| vite (v8) | Build/dev | Dev server (port 5179) + production build |
| vitest (v4) | Test | Test runner (`npm test`) |
| eslint (v10) | Lint | Enforces conventions incl. the **DATA-4 ban** on raw `localStorage.setItem` |

## Notes for future work

- The **price-drop feature** is a buy/decision-layer feature (deal-watch in Want); it *consumes*
  the valuation layer and is a separate arc, after valuation is correct.
- BrickLink's proxy is live for on-demand price columns; wiring it into the *value* layer is V4
  (see `valuation.md`), gated on confirming API-auth vs scrape.
