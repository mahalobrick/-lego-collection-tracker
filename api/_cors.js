/**
 * Shared CORS + security helpers for all API routes.
 *
 * Allowed origins:
 *   APP_ORIGIN  — set this in .env.local and Vercel env vars to your production URL
 *                 e.g. https://my-app.vercel.app
 *   localhost   — always allowed in dev so `npm run dev` keeps working
 *
 * If APP_ORIGIN is not set the server only allows localhost origins,
 * which is safe for purely local use.
 */

const DEV_ORIGINS = ["http://localhost:5179", "http://localhost:5173", "http://localhost:3000"];

const ALLOWED_ORIGINS = [
  ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : []),
  ...DEV_ORIGINS,
];

/**
 * Set CORS headers and return true if the request is a preflight that
 * should be ended immediately.
 *
 * Usage:
 *   if (setCors(req, res, "GET, OPTIONS")) return res.status(200).end();
 */
function setCors(req, res, methods = "GET, OPTIONS") {
  const origin = req.headers.origin || "";
  // Reflect the requesting origin only if it's on the allow-list.
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : null;

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", allowed);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-bl-session-token, x-backup-secret, Authorization"
  );

  return req.method === "OPTIONS";
}

/**
 * Return a safe 500 response — logs the real error server-side
 * but never exposes err.message (which can contain API keys/URLs) to callers.
 */
function internalError(res, err, context = "") {
  console.error(`[BrickLedger API error]${context ? " " + context : ""}:`, err);
  return res.status(500).json({ error: "Internal server error" });
}

module.exports = { setCors, internalError };
