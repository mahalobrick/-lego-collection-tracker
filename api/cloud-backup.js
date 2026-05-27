/**
 * /api/cloud-backup
 *
 * GET  → fetch the stored backup (returns 404 if none exists)
 * POST → store a new backup (overwrites previous)
 *
 * Requires Upstash Redis connected via Vercel Marketplace.
 * Env vars (auto-injected by Vercel): KV_REST_API_URL, KV_REST_API_TOKEN
 *
 * Local dev: add these to .env.local from your Upstash dashboard.
 * If vars are absent the endpoint returns 503 and the client skips silently.
 */

const BACKUP_KEY = "brickledger:backup";
const ONE_YEAR   = 60 * 60 * 24 * 365;

function getKv() {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  // Upstash Redis REST API — no package needed, plain fetch
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
        body: JSON.stringify(JSON.stringify(value)), // Upstash stores as string
      });
    },
  };
}

const { setCors, internalError } = require("./_cors");

module.exports = async function handler(req, res) {
  if (setCors(req, res, "GET, POST, OPTIONS")) return res.status(200).end();

  // Require a shared secret so only the app owner can read/write backups.
  // Set BACKUP_SECRET in .env.local and Vercel env vars (any long random string).
  const secret = process.env.BACKUP_SECRET || "";
  if (secret && req.headers["x-backup-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const kv = getKv();
  if (!kv) {
    return res.status(503).json({
      error: "not_configured",
      message: "Cloud backup not configured — add KV_REST_API_URL and KV_REST_API_TOKEN to env vars.",
    });
  }

  // ── GET: fetch backup ─────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const backup = await kv.get(BACKUP_KEY);
      if (!backup) return res.status(404).json({ error: "no_backup" });
      return res.status(200).json(backup);
    } catch (err) {
      return internalError(res, err, "cloud-backup GET");
    }
  }

  // ── POST: save backup ─────────────────────────────────────────────────────
  if (req.method === "POST") {
    try {
      const backup = req.body;
      if (!backup || backup.app !== "BrickLedger") {
        return res.status(400).json({ error: "invalid_payload" });
      }
      await kv.set(BACKUP_KEY, backup, ONE_YEAR);
      return res.status(200).json({ ok: true, savedAt: new Date().toISOString() });
    } catch (err) {
      return internalError(res, err, "cloud-backup POST");
    }
  }

  return res.status(405).json({ error: "method_not_allowed" });
};
