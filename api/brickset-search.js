const { setCors, internalError } = require("./_cors");
const { requireAuth } = require("./_auth");
const { rateLimitAllow } = require("./_ratelimit");
const { fetchWithTimeout, FetchFailure, sendSourceError } = require("./_fetch");

const SOURCE = "brickset";

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

  const q         = String(req.query.q         || "").trim();
  const theme     = String(req.query.theme     || "").trim();
  const setNumber = String(req.query.setNumber || "").trim();

  if (!q && !theme && !setNumber) {
    return res.status(400).json({ error: "Provide ?q= (name/number search), ?setNumber= (exact/prefix), or ?theme=" });
  }

  const apiKey = process.env.BRICKSET_API_KEY || "";
  if (!apiKey) {
    return sendSourceError(res, {
      kind: "not_configured", source: SOURCE,
      message: "Brickset API key not configured.",
    });
  }

  const params = {
    pageSize: 20,
    orderBy: setNumber ? "SetNumberASC" : "YearFromDESC",
    ...(setNumber ? { setNumber } : {}),
    ...(q         ? { query: q } : {}),
    ...(theme     ? { theme }    : {}),
  };

  const apiUrl = `https://brickset.com/api/v3.asmx/getSets?apiKey=${encodeURIComponent(apiKey)}&userHash=&params=${encodeURIComponent(JSON.stringify(params))}`;

  try {
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

    const sets = (json.sets || []).map(s => ({
      setNumber:    `${s.number}-${s.numberVariant || 1}`,
      name:         s.name         || "",
      theme:        s.theme        || "",
      subtheme:     s.subtheme     || "",
      year:         s.year         || null,
      pieces:       s.pieces       || null,
      minifigs:     s.minifigs     || null,
      msrp:         (s.LEGOCom?.US?.retailPrice) || null,
      availability: s.availability || "",
      thumbnail:    (s.image?.thumbnailURL) || "",
    }));

    return res.status(200).json({ sets, total: json.matches || sets.length });
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
    return internalError(res, err, "brickset-search");
  }
};
