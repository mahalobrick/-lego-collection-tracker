/**
 * Shared per-user rate limiter (APISEC-2).
 *
 * Atomic fixed-window via a single Lua EVAL on Upstash Redis: INCR the counter and,
 * on the first hit of a window, set its TTL — both in one atomic round-trip. This
 * avoids the previous non-atomic INCR-then-EXPIRE race (which could leave a key with
 * no TTL → permanent throttle) and needs no EXPIRE-NX support.
 *
 * Fail-open by design: if the limiter errors or KV isn't configured, the request is
 * ALLOWED (and the error is logged). Rationale — every limited endpoint already
 * requires a verified Clerk user (api/_auth.js), so abuse is bounded to authenticated,
 * accountable accounts; a Redis hiccup must not brick a working feature. The trade-off
 * is logged so it's observable. (A future refinement: tighter, cost-aware limits for the
 * ScraperAPI-backed endpoint, and/or fail-closed there specifically.)
 */

// Atomic: increment within a fixed window, returning the new count.
const LUA = "local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return c";

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
  if (!c) return true; // not configured → allow
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
    console.error("[BrickLedger ratelimit] fail-open:", err.message);
    return true; // fail-open (logged)
  }
}

module.exports = { rateLimitAllow };
