import { describe, it, expect } from "vitest";
import { toValue } from "./value";

// ─────────────────────────────────────────────────────────────────────────────
// Table-driven exhaustion of toValue() over the full provenance matrix:
//   amount    ∈ {0, null, undefined, "", negative, valid}
//   condition ∈ {new, used}
//   source    ∈ {brickeconomy, bricklink, brickset}
//   retired   ∈ {true, false}
// Asserts the derived basis and the cardinal rule: unknown → amount null, NEVER 0.
// ─────────────────────────────────────────────────────────────────────────────

const FIXED_ASOF = "2026-05-30T00:00:00.000Z";

// `expected` is the normalized amount toValue should produce; `known` flags whether
// the input carries a usable figure (drives the basis derivation below).
const AMOUNTS = [
  { label: "zero",      raw: 0,         expected: 0,       known: true },
  { label: "null",      raw: null,      expected: null,    known: false },
  { label: "undefined", raw: undefined, expected: null,    known: false },
  { label: "empty",     raw: "",        expected: null,    known: false },
  { label: "negative",  raw: -5,        expected: -5,      known: true },
  { label: "valid",     raw: 199.99,    expected: 199.99,  known: true },
];

const CONDITIONS = ["new", "used"];
const SOURCES = ["brickeconomy", "bricklink", "brickset"];
const RETIRED = [true, false];

// The spec'd basis: unknown amount → 'unknown'; Brickset is always retail (MSRP);
// BrickLink is raw sold data → always 'market'; BrickEconomy is 'market' once
// retired, else 'retail' (it echoes the sticker price at-retail).
function expectedBasis({ known }, source, retired) {
  if (!known) return "unknown";
  if (source === "brickset") return "retail";
  if (source === "bricklink") return "market";
  return retired ? "market" : "retail";
}

describe("toValue() — full provenance matrix", () => {
  for (const amount of AMOUNTS) {
    for (const condition of CONDITIONS) {
      for (const source of SOURCES) {
        for (const retired of RETIRED) {
          const name = `amount=${amount.label} condition=${condition} source=${source} retired=${retired}`;
          it(name, () => {
            const v = toValue(amount.raw, { source, condition, retired, asOf: FIXED_ASOF });

            // Cardinal rule: unknown is null, never 0.
            expect(v.amount).toBe(amount.expected);
            if (!amount.known) expect(v.amount).toBeNull();
            expect(v.amount).not.toBe(undefined);

            expect(v.basis).toBe(expectedBasis(amount, source, retired));
            expect(v.source).toBe(source);
            expect(v.condition).toBe(condition);
            expect(v.asOf).toBe(FIXED_ASOF);
          });
        }
      }
    }
  }
});

describe("toValue() — the falsy-zero distinction (the whole point)", () => {
  it("keeps a genuine 0 as a KNOWN amount of 0 (not unknown)", () => {
    const v = toValue(0, { source: "brickeconomy", condition: "new", retired: true });
    expect(v.amount).toBe(0);
    expect(v.basis).toBe("market"); // a known figure, basis still derives normally
  });

  it("maps missing data to amount null + basis 'unknown', never 0", () => {
    for (const raw of [null, undefined, ""]) {
      const v = toValue(raw, { source: "brickeconomy", condition: "new", retired: true });
      expect(v.amount).toBeNull();
      expect(v.amount).not.toBe(0);
      expect(v.basis).toBe("unknown");
    }
  });

  it("treats an unparseable string as unknown (null), not 0", () => {
    const v = toValue("not a number", { source: "bricklink", condition: "used" });
    expect(v.amount).toBeNull();
    expect(v.basis).toBe("unknown");
  });
});

describe("toValue() — amount normalization", () => {
  it("strips $ and commas from string figures", () => {
    expect(toValue("$1,203.32", { source: "brickeconomy" }).amount).toBe(1203.32);
  });

  it("passes finite numbers through unchanged (incl. negative)", () => {
    expect(toValue(298.99, {}).amount).toBe(298.99);
    expect(toValue(-5, {}).amount).toBe(-5);
  });

  it("rejects non-finite numbers as unknown", () => {
    expect(toValue(NaN, {}).amount).toBeNull();
    expect(toValue(Infinity, {}).amount).toBeNull();
  });
});

describe("toValue() — basis derivation rules", () => {
  it("Brickset is always retail basis (original MSRP), even when retired", () => {
    expect(toValue(50, { source: "brickset", retired: true }).basis).toBe("retail");
    expect(toValue(50, { source: "brickset", retired: false }).basis).toBe("retail");
  });

  it("BrickEconomy flips retail → market on retirement (echoes sticker price at-retail)", () => {
    expect(toValue(372.2, { source: "brickeconomy", retired: false }).basis).toBe("retail");
    expect(toValue(372.2, { source: "brickeconomy", retired: true }).basis).toBe("market");
  });

  it("BrickLink is market basis whenever a real figure exists, even at-retail (raw sold data)", () => {
    expect(toValue(372.2, { source: "bricklink", retired: false }).basis).toBe("market");
    expect(toValue(372.2, { source: "bricklink", retired: true }).basis).toBe("market");
  });

  it("defaults: no source, not retired → retail when known, unknown when not", () => {
    expect(toValue(10, {}).basis).toBe("retail");
    expect(toValue(null, {}).basis).toBe("unknown");
  });
});

describe("toValue() — defaults", () => {
  it("defaults source/condition to null and stamps an asOf when omitted", () => {
    const v = toValue(199.99);
    expect(v.source).toBeNull();
    expect(v.condition).toBeNull();
    expect(typeof v.asOf).toBe("string");
    expect(v.asOf).not.toBe("");
  });
});
