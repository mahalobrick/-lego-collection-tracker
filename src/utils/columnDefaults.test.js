import { describe, it, expect } from "vitest";
import { DEFAULT_OWNED_COLUMNS } from "./columnDefaults";

// ─────────────────────────────────────────────────────────────────────────────
// MC-Browse polish R1 — the two BrickLink sold-price columns (blSoldNew /
// blSoldUsed) were removed from the owned-table column menu: backed only by a
// non-persisted, auth-gated BL read overlay (usually empty) and already shown in
// the detail panel. DEFAULT_OWNED_COLUMNS is the single source of truth that drives
// both the menu AND the persisted-config merge filter (a saved column not in
// defaults is dropped), so their absence here removes them everywhere.
// ─────────────────────────────────────────────────────────────────────────────

describe("DEFAULT_OWNED_COLUMNS — BL sold-price columns removed (R1)", () => {
  const keys = DEFAULT_OWNED_COLUMNS.map(c => c.key);

  it("does not include blSoldNew or blSoldUsed", () => {
    expect(keys).not.toContain("blSoldNew");
    expect(keys).not.toContain("blSoldUsed");
  });

  it("still includes the surviving owned columns", () => {
    for (const k of ["setNumber", "name", "value", "gain", "roi", "minifigs", "notes"]) {
      expect(keys).toContain(k);
    }
  });
});
