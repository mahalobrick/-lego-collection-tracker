const { setCors, internalError } = require("./_cors");
const { requireAuth } = require("./_auth");
const { rateLimitAllow } = require("./_ratelimit");
const { fetchWithTimeout, FetchFailure, sendSourceError } = require("./_fetch");

const SOURCE = "brickset";

/**
 * Returns all LEGO themes from the Brickset API.
 * Response: { themes: ["Architecture", "City", ...] }
 * Cached client-side for 30 days — this endpoint is called rarely.
 */
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

  const apiKey = process.env.BRICKSET_API_KEY || "";
  if (!apiKey) {
    return sendSourceError(res, {
      kind: "not_configured", source: SOURCE,
      message: "Brickset API key not configured.",
    });
  }

  try {
    const apiUrl = `https://brickset.com/api/v3.asmx/getThemes?apiKey=${encodeURIComponent(apiKey)}`;
    const response = await fetchWithTimeout(apiUrl, {
      headers: { accept: "application/json", "User-Agent": "BrickLedger/1.0" }
    }, { timeoutMs: 12_000 });
    const text = await response.text();

    let json;
    try { json = JSON.parse(text); } catch {
      return sendSourceError(res, {
        kind: "bad_gateway", source: SOURCE,
        message: "Brickset returned a non-JSON response.",
      });
    }

    if (json.status === "error") {
      return sendSourceError(res, {
        kind: "bad_request", source: SOURCE,
        message: json.message || "Brickset API returned an error.",
      });
    }

    const themes = (json.themes || [])
      .map(t => t.theme)
      .filter(Boolean)
      .sort();

    return res.status(200).json({ themes });
  } catch (err) {
    if (err instanceof FetchFailure) {
      return sendSourceError(res, {
        kind: err.kind === "timeout" ? "timeout" : "upstream_error",
        source: SOURCE,
        message: err.kind === "timeout"
          ? "Brickset request timed out."
          : "Could not reach Brickset.",
      });
    }
    return internalError(res, err, "brickset-themes");
  }
};
