#!/usr/bin/env node
// P4 (Brickset contract): capture REAL Brickset API payloads (the UPSTREAM shape the
// field-select proxies read) and write fixtures. Fixture-first — NO production code touched.
//
// Usage:
//   node scripts/capture-brickset.mjs
//   node scripts/capture-brickset.mjs 75192 10300        # custom getSets set numbers
//
// Reads BRICKSET_API_KEY from .env.local (same key the proxies use). Brickset's getSets endpoint
// backs BOTH /api/brickset-set (params={setNumber}) and /api/brickset-search (params={query|theme});
// getThemes backs /api/brickset-themes. We capture getSets (by setNumber + by free-text query) and
// getThemes. Writes raw upstream JSON to test-data/brickset-fixtures/ and prints a shape report.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnvKey } from "./lib/env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const key = loadEnvKey("BRICKSET_API_KEY");
if (!key) { console.error("NO BRICKSET_API_KEY in .env.local"); process.exit(1); }

const outDir = join(root, "test-data", "brickset-fixtures");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const BASE = "https://brickset.com/api/v3.asmx/getSets";
const THEMES = "https://brickset.com/api/v3.asmx/getThemes";

async function getSets(params, label) {
  const url = `${BASE}?apiKey=${encodeURIComponent(key)}&userHash=&params=${encodeURIComponent(JSON.stringify(params))}`;
  const res = await fetch(url, { headers: { accept: "application/json", "User-Agent": "BrickLedger/1.0" } });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { console.log(`${label}: NON-JSON ${text.slice(0,120)}`); return null; }
  writeFileSync(join(outDir, `${label}.json`), JSON.stringify(json, null, 2));
  const n = (json.sets || []).length;
  console.log(`\n=== ${label} HTTP ${res.status} status=${json.status} matches=${json.matches} sets=${n} ===`);
  if (json.sets?.[0]) {
    const s = json.sets[0];
    console.log(`  sets[0] top-level keys: ${JSON.stringify(Object.keys(s))}`);
    console.log(`  LEGOCom keys: ${JSON.stringify(Object.keys(s.LEGOCom || {}))}  LEGOCom.US: ${JSON.stringify(s.LEGOCom?.US)}`);
    console.log(`  image keys: ${JSON.stringify(Object.keys(s.image || {}))}`);
    console.log(`  dimensions: ${JSON.stringify(s.dimensions)}  ageRange: ${JSON.stringify(s.ageRange)}`);
    console.log(`  collections: ${JSON.stringify(s.collections)}  barcode: ${JSON.stringify(s.barcode)}`);
    console.log(`  extendedData: ${JSON.stringify(s.extendedData)}`);
    console.log(`  number=${s.number} numberVariant=${s.numberVariant} name=${JSON.stringify(s.name)} launchDate=${s.launchDate} exitDate=${s.exitDate}`);
  }
  return json;
}

const setNums = process.argv.slice(2).length ? process.argv.slice(2) : ["75192", "10300", "10363", "30432"];
for (const n of setNums) {
  await getSets({ setNumber: `${n}-1` }, `set-${n}`);
}
// search (free-text, multi-result) — mirrors /api/brickset-search params
await getSets({ pageSize: 20, orderBy: "YearFromDESC", query: "millennium falcon" }, "search-millennium-falcon");

// themes
{
  const url = `${THEMES}?apiKey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { accept: "application/json", "User-Agent": "BrickLedger/1.0" } });
  const json = JSON.parse(await res.text());
  writeFileSync(join(outDir, "themes.json"), JSON.stringify(json, null, 2));
  console.log(`\n=== themes HTTP ${res.status} status=${json.status} count=${(json.themes||[]).length} ===`);
  console.log(`  themes[0] keys: ${JSON.stringify(Object.keys(json.themes?.[0] || {}))}  sample: ${JSON.stringify(json.themes?.[0])}`);
}
console.log("\nDONE. Raw fixtures in test-data/brickset-fixtures/");
