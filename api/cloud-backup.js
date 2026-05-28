/**
 * /api/cloud-backup
 *
 * GET  → fetch the stored encrypted payload (returns 404 if none exists)
 * POST → store a new encrypted payload (overwrites previous)
 *
 * The server stores only AES-GCM ciphertext — it never sees plaintext data.
 * Auth is the passphrase itself: wrong passphrase = garbage on decryption.
 * No BACKUP_SECRET or client-side secret needed.
 *
 * Supports two Redis backends (whichever env vars are present):
 *
 *   1. Upstash Redis REST (preferred — no package required):
 *      KV_REST_API_URL + KV_REST_API_TOKEN
 *
 *   2. Redis Cloud / any Redis via connection string:
 *      REDIS_URL  (e.g. redis://default:password@host:port)
 *
 * If neither is configured, returns 503 and the client skips silently.
 */

const BACKUP_KEY = "brickledger:backup";
const ONE_YEAR   = 60 * 60 * 24 * 365;

// ── Backend 1: Upstash REST API (pure fetch, no package) ─────────────────────
function upstashClient(url, token) {
  return {
    async get(key) {
      const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      if (j.result === null || j.result === undefined) return null;
      return typeof j.result === "string" ? JSON.parse(j.result) : j.result;
    },
    async set(key, value, ex) {
      await fetch(`${url}/set/${encodeURIComponent(key)}?ex=${ex}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(JSON.stringify(value)),
      });
    },
    close() {},
  };
}

// ── Backend 2: ioredis (for REDIS_URL / Redis Cloud) ─────────────────────────
function ioredisClient(redisUrl) {
  const Redis = require("ioredis");
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: false,  // faster cold starts in serverless
    lazyConnect: true,
    tls: redisUrl.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
  });
  return {
    async get(key) {
      const raw = await client.get(key);
      if (raw === null || raw === undefined) return null;
      return JSON.parse(raw);
    },
    async set(key, value, ex) {
      await client.set(key, JSON.stringify(value), "EX", ex);
    },
    close() {
      try { client.disconnect(); } catch { /* ignore */ }
    },
  };
}

function getKv() {
  // Prefer Upstash REST (works without a package; no connection to manage)
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return { client: upstashClient(url, token), backend: "upstash" };

  // Fall back to Redis connection string (Redis Cloud, self-hosted, etc.)
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) return { client: ioredisClient(redisUrl), backend: "ioredis" };

  return null;
}

const { setCors, internalError } = require("./_cors");

module.exports = async function handler(req, res) {
  if (setCors(req, res, "GET, POST, OPTIONS")) return res.status(200).end();

  const kv = getKv();
  if (!kv) {
    return res.status(503).json({
      error: "not_configured",
      message: "Cloud backup not configured — add KV_REST_API_URL+KV_REST_API_TOKEN (Upstash) or REDIS_URL to env vars.",
    });
  }

  const { client } = kv;

  // ── GET: fetch backup (open — LEGO data isn't sensitive enough to gate reads) ──
  if (req.method === "GET") {
    try {
      const backup = await client.get(BACKUP_KEY);
      client.close();
      if (!backup) return res.status(404).json({ error: "no_backup" });
      return res.status(200).json(backup);
    } catch (err) {
      client.close();
      return internalError(res, err, "cloud-backup GET");
    }
  }

  // ── POST: save backup ────────────────────────────────────────────────────
  // Auth is handled by encryption: without the passphrase the ciphertext is
  // worthless, so there is no shared secret to embed in the client bundle.
  if (req.method === "POST") {
    try {
      const backup = req.body;
      // Expect the encrypted envelope shape { version, exportedAt, salt, iv, ciphertext }
if (!backup || !backup.ciphertext || !backup.salt || !backup.iv) {
        client.close();
        return res.status(400).json({ error: "invalid_payload" });
      }
      await client.set(BACKUP_KEY, backup, ONE_YEAR);
      client.close();
      return res.status(200).json({ ok: true, savedAt: new Date().toISOString() });
    } catch (err) {
      client.close();
      return internalError(res, err, "cloud-backup POST");
    }
  }

  client.close();
  return res.status(405).json({ error: "method_not_allowed" });
};
