/**
 * /api/history  (POST)
 *
 * Batch read of the BrickLink per-set value HISTORY cache (history:SET:{number} Redis LISTs,
 * written by scripts/refresh-values.mjs: LPUSH newest + LTRIM ~520 — so each list is newest-first).
 * Phase 1 of the trend BE→BL swap (docs/trend-history-swap-plan.md): this endpoint EXISTS and is
 * reachable, but NOTHING in the app consumes it yet (Phase 2 wires an owned-set value-trend into
 * SetDetailPanel via historyFromBL). The same "Step 1" inert posture api/values.js shipped with.
 *
 * Pipeline mirrors api/values.js (docs/integration-standard.md §1): setCors → requireAuth →
 * rateLimitAllow → (read, timeout) → field-select → typed response. The ONE divergence from
 * values.js: value:SET are strings (single MGET), but history:SET are LISTS, so this issues an
 * LRANGE per key via the Upstash REST /pipeline (raw fetchWithTimeout, like sync.js / values.js —
 * NOT @upstash/redis — so the no-bare-fetch / timeout lock holds). READ-ONLY: only LRANGE is ever
 * sent; this endpoint never writes (no LPUSH/LTRIM/SET/DEL).
 *
 * Body:   { setNumbers: string[] }
 * Returns: { [setNumber]: Array<{ asOf, new, used }> }  — the curated per-point shape, newest-first
 *          (as stored). [] for a set with no history list. `source` is implied "BrickLink"; the
 *          newest-first→ASC [{date,value}] chart mapping is the client adapter's job (historyFromBL).
 * Failure: the typed-error envelope (§4) so the client funnel can branch on it.
 */

const { setCors, internalError } = require("./_cors");
const { requireAuth } = require("./_auth");
const { rateLimitAllow } = require("./_ratelimit");
const { fetchWithTimeout, FetchFailure, sendSourceError } = require("./_fetch");

// The history cache is BrickLink-sourced (same cron as value:SET). Surfaced via the readSource
// label "BrickLink".
const SOURCE = "bricklink";
const MAX_SETS = 1000; // bound the pipeline payload (a collection is ~hundreds of sets)
const MAX_POINTS = 520; // align with the cron's LTRIM cap; bound the LRANGE window per key

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
      message: "Value history cache is not configured.",
    });
  }

  const body = req.body || {};
  if (!Array.isArray(body.setNumbers)) {
    return res.status(400).json({ error: "invalid_payload", message: "Body must be { setNumbers: string[] }" });
  }

  // Normalize: trim, drop blanks, de-dupe, cap. Empty request → empty map (no round-trip).
  const numbers = [...new Set(body.setNumbers.map((n) => String(n).trim()).filter(Boolean))].slice(0, MAX_SETS);
  if (numbers.length === 0) return res.status(200).json({});

  // One pipeline of LRANGE (read-only) — history:SET are lists, so no MGET.
  const commands = numbers.map((n) => ["LRANGE", `history:SET:${n}`, 0, MAX_POINTS - 1]);

  try {
    const r = await fetchWithTimeout(`${kv.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kv.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    }, { timeoutMs: 12_000 });

    if (!r.ok) {
      return sendSourceError(res, {
        kind: "upstream_error", source: SOURCE,
        message: "Value history read failed.", status: r.status,
      });
    }

    const j = await r.json();
    // Upstash /pipeline returns an array aligned to the commands: [{ result: [...] }, …].
    const arr = Array.isArray(j) ? j : [];
    const out = {};
    numbers.forEach((num, i) => { out[num] = selectSeries(arr[i]); });
    return res.status(200).json(out);
  } catch (err) {
    if (err instanceof FetchFailure) {
      return sendSourceError(res, {
        kind: err.kind === "timeout" ? "timeout" : "upstream_error",
        source: SOURCE,
        message: err.kind === "timeout" ? "Value history timed out." : "Could not reach the value history cache.",
      });
    }
    return internalError(res, err, "history");
  }
};

// One pipeline element ({ result: [rawStr, …] }) → curated newest-first [{asOf,new,used}]. A missing
// key, an error element, or an empty list all collapse to [] (no history ≠ an error).
function selectSeries(elem) {
  const list = elem && Array.isArray(elem.result) ? elem.result : [];
  const out = [];
  for (const raw of list) {
    const point = selectPoint(parseStored(raw));
    if (point) out.push(point);
  }
  return out;
}

// A stored history point → the consumed shape. A point with no string asOf can't be placed on the
// axis → dropped. new/used keep null when not numeric (unknown ≠ a fabricated 0 — the client adapter
// drops nulls via valueAmount).
function selectPoint(v) {
  if (!v || typeof v !== "object") return null;
  const asOf = typeof v.asOf === "string" ? v.asOf : null;
  if (!asOf) return null;
  return {
    asOf,
    new: typeof v.new === "number" ? v.new : null,
    used: typeof v.used === "number" ? v.used : null,
  };
}

// Upstash list elements come back as their raw stored string (JSON, written by @upstash/redis), or
// null. Parse defensively (mirrors values.js / sync.js's double-encode guard).
function parseStored(raw) {
  if (raw === null || raw === undefined) return null;
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  return v;
}
