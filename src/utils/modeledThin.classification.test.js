import { describe, it, expect } from "vitest";
import { setValueProvenance, estimatedValueShare } from "./portfolio";
import { valueConfidence, lotsLabel } from "./valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// modeled_thin classification — the app-side twin of the cron's rung-gap close
// (scripts/lib/deriveValue.mjs, commit 9073dba). The cron emits basis="modeled_thin"
// (used modeled off a THIN new sample); the app must classify it as an ESTIMATE —
// counted in the "% estimated" disclosure, confidence "estimates", honest distinct
// label — NOT fall through as a clean/confident figure. sold_thin (real-but-thin
// SOLD data) stays exactly as it was: flagged "thin", never counted as estimated.
// ─────────────────────────────────────────────────────────────────────────────

const ASOF = "2026-06-14T03:00:00.000Z";
const cond = (amount, basis, lots) => ({ amount, basis, lots, asOf: ASOF });
const set = (n, condition = "used") => ({ setNumber: n, condition, quantity: 1 });

// One owned-used set per basis; the used condition carries the basis under test.
const VALUE_MAP = {
  "sold-1":  { new: cond(200, "sold", 50), used: cond(100, "sold", 20) },
  "mthin-1": { new: cond(18.99, "sold_thin", 3), used: cond(14.24, "modeled_thin", 3) },
  "sthin-1": { new: cond(120, "sold", 30), used: cond(55, "sold_thin", 2) },
  "mod-1":   { new: cond(160, "sold", 40), used: cond(120, "modeled", 40) },
  "ask-1":   { new: cond(90, "sold", 15), used: cond(80, "asking", 2) },
};

describe("modeled_thin counts as an ESTIMATE in the %-estimated disclosure", () => {
  it("estimatedValueShare includes modeled_thin dollars (the count moves)", () => {
    // 100 sold + 14.24 modeled_thin known; only the modeled_thin dollars are estimated.
    const sets = [set("sold-1"), set("mthin-1")];
    expect(estimatedValueShare(sets, VALUE_MAP)).toBeCloseTo(14.24 / 114.24, 10);
  });

  it("REGRESSION: sold_thin is still NOT estimated; modeled/asking still are", () => {
    expect(estimatedValueShare([set("sold-1"), set("sthin-1")], VALUE_MAP)).toBe(0); // real thin sales ≠ estimate
    expect(estimatedValueShare([set("mod-1")], VALUE_MAP)).toBe(1);  // modeled unchanged
    expect(estimatedValueShare([set("ask-1")], VALUE_MAP)).toBe(1);  // asking unchanged
  });
});

describe("modeled_thin reads as an estimate in the confidence funnel", () => {
  it("set-level confidence is 'estimates' (was the 'clean' misread before this fix)", () => {
    expect(setValueProvenance(set("mthin-1"), VALUE_MAP).confidence).toBe("estimates");
  });

  it("valueConfidence: 'est.' marker with an HONEST DISTINCT tooltip (not plain modeled's)", () => {
    const mthin = valueConfidence(setValueProvenance(set("mthin-1"), VALUE_MAP));
    const mod = valueConfidence(setValueProvenance(set("mod-1"), VALUE_MAP));
    expect(mthin).not.toBeNull();
    expect(mthin.marker).toBe("est.");           // same estimate family as modeled…
    expect(mthin.tooltip).toMatch(/thin/i);      // …but the tooltip discloses the thin sample
    expect(mthin.tooltip).not.toBe(mod.tooltip); // distinct on purpose — never mislabeled "modeled"
  });

  it("lotsLabel discloses the thin NEW-sample reading, never a sales count for this copy", () => {
    const label = lotsLabel(setValueProvenance(set("mthin-1"), VALUE_MAP));
    expect(label).toBe("from new price (few sales)");
  });

  it("REGRESSION: sold → no marker; sold_thin → 'thin'; modeled tooltip unchanged", () => {
    expect(valueConfidence(setValueProvenance(set("sold-1"), VALUE_MAP))).toBeNull();
    expect(valueConfidence(setValueProvenance(set("sthin-1"), VALUE_MAP))).toMatchObject({ marker: "thin" });
    expect(valueConfidence(setValueProvenance(set("mod-1"), VALUE_MAP)).tooltip).toBe("Estimated from new sold price");
  });
});
