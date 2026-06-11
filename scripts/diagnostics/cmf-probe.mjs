// CMF Phase 2 — droplet confirmation probe — READ-ONLY diagnostic (NOT wired into anything).
// Run ON THE VPS (the BL OAuth1 creds are IP-bound there; from anywhere else the preflight
// fails fast with TOKEN_IP_MISMATCHED):
//
//   cd /root/brickledger && git pull --ff-only origin main && node scripts/diagnostics/cmf-probe.mjs
//
// Confirms the two things the public-catalog spike (docs/cmf-mapping-spike.md) could not:
//   1. the curated-table-derived col-prefixed SET IDs return *sold* price-guide data through the
//      exact OAuth1 fetch path the cron uses (refresh-values.mjs → priceGuide), and
//   2. how the 2 long-numeric promo IDs behave on the SET endpoint — the setList.mjs skip-comment
//      says they "error on the SET endpoint"; the public catalog shows ordinary SETs. Verify.
//
// READ-ONLY / FOOTPRINT: BrickLink price-guide GETs only — no Upstash import, no value:SET /
// history:SET writes, no change to refresh-values.mjs, setList.mjs, or the ladder. The ladder
// (deriveValue) is imported and RUN on the fetched samples purely to PRINT what basis/amount the
// real CMF branch would assign; nothing is persisted anywhere. Creds from .env.local; names only
// ever printed, never values (same rule as the sibling scripts).

import crypto from "node:crypto";
import OAuth from "oauth-1.0a";
import { loadEnvKey } from "../lib/env.mjs";
import { deriveValue } from "../lib/deriveValue.mjs";

const THROTTLE_MS = 300; // same polite delay as the cron
const KNOWN_GOOD = "75298-1"; // boxed set the cron values weekly — preflight cred/IP check

// ── Creds (BL only — this probe never loads the KV creds, so it CANNOT touch Upstash) ──
const BL_NAMES = ["BL_CONSUMER_KEY", "BL_CONSUMER_SECRET", "BL_TOKEN", "BL_TOKEN_SECRET"];
const creds = Object.fromEntries(BL_NAMES.map((n) => [n, loadEnvKey(n)]));
const missing = BL_NAMES.filter((n) => !creds[n]);
if (missing.length) {
  console.error(`Missing required cred(s) in .env.local: ${missing.join(", ")}`);
  console.error("(no values printed — set the var name(s) above and re-run)");
  process.exit(1);
}

// ── OAuth signer (same as refresh-values.mjs / bl-coverage-check.mjs) ─────────
const oauth = OAuth({
  consumer: { key: creds.BL_CONSUMER_KEY, secret: creds.BL_CONSUMER_SECRET },
  signature_method: "HMAC-SHA1",
  hash_function(baseString, key) {
    return crypto.createHmac("sha1", key).update(baseString).digest("base64");
  },
});
const token = { key: creds.BL_TOKEN, secret: creds.BL_TOKEN_SECRET };

// BL echoes the consumer key inside some error descriptions (e.g. TOKEN_IP_MISMATCHED) —
// scrub every cred value from anything we print.
const redact = (s) => BL_NAMES.reduce((t, n) => (creds[n] ? t.split(creds[n]).join(`<${n}>`) : t), String(s));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── One signed price-guide call — the cron's fetch verbatim (refresh-values.mjs:77),
// extended only to surface the raw meta code/description for the promo report. ──
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
    if (meta.code !== 200) {
      return { ok: false, code: meta.code ?? null, desc: redact(meta.description || meta.message || `code ${meta.code}`) };
    }
    const d = body.data || {};
    return {
      ok: true,
      code: 200,
      avg: Number(d.avg_price) || 0,
      min: Number(d.min_price) || 0,
      lots: Number(d.unit_quantity) || 0,
    };
  } catch (e) {
    return { ok: false, code: null, desc: redact(`fetch/parse failed: ${e.message}`) };
  }
}

