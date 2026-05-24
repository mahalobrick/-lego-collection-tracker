module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-bl-session-token");

  if (req.method === "OPTIONS") return res.status(200).end();

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
    `?guide_type=sold&new_or_used=N`;

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
          `?guide_type=sold&new_or_used=U`;
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
        // JSON parse failed — fall through to fallback
      }
    }

    // 401/403 or parse failure — fall through to HTML fallback
    if (primaryRes.status !== 401 && primaryRes.status !== 403 && primaryRes.ok) {
      // Unexpected non-auth error but not auth related — still try fallback
    }
  } catch { /* network error — try fallback */ }

  // ── Fallback: HTML catalog page ──────────────────────────────
  const itemNo = number.replace(/-1$/, "");
  const fallbackUrl =
    `https://www.bricklink.com/catalogPG.asp` +
    `?itemType=S&itemNo=${encodeURIComponent(itemNo)}&colorID=0&priceRemarks=Y&viewType=D&usg=1`;

  try {
    const fallbackRes = await fetch(fallbackUrl, {
      headers: {
        "x-bl-session-token": sessionToken,
        "x-bl-tpa-client-id": CLIENT_ID,
        "User-Agent": "LEGO Buy Target App/1.0"
      }
    });

    const text = await fallbackRes.text();

    // Check if it looks like JSON
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return res.status(200).json(JSON.parse(trimmed));
      } catch { /* fall through */ }
    }

    // Return raw HTML/text for client-side parsing
    return res.status(200).json({ raw: text, format: "html" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

function parseFloatOrNull(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}
