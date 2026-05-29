/**
 * Shared Clerk authentication for API routes.
 *
 * Every /api endpoint that spends a server-held secret (the data proxies) or
 * touches user data (sync) must gate on this. CORS is NOT access control — a
 * curl/script with no Origin still reaches the handler — so the auth check is
 * the real boundary.
 *
 * AUTH-1: verifyToken enforces the `azp` (authorized party) claim via
 * authorizedParties, so a token minted for a different origin on the same Clerk
 * instance is rejected. APP_ORIGIN is the production origin; localhost covers dev.
 */
const { verifyToken } = require("@clerk/backend");

// Origins allowed as the token's authorized party (azp claim).
const AUTHORIZED_PARTIES = [
  process.env.APP_ORIGIN,
  "http://localhost:5179",
  "http://localhost:5173",
  "http://localhost:3000",
].filter(Boolean);

/** Verify the Clerk Bearer token → return the userId (sub), or null if missing/invalid. */
async function authenticate(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      authorizedParties: AUTHORIZED_PARTIES,
    });
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
