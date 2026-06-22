// @vitest-environment node
import { describe, it, expect } from "vitest";
import { setImageUrl, setImageFallbackUrl, handleSetImageError } from "./formatting";

// setImageUrl builds the Brickset set-image URL from the FULL set number, VARIANT PRESERVED.
// Brickset serves the real per-figure CMF art keyed by the full number (verified 200):
//   71045-3 → https://images.brickset.com/sets/small/71045-3.jpg  (= figure 3, "Vampire Knight"),
//   NOT 71045-1 (figure 1) and NOT the old 71045-3-1.jpg (404). No -1 forcing, no "-1X" corruption.
// (Supersedes 4e3ce39, which stripped the variant and forced -1 → rendered figure 1 for every figure.)
const IMG = (n) => `https://images.brickset.com/sets/small/${n}.jpg`;

describe("setImageUrl — full number, variant preserved (real per-figure CMF art)", () => {
  it("normal set 10497-1 → 10497-1.jpg (unchanged)", () => {
    expect(setImageUrl("10497-1")).toBe(IMG("10497-1"));
  });

  it("bare number with no variant 10497 → 10497-1.jpg (defaults to -1 only when absent)", () => {
    expect(setImageUrl("10497")).toBe(IMG("10497-1"));
  });

  it("non-1 set variant 10497-2 → 10497-2.jpg (variant PRESERVED, not forced to -1)", () => {
    expect(setImageUrl("10497-2")).toBe(IMG("10497-2"));
  });

  it("CMF figure 71045-3 → 71045-3.jpg (the actual figure, NOT 71045-1, NOT 71045-3-1)", () => {
    expect(setImageUrl("71045-3")).toBe(IMG("71045-3"));
    expect(setImageUrl("71045-3")).not.toContain("71045-1");
    expect(setImageUrl("71045-3")).not.toContain("71045-3-1");
  });

  it("CMF figure 71045-12 → 71045-12.jpg (variant preserved, NOT corrupted to 710452-1)", () => {
    expect(setImageUrl("71045-12")).toBe(IMG("71045-12"));
    expect(setImageUrl("71045-12")).not.toContain("710452");
  });

  it("CMF figure 71047-10 → 71047-10.jpg", () => {
    expect(setImageUrl("71047-10")).toBe(IMG("71047-10"));
  });

  it("empty / falsy → empty string (the <img> onError fallback handles the blank)", () => {
    expect(setImageUrl("")).toBe("");
    expect(setImageUrl(null)).toBe("");
    expect(setImageUrl(undefined)).toBe("");
  });
});

describe("setImageFallbackUrl — series/base image (variant forced to -1)", () => {
  it("a CMF figure degrades to its base -1 image (71045-3 → 71045-1)", () => {
    expect(setImageFallbackUrl("71045-3")).toBe(IMG("71045-1"));
    expect(setImageFallbackUrl("71047-10")).toBe(IMG("71047-1"));
  });
  it("a normal set's fallback is its own -1 image", () => {
    expect(setImageFallbackUrl("10497-1")).toBe(IMG("10497-1"));
    expect(setImageFallbackUrl("10497")).toBe(IMG("10497-1"));
  });
  it("falsy → empty string", () => {
    expect(setImageFallbackUrl("")).toBe("");
    expect(setImageFallbackUrl(null)).toBe("");
  });
});

describe("handleSetImageError — swap-once fallback then hide (never blank, never loops)", () => {
  // Minimal <img>-like mock (node env, no DOM): dataset/style objects + a src property.
  const mockImg = (src) => ({ dataset: {}, style: {}, src });

  it("first error swaps to the series/base image; second error hides (opacity)", () => {
    const img = mockImg(IMG("71045-3")); // the per-figure image 404'd
    handleSetImageError({ currentTarget: img }, "71045-3");
    expect(img.src).toBe(IMG("71045-1"));   // swapped to the series/base figure
    expect(img.dataset.imgFallback).toBe("1");
    expect(img.style.opacity).toBeUndefined(); // not hidden yet
    handleSetImageError({ currentTarget: img }, "71045-3"); // fallback also 404s
    expect(img.style.opacity).toBe("0");    // now hidden
  });

  it("hide=\"display\" hides via display:none (detail hero)", () => {
    const img = mockImg(IMG("71045-1")); // src already == fallback → no swap, hide straight away
    handleSetImageError({ currentTarget: img }, "71045-1", "display");
    expect(img.style.display).toBe("none");
  });
});
