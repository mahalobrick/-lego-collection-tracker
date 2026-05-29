/**
 * Authenticated fetch for /api proxy + sync endpoints.
 *
 * Attaches the current Clerk session JWT as a Bearer token so the server can
 * verify the caller (see api/_auth.js). Works from both React components and
 * plain util modules via the global `window.Clerk` instance that clerk-js
 * installs once loaded — no need to thread useAuth().getToken() everywhere.
 *
 * clerk-js loads asynchronously (~200ms after first paint), and some data
 * fetches fire on mount before it's ready. We wait for Clerk to finish loading
 * before reading the token so those early calls aren't sent unauthenticated
 * (which would 401 — e.g. the themes fetch racing ahead on every load).
 *
 * If the user genuinely isn't signed in, getToken() returns null and the request
 * goes out without auth → the server responds 401 (these features require an
 * account by design).
 */

// Resolve once clerk-js has attached and finished loading (or give up after a
// few seconds so a Clerk outage never hangs a request). Returns immediately
// once loaded — only actually waits during the brief startup window.
async function waitForClerk(maxMs = 5000) {
  for (let waited = 0; waited < maxMs; waited += 100) {
    if (window.Clerk?.loaded) return;
    await new Promise(r => setTimeout(r, 100));
  }
}

export async function apiFetch(url, opts = {}) {
  let token = null;
  try {
    await waitForClerk();
    token = await window.Clerk?.session?.getToken?.();
  } catch {
    /* not signed in / Clerk unavailable — server will 401 */
  }
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...opts, headers });
}
