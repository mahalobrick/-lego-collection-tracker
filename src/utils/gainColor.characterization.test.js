import { describe, it, expect } from "vitest";
import { setGain, setROI } from "./portfolio";
import { signColor, SIGN_COLORS } from "./valueDisplay";
import { asNumber } from "./formatting";

// ─────────────────────────────────────────────────────────────────────────────
// Sets-tab gain/ROI cell color — characterization + guard.
//
// THE BUG (pinned, then flipped): the gain cell COLOR keyed off a raw inline
// `currentValue×qty − paidPrice×qty` (MyCollection.jsx ~:2437-2439) while the TEXT showed
// setGain (overlay/null-aware). They diverge → a real LOSS could render green, and an
// unknown-value row ("—") rendered red. The fix keys color off the SAME number displayed
// (setGain / setROI) via signColor, with unknown → neutral.
// ─────────────────────────────────────────────────────────────────────────────

const GREEN = "#5aa832", RED = "#ff8b8b";

// Replica of the OLD inline color logic (the bug), for contrast.
const oldGainColor = (s) => {
  const q = asNumber(s.qty) || 1;
  return (asNumber(s.currentValue) * q - asNumber(s.paidPrice) * q) >= 0 ? GREEN : RED;
};

// A set worth LESS than cost on the BL overlay ($80 < $100), but whose STORED currentValue
// ($150) is above paid — so the raw inline reads positive while setGain reads a loss.
const LOSS = { setNumber: "X", condition: "new", qty: 1, paidPrice: 100, currentValue: 150 };
const VALUE_MAP = { "X": { new: { amount: 80, basis: "sold", lots: 5, asOf: "2026-01-01" } } };
// Unknown value (no stored value, no overlay) → setGain null → text "—".
const UNKNOWN = { setNumber: "Y", condition: "new", qty: 1, paidPrice: 50 };
// A genuine gain (no overlay → uses stored currentValue).
const GAIN = { setNumber: "Z", condition: "new", qty: 1, paidPrice: 100, currentValue: 150 };

describe("gain cell color — characterization flips (bug → fixed)", () => {
  it("a real LOSS rendered GREEN (bug); RED after the fix", () => {
    expect(setGain(LOSS, VALUE_MAP)).toBeLessThan(0);  // displayed text is a loss (−$20)
    expect(oldGainColor(LOSS)).toBe(GREEN);            // OLD raw-inline color: GREEN (the bug)
    expect(signColor(setGain(LOSS, VALUE_MAP))).toBe(RED); // FIXED: keyed to the displayed loss
  });

  it("an UNKNOWN-value row rendered RED (bug); NEUTRAL after the fix", () => {
    expect(setGain(UNKNOWN)).toBeNull();               // displayed text is "—"
    expect(oldGainColor(UNKNOWN)).toBe(RED);           // OLD: 0 − paid < 0 → red on a "—" cell
    expect(signColor(setGain(UNKNOWN))).toBe(SIGN_COLORS.neutral); // FIXED: neutral, matches "—"
  });

  it("a genuine gain stays green", () => {
    expect(setGain(GAIN)).toBeGreaterThan(0);
    expect(signColor(setGain(GAIN))).toBe(GREEN);
  });
});

describe("signColor guard — color sign always matches the DISPLAYED value (gain & ROI)", () => {
  const cases = [
    ["loss", LOSS, VALUE_MAP, RED],
    ["gain", GAIN, undefined, GREEN],
    ["unknown", UNKNOWN, undefined, SIGN_COLORS.neutral],
  ];
  for (const [label, set, map, expected] of cases) {
    it(`${label}: gain color matches sign(setGain)`, () => {
      const g = setGain(set, map);
      expect(signColor(g)).toBe(expected);
      if (g != null) expect(signColor(g)).toBe(g >= 0 ? GREEN : RED);
    });
    it(`${label}: ROI color matches sign(setROI)`, () => {
      const r = setROI(set, map);
      const c = signColor(r);
      if (r == null) expect(c).toBe(SIGN_COLORS.neutral);
      else expect(c).toBe(r >= 0 ? GREEN : RED);
    });
  }
});
