const { setCors, internalError } = require("./_cors");

/**
 * Returns all LEGO themes from the Brickset API.
 * Response: { themes: ["Architecture", "City", ...] }
 * Cached client-side for 30 days — this endpoint is called rarely.
 */
module.exports = async function handler(req, res) {
  if (setCors(req, res, "GET, OPTIONS")) return res.status(200).end();

  const apiKey = process.env.BRICKSET_API_KEY || "";
  if (!apiKey) {
    return res.status(503).json({ error: "no_key", message: "Brickset API key not configured." });
  }

  try {
    const apiUrl = `https://brickset.com/api/v3.asmx/getThemes?apiKey=${encodeURIComponent(apiKey)}`;
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

    const themes = (json.themes || [])
      .map(t => t.theme)
      .filter(Boolean)
      .sort();

    return res.status(200).json({ themes });
  } catch (err) {
    return internalError(res, err, "brickset-themes");
  }
};
