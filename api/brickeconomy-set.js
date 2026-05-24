module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

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
    const response = await fetch(apiUrl, {
      headers: {
        accept: "application/json",
        "User-Agent": "LEGO Buy Target App/1.0",
        "x-apikey": process.env.BRICKECONOMY_API_KEY || ""
      }
    });

    const text = await response.text();

    if (response.status === 429) {
      return res.status(429).json({
        error: "BrickEconomy quota reached",
        message: "BrickEconomy rate limit reached. Try again after your quota resets."
      });
    }

    try {
      return res.status(response.status).json(JSON.parse(text));
    } catch {
      return res.status(502).json({
        error: "BrickEconomy returned HTML",
        preview: text.slice(0, 300)
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
