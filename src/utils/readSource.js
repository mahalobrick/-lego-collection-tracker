/**
 * readSource — the client-side typed-error funnel (integration P3 S6).
 *
 * Pairs with api/_fetch.js `sendSourceError`, which emits the failure envelope
 *   { ok:false, error:{ kind, source, message, status? } }
 * from every data-source proxy. This funnel turns a proxy Response into a discriminated
 * result so a client can tell "no data exists" from "the fetch broke" (integration-standard §4.2)
 * — and surface the latter — instead of swallowing every failure as a bare null.
 *
 * Layers:
 *  - readSource(res, source)   → { ok:true, data } | { ok:false, kind, source, message, status }
 *  - classifyFailure(kind, src) → { surface:boolean, message } — the "broke" vs "absent" decision
 *  - reportSourceFailure(failure) → fires ONE deduped toast for "broke" kinds; quiet for absent/admin
 *
 * Clients keep their existing return shapes (null / [] / Set) for the data-absent contract; the point
 * is that a failure now ALWAYS routes through reportSourceFailure, never a silent null.
 */

import toast from "react-hot-toast";

// Enum token (envelope `source`) → human display name.
const SOURCE_LABELS = {
  brickeconomy: "BrickEconomy",
  bricklink: "BrickLink",
  brickset: "Brickset",
  lego: "LEGO.com",
  brickfanatics: "Brick Fanatics",
};

/**
 * Parse a proxy Response into a discriminated result.
 * @param {Response} res - the fetch Response (from apiFetch)
 * @param {string} source - enum token fallback if the envelope omits `source`
 */
export async function readSource(res, source) {
  if (res.ok) {
    const data = await res.json().catch(() => null);
    return { ok: true, data };
  }

  // Failure — try to read the typed envelope { ok:false, error:{ kind, source, message, status } }.
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON failure body */
  }

  const env = body && body.error;
  if (env && typeof env === "object" && env.kind) {
    return {
      ok: false,
      kind: env.kind,
      source: env.source || source,
      message: env.message || "",
      status: env.status,
    };
  }

  // Legacy / non-envelope / non-JSON failure → synthesize a "broke" result so it still surfaces.
  return {
    ok: false,
    kind: "upstream_error",
    source,
    message: (body && (body.message || body.error)) || "",
    status: res.status,
  };
}

/**
 * The branch that matters: should this failure kind be SURFACED as a "fetch broke" signal,
 * or stay QUIET (an expected "no data" / admin state)?
 * @returns {{ surface: boolean, message: string }}
 */
export function classifyFailure(kind, source) {
  const name = SOURCE_LABELS[source] || "the source";
  switch (kind) {
    case "timeout":
      return { surface: true, message: `${name} timed out — try again.` };
    case "rate_limited":
      return { surface: true, message: `${name} is rate limited — try again shortly.` };
    case "upstream_error":
    case "bad_gateway":
      return { surface: true, message: `Couldn't reach ${name}.` };
    case "not_found":      // expected "no data" — the uncatalogued case
    case "not_configured": // admin state — handled by the existing inline "configure key" path
    default:
      return { surface: false, message: "" };
  }
}

/**
 * Surface a failure from readSource. Fires ONE toast per source ("broke" kinds only) — deduped by a
 * per-source toast id so a list view that fails N lookups shows one signal, not N. No-op for a
 * success/empty result and for quiet kinds (not_found / not_configured).
 */
export function reportSourceFailure(failure) {
  if (!failure || failure.ok) return;
  const { surface, message } = classifyFailure(failure.kind, failure.source);
  if (!surface) return;
  toast.error(message, { id: `source:${failure.source}` });
}
