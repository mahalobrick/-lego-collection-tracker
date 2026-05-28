# BrickLedger — Codex Guidelines

## Project snapshot
React + Vite SPA. Four tabs: My Collection, Budget, Wanted List, Settings.
Primary store: `localStorage` (`blOwnedSets`, `blPurchases`, `blWantedList`, etc.).
Charts: recharts. External data: BrickEconomy API (key in `.env.local`).
Dev server: `npm run dev` (port 5179). Build: `npm run build`.

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
