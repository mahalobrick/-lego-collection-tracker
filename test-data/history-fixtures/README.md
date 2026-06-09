# history-fixtures

`history-response.json` — a representative `/api/history` POST response, the contract pinned by
`src/utils/historyCache.contract.test.js` (trend BE→BL swap, Phase 1).

Shape: `{ [setNumber]: Array<{ asOf, new, used }> }` — the curated per-point history series, **as
stored** (newest-first, the cron's `LPUSH` order). Mirrors the `value:SET` element shape minus the
`{basis,lots}` value-record fields (history points carry only the resolved `new`/`used` numbers).

- `asOf` — ISO-8601 string (when the cron computed the point).
- `new` / `used` — number, or `null` when unknown (never a fabricated `0`; the client adapter
  `historyFromBL` drops nulls via `valueAmount`).
- `[]` — a set with no history list (absent key / empty list). Distinct from a value cache-miss `null`.

The newest-first → ASC `[{date,value}]` chart mapping is the client adapter's job
(`src/utils/historyEvents.js`), not the endpoint's.
