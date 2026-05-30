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

| Source | Type | What it does | /api proxy |
|---|---|---|---|
| BrickEconomy | External API | Set values (new/used), 2/5yr forecasts, price history, retail | `brickeconomy-set`, `brickeconomy-collection` |
| Brickset | External API | Catalog facts: MSRP, retirement dates, pieces, minifigs, images, themes | `brickset-set`, `brickset-search`, `brickset-themes` |
| BrickLink | External API | Resale sold prices (new & used, avg/min/max) | `bricklink-auth`, `bricklink-priceguide` |
| LEGO.com | Scraper | "Last Chance to Buy" list → urgency badges | `lego-last-chance` |
| Brick Fanatics | Scraper | Retiring-sets list + waves/dates | `brickfanatics-retiring` |
| ScraperAPI | Scraping proxy | Renders pages past Cloudflare (Brick Fanatics only) | (inside `brickfanatics-retiring`) |
| Clerk | Auth | Login + the token gating every API call | (all `/api`) |
| Upstash Redis | Storage | Cloud backup + rate-limit counters | `sync` |
| Vercel | Hosting | Runs the `/api` functions + CDN | — |
| Rebrickable | Bundled CSV | Offline set lookup (name/year/theme/parts), no network | — |
| Excel import | File upload | Reads the "All Buys" budget sheet → purchases | — |

## Feature → source → cache map

| Feature | Trigger | Source | Cached as (TTL) | Shows up in |
|---|---|---|---|---|
| Set value + forecasts | App open / Sync Values | BrickEconomy | `brickEconomySetCache` (24h) | Collection value, ROI, forecast boxes |
| Set facts + MSRP + retirement | Add/look up a set | Brickset | `bricksetSetCache` (7d) | Add forms, retirement urgency |
| Resale prices | Manual / bulk sync | BrickLink | `blPriceGuideCache` (6h; 12h bulk) | Price columns |
| Last Chance list | App open | LEGO.com | `legoLastChanceCache` (23h) | "Last Chance" badges, alerts |
| Retiring waves | App open | Brick Fanatics (via ScraperAPI) | `blBFRetirementCache` (7d) | Retirement dates/waves |
| Offline lookup | Instant | Rebrickable CSV | in-memory | Name/theme/parts fallback |
| Cloud sync | Sign-in / after edits | Upstash Redis | `blLastPushHash` | All data, across devices |

## Notes for future work

- The **price-drop feature** is a buy/decision-layer feature (deal-watch in Want); it *consumes*
  the valuation layer and is a separate arc, after valuation is correct.
- BrickLink's proxy is live for on-demand price columns; wiring it into the *value* layer is V4
  (see `valuation.md`), gated on confirming API-auth vs scrape.
