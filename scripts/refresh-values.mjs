// BrickLink value-refresh batch — PRODUCTION tooling (maintained; deps in package.json).
// Run: node scripts/refresh-values.mjs
//
// Sources the owned-set list from the LIVE collection in Upstash (the per-user blobs under
// brickledger:user:*, unioned + deduped), pulls BrickLink 6-month *sold* price-guide data, walks the
// value ladder from docs/value-source-decision.md §3 (via the pure, unit-tested deriveValue in
// scripts/lib/deriveValue.mjs), and writes basis-tagged value records + trend snapshots to a SEPARATE
// shared Upstash keyspace:
//
//   value:SET:{number}   → { new: <record>|… , used: <record>|… }   (set-level cache, authoritative)
//   history:SET:{number} → Redis list, one snapshot/run (LPUSH newest, LTRIM to ~520)
//
// Each record aligns with the Workstream A provenance model so the later app-read step is a
// clean map: { amount, source:"BrickLink", condition, basis, asOf, lots }.
//
// SAFETY/FOOTPRINT: creds come from .env.local only and are NEVER logged. The NEW keyspace
// (value:SET:* / history:SET:*) is disjoint from the per-user collection keys (brickledger:user:*),
// so this write is purely additive — the app does NOT read this keyspace yet, so it cannot
// affect the live app. Reuses the proven OAuth 1.0a signing + loadEnvKey loader from
// bl-coverage-check.mjs / bl-price-test.mjs.

import crypto from "node:crypto";
import OAuth from "oauth-1.0a";
import { Redis } from "@upstash/redis";
import { loadEnvKey } from "./lib/env.mjs";
import { deriveValue } from "./lib/deriveValue.mjs";
import { collectionFromBlob, buildWorkList } from "./lib/setList.mjs";

// ── Tunables ─────────────────────────────────────────────────────────────────
const THROTTLE_MS = 300;     // polite delay between BrickLink calls (matches the pilot)
const HISTORY_CAP = 520;     // keep ~520 snapshots/set (≈ weekly for 10y, or daily for ~1.4y)

// ── Creds (names only ever printed, never values) ────────────────────────────
const BL_NAMES = ["BL_CONSUMER_KEY", "BL_CONSUMER_SECRET", "BL_TOKEN", "BL_TOKEN_SECRET"];
const KV_NAMES = ["KV_REST_API_URL", "KV_REST_API_TOKEN"];
const creds = Object.fromEntries([...BL_NAMES, ...KV_NAMES].map((n) => [n, loadEnvKey(n)]));
const missing = [...BL_NAMES, ...KV_NAMES].filter((n) => !creds[n]);
if (missing.length) {
  console.error(`Missing required cred(s) in .env.local: ${missing.join(", ")}`);
  console.error("(no values printed — set the var name(s) above and re-run)");
  process.exit(1);
}

