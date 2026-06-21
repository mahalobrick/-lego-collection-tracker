import { describe, it, expect } from "vitest";
import { toISODate, parseLocalDate } from "./formatting";
import { materializeEntries } from "./percopy";
import { ownedSetFromBlob } from "./beCollection";

// ─────────────────────────────────────────────────────────────────────────────
// Per-copy acquired_date → ISO standardization (read boundary, non-destructive).
//
// Real per-copy dates are stored as US "M/D/YYYY" (BE-CSV import); code intends ISO.
// We normalize on READ (never rewrite storage), fix the off-by-one in the date
// formatters, and make the derived holding date + column sort chronological.
// ─────────────────────────────────────────────────────────────────────────────

describe("toISODate — read-boundary coercion to ISO yyyy-mm-dd", () => {
  it("parses US M/D/YYYY → ISO, padding single digits", () => {
    expect(toISODate("7/13/2025")).toBe("2025-07-13");
    expect(toISODate("12/1/2023")).toBe("2023-12-01"); // single-digit day padded
    expect(toISODate("1/5/2024")).toBe("2024-01-05");  // both padded
  });
  it("is idempotent on already-ISO values", () => {
    expect(toISODate("2025-07-13")).toBe("2025-07-13");
    expect(toISODate(toISODate("7/13/2025"))).toBe("2025-07-13"); // double-apply
  });
  it("empty / null / undefined → empty string", () => {
    expect(toISODate("")).toBe("");
    expect(toISODate(null)).toBe("");
    expect(toISODate(undefined)).toBe("");
  });
  it("trims surrounding whitespace", () => {
    expect(toISODate("  7/13/2025  ")).toBe("2025-07-13");
  });
  it("leaves anything unparseable UNCHANGED (never drops a value)", () => {
    expect(toISODate("Q3 2024")).toBe("Q3 2024");
    expect(toISODate("7/13/25")).toBe("7/13/25");     // 2-digit year — not the recognized shape
    expect(toISODate("not a date")).toBe("not a date");
  });
});

describe("parseLocalDate — local date-only (no UTC off-by-one)", () => {
  it("builds an ISO date as the correct LOCAL day, regardless of timezone", () => {
    // Parts-based construction: getDate/getMonth/getFullYear round-trip the input exactly.
    // A bare new Date('2023-12-01') (UTC) would be Nov 30 in a negative-offset zone.
    const d = parseLocalDate("2023-12-01");
    expect(d.getFullYear()).toBe(2023);
    expect(d.getMonth()).toBe(11); // December (0-indexed) — NOT November (off-by-one)
    expect(d.getDate()).toBe(1);   // 1st — NOT the prior day
  });
  it("handles legacy M/D/YYYY too", () => {
    const d = parseLocalDate("7/13/2025");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2025, 6, 13]);
  });
  it("formats a first-of-month value to the correct month/year", () => {
    expect(parseLocalDate("2023-12-01").toLocaleDateString("en-US", { month: "short", year: "numeric" })).toBe("Dec 2023");
  });
  it("empty / unparseable → null", () => {
    expect(parseLocalDate("")).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate("garbage")).toBeNull();
  });
});

describe("ISO lexical sort is chronological (the column-sort + derived-date guarantee)", () => {
  it("orders ISO strings chronologically; raw M/D/YYYY does NOT", () => {
    const iso = ["2020-09-01", "2023-10-01", "2022-01-31"].slice().sort();
    expect(iso[iso.length - 1]).toBe("2023-10-01"); // most recent last
    // Why normalization matters: the SAME dates as raw M/D/YYYY sort wrong.
    const raw = ["9/1/2020", "10/1/2023", "1/31/2022"].slice().sort();
    expect(raw[raw.length - 1]).not.toBe("10/1/2023"); // lexical picks the wrong "most recent"
  });
});

describe("materializeEntries — normalizes per-copy acquired_date to ISO on read", () => {
  it("coerces stored M/D/YYYY entries to ISO (non-destructive: input not mutated)", () => {
    const set = {
      setNumber: "31120-1", qty: 2,
      entries: [
        { paid_price: 16.56, condition: "new", acquired_date: "7/13/2025" },
        { paid_price: 16.56, condition: "new", acquired_date: "12/1/2023" },
      ],
    };
    const out = materializeEntries(set);
    expect(out.map(e => e.acquired_date)).toEqual(["2025-07-13", "2023-12-01"]);
    // Source untouched — we transform on read only.
    expect(set.entries[0].acquired_date).toBe("7/13/2025");
  });
  it("idempotent on ISO; empty stays empty", () => {
    const set = { setNumber: "x", qty: 2, entries: [
      { acquired_date: "2024-03-01" }, { acquired_date: "" },
    ] };
    expect(materializeEntries(set).map(e => e.acquired_date)).toEqual(["2024-03-01", ""]);
  });
});

describe("ownedSetFromBlob — derived holding acquiredDate is the chronologically-most-recent ISO", () => {
  it("picks the latest by ISO order (not raw lexical) and exposes it as ISO", () => {
    const item = {
      setNumber: "75254-1", quantity: 2,
      entries: [
        { acquired_date: "9/1/2020" },   // older
        { acquired_date: "10/1/2023" },  // most recent (raw lexical would pick 9/1/2020)
      ],
    };
    const set = ownedSetFromBlob(item);
    expect(set.acquiredDate).toBe("2023-10-01");
    // Non-destructive: the per-copy entries pass through unchanged (normalization is on read).
    expect(set.entries[0].acquired_date).toBe("9/1/2020");
  });
  it("no per-copy dates → null", () => {
    const set = ownedSetFromBlob({ setNumber: "x", quantity: 1, entries: [{ paid_price: 5 }] });
    expect(set.acquiredDate).toBeNull();
  });
});
