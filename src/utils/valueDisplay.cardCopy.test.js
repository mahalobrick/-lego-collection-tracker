import { describe, it, expect } from "vitest";
import {
  retailCoverageNote, retailCoverageCounts, retailCoverageTooltip,
  TOTAL_SETS_TOOLTIP, NEW_USED_COUNT_TOOLTIP, CONDITION_VALUE_TOOLTIP, RETIRED_TOOLTIP, COST_BASIS_TOOLTIP,
} from "./valueDisplay";
import { money } from "./formatting";

// ─────────────────────────────────────────────────────────────────────────────
// Collection-stats tooltip content audit (Workstream #2). Two guarantees:
//  (1) the new GENERIC card copy renders the agreed wording (no hardcoded counts/$);
//  (2) the MSRP card's segment COUNTS are UNCHANGED — retailCoverageCounts is a pure
//      reformat of the same portfolioRetail result (no recompute), with the dollar
//      sums RELOCATED out of the sub into retailCoverageTooltip.
// money() is imported (not hardcoded) so assertions hold across currency/locale.
// ─────────────────────────────────────────────────────────────────────────────

// A representative MSRP partition: some sourced, some estimated, a valued promo (ARV), some unlisted.
const SEG = { known: 2, estimated: 1, estimatedTotal: 39.98, promo: 1, promoTotal: 19.99, notListed: 3 };

describe("retailCoverageCounts() — MSRP sub, counts only (sums relocated)", () => {
  it("renders the four segment COUNTS, omitting the dollar detail", () => {
    expect(retailCoverageCounts(SEG)).toBe("2 sourced · 1 est. · 1 promo · 3 not listed");
  });

  it("carries NO dollar figure (relocated to the tooltip)", () => {
    expect(retailCoverageCounts(SEG)).not.toMatch(/\$/);
  });

  it("omits zero-count segments and returns null when fully sourced", () => {
    expect(retailCoverageCounts({ known: 5 })).toBeNull(); // nothing but sourced → headline says it all
    expect(retailCoverageCounts({ known: 4, notListed: 1 })).toBe("4 sourced · 1 not listed");
  });

  it("COUNTS are UNCHANGED vs retailCoverageNote — same numbers, no recompute", () => {
    const note = retailCoverageNote(SEG);
    // every segment count that the (old) note showed is preserved verbatim in the counts-only sub
    for (const token of ["2 sourced", "3 not listed"]) expect(note).toContain(token);
    expect(retailCoverageCounts(SEG)).toContain("2 sourced");
    expect(retailCoverageCounts(SEG)).toContain("3 not listed");
    // the note USED to carry the $ sums inline; those are exactly what moves to the tooltip
    expect(note).toContain(money(39.98));
    expect(note).toContain(money(19.99));
  });
});

describe("retailCoverageTooltip() — MSRP glossary, relocated $ sums", () => {
  it("defines the segments and RELOCATES the estimated + promo-ARV sums (existing computed values)", () => {
    const tip = retailCoverageTooltip(SEG);
    expect(tip).toContain("Sourced = confirmed RRP.");
    expect(tip).toContain(`Estimated where none exists (~${money(39.98)}).`);
    expect(tip).toContain(`Promo = LEGO's stated value / ARV (~${money(19.99)}), not an RRP.`);
    expect(tip).toContain("Not listed = no value found.");
  });

  it("mirrors only the PRESENT segments and shares the fully-sourced null gate", () => {
    expect(retailCoverageTooltip({ known: 5 })).toBeNull();
    const noEst = retailCoverageTooltip({ known: 1, notListed: 2 });
    expect(noEst).toContain("Sourced = confirmed RRP.");
    expect(noEst).not.toContain("Estimated where none exists"); // estimated:0 → clause omitted
    expect(noEst).toContain("Not listed = no value found.");
  });

  it("a promo with no ARV ($0) drops the dollar clause but keeps the label", () => {
    const tip = retailCoverageTooltip({ known: 1, promo: 1, promoTotal: 0 });
    expect(tip).toContain("Promo = LEGO's stated value / ARV, not an RRP.");
    expect(tip).not.toMatch(/ARV \(/); // no "(~$…)" when there's no ARV
  });
});

describe("Collection-stats card glossary copy renders the agreed, GENERIC wording", () => {
  it("Total Sets explains total vs unique + the multi-copy gap", () => {
    expect(TOTAL_SETS_TOOLTIP).toContain("every copy you own");
    expect(TOTAL_SETS_TOOLTIP).toContain("distinct sets");
    expect(TOTAL_SETS_TOOLTIP).toContain("multi-copy");
  });
  it("New/Used COUNT card says per-copy", () => {
    expect(NEW_USED_COUNT_TOOLTIP).toContain("per copy");
  });
  it("New/Used VALUE cards say per-copy and that the two sum to collection value", () => {
    expect(CONDITION_VALUE_TOOLTIP).toContain("per copy");
    expect(CONDITION_VALUE_TOOLTIP).toContain("New or Used");
    expect(CONDITION_VALUE_TOOLTIP).toContain("sum to your collection value");
  });
  it("Retired Sets explains the % (retired ÷ unique sets, counted once per set, not per copy)", () => {
    expect(RETIRED_TOOLTIP).toContain("÷");
    expect(RETIRED_TOOLTIP).toContain("unique sets");
    expect(RETIRED_TOOLTIP).toContain("counts once");
    expect(RETIRED_TOOLTIP).toContain("not per copy");
  });
  it("Cost Basis explains the MSRP cost proxy / conservative ROI", () => {
    expect(COST_BASIS_TOOLTIP).toContain("MSRP");
    expect(COST_BASIS_TOOLTIP).toContain("conservative");
  });
  it("none of the static glossary copy hardcodes a count or dollar figure", () => {
    for (const s of [TOTAL_SETS_TOOLTIP, NEW_USED_COUNT_TOOLTIP, CONDITION_VALUE_TOOLTIP, RETIRED_TOOLTIP, COST_BASIS_TOOLTIP]) {
      expect(s).not.toMatch(/\$|\d/); // generic only — no per-collection numbers baked into the literal
    }
  });
});
