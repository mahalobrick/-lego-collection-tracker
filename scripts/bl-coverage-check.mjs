// Throwaway BrickLink SOLD-coverage check — NOT app code, NOT wired into anything.
// Run: node scripts/bl-coverage-check.mjs
//
// Same OAuth 1.0a / HMAC-SHA1 signing + loadEnvKey(.env.local) as bl-price-test.mjs.
// For each set in a (sampled or full) collection it makes TWO sold price-guide calls —
// new/sealed and used — buckets coverage on the sold/NEW lot count, and compares the
// BrickEconomy new/used values against the BrickLink 6-month sold averages.
//
// Constraints: scripts/ + outputs/ only, no app imports, no CI, no package.json/lockfile
// changes (oauth-1.0a already in node_modules via --no-save). Never logs a secret.

import crypto from "node:crypto";
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import OAuth from "oauth-1.0a";
import { loadEnvKey } from "./lib/env.mjs";

// ── Tunables ─────────────────────────────────────────────────────────────────
const SAMPLE_SIZE = Infinity;    // Infinity = whole collection. A finite N samples randomly.
const THROTTLE_MS = 300;         // polite delay between BrickLink calls.

// ── Creds (names only ever printed, never values) ────────────────────────────
const CRED_NAMES = ["BL_CONSUMER_KEY", "BL_CONSUMER_SECRET", "BL_TOKEN", "BL_TOKEN_SECRET"];
const creds = Object.fromEntries(CRED_NAMES.map((n) => [n, loadEnvKey(n)]));
const missing = CRED_NAMES.filter((n) => !creds[n]);
if (missing.length) {
  console.error(`Missing required cred(s) in .env.local: ${missing.join(", ")}`);
  console.error("(no values printed — set the var name(s) above and re-run)");
  process.exit(1);
}

