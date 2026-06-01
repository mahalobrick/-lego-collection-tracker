import { describe, it, expect } from "vitest";
import { formatValue, formatAggregateValue } from "./valueDisplay";
import { valueAmount } from "./value";
import { portfolioValue, knownValueCount } from "./portfolio";
import { money } from "./formatting";

// ─────────────────────────────────────────────────────────────────────────────
// Workstream A — the $0-for-unknown guard, at the funnel level.
//
// Two things this pins:
//   1. formatValue is the bare-number twin of formatValueCell and honours the SAME
//      0→unknown rule once a value read has been coalesced by valueAmount: a 0/blank/
//      unparseable value → "—", never money(0). (docs/valuation.md rule 6)
//   2. An all-unknown collection's aggregate value cards render "—", not "$0.00" —
//      the exact behaviour the My-Collection cards now compose from portfolioValue +
//      knownValueCount → formatAggregateValue. This is the "convention + test" half of
//      the ESLint known-gap (generic aggregates aren't AST-bannable; this locks them).
// money() is imported (not hardcoded) so assertions hold across currency/locale.
// ─────────────────────────────────────────────────────────────────────────────

describe("formatValue() — 0 is unknown for VALUE", () => {
  it("formatValue(valueAmount(0)) renders the em dash, never $0", () => {
    expect(valueAmount(0)).toBeNull();
    expect(formatValue(valueAmount(0))).toBe("—");
    expect(formatValue(valueAmount(0))).not.toBe(money(0));
  });

  it("treats missing / blank / unparseable as unknown too", () => {
    expect(formatValue(valueAmount(undefined))).toBe("—");
    expect(formatValue(valueAmount(null))).toBe("—");
    expect(formatValue(valueAmount(""))).toBe("—");
    expect(formatValue(valueAmount("abc"))).toBe("—");
  });

  it("still renders a genuine known amount via money()", () => {
    expect(formatValue(valueAmount(199.99))).toBe(money(199.99));
  });
});

describe("an all-unknown collection renders no $0.00 value card", () => {
  // Sets carrying NO usable value data — every contribution is unknown. The stored `0`
  // (set "333") and the absent fields are the SAME: unknown for VALUE (no set is worth $0).
  const allUnknown = [
    { setNumber: "111", qty: 1, paidPrice: 50 },
    { setNumber: "222", qty: 2, condition: "used_good", paidPrice: 30 },
    { setNumber: "333", qty: 1, totalValue: 0 },
  ];

  it("the funnel reports zero known values (unknowns contribute 0 to the sum)", () => {
    expect(knownValueCount(allUnknown)).toBe(0);
    expect(portfolioValue(allUnknown)).toBe(0);
  });

  it('the Collection Value card shows "—", not $0.00', () => {
    const card = formatAggregateValue(portfolioValue(allUnknown), knownValueCount(allUnknown));
    expect(card).toBe("—");
    expect(card).not.toBe(money(0));
  });

  it('one known value flips the card from "—" to money()', () => {
    const mixed = [...allUnknown, { setNumber: "444", qty: 1, totalValue: 120 }];
    expect(knownValueCount(mixed)).toBe(1);
    const card = formatAggregateValue(portfolioValue(mixed), knownValueCount(mixed));
    expect(card).toBe(money(120));
    expect(card).not.toBe("—");
  });
});
