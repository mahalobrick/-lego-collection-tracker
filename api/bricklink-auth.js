const { setCors, internalError } = require("./_cors");
const { requireAuth } = require("./_auth");
const { rateLimitAllow } = require("./_ratelimit");

module.exports = async function handler(req, res) {
  if (setCors(req, res, "POST, OPTIONS")) return res.status(200).end();

  const userId = await requireAuth(req, res);
  if (!userId) return;

  if (!(await rateLimitAllow(userId, { limit: 500, windowSeconds: 60, bucket: "proxy" }))) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "rate_limited" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = "";
  try {
    body = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", chunk => { data += chunk; });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  } catch (err) {
    return res.status(400).json({ error: "Could not read request body" });
  }

  let accessToken;
  try {
    const parsed = JSON.parse(body);
    accessToken = parsed.accessToken;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
    return res.status(400).json({ error: "Missing accessToken in request body" });
  }

  const CLIENT_ID = "ca629c09-4d8c-45dc-8a6f-bfb2b058f720";

  try {
    const response = await fetch(
      "https://account.prod.member.bricklink.info/api/v1/actions/verify-and-create-session",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "LEGO Buy Target App/1.0"
        },
        body: JSON.stringify({
          clientId: CLIENT_ID,
          clientToken: accessToken.trim()
        })
      }
    );

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: "BrickLink auth returned invalid JSON" });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "BrickLink auth failed",
        message: data.message || data.error || `HTTP ${response.status}`
      });
    }

    const sessionToken = data.sessionToken || data.session_token || data.token;
    if (!sessionToken) {
      return res.status(502).json({ error: "No sessionToken in BrickLink response" });
    }

    return res.status(200).json({ sessionToken });
  } catch (err) {
    return internalError(res, err, "bricklink-auth");
  }
};
