/**
 * Shared upstream-fetch + typed-error infra for /api proxies.
 *
 * Two layers, DELIBERATELY SPLIT (docs/integration-standard.md §4 "S4 wrapper scope, RATIFIED"):
 *
 *  1. fetchWithTimeout — UNIVERSAL. Every proxy upstream fetch (sync.js included) goes through it.
 *     It applies an AbortSignal timeout and maps an abort/network throw to a typed FetchFailure.
 *     This is the part the (S5) no-bare-fetch lock enforces everywhere.
 *
 *  2. sendSourceError — DATA-SOURCE ONLY. The B2 failure envelope
 *     { ok:false, error:{ kind, source, message, status?, retryAfter? } }, with a FIXED kind->HTTP
 *     status map. Curated messages only — it never receives or forwards the upstream body (this is what
 *     retires BE's raw-passthrough-on-failure when BE migrates in S5). sync.js does NOT use this: it
 *     keeps its own Upstash error handling and never emits a data-source envelope (no fake "upstash").
 */

const DEFAULT_TIMEOUT_MS = 15_000;

// Thrown by fetchWithTimeout. `.kind` is "timeout" (abort fired) or "network" (everything else).
// Callers decide how to surface it — data-source proxies map it onto sendSourceError; sync.js handles
// it itself.
class FetchFailure extends Error {
  constructor(kind, message, cause) {
    super(message);
    this.name = "FetchFailure";
    this.kind = kind;
    if (cause !== undefined) this.cause = cause;
  }
}

async function fetchWithTimeout(url, opts = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    // The wrapper owns the timeout — callers pass timeoutMs, not their own signal.
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = err && err.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new FetchFailure("timeout", `Upstream timed out after ${timeoutMs}ms`, err);
    }
    throw new FetchFailure("network", "Upstream fetch failed", err);
  }
}

// Fixed kind -> HTTP status for OUR response. The envelope's optional `status` carries the *upstream*
// status when relevant — distinct from the response status, which is derived from `kind`.
const KIND_STATUS = {
  bad_request:    400,
  not_found:      404,
  rate_limited:   429,
  internal:       500,
  bad_gateway:    502,
  upstream_error: 502,
  not_configured: 503,
  timeout:        504,
};

function sendSourceError(res, { kind, source, message, status, retryAfter }) {
  const httpStatus = KIND_STATUS[kind] || 500;
  const error = { kind, source, message };
  if (status !== undefined && status !== null) error.status = status;
  if (retryAfter !== undefined && retryAfter !== null) {
    error.retryAfter = retryAfter;
    res.setHeader("Retry-After", String(retryAfter));
  }
  return res.status(httpStatus).json({ ok: false, error });
}

module.exports = { fetchWithTimeout, FetchFailure, sendSourceError, KIND_STATUS, DEFAULT_TIMEOUT_MS };
