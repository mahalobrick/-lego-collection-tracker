/**
 * /api/brickfanatics-retiring
 *
 * Scrapes the Brick Fanatics "every LEGO set retiring" article via ScraperAPI,
 * which bypasses Cloudflare's managed challenge.
 *
 * Requires env var: SCRAPERAPI_KEY
 * Free tier: 1,000 credits/month. JS render = 5 credits. 1 req/day = ~150/month → free forever.
 *
 * CDN-cached 24 hours. Client caches in localStorage to avoid repeat hits.
 *
 * Optional query param: ?debug=1  → returns raw HTML for parser tuning
 * Optional query param: ?number=75192 → returns { retiring: bool, wave, theme }
 */

const BF_URL =
  "https://www.brickfanatics.com/every-lego-set-retiring-this-year-and-beyond";

// ── HTML helpers ─────────────────────────────────────────────────────────────

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "–")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Theme name normalisation ─────────────────────────────────────────────────

function parseTheme(rawHeading) {
  return rawHeading
    .replace(/retiring\s+/i, "")
    .replace(/\s+sets?\s*$/i, "")
    .replace(/^lego\s+/i, "")
    .trim();
}

// ── Retirement wave / timing extraction ─────────────────────────────────────

function parseWave(text) {
  const wm = text.match(/Wave\s*(\d+)\s*(20\d{2})/i);
  if (wm) return `Wave ${wm[1]} ${wm[2]}`;

  const qm = text.match(/Q([1-4])\s*(20\d{2})/i);
  if (qm) return `Q${qm[1]} ${qm[2]}`;

  // Month + Year: "December 2025"
  const mm = text.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i
  );
  if (mm) return `${mm[1]} ${mm[2]}`;

  // Bare year
  const ym = text.match(/\b(202[5-9]|20[3-9]\d)\b/);
  if (ym) return ym[1];

  if (/tbc|tbd|unknown/i.test(text)) return "TBC";
  return null;
}

// ── LEGO set number extraction ───────────────────────────────────────────────
// Matches 4-6 digit sequences; skips year-range numbers like 2025-2029.

function extractSetNumber(text) {
  const nums = text.match(/\b(\d{4,6})\b/g) || [];
  return (
    nums.find((n) => {
      const v = parseInt(n, 10);
      return v >= 100 && v < 200000 && !(v >= 2020 && v <= 2035);
    }) || null
  );
}

// ── HTML → structured set list ───────────────────────────────────────────────
// Article structure:
//   <h2> → theme  (e.g. "Retiring LEGO Star Wars sets")
//   <h4> → exact retirement date  (e.g. "July 31, 2026")
//   <table><tbody><tr><td> → one set per row
//     first <td> contains an <a data-set-number="NNNNN"> or plain "NNNNN Name"

function parseArticle(html) {
  // Isolate article body
  const artMatch = html.match(/class="[^"]*entry-content[^"]*"[^>]*>([\s\S]{1,600000})/i);
  const body = artMatch ? artMatch[1] : html;

  const sets = [];
  let currentTheme = "Unknown";
  let currentDate  = "TBC";

  // Walk all h2, h4, and tr elements in document order
  const TOKEN_RE = /<(h2|h4|tr)([^>]*)>([\s\S]*?)<\/(h2|h4|tr)>/gi;
  let m;
  while ((m = TOKEN_RE.exec(body)) !== null) {
    const tag     = m[1].toLowerCase();
    const inner   = m[3];
    const text    = stripTags(inner).replace(/\s+/g, " ").trim();

    if (tag === "h2") {
      if (/lego|retiring/i.test(text)) {
        currentTheme = parseTheme(text);
      }
      continue;
    }

    if (tag === "h4") {
      currentDate = text || "TBC";
      continue;
    }

    // tr — grab first <td>
    const tdMatch = inner.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    if (!tdMatch) continue;

    const firstCell = tdMatch[1];

    // Prefer data-set-number attribute (most reliable)
    const attrMatch = firstCell.match(/data-set-number="(\d{4,6})"/);
    let setNumber = attrMatch ? attrMatch[1] : null;

    // Fall back to leading digits in cell text
    const cellText = stripTags(firstCell).replace(/\s+/g, " ").trim();
    if (!setNumber) {
      const numMatch = cellText.match(/^(\d{4,6})\b/);
      setNumber = numMatch ? numMatch[1] : null;
    }

    if (!setNumber) continue;
    if (sets.some((s) => s.setNumber === setNumber)) continue; // dedupe

    // Name = cell text minus leading set number
    const name = cellText.replace(/^\d+\s*[-–]?\s*/, "").trim();

    sets.push({
      setNumber,
      name,
      theme: currentTheme,
      retirementDate: currentDate,
    });
  }

  return sets;
}

// ── Handler ──────────────────────────────────────────────────────────────────

const { setCors, internalError } = require("./_cors");
const { requireAuth } = require("./_auth");

module.exports = async function handler(req, res) {
  if (setCors(req, res, "GET, OPTIONS")) return res.status(200).end();

  const userId = await requireAuth(req, res);
  if (!userId) return;

  const apiKey = process.env.SCRAPERAPI_KEY || "";
  if (!apiKey) {
    return res.status(503).json({
      error: "no_key",
      message: "SCRAPERAPI_KEY not configured — add it to .env.local and Vercel env vars.",
    });
  }

  try {
    // render=true → headless Chrome → bypasses Cloudflare JS challenge
    const scraperUrl =
      `http://api.scraperapi.com` +
      `?api_key=${encodeURIComponent(apiKey)}` +
      `&url=${encodeURIComponent(BF_URL)}` +
      `&render=true`;

    const r = await fetch(scraperUrl, {
      headers: { Accept: "text/html" },
      // ScraperAPI can take 20-30s on JS render — set a generous timeout
      signal: AbortSignal.timeout(45_000),
    });

    if (!r.ok) {
      return res.status(502).json({
        error: "scraper_error",
        status: r.status,
        message: `ScraperAPI returned HTTP ${r.status}`,
      });
    }

    const html = await r.text();

    // Debug mode — only available when BF_DEBUG=1 is set server-side
    if (process.env.BF_DEBUG === "1" && String(req.query?.debug || "") === "1") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).end(html.slice(0, 50_000));
    }

    const sets = parseArticle(html);

    if (sets.length === 0) {
      return res.status(502).json({
        error: "parse_failed",
        message:
          "Parsed 0 sets — the article structure may have changed. Use ?debug=1 to inspect the raw HTML.",
      });
    }

    res.setHeader(
      "Cache-Control",
      "s-maxage=604800, stale-while-revalidate=86400"
    );

    // Single-set lookup mode
    const queryNum = String(req.query?.number || "").trim().replace(/-1$/, "");
    if (queryNum) {
      const match = sets.find(
        (s) => s.setNumber === queryNum || s.setNumber === `${queryNum}-1`
      );
      return res.status(200).json({
        retiring: !!match,
        retirementDate: match?.retirementDate || null,
        theme: match?.theme || null,
        name: match?.name || null,
        fetchedAt: new Date().toISOString(),
        source: "Brick Fanatics",
      });
    }

    return res.status(200).json({
      sets,
      total: sets.length,
      fetchedAt: new Date().toISOString(),
      source: "Brick Fanatics",
    });
  } catch (err) {
    return internalError(res, err, "brickfanatics-retiring");
  }
};
