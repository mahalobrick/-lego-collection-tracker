import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT TEST — the bundled Rebrickable CSVs (integration-standard.md §5, P4).
// No network: the "contract" is the shipped files' HEADER columns vs the columns
// rebrickable.js reads. A header rename/removal (e.g. a refreshed download dropping
// `theme_id`) makes papaparse's header map silently yield `undefined` — this asserts
// every read column is present, so such a drift fails CI. Extra new columns are fine.
// ─────────────────────────────────────────────────────────────────────────────
const publicDir = path.resolve(__dirname, "../../public");

function headerCols(file) {
  return readFileSync(path.join(publicDir, file), "utf8")
    .split("\n")[0]
    .replace(/\r$/, "")
    .split(",");
}

// Columns rebrickable.js consumes (loadRebrickable / rbLookupSet).
const SETS_READ = ["set_num", "name", "year", "theme_id", "num_parts", "img_url"];
const THEMES_READ = ["id", "name", "parent_id"];

describe("Rebrickable bundled CSV — column contract", () => {
  it("public/sets.csv header carries every column rebrickable.js reads", () => {
    const cols = headerCols("sets.csv");
    for (const c of SETS_READ) expect(cols, `sets.csv missing column "${c}"`).toContain(c);
  });

  it("public/themes.csv header carries every column rebrickable.js reads", () => {
    const cols = headerCols("themes.csv");
    for (const c of THEMES_READ) expect(cols, `themes.csv missing column "${c}"`).toContain(c);
  });
});
