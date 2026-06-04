import { describe, it, expect } from "vitest";
import { manualMsrpPatch, setRetailProvenance } from "./portfolio";
import { retailSourceMarker } from "./valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// Retail Phase 3a.1 — the hand-entered MSRP edit contract. manualMsrpPatch is the
// SINGLE formula both the Add-Set form and the edit form write through, so an existing
// set edited via the form stores msrp exactly as a newly-added set would. Per-unit,
// mirrored to retailPrice (ladder reads msrp; headline card + paidEqualsRetail read
// retailPrice — they stay in lockstep).
// ─────────────────────────────────────────────────────────────────────────────

describe("manualMsrpPatch — the shared Add-Set / edit-form write contract", () => {
  it("writes a per-unit msrp mirrored to retailPrice", () => {
    expect(manualMsrpPatch(4.99)).toEqual({ msrp: 4.99, retailPrice: 4.99 });
  });

  it("parses a form string ($/commas tolerated, same as value reads)", () => {
    expect(manualMsrpPatch("12.50")).toEqual({ msrp: 12.5, retailPrice: 12.5 });
    expect(manualMsrpPatch("$1,299.99")).toEqual({ msrp: 1299.99, retailPrice: 1299.99 });
  });

  it("blank / 0 → {0,0} (clears the manual rung — value coalescing reads 0 as 'no MSRP')", () => {
    expect(manualMsrpPatch("")).toEqual({ msrp: 0, retailPrice: 0 });
    expect(manualMsrpPatch(0)).toEqual({ msrp: 0, retailPrice: 0 });
    expect(manualMsrpPatch(undefined)).toEqual({ msrp: 0, retailPrice: 0 });
  });
});

describe("a stored s.msrp resolves through the ladder's manual rung", () => {
  // Mirrors retailFor's source build: brickset from cache (none here), manual from the set's msrp.
  const resolve = (set) =>
    setRetailProvenance(
      { brickset: { amount: null }, manual: { amount: set.msrp }, brickeconomy: { amount: null } },
      { condition: set.condition },
    );

  it("an edited set with only a manual msrp → tagged 'manual'", () => {
    const set = { ...manualMsrpPatch("4.99"), condition: "new" };
    const v = resolve(set);
    expect(v).toMatchObject({ amount: 4.99, source: "manual" });
    expect(retailSourceMarker(v)).toMatchObject({ marker: "manual" });
  });

  it("clearing the msrp (0) → manual rung drops out (→ null / '—' here)", () => {
    const set = { ...manualMsrpPatch(""), condition: "new" };
    expect(resolve(set)).toBeNull();
  });
});
