# BrickLedger

![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)
![Vercel](https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white)

A personal LEGO collection tracker with market intelligence. Track what you own, budget your purchases, manage a prioritized wanted list, and spot retirement waves before sets disappear.

---

![Screenshot placeholder](docs/screenshot.png)

---

## Features

### My Collection
- Track owned sets with cost basis, current market value, and ROI per set
- Per-copy breakdown for sets you own multiple of
- Export collection to XLSX

### Budget
- Spending overview with Recharts visualizations
- Price deal log — records timestamps when a spotted price beats your target
- Multi-currency display: USD / GBP / EUR / CAD

### Wanted List
- Priority scoring (0–100) based on retirement urgency, discount from MSRP, and your priority level
- Wave-aware retirement timeline showing Jul / Dec LEGO retirement waves with clickable set cards
- **Last Chance alert banner** when any wanted set appears on LEGO's Last Chance to Buy page
- Brickset CSV import to bulk-add sets
- Column visibility control with grouped sections: Intelligence / Core / Retirement / Pricing / Details
- Bulk retirement update: apply year, confidence, and source to all sets in a theme at once
- Custom fields: add your own text / number / checkbox / date columns
- BrickHound Discord bot integration (copies a formatted command to clipboard)

### Set Detail Panel
- Pulls set info from Brickset: retail price, subtheme, minifig count, rating, exit date
- BrickEconomy 2-year and 5-year investment forecasts
- BrickLink 6-month average sold price
- Set lifecycle age (months since release)

### Settings
- Configurable auto-backup to JSON on a custom interval
- API key status indicators
- Keyboard shortcuts reference

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `N` | New item |
| `E` | Edit selected row |
| `Esc` | Close panel / modal |
| `↑` / `↓` | Navigate rows |

---

## Quick Start

**Prerequisites:** Node.js 18+

```bash
git clone https://github.com/your-username/brickledger.git
cd brickledger
npm install
cp .env.local.example .env.local   # then add your API keys
npm run dev                         # http://localhost:5173
```

All data is stored in `localStorage` — no database setup required.

---

## API Keys

Create a `.env.local` file in the project root (it is gitignored — never commit your keys):

```env
BRICKSET_API_KEY="your-key"
BRICKECONOMY_API_KEY="your-key"
BRICKLINK_ACCESS_TOKEN="your-token"
```

The app works with any combination of keys; features that depend on a missing key are silently skipped.

### Where to get each key

| Variable | Source | What it powers |
|----------|--------|----------------|
| `BRICKSET_API_KEY` | [brickset.com/tools/webservices](https://brickset.com/tools/webservices) | Set details, retail prices, exit dates, subtheme, minifig count, rating |
| `BRICKECONOMY_API_KEY` | [brickeconomy.com/api](https://www.brickeconomy.com/api) | Market values, 2yr / 5yr investment forecasts |
| `BRICKLINK_ACCESS_TOKEN` | BrickLink developer account | 6-month average sold price |

The **LEGO Last Chance** page (`lego.com/en-us/categories/last-chance-to-buy`) is scraped directly — no key needed.

---

## Project Structure

```
/
├── src/
│   ├── components/       # UI components (tabs, panels, modals)
│   ├── hooks/            # Custom React hooks
│   └── main.jsx
├── api/                  # Vercel serverless functions (proxy API calls)
├── public/
├── .env.local.example
└── vite.config.js
```

API calls to Brickset, BrickEconomy, and BrickLink are proxied through `/api/` routes so keys stay server-side and are never exposed to the browser.

---

## Tech Stack

| Package | Purpose |
|---------|---------|
| React + Vite | SPA framework and dev tooling |
| Recharts | Budget and collection charts |
| xlsx | XLSX export |

---

## Deployment

The app deploys to Vercel out of the box. The `/api` directory is automatically treated as serverless functions.

1. Push to GitHub and import the repo in the [Vercel dashboard](https://vercel.com/new).
2. Add the same env vars from your `.env.local` under **Project > Settings > Environment Variables**.
3. Deploy. Vercel handles the rest.

No additional configuration is needed — `vite.config.js` is already set up for Vercel's build output.

---

## Contributing

PRs welcome. Open an issue first for anything substantial.

---

## License

MIT
