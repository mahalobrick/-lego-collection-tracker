/**
 * /api/values  (POST)
 *
 * Batch read of the BrickLink value cache (written by scripts/refresh-values.mjs to the
 * value:SET:{number} keyspace in Upstash). Step 1 of the app-read: this endpoint EXISTS and
 * is reachable, but nothing in the funnel/display consumes it yet (that is Step 2).
 *
 * Pipeline (docs/integration-standard.md §1): setCors → requireAuth → rateLimitAllow →
 * MGET(timeout) → field-select → typed response. The Upstash read goes through
 * fetchWithTimeout (raw REST, like sync.js) — NOT @upstash/redis — so the no-bare-fetch /
 * timeout lock (src/api-no-bare-fetch.test.js, §4) holds.
 *
 * Body:   { setNumbers: string[] }
 * Returns: { [setNumber]: { new: {amount,basis,lots,asOf}|null, used: {…}|null } | null }
 *          — null for a set with no cached value (e.g. a deferred CMF). `source` is implied
 *          "BrickLink" for the whole endpoint; `condition` is the new/used key.
 * Failure: the typed-error envelope (§4) so the client funnel can branch on it.
 */

const { setCors, internalError } = require("./_cors");
const { requireAuth } = require("./_auth");
const { rateLimitAllow } = require("./_ratelimit");
const { fetchWithTimeout, FetchFailure, sendSourceError } = require("./_fetch");

// The value cache is BrickLink-sourced (basis-tagged sold/modeled/asking). Surfaced via the
// existing readSource label "BrickLink".
const SOURCE = "bricklink";
const MAX_SETS = 1000; // bound the MGET payload (a collection is ~hundreds of sets)

function getKv() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

module.exports = async function handler(req, res) {
  if (setCors(req, res, "POST, OPTIONS")) return res.status(200).end();

  // Auth FIRST — before touching KV or reading the body (§2).
  const userId = await requireAuth(req, res);
  if (!userId) return;

  if (!(await rateLimitAllow(userId, { limit: 1000, windowSeconds: 60, bucket: "proxy" }))) {
    return sendSourceError(res, {
      kind: "rate_limited", source: SOURCE,
      message: "Too many requests — please retry shortly.", retryAfter: 60,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const kv = getKv();
  if (!kv) {
    return sendSourceError(res, {
      kind: "not_configured", source: SOURCE,
      message: "Value cache is not configured.",
    });
  }

  const body = req.body || {};
  if (!Array.isArray(body.setNumbers)) {
    return res.status(400).json({ error: "invalid_payload", message: "Body must be { setNumbers: string[] }" });
  }

  // Normalize: trim, drop blanks, de-dupe, cap. Empty request → empty map (no round-trip).
  const numbers = [...new Set(body.setNumbers.map((n) => String(n).trim()).filter(Boolean))].slice(0, MAX_SETS);
  if (numbers.length === 0) return res.status(200).json({});

  const keys = numbers.map((n) => `value:SET:${n}`);

  try {
    // One MGET round-trip via the Upstash REST command form (POST ["MGET", ...keys]).
    const r = await fetchWithTimeout(kv.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${kv.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["MGET", ...keys]),
    }, { timeoutMs: 12_000 });

    if (!r.ok) {
      return sendSourceError(res, {
        kind: "upstream_error", source: SOURCE,
        message: "Value cache read failed.", status: r.status,
      });
    }

    const j = await r.json();
    const results = Array.isArray(j.result) ? j.result : [];

    // Field-select: own the curated per-condition shape {amount,basis,lots,asOf}; never echo the
    // raw stored record (which also carries source/condition — implied here). Absent key → null.
    const out = {};
    numbers.forEach((num, i) => { out[num] = selectRecord(results[i]); });
    return res.status(200).json(out);
  } catch (err) {
    if (err instanceof FetchFailure) {
      return sendSourceError(res, {
        kind: err.kind === "timeout" ? "timeout" : "upstream_error",
        source: SOURCE,
        message: err.kind === "timeout" ? "Value cache timed out." : "Could not reach the value cache.",
      });
    }
    return internalError(res, err, "values");
  }
};

// One MGET element → the curated { new, used } record, or null when the key was absent.
function selectRecord(raw) {
  const v = parseStored(raw);
  if (!v || typeof v !== "object") return null;
  return { new: selectCondition(v.new), used: selectCondition(v.used) };
}

// A stored per-condition record → the consumed shape. null stays null (unknown ≠ a fake 0).
function selectCondition(c) {
  if (!c || typeof c !== "object") return null;
  return {
    amount: typeof c.amount === "number" ? c.amount : null,
    basis: typeof c.basis === "string" ? c.basis : null,
    lots: typeof c.lots === "number" ? c.lots : null,
    asOf: typeof c.asOf === "string" ? c.asOf : null,
  };
}

// Upstash MGET returns each value as its raw stored string (JSON, written by @upstash/redis), or
// null. Parse defensively (mirrors sync.js's double-encode guard).
function parseStored(raw) {
  if (raw === null || raw === undefined) return null;
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  return v;
}
