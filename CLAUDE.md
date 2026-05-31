# BrickLedger — Claude Code Guidelines

## Project snapshot
React + Vite SPA. Four tabs: My Collection, Budget, Wanted List, Settings.
Primary store: `localStorage` (`blOwnedSets`, `blPurchases`, `blWantedList`, etc.).
Charts: recharts. External data: BrickEconomy API (key in `.env.local`).
Dev server: `npm run dev` (port 5179). Build: `npm run build`.

## Architecture at a glance
- **Client**: React 19 + Vite 8 SPA — four large "god-module" tabs over a schema-less `localStorage` namespace (`bl*` / `brickEconomy*`); no data-access layer.
- **Cloud**: per-user JSON blob in Upstash Redis via Clerk-authenticated Vercel functions in `/api` (`sync.js` + key-hiding proxies; shared `_auth` / `_ratelimit` / `_cors`).
- **Sync**: `src/App.jsx → reconcileOnSignIn()` + `src/utils/exportBackup.js` (build / apply / push / dedup-hash). Highest-blast-radius code in the repo.
- **Auth/secrets**: Clerk; server keys in env only; CSP enforced.

## Reference docs (read before large changes)
- **[`docs/architecture-audit.md`](docs/architecture-audit.md)** — full architecture audit + prioritized checklist.
- **[`docs/audit-action-plan.md`](docs/audit-action-plan.md)** — sequenced work plan (root-cause grouped: stopgap → test → refactor).
- **[`docs/security.md`](docs/security.md)** — security source of truth (audit + remediation). Don't duplicate it; cross-link.
- ✅ **`SYNC-CRIT-1` / `A4` / `A11` CLOSED (Phase D)**: census, overwrite, build, push-guard, dedup-hash + the sign-out wipe-guard now all derive from one registry (`BACKUP_KEYS` in `src/utils/exportBackup.js`). Sync is still the highest-blast-radius code — touching it? Read **Deep-Dive A** + [`docs/audit-action-plan.md`](docs/audit-action-plan.md) (esp. *Phase D*) first. Note: sign-out now **retains** unsynced data (A4 trade-off, `SIGNOUT-RETAIN-1`).

## Coding principles

### 1. Think before coding
State assumptions explicitly — don't silently guess intent.
When a request is ambiguous, present the two most likely interpretations and ask.
If a change touches more than one file, say which files and why before editing.

### 2. Simplicity first
Write the minimal code that solves the stated problem.
No speculative features, no unasked abstractions, no "while I'm here" refactors.
If 200 lines could be 50, flag it — but only rewrite if asked.

### 3. Surgical changes
Only modify what the task requires. Match the existing style exactly.
Do not reformat, rename, or reorganize adjacent code unless explicitly requested.
This codebase has large files (1000–2800 lines) — precision matters.

### 4. Goal-driven execution
Turn vague tasks into verifiable criteria before starting.
"Fix the bug" → "reproduce it in the preview, confirm the fix, show the before/after."
Use the preview server and screenshot tool to verify visual changes landed correctly.

## Key conventions
- **IDs**: `wl_${Date.now()}_${Math.random().toString(36).slice(2,7)}` for wanted items
- **Money**: always `asNumber()` before arithmetic — never trust raw string fields
- **Value / gain (unknown ≠ 0)**: a set's value or gain is consumed ONLY via the null-aware functions in `src/utils/portfolio.js` (`setValueProvenance().amount`, `setGain`, `setROI`, `portfolioValue/Gain/ROI`, `groupRollup`) and rendered via `valueDisplay.js` (`formatValueCell`). Unknown value is `null` → "—" / excluded, NEVER `$0`. Never write your own `asNumber(s.totalValue) || asNumber(s.currentValue) * qty` or `value - paid` at a consumer site — that re-opens the falsy-zero class. (Cost/spent stays inclusive: `$0` adds `$0`.)
- **localStorage**: changes need a state update to trigger re-renders; don't read stale values in closures
- **localStorage writes**: always `setItemSafe()` from `src/utils/safeStorage.js` — never raw `localStorage.setItem` (quota guard + auto-sync trigger; DATA-4). `npm run lint` enforces this; the only sanctioned raw writes live in `safeStorage.js`
- **Backups**: before any large edit, the existing pattern is copy file → `file.bak.jsx`
- **Secrets**: API keys live in `.env.local` only — never commit, never log
- **Tab style**: underline tabs (gold `#c9a84c` active), action buttons as small green pills
