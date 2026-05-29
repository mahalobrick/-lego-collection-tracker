/**
 * /api/lego-last-chance
 *
 * Fetches the current LEGO "Last Chance to Buy" list from lego.com.
 * Returns the set numbers (productCodes) of all officially-tagged retiring sets.
 *
 * CDN-cached for 24 hours — this runs at most once per day per edge node.
 * Client also caches in localStorage to avoid even hitting the CDN repeatedly.
 *
 * Optional query param: ?number=75192  → returns { isLastChance: bool, total: N }
 * Without param         → returns { setCodes: [...], sets: [...], total: N, fetchedAt }
 */

const LEGO_BASE = "https://www.lego.com/en-us/categories/last-chance-to-buy";
const MAX_PAGES = 12; // safety cap

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function parsePage(html) {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) return { sets: [], total: 0, perPage: 18 };

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return { sets: [], total: 0, perPage: 18 };
  }

  const apollo =
    data?.props?.pageProps?.["__APOLLO_STATE__"] || {};

  // Pull total + perPage from the first ProductQueryResult
  let total = 0;
  let perPage = 18;
  for (const [key, val] of Object.entries(apollo)) {
    if (key.startsWith("ProductQueryResult:") && val.total) {
      total = val.total;
      perPage = val.perPage || 18;
      break;
    }
  }

  // Extract set numbers from SingleVariantProduct entries
  const sets = [];
  for (const [key, val] of Object.entries(apollo)) {
    if (key.startsWith("SingleVariantProduct:") && val.productCode) {
      sets.push({
        setNumber: String(val.productCode),
        name: val.name || "",
        slug: val.slug || "",
      });
    }
  }

  return { sets, total, perPage };
}

async function fetchPage(pageNum) {
  const url =
    pageNum === 1 ? LEGO_BASE : `${LEGO_BASE}?page=${pageNum}`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return { sets: [], total: 0, perPage: 18 };
    return parsePage(await res.text());
  } catch {
    return { sets: [], total: 0, perPage: 18 };
  }
}

const { setCors, internalError } = require("./_cors");
const { requireAuth } = require("./_auth");

module.exports = async function handler(req, res) {
  if (setCors(req, res, "GET, OPTIONS")) return res.status(200).end();

  const userId = await requireAuth(req, res);
  if (!userId) return;

  try {
    // Page 1 first — gives us total so we know how many more to fetch
    const page1 = await fetchPage(1);

    if (page1.total === 0 && page1.sets.length === 0) {
      return res.status(502).json({
        error: "Could not parse LEGO Last Chance page",
      });
    }

    // Remaining pages fetched in parallel
    const totalPages = Math.min(
      Math.ceil(page1.total / page1.perPage),
      MAX_PAGES
    );
    const remainingNums = Array.from(
      { length: totalPages - 1 },
      (_, i) => i + 2
    );
    const restResults = await Promise.all(
      remainingNums.map((n) => fetchPage(n))
    );

    // Deduplicate across pages
    const seenCodes = new Set();
    const allSets = [];

    for (const { sets } of [page1, ...restResults]) {
      for (const s of sets) {
        if (!seenCodes.has(s.setNumber)) {
          seenCodes.add(s.setNumber);
          allSets.push(s);
        }
      }
    }

    // Cache at CDN for 24 hours; stale-while-revalidate gives 1hr grace window
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");

    // Single-set check mode
    const queryNum = String(req.query?.number || "").trim();
    if (queryNum) {
      const clean = queryNum.replace(/-1$/, "");
      const found = allSets.some(
        (s) => s.setNumber === clean || s.setNumber === `${clean}-1`
      );
      return res.status(200).json({
        isLastChance: found,
        total: allSets.length,
        fetchedAt: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      setCodes: allSets.map((s) => s.setNumber),
      sets: allSets,
      total: allSets.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return internalError(res, err, "lego-last-chance");
  }
};
