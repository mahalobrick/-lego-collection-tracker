// Throwaway BrickLink Store API smoke test — NOT app code, NOT wired into anything.
// Run: node scripts/bl-price-test.mjs
//
// Proves the BrickLink Store API works end-to-end from this machine and prints the
// price-guide numbers for one set (75298-1, AT-AT). Reads creds from .env.local only.
// Never hardcodes, logs, or prints a secret value.
//
// OAuth 1.0a / HMAC-SHA1 via oauth-1.0a + node:crypto.
// GOTCHA handled below: BrickLink folds the query-string params into the OAuth
// signature base string, and oauth-1.0a does NOT parse them out of the URL — so the
// params are passed via `data` to oauth.authorize() (to be signed) AND appended to the
// fetch URL's query string. Same object for both, so the base string matches.

import crypto from "node:crypto";
import OAuth from "oauth-1.0a";
import { loadEnvKey } from "./lib/env.mjs";

// ── Creds (names only ever printed, never values) ────────────────────────────
const CRED_NAMES = ["BL_CONSUMER_KEY", "BL_CONSUMER_SECRET", "BL_TOKEN", "BL_TOKEN_SECRET"];
const creds = Object.fromEntries(CRED_NAMES.map((n) => [n, loadEnvKey(n)]));
const missing = CRED_NAMES.filter((n) => !creds[n]);
if (missing.length) {
  console.error(`Missing required cred(s) in .env.local: ${missing.join(", ")}`);
  console.error("(no values printed — set the var name(s) above and re-run)");
  process.exit(1);
}

// ── OAuth signer ─────────────────────────────────────────────────────────────
const oauth = OAuth({
  consumer: { key: creds.BL_CONSUMER_KEY, secret: creds.BL_CONSUMER_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(baseString, key) {
    return crypto.createHmac("sha1", key).update(baseString).digest("base64");
  },
});
const token = { key: creds.BL_TOKEN, secret: creds.BL_TOKEN_SECRET };

const SET = "75298-1";
const BASE_URL = `https://api.bricklink.com/api/store/v1/items/SET/${SET}/price`;

/** One signed price-guide call. Returns { ok, meta, data } or { ok:false, error }. */
async function priceGuide(params) {
  // params signed via `data` (the gotcha) AND appended to the URL query string.
  const requestData = { url: BASE_URL, method: "GET", data: params };
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));
  const url = `${BASE_URL}?${new URLSearchParams(params).toString()}`;
  try {
    const res = await fetch(url, { method: "GET", headers: { ...authHeader, Accept: "application/json" } });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); }
    catch { return { ok: false, error: `HTTP ${res.status}: non-JSON body (first 200 chars): ${text.slice(0, 200)}` }; }
    const meta = body.meta || {};
    if (meta.code !== 200) return { ok: false, meta };
    return { ok: true, meta, data: body.data || {} };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${e.message}` };
  }
}

const CALLS = [
  { label: "SOLD / NEW ", params: { guide_type: "sold",  new_or_used: "N", currency_code: "USD" } },
  { label: "SOLD / USED", params: { guide_type: "sold",  new_or_used: "U", currency_code: "USD" } },
  { label: "STOCK / NEW", params: { guide_type: "stock", new_or_used: "N", currency_code: "USD" } },
];

const money = (v) => (v == null || v === "" ? "—" : `$${Number(v).toFixed(2)}`);

console.log(`BrickLink price-guide smoke test — SET ${SET}\n${"─".repeat(64)}`);

const summary = [];
for (const { label, params } of CALLS) {
  const r = await priceGuide(params);
  if (!r.ok) {
    if (r.meta) console.error(`[${label}] meta.code ${r.meta.code}: ${r.meta.message} — ${r.meta.description}`);
    else console.error(`[${label}] ${r.error}`);
    summary.push({ label, failed: r.meta ? `meta ${r.meta.code}` : "error" });
    continue;
  }
  const d = r.data;
  console.log(
    `[${label}] avg=${money(d.avg_price)}  min=${money(d.min_price)}  max=${money(d.max_price)}  ` +
    `qty_avg=${money(d.qty_avg_price)}  lots(unit_quantity)=${d.unit_quantity}  items(total_quantity)=${d.total_quantity}`
  );
  summary.push({ label, d });
}

// ── Clean labeled summary ─────────────────────────────────────────────────────
console.log(`${"─".repeat(64)}\nSUMMARY (currency USD)`);
for (const s of summary) {
  if (s.failed) { console.log(`  ${s.label}:  (no data — ${s.failed})`); continue; }
  const d = s.d;
  const sales = s.label.startsWith("STOCK") ? `${d.unit_quantity} listings` : `${d.unit_quantity} sales`;
  console.log(`  ${s.label}:  avg ${money(d.avg_price)} | min ${money(d.min_price)} | max ${money(d.max_price)} | ${sales}`);
}
