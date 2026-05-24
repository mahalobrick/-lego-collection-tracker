module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const q     = String(req.query.q     || "").trim();
  const theme = String(req.query.theme || "").trim();

  if (!q && !theme) {
    return res.status(400).json({ error: "Provide ?q= (name search) or ?theme= (theme filter)" });
  }

  const apiKey = process.env.BRICKSET_API_KEY || "";
  if (!apiKey) {
    return res.status(503).json({ error: "no_key", message: "Brickset API key not configured." });
  }

  const params = {
    pageSize: 24,
    orderBy: "YearFromDESC",
    ...(q     ? { query: q } : {}),
    ...(theme ? { theme }    : {}),
  };

  const apiUrl = `https://brickset.com/api/v3.asmx/getSets?apiKey=${encodeURIComponent(apiKey)}&userHash=&params=${encodeURIComponent(JSON.stringify(params))}`;

  try {
    const response = await fetch(apiUrl, {
      headers: { accept: "application/json", "User-Agent": "BrickLedger/1.0" }
    });
    const text = await response.text();

    let json;
    try { json = JSON.parse(text); } catch {
      return res.status(502).json({ error: "Brickset returned invalid JSON", preview: text.slice(0, 200) });
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
      exitDate:     s.exitDate     || null,
      availability: s.availability || "",
      thumbnail:    (s.image?.thumbnailURL) || "",
    }));

    return res.status(200).json({ sets, total: json.matches || sets.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