// ── Candidates — straight from the docs/cmf-mapping-spike.md validation table.
// One figure per series = ALL 11 curated prefix rows exercised, plus both promos as-is.
// `be` is the BrickEconomy value recorded in the spike (display-only sanity cross-check).
const CANDIDATES = [
  { our: "71034-1",   name: "Nutcracker",             be: "$14.64", bl: "col23-1",     note: "CMF S23" },
  { our: "71037-2",   name: "Robot Warrior",          be: "$3.10",  bl: "col24-2",     note: "CMF S24" },
  { our: "71038-4",   name: "Sorcerer Mickey",        be: "$6.94",  bl: "coldis100-4", note: "Disney 100" },
  { our: "71039-1",   name: "Agatha Harkness",        be: "$13.02", bl: "colmar2-1",   note: "Marvel S2" },
  { our: "71045-3",   name: "Basil the Bat Lord",     be: "$18.68", bl: "col25-3",     note: "CMF S25" },
  { our: "71046-1",   name: "Spacewalking Astronaut", be: "$8.29",  bl: "col26-1",     note: "CMF S26" },
  { our: "71047-4",   name: "Dragonborn Paladin",     be: "$12.45", bl: "coldnd-4",    note: "D&D (BL 6-mo ~$13.28)" },
  { our: "71048-2",   name: "Wolfpack Beastmaster",   be: "$92.21", bl: "col27-2",     note: "CMF S27 (BE ~6x market)" },
  { our: "71049-1",   name: "F1 Red Bull RB20",       be: "$5-10",  bl: "colf1rc-1",   note: "F1 (irregular prefix)" },
  { our: "71051-3",   name: "Goldfish Costume Girl",  be: "$4.68",  bl: "col28-3",     note: "CMF S28 (2026 — thin?)" },
  { our: "71052-3",   name: "BIONICLE Cosplayer",     be: "$4.99",  bl: "col29-3",     note: "CMF S29 (2026 — thin?)" },
  { our: "6490363-1", name: "By the Fireplace",       be: "$23.72", bl: "6490363-1",   note: "PROMO (as-is)", promo: true },
  { our: "6550806-1", name: "Gingerbread Lane",       be: "$32.96", bl: "6550806-1",   note: "PROMO (as-is)", promo: true },
];

const money = (v) => (v == null ? "—" : `$${Number(v).toFixed(2)}`);
const sample = (r) => (!r.ok ? "—" : `${r.lots} @ ${r.lots ? money(r.avg) : "—"}`);
const ladderCell = (rec) => (rec.amount == null ? rec.basis : `${rec.basis} ${money(rec.amount)}`);

// ── Preflight: cred/IP check on a known-good boxed set ────────────────────────
const pre = await priceGuide(KNOWN_GOOD, "sold", "N");
if (!pre.ok || !(pre.avg > 0)) {
  console.error(`PREFLIGHT FAILED on known-good SET ${KNOWN_GOOD}: ${pre.ok ? "200 but no avg_price" : `meta ${pre.code}: ${pre.desc}`}`);
  console.error("BL creds/IP not usable from this machine (creds are IP-bound to the VPS) — run on the droplet.");
  process.exit(2);
}
console.log(`Preflight OK: SET ${KNOWN_GOOD} sold/N avg=${money(pre.avg)} (${pre.lots} lots) — creds + IP good.`);
await sleep(THROTTLE_MS);

// ── Probe each candidate through the cron's exact phase-1 (+ residual) sequence ──
console.log(`\nCMF Phase 2 confirmation probe — ${CANDIDATES.length} candidates, sold/N + sold/U (+ stock only when residual), USD, ${THROTTLE_MS}ms apart`);
const W = { our: 11, bl: 13, res: 7, n: 15, u: 15, lad: 21, be: 7 };
const header =
  "our set#".padEnd(W.our) + "derived BL ID".padEnd(W.bl) + "resol.".padEnd(W.res) +
  "sold N (lots@avg)".padEnd(W.n) + "sold U (lots@avg)".padEnd(W.u) +
  "ladder N".padEnd(W.lad) + "ladder U".padEnd(W.lad) + "BE".padEnd(W.be) + "note";
console.log("─".repeat(header.length));
console.log(header);
console.log("─".repeat(header.length));

