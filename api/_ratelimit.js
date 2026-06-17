/**
 * Shared per-user rate limiter (APISEC-2).
 *
 * Atomic fixed-window via a single Lua EVAL on Upstash Redis: INCR the counter and,
 * on the first hit of a window, set its TTL — both in one atomic round-trip. This
 * avoids the previous non-atomic INCR-then-EXPIRE race (which could leave a key with
 * no TTL → permanent throttle) and needs no EXPIRE-NX support.
 *
 * Per-bucket failure policy: when the limiter can't consult KV (Upstash unconfigured, a network
 * error, or a non-OK response) it falls back to a bucket-specific verdict —
 *   • fail OPEN (allow) for most buckets: every limited endpoint already requires a verified Clerk
 *     user (api/_auth.js), so abuse is bounded to accountable accounts and a Redis hiccup must not
 *     brick a working feature.
 *   • fail CLOSED (deny) for "scrape": it fronts the *metered* ScraperAPI endpoint
 *     (api/brickfanatics-retiring.js), so when we can't confirm the request is within limit we deny
 *     it — a KV outage degrades that one endpoint rather than burning paid budget (L2, Jun-17 audit).
 * Either way the fallback is logged so it's observable.
 */

// Atomic: increment within a fixed window, returning the new count.
const LUA = "local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return c";

// Buckets that fail CLOSED (deny) when KV can't be consulted — every other bucket fails OPEN (allow).
// "scrape" fronts the metered ScraperAPI endpoint, so a KV outage must not let spend go unthrottled.
const FAIL_CLOSED_BUCKETS = new Set(["scrape"]);

// The allow/deny verdict to use when KV is unavailable, per the bucket's policy above.
function failModeAllow(bucket) {
  return !FAIL_CLOSED_BUCKETS.has(bucket);
}

function kv() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

/**
 * @returns {Promise<boolean>} true if the request is within the limit (allow), false if over (block).
 */
async function rateLimitAllow(userId, { limit, windowSeconds, bucket }) {
  const c = kv();
  if (!c) return failModeAllow(bucket); // KV unconfigured → bucket policy (open for most, closed for scrape)
  try {
    const res = await fetch(c.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["EVAL", LUA, "1", `brickledger:rl:${bucket}:${userId}`, String(windowSeconds)]),
    });
    if (!res.ok) throw new Error(`ratelimit EVAL HTTP ${res.status}`);
    const data = await res.json();
    const count = Number(data?.result) || 0;
    return count <= limit;
  } catch (err) {
    const allow = failModeAllow(bucket);
    console.error(`[BrickLedger ratelimit] KV error → failing ${allow ? "open" : "closed"} (bucket=${bucket}):`, err.message);
    return allow;
  }
}

module.exports = { rateLimitAllow };