// ── OAuth signer (same as bl-price-test.mjs) ─────────────────────────────────
const oauth = OAuth({
  consumer: { key: creds.BL_CONSUMER_KEY, secret: creds.BL_CONSUMER_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(baseString, key) {
    return crypto.createHmac("sha1", key).update(baseString).digest("base64");
  },
});
const token = { key: creds.BL_TOKEN, secret: creds.BL_TOKEN_SECRET };

// ── Pick the most-recent backup that actually holds the collection ───────────
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

// BrickEconomy value for a set = current_value of a copy in the matching condition (the
// field used to build the PriceCharting comparison CSV). new = new/sealed copy; used = any
// used* copy (BrickEconomy values all used* at current_value_used). Missing condition → null.
function beValueFor(s, kind) {
  const match = kind === "new"
    ? (e) => e.condition === "new" || e.condition === "sealed"
    : (e) => String(e.condition || "").startsWith("used");
  const e = (s.entries || []).find(match);
  const v = e ? Number(e.current_value) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

// BrickLink wants the variant suffix: append -1 only if there's no -N already.
const blSetId = (num) => (/-\d+$/.test(String(num)) ? String(num) : `${num}-1`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const median = (arr) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// ── One sold call (new_or_used: "N" | "U") ───────────────────────────────────
async function sold(setId, newOrUsed) {
  const params = { guide_type: "sold", new_or_used: newOrUsed, currency_code: "USD" };
  const url = `https://api.bricklink.com/api/store/v1/items/SET/${setId}/price`;
  const authHeader = oauth.toHeader(oauth.authorize({ url, method: "GET", data: params }, token));
  const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
  try {
    const res = await fetch(fullUrl, { method: "GET", headers: { ...authHeader, Accept: "application/json" } });
    const body = JSON.parse(await res.text());
    const meta = body.meta || {};
    if (meta.code !== 200) return { ok: false, desc: meta.description || meta.message || `code ${meta.code}` };
    const d = body.data || {};
    return { ok: true, avg: Number(d.avg_price) || 0, lots: Number(d.unit_quantity) || 0, total: Number(d.total_quantity) || 0 };
  } catch (e) {
    return { ok: false, desc: `fetch/parse failed: ${e.message}` };
  }
}

// ── Build the work list ──────────────────────────────────────────────────────
const picked = pickBackup();
const norm = picked.data.brickEconomyNormalized;
const seen = new Set();
const allSets = [];
for (const s of norm) {
  const num = String(s.setNumber || "");
  if (!num || seen.has(num)) continue;
  seen.add(num);
  allSets.push({ setId: blSetId(num), name: s.name || "", beNew: beValueFor(s, "new"), beUsed: beValueFor(s, "used") });
}
// sampling code path left intact; Infinity bypasses it (takes the whole collection).
const shuffled = [...allSets].sort(() => Math.random() - 0.5);
const work = shuffled.slice(0, Math.min(SAMPLE_SIZE, shuffled.length));
const isFull = SAMPLE_SIZE === Infinity || work.length === allSets.length;

console.log(`Source backup: ${picked.f}  (exportedAt ${picked.data.exportedAt})`);
console.log(`Collection: ${allSets.length} unique sets | processing ${work.length}` + (isFull ? " (ALL)" : ` (SAMPLE_SIZE=${SAMPLE_SIZE})`));
console.log(`Two sold calls/set (new + used), USD, ~${THROTTLE_MS}ms apart — expect ~${Math.round(work.length * 2 * THROTTLE_MS / 1000 / 60)}+ min.\n${"─".repeat(70)}`);

const rows = [];
const buckets = { healthy: [], sparse: [], "no-sales": [], "error/not-found": [] };
const ratio = (be, avg) => (be != null && avg > 0 ? be / avg : null);

let i = 0;
for (const s of work) {
  const rN = await sold(s.setId, "N"); await sleep(THROTTLE_MS);
  const rU = await sold(s.setId, "U"); await sleep(THROTTLE_MS);

  let bucket;
  if (!rN.ok) bucket = "error/not-found";
  else bucket = rN.lots >= 10 ? "healthy" : rN.lots >= 1 ? "sparse" : "no-sales";

  const blNewAvg = rN.ok && rN.avg > 0 ? rN.avg : null;
  const blUsedAvg = rU.ok && rU.avg > 0 ? rU.avg : null;
  const rNew = ratio(s.beNew, blNewAvg);
  const rUsed = ratio(s.beUsed, blUsedAvg);

  buckets[bucket].push({ ...s, rN, rU, rNew, rUsed });
  rows.push({
    set: s.setId,
    name: s.name,
    be_new_value: s.beNew == null ? "" : s.beNew.toFixed(2),
    bl_sold_new_avg: blNewAvg == null ? "" : blNewAvg.toFixed(2),
    lots_new: rN.ok ? rN.lots : "",
    be_used_value: s.beUsed == null ? "" : s.beUsed.toFixed(2),
    bl_sold_used_avg: blUsedAvg == null ? "" : blUsedAvg.toFixed(2),
    lots_used: rU.ok ? rU.lots : "",
    be_over_bl_new: rNew == null ? "" : rNew.toFixed(3),
    be_over_bl_used: rUsed == null ? "" : rUsed.toFixed(3),
    bucket,
  });

  i++;
  const tag = rN.ok ? `N:${bucket}(lots=${rN.lots})` : `N:error(${rN.desc})`;
  const tagU = rU.ok ? `U:lots=${rU.lots}` : `U:error`;
  console.log(`${String(i).padStart(3)}/${work.length}  ${s.setId.padEnd(11)} ${tag}  ${tagU}`);
}

// ── Write CSV ──────────────────────────────────────────────────────────────
const HEADER = ["set","name","be_new_value","bl_sold_new_avg","lots_new","be_used_value","bl_sold_used_avg","lots_used","be_over_bl_new","be_over_bl_used","bucket"];
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "outputs");
mkdirSync(outDir, { recursive: true });
const csvPath = join(outDir, "bl-coverage-full.csv");
writeFileSync(csvPath, [HEADER.join(","), ...rows.map((r) => HEADER.map((h) => csvCell(r[h])).join(","))].join("\n") + "\n");

// ── Console summary ────────────────────────────────────────────────────────
const n = work.length;
const pct = (k) => ((buckets[k].length / n) * 100).toFixed(1);
console.log(`${"═".repeat(70)}\nCOVERAGE SUMMARY  (n=${n}, full=${isFull})`);
for (const k of ["healthy", "sparse", "no-sales", "error/not-found"]) {
  console.log(`  ${k.padEnd(16)} ${String(buckets[k].length).padStart(3)}  (${pct(k)}%)`);
}

// CMF / not-a-SET errors
const errs = buckets["error/not-found"];
console.log(`\nCMF/error (not-a-SET) entries: ${errs.length}`);
if (errs.length) console.log("  " + errs.map((e) => e.setId).join(", "));

// no-sales (0 sold/new lots)
const ns = buckets["no-sales"];
console.log(`\nNo-sales (0 sold/new lots): ${ns.length}`);
if (ns.length) console.log("  " + ns.map((e) => e.setId).join(", "));

// ratio distributions (across all computable rows)
function dist(label, vals) {
  if (!vals.length) { console.log(`  ${label}: (none computable)`); return; }
  const lo = Math.min(...vals), hi = Math.max(...vals);
  console.log(`  ${label} (n=${vals.length}): median ${median(vals).toFixed(3)} | range ${lo.toFixed(3)}–${hi.toFixed(3)}`);
}
const newRatios = rows.filter((r) => r.be_over_bl_new !== "").map((r) => Number(r.be_over_bl_new));
const usedRatios = rows.filter((r) => r.be_over_bl_used !== "").map((r) => Number(r.be_over_bl_used));
console.log(`\nRatio distributions (>1 = BrickEconomy above BrickLink sold avg):`);
dist("be_over_bl_new ", newRatios);
dist("be_over_bl_used", usedRatios);

// median lot count among healthy
const healthyLots = buckets.healthy.map((x) => x.rN.lots);
console.log(`\nHealthy sets: median sold/new lot count = ${median(healthyLots) ?? "—"}`);

console.log(`\nCSV: ${csvPath}`);
