const { setCors, internalError } = require("./_cors");
const { requireAuth } = require("./_auth");
const { rateLimitAllow } = require("./_ratelimit");
const { fetchWithTimeout, FetchFailure, sendSourceError } = require("./_fetch");

const SOURCE = "bricklink";

module.exports = async function handler(req, res) {
  if (setCors(req, res, "POST, OPTIONS")) return res.status(200).end();

  const userId = await requireAuth(req, res);
  if (!userId) return;

  if (!(await rateLimitAllow(userId, { limit: 1000, windowSeconds: 60, bucket: "proxy" }))) {
    return sendSourceError(res, {
      kind: "rate_limited", source: SOURCE,
      message: "Too many requests — please retry shortly.", retryAfter: 60,
    });
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
    const response = await fetchWithTimeout(
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
      },
      { timeoutMs: 12_000 }
    );

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return sendSourceError(res, {
        kind: "bad_gateway", source: SOURCE,
        message: "BrickLink auth returned a non-JSON response.",
      });
    }

    if (!response.ok) {
      return sendSourceError(res, {
        kind: "upstream_error", source: SOURCE,
        message: "BrickLink authentication failed.", status: response.status,
      });
    }

    const sessionToken = data.sessionToken || data.session_token || data.token;
    if (!sessionToken) {
      return sendSourceError(res, {
        kind: "bad_gateway", source: SOURCE,
        message: "BrickLink auth response had no session token.",
      });
    }

    return res.status(200).json({ sessionToken });
  } catch (err) {
    if (err instanceof FetchFailure) {
      return sendSourceError(res, {
        kind: err.kind === "timeout" ? "timeout" : "upstream_error",
        source: SOURCE,
        message: err.kind === "timeout"
          ? "BrickLink request timed out."
          : "Could not reach BrickLink.",
      });
    }
    return internalError(res, err, "bricklink-auth");
  }
};
