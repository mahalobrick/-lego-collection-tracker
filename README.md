# LEGO Collection Tracker

A web-based LEGO collection manager with financial analytics — track owned sets, monitor market values, manage a wanted list, and analyse your spending.

Built with React + Vite. All data stored locally in your browser.

## Features

- **My Collection** — owned sets with cost basis, current value, ROI, and theme breakdown
- **Wanted List** — sets on your radar with retirement risk scoring and buy priority
- **Budget Dashboard** — spending by store, monthly trends, and investment curve
- **Research** — look up any set by number, get metadata and pricing

## Data Sources

- [Brickset](https://brickset.com) — set metadata (theme, pieces, minifigs, dimensions)
- [BrickLink](https://bricklink.com) — catalog and market pricing

## Setup

```bash
npm install
npm run dev
```

Add API keys to `.env.local` (see `.env.example`):

```
BRICKSET_API_KEY=""
```

## License

GPL v3 — see [LICENSE](LICENSE)

## Support

If you find this useful, [buy me a coffee](https://ko-fi.com) ☕
