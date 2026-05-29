/**
 * Authenticated fetch for /api proxy + sync endpoints.
 *
 * Attaches the current Clerk session JWT as a Bearer token so the server can
 * verify the caller (see api/_auth.js). Works from both React components and
 * plain util modules via the global `window.Clerk` instance that clerk-js
 * installs once loaded — no need to thread useAuth().getToken() everywhere.
 *
 * If the user isn't signed in (no token), the request goes out without auth and
 * the server responds 401 — these data features require an account by design.
 */
export async function apiFetch(url, opts = {}) {
  let token = null;
  try {
    token = await window.Clerk?.session?.getToken?.();
  } catch {
    /* not signed in / Clerk not ready — server will 401 */
  }
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...opts, headers });
}
