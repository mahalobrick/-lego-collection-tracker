import { describe, it, expect, beforeEach } from "vitest";
import {
  setValueProvenance,
  portfolioValue,
  knownValueCount,
  portfolioROI,
  roiExcludedCount,
  setGain,
  setROI,
  groupRollup,
} from "./portfolio";
import { formatValueCell } from "./valueDisplay";
import { toValue, valueAmount } from "./value";

// ─────────────────────────────────────────────────────────────────────────────
// LOCK: a stored 0 value reads as UNKNOWN, end-to-end — for VALUE, 0 and absent
// are the same (no real set is genuinely worth $0, so a 0 value always means "no
// data"). This is the guarantee: the read funnel (rawSetValue, inside
// setValueProvenance) coalesces a stored 0 → null. Anyone who later "fixes"
// rawSetValue to treat 0 as a genuine value fails these tests.
//
// rawSetValue is not exported; we assert through its public funnel,
// setValueProvenance(s).amount — exactly what every consumer reads (docs/valuation.md
// rule 6). The 0=unknown rule is VALUE-only; for COST, $0 can be genuine (GWP) — out
// of scope here.
// ─────────────────────────────────────────────────────────────────────────────

const ZERO_TOTAL   = { totalValue: 0, paidPrice: 50, qty: 1 };   // baked-0 total
const ZERO_PERUNIT = { currentValue: 0, paidPrice: 50, qty: 3 }; // baked-0 per-unit, qty>1
const ABSENT       = { paidPrice: 50, qty: 1 };                  // no value field at all
const KNOWN        = { currentValue: 150, paidPrice: 100, qty: 1 };

describe("a stored 0 value reads as UNKNOWN at the value read funnel", () => {
  it("totalValue: 0 → amount null (not 0)", () => {
    expect(setValueProvenance(ZERO_TOTAL).amount).toBeNull();
  });

  it("currentValue: 0 (qty > 1) → amount null (never 0 × qty)", () => {
    expect(setValueProvenance(ZERO_PERUNIT).amount).toBeNull();
  });

  it("a stored 0 is indistinguishable from absent — both unknown", () => {
    expect(setValueProvenance(ZERO_TOTAL).amount).toBe(setValueProvenance(ABSENT).amount);
    expect(setValueProvenance(ABSENT).amount).toBeNull();
  });
});

describe("an unknown (0-value) set shows '—' and is excluded from totals / avg / ROI", () => {
  beforeEach(() => localStorage.clear()); // money() → USD default

  it("renders '—', never '$0.00'", () => {
    expect(formatValueCell(setValueProvenance(ZERO_TOTAL))).toBe("—");
    expect(formatValueCell(setValueProvenance(ZERO_PERUNIT))).toBe("—");
  });

  it("contributes nothing to the combined value total", () => {
    expect(portfolioValue([ZERO_TOTAL])).toBe(0);
    expect(portfolioValue([KNOWN, ZERO_TOTAL])).toBeCloseTo(150, 5); // = KNOWN alone
  });

  it("is excluded from the value average's denominator (knownValueCount)", () => {
    expect(knownValueCount([KNOWN, ZERO_TOTAL])).toBe(1);
  });

  it("has no computable gain (null → '—'), never a phantom −cost loss", () => {
    expect(setGain(ZERO_TOTAL)).toBeNull(); // NOT 0 − 50 = −50
  });

  it("is excluded from % ROI even though it has a positive cost", () => {
    expect(setROI(ZERO_TOTAL)).toBeNull();
    expect(portfolioROI([ZERO_TOTAL])).toBeNull();
    expect(roiExcludedCount([KNOWN, ZERO_TOTAL])).toBe(1); // only the 0-value set
  });

  it("is surfaced as unknown in a group rollup, not summed as $0", () => {
    const g = groupRollup([KNOWN, ZERO_TOTAL], () => "All")[0];
    expect(g.value).toBeCloseTo(150, 5);
    expect(g.knownValueCount).toBe(1);
    expect(g.unknownValueCount).toBe(1);
  });
});

// The SetDetailPanel per-copy breakdown builds its Value via toValue directly (not
// rawSetValue), so it routes the raw entry value through the SAME shared valueAmount
// helper. This pins that a per-copy entry stored with current_value: 0 reads as
// unknown end-to-end — value "—" and gain "—", never "$0.00" / a phantom 0 − paid.
describe("per-copy entry: a stored current_value 0 is unknown (value '—', gain '—')", () => {
  beforeEach(() => localStorage.clear());

  // Mirrors SetDetailPanel's per-copy inline read.
  const entryProv = (entry) =>
    toValue(valueAmount(entry.current_value ?? entry.Value ?? entry.value), {
      condition: entry.condition,
      retired: false,
    });
  const entryGain = (entry, paid) => {
    const val = entryProv(entry).amount;
    return val === null ? null : val - paid;
  };

  it("current_value: 0 → value unknown → cell '—', never '$0.00'", () => {
    const prov = entryProv({ current_value: 0 });
    expect(prov.amount).toBeNull();
    expect(formatValueCell(prov)).toBe("—");
  });

  it("current_value: 0 → gain '—' (null), never a phantom 0 − paid loss", () => {
    expect(entryGain({ current_value: 0 }, 50)).toBeNull(); // NOT −50
  });

  it("a known per-copy value still renders and gains normally", () => {
    const prov = entryProv({ current_value: 120 });
    expect(formatValueCell(prov)).toBe("$120.00");
    expect(entryGain({ current_value: 120 }, 100)).toBeCloseTo(20, 5);
  });
});
