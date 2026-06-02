# /api/values response fixtures

A **real** `/api/values` (POST) response, captured from the live handler reading the BrickLink
value cache (`value:SET:*` in Upstash, written by `scripts/refresh-values.mjs`). Pins the
response contract per [`docs/integration-standard.md`](../../docs/integration-standard.md) §5.

- **`values-response.json`** — captured 2026-06-02 by driving `api/values.js` (auth stubbed —
  auth is separately locked by `src/api-auth.test.js`) against the real cache with
  `{ setNumbers: ["75298-1", "30303-1", "71045-12"] }`.

## Shape (what `valueCache.contract.test.js` locks)

```
{ [setNumber]: { new: {amount,basis,lots,asOf}|null, used: {…}|null } | null }
```

- `source` is **implied "BrickLink"** for the whole endpoint and is field-selected OUT of the
  per-condition object; `condition` is the `new`/`used` key.
- A cached set (e.g. `75298-1`, `30303-1`) → a `{ new, used }` record. `amount` is `number|null`
  (null = unknown, never a fake 0); `basis` ∈ `sold | sold_thin | modeled | asking | unknown`;
  `lots` is a number; `asOf` is an ISO timestamp.
- A set with no cached value (e.g. the deferred CMF `71045-12`) → `null`.

## Refresh / drift

Re-capture by re-running the value-refresh batch and re-driving the handler. A frozen fixture
locks **code-conformance** to this shape (a field-select change that drops/renames a consumed
field fails CI); it does not detect a live keyspace change on its own (§5).
