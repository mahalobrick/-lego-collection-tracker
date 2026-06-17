/**
 * Shared BrickLink constants for the two BL endpoints (bricklink-auth, bricklink-priceguide).
 *
 * BL_TPA_CLIENT_ID — the BrickLink third-party-app (TPA) client id. This is a PUBLIC client
 * identifier (sent in the `x-bl-tpa-client-id` header and the verify-and-create-session `clientId`),
 * NOT a secret: the actual credential is the user's own session token, never an app secret. It lives
 * in ONE place so both endpoints share a single source (no duplicated literal), and it's overridable
 * via the BL_TPA_CLIENT_ID env var for rotation hygiene (L1, Jun-17 audit). The fallback is the
 * current value, so this is non-breaking — it works with no env var set; the env var is an optional
 * override.
 */
const DEFAULT_BL_TPA_CLIENT_ID = "ca629c09-4d8c-45dc-8a6f-bfb2b058f720";
const BL_TPA_CLIENT_ID = process.env.BL_TPA_CLIENT_ID || DEFAULT_BL_TPA_CLIENT_ID;

module.exports = { BL_TPA_CLIENT_ID, DEFAULT_BL_TPA_CLIENT_ID };