const asOf = new Date().toISOString();
const results = [];
for (const c of CANDIDATES) {
  const rNew = await priceGuide(c.bl, "sold", "N"); await sleep(THROTTLE_MS);
  const rUsed = await priceGuide(c.bl, "sold", "U"); await sleep(THROTTLE_MS);

  const soldNew = rNew.ok ? { avg: rNew.avg, lots: rNew.lots } : null;
  const soldUsed = rUsed.ok ? { avg: rUsed.avg, lots: rUsed.lots } : null;

  // Residual stock calls — same gate as the cron (refresh-values.mjs:132-143).
  const newHealthy = !!soldNew && soldNew.lots >= 10 && soldNew.avg > 0;
  const usedHealthy = !!soldUsed && soldUsed.lots >= 10 && soldUsed.avg > 0;
  const residual = !newHealthy && !usedHealthy;
  let stockNew = null, stockUsed = null;
  if (residual && (!soldNew || soldNew.lots === 0)) {
    const r = await priceGuide(c.bl, "stock", "N"); await sleep(THROTTLE_MS);
    if (r.ok) stockNew = { min: r.min, lots: r.lots };
  }
  if (residual && (!soldUsed || soldUsed.lots === 0)) {
    const r = await priceGuide(c.bl, "stock", "U"); await sleep(THROTTLE_MS);
    if (r.ok) stockUsed = { min: r.min, lots: r.lots };
  }

  // What the real CMF branch would assign — computed for DISPLAY only, persisted nowhere.
  const { new: newRec, used: usedRec } = deriveValue({ soldNew, soldUsed, stockNew, stockUsed, asOf });

  const resolved = rNew.ok && rUsed.ok;
  const soldUsable =
    (!!soldNew && soldNew.lots >= 1 && soldNew.avg > 0) ||
    (!!soldUsed && soldUsed.lots >= 1 && soldUsed.avg > 0);
  results.push({
    ...c, resolved, soldUsable, newRec, usedRec,
    detailN: rNew.ok ? `meta 200, lots=${rNew.lots}, avg=${money(rNew.avg)}` : `meta ${rNew.code}: ${rNew.desc}`,
    detailU: rUsed.ok ? `meta 200, lots=${rUsed.lots}, avg=${money(rUsed.avg)}` : `meta ${rUsed.code}: ${rUsed.desc}`,
  });

  console.log(
    c.our.padEnd(W.our) + c.bl.padEnd(W.bl) +
    (resolved ? "✓ 200" : `✗ ${rNew.ok ? rUsed.code : rNew.code}`).padEnd(W.res) +
    sample(rNew).padEnd(W.n) + sample(rUsed).padEnd(W.u) +
    ladderCell(newRec).padEnd(W.lad) + ladderCell(usedRec).padEnd(W.lad) +
    c.be.padEnd(W.be) + c.note
  );
}
console.log("─".repeat(header.length));

// ── Promo detail: exactly what the SET endpoint returned, verbatim ────────────
console.log("\nPROMO DETAIL (skip-comment in scripts/lib/setList.mjs claims these error on the SET endpoint):");
for (const r of results.filter((x) => x.promo)) {
  console.log(`  ${r.our} sold/N → ${r.detailN}`);
  console.log(`  ${" ".repeat(r.our.length)} sold/U → ${r.detailU}`);
}

// ── One-line verdict ──────────────────────────────────────────────────────────
const mapped = results.filter((r) => !r.promo);
const promos = results.filter((r) => r.promo);
const usable = mapped.filter((r) => r.soldUsable);
const failTxt = usable.length === mapped.length ? "" :
  ` (no sold data: ${mapped.filter((r) => !r.soldUsable).map((r) => `${r.our}→${r.bl} [N:${r.newRec.basis}/U:${r.usedRec.basis}]`).join(", ")})`;
const promoResolved = promos.filter((r) => r.resolved);
const promoTxt = promoResolved.length === promos.length
  ? `promos ${promos.length}/${promos.length} resolve as ordinary SETs — skip-comment "error on the SET endpoint" REFUTED`
  : promoResolved.length === 0
    ? `promos 0/${promos.length} resolve — skip-comment CONFIRMED (keep BE / special-case them)`
    : `promos ${promoResolved.length}/${promos.length} resolve (${promos.filter((r) => !r.resolved).map((r) => r.our).join(", ")} errored) — skip-comment PARTIALLY confirmed`;
console.log(`\nVERDICT: ${usable.length}/${mapped.length} mapped candidates return usable sold data via the cron's SET price-guide path${failTxt}; ${promoTxt}.`);
