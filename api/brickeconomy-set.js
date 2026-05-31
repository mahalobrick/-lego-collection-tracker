const { setCors, internalError } = require("./_cors");
const { requireAuth } = require("./_auth");
const { rateLimitAllow } = require("./_ratelimit");
const { fetchWithTimeout, FetchFailure, sendSourceError } = require("./_fetch");

const SOURCE = "brickeconomy";

module.exports = async function handler(req, res) {
  if (setCors(req, res, "GET, OPTIONS")) return res.status(200).end();

  const userId = await requireAuth(req, res);
  if (!userId) return;

  if (!(await rateLimitAllow(userId, { limit: 1000, windowSeconds: 60, bucket: "proxy" }))) {
    return sendSourceError(res, {
      kind: "rate_limited", source: SOURCE,
      message: "Too many requests — please retry shortly.", retryAfter: 60,
    });
  }

  let number = String(req.query.number || "").trim();
  const currency = String(req.query.currency || "USD").trim() || "USD";

  // Stop bad requests before they hit BrickEconomy
  if (!number || number === "-1") {
    return res.status(400).json({
      error: "Missing set number",
      message: "Enter a valid LEGO set number before looking up BrickEconomy data."
    });
  }

  number = number.replace(/\s+/g, "");

  if (!number.includes("-")) {
    number = `${number}-1`;
  }

  if (!/^\d{3,8}-\d+$/.test(number)) {
    return res.status(400).json({
      error: "Invalid set number",
      message: `Invalid LEGO set number: ${number}`
    });
  }

  const apiUrl = `https://www.brickeconomy.com/api/v1/set/${encodeURIComponent(number)}?currency=${encodeURIComponent(currency)}`;

  try {
    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        accept: "application/json",
        "User-Agent": "LEGO Buy Target App/1.0",
        "x-apikey": process.env.BRICKECONOMY_API_KEY || ""
      }
    }, { timeoutMs: 12_000 });

    const text = await response.text();

    if (response.status === 429) {
      return sendSourceError(res, {
        kind: "rate_limited", source: SOURCE,
        message: "BrickEconomy rate limit reached — try again after your quota resets.",
        retryAfter: 60, status: 429,
      });
    }

    // Only a 2xx is a real payload; a non-ok upstream is an envelope, NOT the raw body
    // (retires the old raw-passthrough-on-failure).
    if (!response.ok) {
      return sendSourceError(res, {
        kind: "upstream_error", source: SOURCE,
        message: "BrickEconomy returned an error.", status: response.status,
      });
    }

    try {
      return res.status(200).json(JSON.parse(text));
    } catch {
      return sendSourceError(res, {
        kind: "bad_gateway", source: SOURCE,
        message: "BrickEconomy returned a non-JSON response.",
      });
    }
  } catch (err) {
    if (err instanceof FetchFailure) {
      return sendSourceError(res, {
        kind: err.kind === "timeout" ? "timeout" : "upstream_error",
        source: SOURCE,
        message: err.kind === "timeout"
          ? "BrickEconomy request timed out."
          : "Could not reach BrickEconomy.",
      });
    }
    return internalError(res, err, "brickeconomy-set");
  }
};
