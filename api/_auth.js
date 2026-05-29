/**
 * Shared Clerk authentication for API routes.
 *
 * Every /api endpoint that spends a server-held secret (the data proxies) or
 * touches user data (sync) must gate on this. CORS is NOT access control — a
 * curl/script with no Origin still reaches the handler — so the auth check is
 * the real boundary.
 *
 * NOTE (Phase 1 / AUTH-1): add `authorizedParties: [process.env.APP_ORIGIN, ...]`
 * to verifyToken to enforce the azp claim. Left out here to keep Phase 0 to a
 * pure auth-gate; this helper is the single place that change will land.
 */
const { verifyToken } = require("@clerk/backend");

/** Verify the Clerk Bearer token → return the userId (sub), or null if missing/invalid. */
async function authenticate(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    return payload.sub;
  } catch {
    return null;
  }
}

/**
 * Enforce auth. Returns the userId, or null after having ALREADY sent a 401.
 * Usage:
 *   const userId = await requireAuth(req, res);
 *   if (!userId) return;
 */
async function requireAuth(req, res) {
  const userId = await authenticate(req);
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return userId;
}

module.exports = { authenticate, requireAuth };
