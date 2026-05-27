const { setCors, internalError } = require("./_cors");

module.exports = async function handler(req, res) {
  if (setCors(req, res, "GET, OPTIONS")) return res.status(200).end();

  let number = String(req.query.number || "").trim();

  if (!number || number === "-1") {
    return res.status(400).json({
      error: "Missing set number",
      message: "Enter a valid LEGO set number before looking up Brickset data."
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

  const apiKey = process.env.BRICKSET_API_KEY || "";

  if (!apiKey) {
    return res.status(503).json({
      error: "no_key",
      message: "Brickset API key not configured."
    });
  }

  const params = JSON.stringify({ setNumber: number });
  const apiUrl = `https://brickset.com/api/v3.asmx/getSets?apiKey=${encodeURIComponent(apiKey)}&userHash=&params=${encodeURIComponent(params)}`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        accept: "application/json",
        "User-Agent": "LEGO Buy Target App/1.0"
      }
    });

    const text = await response.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Brickset returned invalid JSON",
        preview: text.slice(0, 300)
      });
    }

    if (json.status === "error") {
      return res.status(400).json({
        error: "brickset_error",
        message: json.message || "Brickset API returned an error."
      });
    }

    if (!json.sets || json.sets.length === 0) {
      return res.status(404).json({
        error: "not_found",
        message: `No Brickset data found for set ${number}.`
      });
    }

    const s = json.sets[0];

    const lego = s.LEGOCom || {};
    const data = {
      set_number:       `${s.number || ""}-${s.numberVariant || 1}`,
      name:             s.name || "",
      year:             s.year || null,
      theme:            s.theme || "",
      theme_group:      s.themeGroup || "",
      subtheme:         s.subtheme || "",
      pieces:           s.pieces || null,
      minifigs:         s.minifigs || null,
      rating:           s.rating || null,
      review_count:     s.reviewCount || 0,
      packaging_type:   s.packagingType || "",
      age_min:          (s.ageRange && s.ageRange.min) || null,
      height:           (s.dimensions && s.dimensions.height) || null,
      width:            (s.dimensions && s.dimensions.width) || null,
      depth:            (s.dimensions && s.dimensions.depth) || null,
      image_url:        (s.image && s.image.imageURL) || "",
      thumbnail_url:    (s.image && s.image.thumbnailURL) || "",
      brickset_url:     s.bricksetURL || "",
      availability:     s.availability || "",
      released:         !!s.released,
      // Official MSRP from LEGO.com
      retail_price_us:  (lego.US && lego.US.retailPrice) || null,
      retail_price_uk:  (lego.UK && lego.UK.retailPrice) || null,
      retail_price_ca:  (lego.CA && lego.CA.retailPrice) || null,
      retail_price_de:  (lego.DE && lego.DE.retailPrice) || null,
      // Real retirement date from LEGO
      launch_date:      s.launchDate || null,
      exit_date:        s.exitDate || null,
      // Community data
      owned_by:         (s.collections && s.collections.ownedBy) || null,
      wanted_by:        (s.collections && s.collections.wantedBy) || null,
      // Extra
      instructions_count: s.instructionsCount || null,
      ean:              (s.barcode && s.barcode.EAN) || "",
      tags:             (s.extendedData && s.extendedData.tags) || [],
    };

    return res.status(200).json({ data });
  } catch (err) {
    return internalError(res, err, "brickset-set");
  }
};
