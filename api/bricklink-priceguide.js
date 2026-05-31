const { setCors, internalError } = require("./_cors");
const { requireAuth } = require("./_auth");
const { rateLimitAllow } = require("./_ratelimit");

module.exports = async function handler(req, res) {
  if (setCors(req, res, "GET, OPTIONS")) return res.status(200).end();

  const userId = await requireAuth(req, res);
  if (!userId) return;

  if (!(await rateLimitAllow(userId, { limit: 1000, windowSeconds: 60, bucket: "proxy" }))) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "rate_limited" });
  }

  let number = String(req.query.number || "").trim();

  if (!number || number === "-1") {
    return res.status(400).json({
      error: "Missing set number",
      message: "Provide a valid LEGO set number via ?number=75192-1"
    });
  }

  number = number.replace(/\s+/g, "");
  if (!number.includes("-")) number = `${number}-1`;

  if (!/^\d{3,8}-\d+$/.test(number)) {
    return res.status(400).json({
      error: "Invalid set number",
      message: `Invalid LEGO set number: ${number}`
    });
  }

  const sessionToken = req.headers["x-bl-session-token"];
  if (!sessionToken) {
    return res.status(401).json({
      error: "Missing x-bl-session-token header",
      message: "Authenticate via /api/bricklink-auth first."
    });
  }

  const CLIENT_ID = "ca629c09-4d8c-45dc-8a6f-bfb2b058f720";

  // ── Try primary API endpoint ─────────────────────────────────
  const primaryUrl =
    `https://api.bricklink.com/api/store/v1/items/SET/${encodeURIComponent(number)}/price` +
    `?guide_type=sold&new_or_used=N&country_code=US&region=north_america&currency_code=USD`;

  try {
    const primaryRes = await fetch(primaryUrl, {
      headers: {
        "x-bl-session-token": sessionToken,
        "x-bl-tpa-client-id": CLIENT_ID,
        "User-Agent": "LEGO Buy Target App/1.0",
        accept: "application/json"
      }
    });

    if (primaryRes.ok) {
      const text = await primaryRes.text();
      try {
        const json = JSON.parse(text);
        const d = json.data || json;

        // Fetch used prices from the same API
        const usedUrl =
          `https://api.bricklink.com/api/store/v1/items/SET/${encodeURIComponent(number)}/price` +
          `?guide_type=sold&new_or_used=U&country_code=US&region=north_america&currency_code=USD`;
        let usedData = {};
        try {
          const usedRes = await fetch(usedUrl, {
            headers: {
              "x-bl-session-token": sessionToken,
              "x-bl-tpa-client-id": CLIENT_ID,
              "User-Agent": "LEGO Buy Target App/1.0",
              accept: "application/json"
            }
          });
          if (usedRes.ok) {
            const usedJson = JSON.parse(await usedRes.text());
            usedData = usedJson.data || usedJson;
          }
        } catch { /* ignore used fetch errors */ }

        return res.status(200).json({
          avg_price_new:     parseFloatOrNull(d.avg_price),
          min_price_new:     parseFloatOrNull(d.min_price),
          max_price_new:     parseFloatOrNull(d.max_price),
          qty_avg_price_new: parseFloatOrNull(d.qty_avg_price),
          avg_price_used:     parseFloatOrNull(usedData.avg_price),
          min_price_used:     parseFloatOrNull(usedData.min_price),
          max_price_used:     parseFloatOrNull(usedData.max_price),
          qty_avg_price_used: parseFloatOrNull(usedData.qty_avg_price),
          currency: d.currency_code || "USD",
          source: "bricklink"
        });
      } catch {
        // Primary API returned non-JSON — no usable price data.
        return res.status(502).json({ error: "BrickLink returned invalid JSON" });
      }
    }

    // Primary API did not return OK (expired session 401/403, or upstream error).
    return res.status(primaryRes.status).json({
      error: "BrickLink price lookup failed",
      message: `HTTP ${primaryRes.status}`
    });
  } catch (err) {
    return internalError(res, err, "bricklink-priceguide");
  }
};

function parseFloatOrNull(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}
