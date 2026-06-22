import { describe, it, expect } from "vitest";
import { DEFAULT_OWNED_COLUMNS } from "./columnDefaults";

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_OWNED_COLUMNS is the single source of truth for the owned-table column
// menu AND the persisted-config merge filter (a saved column whose key is not in
// defaults is dropped on load). Removing a column from this list drops it from the
// menu everywhere AND self-heals it out of any saved blOwnedColumns order:
//   • MC-Browse polish R1 — the two BrickLink sold-price columns (blSoldNew /
//     blSoldUsed): backed only by a non-persisted, auth-gated BL read overlay.
//   • Table slim-down 1B — the five metadata columns (Figs / Acquired / Retired /
//     Released / Notes): now shown on the detail page (Timeline, Set Details,
//     per-copy breakdown), so they no longer earn a table column.
// ─────────────────────────────────────────────────────────────────────────────

const keys = DEFAULT_OWNED_COLUMNS.map(c => c.key);

describe("DEFAULT_OWNED_COLUMNS — removed columns", () => {
  it("does not include the BL sold-price columns (R1)", () => {
    expect(keys).not.toContain("blSoldNew");
    expect(keys).not.toContain("blSoldUsed");
  });

  it("does not include the five metadata columns (slim-down 1B)", () => {
    for (const k of ["minifigs", "acquiredDate", "retiredDate", "releasedDate", "notes"]) {
      expect(keys).not.toContain(k);
    }
  });

  it("still includes the surviving owned columns", () => {
    for (const k of ["setNumber", "name", "theme", "qty", "value", "gain", "roi"]) {
      expect(keys).toContain(k);
    }
  });
});

// Mirrors the inline drop-unknown-keys reconcile in MyCollection.jsx's ownedColumns
// initializer: a persisted blOwnedColumns entry whose key is no longer in defaults is
// filtered out, and any default missing from the saved order is appended. A saved order
// that still names a removed column (e.g. "retiredDate") must self-heal without throwing.
function reconcileOwnedColumns(parsed) {
  const labelMap = Object.fromEntries(DEFAULT_OWNED_COLUMNS.map(c => [c.key, c.label]));
  const defaultKeys = new Set(DEFAULT_OWNED_COLUMNS.map(c => c.key));
  const merged = parsed.filter(c => defaultKeys.has(c.key)).map(c => ({ ...c, label: labelMap[c.key] ?? c.label }));
  const savedKeys = new Set(merged.map(c => c.key));
  const missing = DEFAULT_OWNED_COLUMNS.filter(c => !savedKeys.has(c.key));
  return missing.length ? [...merged, ...missing] : merged;
}

describe("blOwnedColumns load-reconcile — removed keys self-heal", () => {
  it("drops a persisted removed key ('retiredDate') from the order without throwing", () => {
    const saved = [
      { key: "setNumber", label: "Set", visible: true },
      { key: "retiredDate", label: "Retired", visible: true }, // removed — must be dropped
      { key: "value", label: "Value", visible: true },
    ];
    const out = reconcileOwnedColumns(saved);
    const outKeys = out.map(c => c.key);
    expect(outKeys).not.toContain("retiredDate");
    expect(outKeys).toContain("setNumber");
    expect(outKeys).toContain("value");
  });

  it("drops every removed metadata key and never reintroduces one", () => {
    const saved = ["minifigs", "acquiredDate", "retiredDate", "releasedDate", "notes"]
      .map(k => ({ key: k, label: k, visible: true }));
    const out = reconcileOwnedColumns(saved);
    const outKeys = out.map(c => c.key);
    for (const k of ["minifigs", "acquiredDate", "retiredDate", "releasedDate", "notes"]) {
      expect(outKeys).not.toContain(k);
    }
    // The surviving defaults are all still present (appended as "missing").
    for (const k of keys) expect(outKeys).toContain(k);
  });
});
