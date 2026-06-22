// @vitest-environment node
import { describe, it, expect } from "vitest";
import { setImageUrl } from "./formatting";

// setImageUrl builds the Brickset set-image URL. Two fixes pinned here:
//  (1) ANCHORED variant strip — the old unanchored .replace("-1","") corrupted "-1X" numbers
//      (71045-12 → 710452) and built "${figure}-1.jpg" (404) for any non-"-1" variant.
//  (2) CMF figures resolve to their SERIES box image (the only CMF art the set-image host serves),
//      gated by the shared CMF_SERIES_BY_BASE table. No per-figure minifig art (out of scope).
const IMG = (n) => `https://images.brickset.com/sets/small/${n}.jpg`;

describe("setImageUrl — anchored base + CMF series image", () => {
  it("normal set 10497-1 → the -1 set image (unchanged)", () => {
    expect(setImageUrl("10497-1")).toBe(IMG("10497-1"));
  });

  it("normal multi-digit variant 10497-2 → base 10497 → -1 image (anchored, not mangled)", () => {
    expect(setImageUrl("10497-2")).toBe(IMG("10497-1"));
  });

  it("CMF figure 71045-3 → SERIES image 71045-1 (NOT 71045-3-1)", () => {
    expect(setImageUrl("71045-3")).toBe(IMG("71045-1"));
    expect(setImageUrl("71045-3")).not.toContain("71045-3-1");
  });

  it("CMF figure 71045-12 → 71045-1 (anchor fix: NOT the corrupted 710452-1)", () => {
    expect(setImageUrl("71045-12")).toBe(IMG("71045-1"));
    expect(setImageUrl("71045-12")).not.toContain("710452");
  });

  it("CMF series base with no variant (71052) and figure 71052-5 both → 71052-1", () => {
    expect(setImageUrl("71052")).toBe(IMG("71052-1"));
    expect(setImageUrl("71052-5")).toBe(IMG("71052-1"));
  });

  it("a non-CMF base with a multi-digit variant (10497-12) is NOT mis-detected as CMF → 10497-1, not corrupted", () => {
    expect(setImageUrl("10497-12")).toBe(IMG("10497-1"));
    expect(setImageUrl("10497-12")).not.toContain("104972"); // the old unanchored-strip corruption
  });

  it("empty / falsy → empty string (the <img> onError fallbacks handle the blank)", () => {
    expect(setImageUrl("")).toBe("");
    expect(setImageUrl(null)).toBe("");
    expect(setImageUrl(undefined)).toBe("");
  });
});
