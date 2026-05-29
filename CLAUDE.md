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
- ⚠️ **Open Critical `SYNC-CRIT-1`**: the sync "fresh device" check can silently overwrite unsynced sold-sets / portfolio / budget / settings. Touching sync? Read **Deep-Dive A** first.

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
- **localStorage**: changes need a state update to trigger re-renders; don't read stale values in closures
- **Backups**: before any large edit, the existing pattern is copy file → `file.bak.jsx`
- **Secrets**: API keys live in `.env.local` only — never commit, never log
- **Tab style**: underline tabs (gold `#c9a84c` active), action buttons as small green pills
