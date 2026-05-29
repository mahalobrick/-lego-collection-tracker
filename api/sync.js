/**
 * /api/sync
 *
 * Per-user cloud sync — requires Clerk authentication.
 * Data is stored as plaintext JSON; Clerk auth is the security layer.
 * No passphrase needed.
 *
 * GET  → fetch this user's backup
 * POST → save this user's backup
 *
 * Redis key: brickledger:user:{userId}
 */

const { verifyToken } = require("@clerk/backend");
const { setCors, internalError } = require("./_cors");

const ONE_YEAR = 60 * 60 * 24 * 365;

// ── Upstash REST client (same as cloud-backup.js — no extra packages) ─────────
function upstashClient(url, token) {
  return {
    async get(key) {
      const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      if (j.result === null || j.result === undefined) return null;
      let parsed = typeof j.result === "string" ? JSON.parse(j.result) : j.result;
      if (typeof parsed === "string") parsed = JSON.parse(parsed); // double-encoded safety
      return parsed;
    },
    async set(key, value, ex) {
      await fetch(`${url}/set/${encodeURIComponent(key)}?ex=${ex}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
    },
    // Atomic increment; sets a TTL on first hit. Returns the new count.
    async incrWithTtl(key, ttlSeconds) {
      const r = await fetch(`${url}/incr/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      const count = Number(j.result) || 0;
      if (count === 1) {
        await fetch(`${url}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      return count;
    },
  };
}

// Per-user rate limit: max requests per rolling window. Generous for normal use
// (debounced + interval pushes are infrequent) but caps abuse / runaway loops.
const RATE_LIMIT = 60;
const RATE_WINDOW_SECONDS = 60;

function getKv() {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return upstashClient(url, token);
  return null;
}

// ── Validate Clerk Bearer token → return userId or null ──────────────────────
async function authenticate(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    return payload.sub; // Clerk user ID
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (setCors(req, res, "GET, POST, OPTIONS")) return res.status(200).end();

  const kv = getKv();
  if (!kv) {
    return res.status(503).json({ error: "not_configured" });
  }

  const userId = await authenticate(req);
  if (!userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // Per-user rate limit (fail-open: if the counter errors, allow the request).
  try {
    const count = await kv.incrWithTtl(`brickledger:rl:${userId}`, RATE_WINDOW_SECONDS);
    if (count > RATE_LIMIT) {
      res.setHeader("Retry-After", String(RATE_WINDOW_SECONDS));
      return res.status(429).json({ error: "rate_limited" });
    }
  } catch { /* ignore — don't block sync on a rate-limiter hiccup */ }

  const key = `brickledger:user:${userId}`;

  // ── GET: return user's backup ─────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const data = await kv.get(key);
      if (!data) return res.status(404).json({ error: "no_backup" });
      return res.status(200).json(data);
    } catch (err) {
      return internalError(res, err, "sync GET");
    }
  }

  // ── POST: save user's backup ──────────────────────────────────────────────
  if (req.method === "POST") {
    try {
      const data = req.body;
      if (!data || !data.version) {
        return res.status(400).json({ error: "invalid_payload" });
      }
      await kv.set(key, data, ONE_YEAR);
      return res.status(200).json({ ok: true, savedAt: new Date().toISOString() });
    } catch (err) {
      return internalError(res, err, "sync POST");
    }
  }

  return res.status(405).json({ error: "method_not_allowed" });
};
