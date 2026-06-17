#!/usr/bin/env node
// Codegen: docs/curated-msrp.csv → src/utils/curatedMsrp.js (a bundled, pure lookup table,
// mirroring src/utils/cmfRetail.js). The CSV is the SINGLE SOURCE OF TRUTH; the generated
// module is committed and drift-guarded (curatedMsrp.drift.test.js re-runs buildCuratedMap on
// the CSV and compares). Research-derived + static — no network, never source:"brickeconomy"
// (Phase 3c intact).
//
//   Regenerate:  node scripts/gen-curated-msrp.mjs
//
// CSV columns: set_number,name,year,bucket,msrp,confidence,tier,source
// Rows with tier "none" / blank msrp (e.g. 30625) are SKIPPED → curatedRetail returns null →
// the set stays "not listed" (unchanged resolution).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CSV_PATH = join(HERE, "..", "docs", "curated-msrp.csv");
export const OUT_PATH = join(HERE, "..", "src", "utils", "curatedMsrp.js");

/**
 * Pure: parse the curated CSV text → { [setNumber]: { msrp, tier, confidence, source } }.
 * Shared by the generator and the drift guard so they can never parse differently. Keeps only
 * priced rows (tier sourced|estimated AND a numeric msrp); skips tier "none" / blank-msrp rows.
 */
export function buildCuratedMap(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  lines.shift(); // header
  const map = {};
  for (const line of lines) {
    const f = line.split(",");
    // `source` is the last column; defensively re-join in case it ever contains commas.
    const [setNumber, , , , msrpRaw, confidence, tier] = f;
    const source = f.slice(7).join(",");
    if (tier !== "sourced" && tier !== "estimated") continue; // skip "none"
    const msrp = Number(msrpRaw);
    if (!(msrp > 0)) continue; // skip blank / non-numeric
    map[setNumber] = { msrp, tier, confidence, source };
  }
  return map;
}

/** Pure: render the generated module source from a curated map (keys sorted for stable output). */
export function renderModule(map) {
  const keys = Object.keys(map).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rows = keys
    .map((k) => {
      const e = map[k];
      return `  ${JSON.stringify(k)}: { msrp: ${e.msrp}, tier: ${JSON.stringify(e.tier)}, ` +
        `confidence: ${JSON.stringify(e.confidence)}, source: ${JSON.stringify(e.source)} },`;
    })
    .join("\n");
  return `// AUTO-GENERATED from docs/curated-msrp.csv by scripts/gen-curated-msrp.mjs — DO NOT EDIT BY HAND.
// Regenerate: \`node scripts/gen-curated-msrp.mjs\`. Drift-guarded by curatedMsrp.drift.test.js.
//
// Curated MSRP lookup — a static, research-derived retail table (sourced + estimated tiers),
// independent of BrickEconomy / Phase 3c: bundled, no network, never source:"brickeconomy".
// Mirrors cmfRetail.js (pure lookup). tier "none" rows (no standalone MSRP, e.g. 30625) are
// OMITTED here → curatedRetail() returns null → the set stays "not listed".
export const CURATED_MSRP = {
${rows}
};

/**
 * Curated retail for an owned set number → { msrp, tier, confidence, source } | null.
 * tier: "sourced" (researched real RRP / LEGO-stated value) | "estimated" (proxy/ARV). The
 * retail ladder (retailFor) routes sourced → basis "retail", estimated → basis "estimated";
 * a promo (isPromoNoRetail) set's curated value stays basis "promo" (a valued GWP ARV).
 *
 * @param {string} setNumber  e.g. "30303-1".
 * @returns {{ msrp:number, tier:"sourced"|"estimated", confidence:string, source:string } | null}
 */
export function curatedRetail(setNumber) {
  return CURATED_MSRP[setNumber] || null;
}
`;
}

// Run directly → (re)generate the module from the CSV.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const csv = readFileSync(CSV_PATH, "utf8");
  const map = buildCuratedMap(csv);
  writeFileSync(OUT_PATH, renderModule(map), "utf8");
  console.log(`gen-curated-msrp: wrote ${Object.keys(map).length} entries → ${OUT_PATH}`);
}