// ── OAuth signer (same as bl-coverage-check.mjs) ─────────────────────────────
const oauth = OAuth({
  consumer: { key: creds.BL_CONSUMER_KEY, secret: creds.BL_CONSUMER_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(baseString, key) {
    return crypto.createHmac("sha1", key).update(baseString).digest("base64");
  },
});
const token = { key: creds.BL_TOKEN, secret: creds.BL_TOKEN_SECRET };

// ── Upstash client (NEW keyspace — reuses the existing KV_REST_API_* REST creds) ──
const redis = new Redis({ url: creds.KV_REST_API_URL, token: creds.KV_REST_API_TOKEN });

// ── Source the owned-set list from the LIVE collection in Upstash ────────────
// Reads every per-user backup blob (brickledger:user:{userId}) and unions their normalized
// collections. This replaces the old "latest local backup file" source: it values sets added since
// any backup, and runs anywhere with the Upstash creds (the prerequisite for an automated run).
// (The set SELECTION — CMF/promo skip, dedupe, conditions — and the value ladder / value:SET keyspace
// are unchanged; only the input source moved. See scripts/lib/setList.mjs.)
async function loadCollectionFromUpstash() {
  const userKeys = await redis.keys("brickledger:user:*");
  const blobs = [];
  for (const k of userKeys) {
    const v = await redis.get(k); // @upstash/redis auto-deserializes; tolerate a stringified value too
    if (v) blobs.push(typeof v === "string" ? JSON.parse(v) : v);
  }
  return { userKeys, entries: blobs.flatMap(collectionFromBlob) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── One signed price-guide call ──────────────────────────────────────────────
// guideType: "sold" | "stock"; newOrUsed: "N" | "U". Stock is scoped country_code=US (asking floor).
async function priceGuide(setId, guideType, newOrUsed) {
  const params = { guide_type: guideType, new_or_used: newOrUsed, currency_code: "USD" };
  if (guideType === "stock") params.country_code = "US";
  const url = `https://api.bricklink.com/api/store/v1/items/SET/${setId}/price`;
  const authHeader = oauth.toHeader(oauth.authorize({ url, method: "GET", data: params }, token));
  const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
  try {
    const res = await fetch(fullUrl, { method: "GET", headers: { ...authHeader, Accept: "application/json" } });
    const body = JSON.parse(await res.text());
    const meta = body.meta || {};
    if (meta.code !== 200) return { ok: false, desc: meta.description || meta.message || `code ${meta.code}` };
    const d = body.data || {};
    return {
      ok: true,
      avg: Number(d.avg_price) || 0,
      min: Number(d.min_price) || 0,
      lots: Number(d.unit_quantity) || 0,
    };
  } catch (e) {
    return { ok: false, desc: `fetch/parse failed: ${e.message}` };
  }
}

// ── Build the work list from the live Upstash collection (skip CMF/promo) ────
const { userKeys, entries } = await loadCollectionFromUpstash();
if (entries.length === 0) {
  console.error(`No owned-set collection found in Upstash (brickledger:user:* — ${userKeys.length} user key(s)).`);
  console.error("Nothing to value. Has anyone synced a collection?");
  process.exit(1);
}
const { work, cmfSkipped, uniqueCount } = buildWorkList(entries);

const asOf = new Date().toISOString();
const estMin = Math.round((work.length * 2 * THROTTLE_MS) / 1000 / 60);
console.log(`Source: Upstash brickledger:user:* (${userKeys.length} user${userKeys.length === 1 ? "" : "s"})`);
console.log(`Collection: ${uniqueCount} unique sets | Phase-1 boxed: ${work.length} | CMF/promo deferred to Phase 2: ${cmfSkipped}`);
console.log(`asOf=${asOf} | 2 sold calls/set (+ stock only for residual), USD, ~${THROTTLE_MS}ms apart — expect ~${estMin}+ min.`);
console.log("─".repeat(74));

// ── Process ──────────────────────────────────────────────────────────────────
const basisCounts = { sold: 0, sold_thin: 0, modeled: 0, asking: 0, unknown: 0 };
const errors = [];
let written = 0, snapshots = 0, stockCalls = 0;

let i = 0;
for (const s of work) {
  const rNew = await priceGuide(s.setId, "sold", "N"); await sleep(THROTTLE_MS);
  const rUsed = await priceGuide(s.setId, "sold", "U"); await sleep(THROTTLE_MS);
  if (!rNew.ok || !rUsed.ok) errors.push(s.setId);

  const soldNew = rNew.ok ? { avg: rNew.avg, lots: rNew.lots } : null;
  const soldUsed = rUsed.ok ? { avg: rUsed.avg, lots: rUsed.lots } : null;

  // Residual (rung 4): stock lowest only when NEITHER condition has a healthy sold sample,
  // and only for the condition that's fully absent (a thin 1–9 condition resolves via sold_thin).
  const newHealthy = !!soldNew && soldNew.lots >= 10 && soldNew.avg > 0;
  const usedHealthy = !!soldUsed && soldUsed.lots >= 10 && soldUsed.avg > 0;
  const residual = !newHealthy && !usedHealthy;
  let stockNew = null, stockUsed = null;
  if (residual && (!soldNew || soldNew.lots === 0)) {
    const r = await priceGuide(s.setId, "stock", "N"); stockCalls++; await sleep(THROTTLE_MS);
    if (r.ok) stockNew = { min: r.min, lots: r.lots };
  }
  if (residual && (!soldUsed || soldUsed.lots === 0)) {
    const r = await priceGuide(s.setId, "stock", "U"); stockCalls++; await sleep(THROTTLE_MS);
    if (r.ok) stockUsed = { min: r.min, lots: r.lots };
  }

  const { new: newRec, used: usedRec } = deriveValue({ soldNew, soldUsed, stockNew, stockUsed, asOf });
  basisCounts[newRec.basis]++;
  basisCounts[usedRec.basis]++;

  // value:SET — set-level cache, written for EVERY processed set (even all-"unknown") so the
  // cache is authoritative. We store the full record (basis "unknown" + amount null) rather
  // than dropping to null, so asOf/source survive and the app-read step is a uniform map.
  await redis.set(`value:SET:${s.number}`, { new: newRec, used: usedRec });
  written++;

  // history:SET — append one snapshot/run; raw amounts only (null when unknown). LPUSH newest,
  // LTRIM to the cap. This starts owned trend history from this first run (decision-doc §6, opt. 2).
  const histKey = `history:SET:${s.number}`;
  await redis.lpush(histKey, { asOf, new: newRec.amount, used: usedRec.amount });
  await redis.ltrim(histKey, 0, HISTORY_CAP - 1);
  snapshots++;

  i++;
  const tag = `N:${newRec.basis}($${newRec.amount ?? "—"}/${rNew.ok ? rNew.lots : "err"})  U:${usedRec.basis}($${usedRec.amount ?? "—"})`;
  console.log(`${String(i).padStart(3)}/${work.length}  ${s.setId.padEnd(11)} ${tag}`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("═".repeat(74));
console.log(`RUN SUMMARY  asOf=${asOf}`);
console.log(`Sets processed (value:SET written): ${written}`);
console.log(`Snapshots appended (history:SET):   ${snapshots}`);
console.log(`CMF/promo deferred to Phase 2:      ${cmfSkipped}`);
console.log(`Residual stock calls made:          ${stockCalls}`);
console.log(`BL calls returning an error:        ${errors.length}${errors.length ? "  (" + errors.slice(0, 12).join(", ") + (errors.length > 12 ? ", …" : "") + ")" : ""}`);
console.log(`\nBasis counts (across ${written * 2} condition-records: new + used per set):`);
for (const b of ["sold", "sold_thin", "modeled", "asking", "unknown"]) {
  console.log(`  ${b.padEnd(10)} ${String(basisCounts[b]).padStart(4)}`);
}

// ── Read-back: confirm the written shape on 2–3 sample keys ──────────────────
console.log(`\nSample read-back (value:SET + newest history snapshot):`);
const samples = work.slice(0, 3);
for (const s of samples) {
  const v = await redis.get(`value:SET:${s.number}`);
  const h = await redis.lrange(`history:SET:${s.number}`, 0, 0);
  console.log(`  value:SET:${s.number} = ${JSON.stringify(v)}`);
  console.log(`  history:SET:${s.number}[0] = ${JSON.stringify(h[0] ?? null)}`);
}
console.log(`\nDone. Keyspace value:SET:* / history:SET:* is additive — the live app does not read it yet.`);
