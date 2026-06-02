// BrickLink value-refresh batch — PRODUCTION tooling (maintained; deps in package.json).
// Run: node scripts/refresh-values.mjs
//
// Pulls BrickLink 6-month *sold* price-guide data for the collection, walks the value
// ladder from docs/value-source-decision.md §3 (via the pure, unit-tested deriveValue in
// scripts/lib/deriveValue.mjs), and writes basis-tagged value records + trend snapshots to
// a NEW shared Upstash keyspace:
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
import { readdirSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import OAuth from "oauth-1.0a";
import { Redis } from "@upstash/redis";
import { loadEnvKey } from "./lib/env.mjs";
import { deriveValue } from "./lib/deriveValue.mjs";

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

// ── Pick the most-recent backup that actually holds the collection ───────────
// v1 set list comes from the latest local backup (same source bl-coverage-check.mjs uses).
// TODO(next step): derive the live set list from Upstash (the per-user collection keys),
// not a local backup file — this local-file source is the v1 stopgap.
function pickBackup() {
  const dir = join(homedir(), "Downloads");
  const files = readdirSync(dir)
    .filter((f) => /^brickledger-backup-.*\.json$/.test(f))
    .map((f) => ({ f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const c of files) {
    try {
      const d = JSON.parse(readFileSync(c.path, "utf8"));
      if ((d.brickEconomyNormalized || []).length > 0) return { ...c, data: d };
    } catch { /* skip unreadable */ }
  }
  throw new Error("No BrickLedger backup with a non-empty brickEconomyNormalized found in ~/Downloads");
}

// ── CMF / Phase-2 skip rule (docs/value-source-decision.md §4–§5) ────────────
// The whole minifigure namespace is deferred to Phase 2 (valued via the BrickLink MINIFIG
// endpoint, not SET). The data-driven signal is theme === "Minifigure Series" (generalises to
// future runs — no fragile per-series suffix ranges). The 2 long-numeric promo IDs error on
// the SET endpoint but are themed "Seasonal", so they're skipped by explicit id. Even CMF
// entries that DO resolve on the SET endpoint are skipped: §4 says that price is the wrong
// full-box figure for a minifig and must never be used as a set value.
const CMF_THEME = "Minifigure Series";
const NUMERIC_PROMO_SKIP = new Set(["6490363-1", "6550806-1"]);
const isCmfOrPromo = (s) => s.theme === CMF_THEME || NUMERIC_PROMO_SKIP.has(String(s.setNumber));

// BrickLink wants the variant suffix: append -1 only if there's no -N already.
const blSetId = (num) => (/-\d+$/.test(String(num)) ? String(num) : `${num}-1`);
// Collection conditions → the two value conditions we track.
const condOf = (c) => (String(c || "").startsWith("used") ? "used" : "new");

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

// ── Build the work list (skip CMF/promo; count them as deferred to Phase 2) ──
const picked = pickBackup();
const norm = picked.data.brickEconomyNormalized;
const seen = new Set();
const work = [];
let cmfSkipped = 0;
for (const s of norm) {
  const number = String(s.setNumber || "");
  if (!number || seen.has(number)) continue;
  seen.add(number);
  if (isCmfOrPromo(s)) { cmfSkipped++; continue; }
  const ownedConditions = [...new Set((s.entries || []).map((e) => condOf(e.condition)))];
  work.push({ number, setId: blSetId(number), name: s.name || "", ownedConditions });
}

const asOf = new Date().toISOString();
const estMin = Math.round((work.length * 2 * THROTTLE_MS) / 1000 / 60);
console.log(`Source backup: ${picked.f}  (exportedAt ${picked.data.exportedAt})`);
console.log(`Collection: ${seen.size} unique sets | Phase-1 boxed: ${work.length} | CMF/promo deferred to Phase 2: ${cmfSkipped}`);
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
