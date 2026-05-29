const { setCors, internalError } = require("./_cors");
const { requireAuth } = require("./_auth");
const { rateLimitAllow } = require("./_ratelimit");

module.exports = async function handler(req, res) {
  if (setCors(req, res, "GET, OPTIONS")) return res.status(200).end();

  const userId = await requireAuth(req, res);
  if (!userId) return;

  if (!(await rateLimitAllow(userId, { limit: 500, windowSeconds: 60, bucket: "proxy" }))) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "rate_limited" });
  }

  const apiKey = process.env.BRICKECONOMY_API_KEY || "";
  if (!apiKey) {
    return res.status(500).json({
      error: "Missing API key",
      message: "BRICKECONOMY_API_KEY is not configured."
    });
  }

  try {
    const response = await fetch("https://www.brickeconomy.com/api/v1/collection/sets", {
      headers: {
        "accept": "application/json",
        "User-Agent": "BrickLedger/1.0",
        "x-apikey": apiKey
      }
    });

    const text = await response.text();

    if (response.status === 429) {
      return res.status(429).json({
        error: "BrickEconomy quota reached",
        message: "BrickEconomy rate limit reached. Try again after your quota resets."
      });
    }

    if (response.status === 401) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "BrickEconomy API key is invalid or missing."
      });
    }

    try {
      return res.status(response.status).json(JSON.parse(text));
    } catch {
      return res.status(502).json({ error: "BrickEconomy returned unexpected response" });
    }
  } catch (err) {
    return internalError(res, err, "brickeconomy-collection");
  }
};
