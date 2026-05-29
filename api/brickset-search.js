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

  const q         = String(req.query.q         || "").trim();
  const theme     = String(req.query.theme     || "").trim();
  const setNumber = String(req.query.setNumber || "").trim();

  if (!q && !theme && !setNumber) {
    return res.status(400).json({ error: "Provide ?q= (name/number search), ?setNumber= (exact/prefix), or ?theme=" });
  }

  const apiKey = process.env.BRICKSET_API_KEY || "";
  if (!apiKey) {
    return res.status(503).json({ error: "no_key", message: "Brickset API key not configured." });
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
    const response = await fetch(apiUrl, {
      headers: { accept: "application/json", "User-Agent": "BrickLedger/1.0" }
    });
    const text = await response.text();

    let json;
    try { json = JSON.parse(text); } catch {
      return res.status(502).json({ error: "Brickset returned invalid JSON" });
    }

    if (json.status === "error") {
      return res.status(400).json({ error: "brickset_error", message: json.message });
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
    return internalError(res, err, "brickset-search");
  }
};
