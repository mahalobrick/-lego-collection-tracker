import { describe, it, expect } from "vitest";
import { freebieValue, portfolioGain } from "./portfolio";
import { money } from "./formatting";
import { roiScopeNote, roiScopeTooltip, freebieNote, FREEBIE_TOOLTIP } from "./valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// ROI / Net Gain scope relabel (divergence disclosure). LABELS ONLY — these pin
// freebieValue (the $0-cost bridge) and that the relabel notes render. The
// portfolioGain / portfolioROI math is untouched (covered by portfolio.gain /
// roi.characterization tests).
// ─────────────────────────────────────────────────────────────────────────────

const GWP          = { currentValue: 80,  paidPrice: 0,   qty: 1 }; // $0 cost, known value → free
const WIN          = { currentValue: 150, paidPrice: 100, qty: 1 }; // cost>0, +50 gain
const UNKNOWN_FREE = { paidPrice: 0, qty: 1 };                      // $0 cost, value UNKNOWN → not counted

describe("freebieValue()", () => {
  it("sums value over $0-cost, value-KNOWN sets only", () => {
    expect(freebieValue([GWP, WIN, UNKNOWN_FREE])).toBeCloseTo(80, 5);
  });

  it("excludes unknown-value $0-cost sets (no value → nothing to count)", () => {
    expect(freebieValue([UNKNOWN_FREE])).toBeCloseTo(0, 5);
    expect(freebieValue([])).toBe(0);
  });

  it("is the dollar bridge: portfolioGain − freebieValue === the cost>0 core gain", () => {
    const sets = [GWP, WIN, UNKNOWN_FREE];
    // Net Gain = 80 (GWP, full value) + 50 (WIN) = 130; the cost>0 core is just WIN's +50.
    expect(portfolioGain(sets)).toBeCloseTo(130, 5);
    expect(portfolioGain(sets) - freebieValue(sets)).toBeCloseTo(50, 5);
  });
});

describe("ROI / Net Gain relabel notes", () => {
  it("roiScopeNote scopes to cost-basis sets only — numberless & constant (MSRP caveat lives in the tooltip)", () => {
    expect(roiScopeNote()).toBe("cost-basis sets only");
    expect(roiScopeNote(430)).toBe("cost-basis sets only"); // any arg ignored — no count rendered on the card
  });

  it("roiScopeTooltip explains the free-set exclusion, plus a NON-NUMERIC MSRP-baseline caveat when present", () => {
    expect(roiScopeTooltip(0)).toBe(
      "Return on sets you have a cost for. Free sets ($0 cost) are excluded — no % return on $0 invested."
    );
    const tip = roiScopeTooltip(430);
    expect(tip).toContain("cost = MSRP — a gold-standard baseline");
    expect(tip).not.toContain("430"); // msrpCount is NOT rendered — the caveat is non-numeric
  });

  it("freebieNote renders the $0-cost contribution, null when there is none", () => {
    expect(freebieNote(2231)).toBe(`incl. ~${money(2231)} from free sets`);
    expect(freebieNote(0)).toBeNull();
    expect(freebieNote(undefined)).toBeNull();
  });

  it("FREEBIE_TOOLTIP states $0-cost sets are in the gain but out of ROI", () => {
    expect(FREEBIE_TOOLTIP).toBe("Includes $0-cost sets (GWPs/promos) at full value; ROI excludes them.");
  });
});
