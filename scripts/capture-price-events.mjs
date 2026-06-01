#!/usr/bin/env node
// Phase 1 (price_events): capture REAL BrickEconomy /set payloads and pin the
// price_events_* shape. Fixture-first — NO production code touched.
//
// Usage:
//   node scripts/capture-price-events.mjs            # default sample set numbers
//   node scripts/capture-price-events.mjs 10300 10307 30432
//
// Reads BRICKECONOMY_API_KEY from .env.local (same key the proxy uses).
// Writes raw payloads to test-data/be-fixtures/<num>.json and prints a shape report.
// Pick one set per case: (a) retired-with-events, (b) at-retail, (c) ~3% no-value.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnvKey } from "./lib/env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function normNum(n) {
  n = String(n).trim().replace(/\s+/g, "");
  if (!n.includes("-")) n = `${n}-1`;
  return n;
}

const key = loadEnvKey("BRICKECONOMY_API_KEY");
if (!key) {
  console.error("NO BRICKECONOMY_API_KEY in .env.local");
  process.exit(1);
}

const nums = (process.argv.slice(2).length ? process.argv.slice(2) : ["10300", "10307", "30432"]).map(normNum);
const outDir = join(root, "test-data", "be-fixtures");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const PE_HINT = (k) => /price[_]?event|history|growth|event/i.test(k);

for (const num of nums) {
  const url = `https://www.brickeconomy.com/api/v1/set/${encodeURIComponent(num)}?currency=USD`;
  let raw, json;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "User-Agent": "BrickLedger/1.0", "x-apikey": key },
    });
    raw = await res.text();
    console.log(`\n=== ${num} HTTP ${res.status} (${raw.length} bytes) ===`);
    try { json = JSON.parse(raw); } catch { console.log("  NON-JSON body:", raw.slice(0, 160)); continue; }
  } catch (e) {
    console.log(`\n=== ${num} FETCH ERROR: ${e.message}`);
    continue;
  }
  writeFileSync(join(outDir, `${num}.json`), JSON.stringify(json, null, 2));
  const data = json && typeof json === "object" && json.data ? json.data : json;
  const keys = data && typeof data === "object" ? Object.keys(data) : [];
  console.log(`  name=${JSON.stringify(data?.name)} retired=${data?.retired}`);
  console.log(`  current_value_new=${data?.current_value_new} current_value_used=${data?.current_value_used} retail_price_us=${data?.retail_price_us}`);
  const pe = keys.filter(PE_HINT);
  console.log(`  price/event/growth keys: ${JSON.stringify(pe)}`);
  for (const k of pe) {
    const v = data[k];
    if (Array.isArray(v)) console.log(`    ${k}: array len=${v.length} sample[0]=${JSON.stringify(v[0])}`);
    else if (v && typeof v === "object") console.log(`    ${k}: object keys=${JSON.stringify(Object.keys(v))}`);
    else console.log(`    ${k}: ${JSON.stringify(v)}`);
  }
  if (!pe.length) console.log(`  ALL KEYS: ${JSON.stringify(keys)}`);
}
console.log("\nDONE. Raw fixtures in test-data/be-fixtures/");
