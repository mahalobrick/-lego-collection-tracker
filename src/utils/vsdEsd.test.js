import { describe, it, expect } from "vitest";
import { vsdEsdNote, estimatedValueNote, VSD_ESD_TOOLTIP } from "./valueDisplay";

// ─────────────────────────────────────────────────────────────────────────────
// VSD / ESD relabel of the Collection Value estimate disclosure. DISPLAY ONLY —
// ESD is the SAME estimatedValueShare fraction the old "X% of value estimated"
// note showed (rounded identically); VSD is its complement. estimatedValueShare
// is NOT recomputed or touched (frozen-promo handling unchanged).
// ─────────────────────────────────────────────────────────────────────────────

describe("vsdEsdNote()", () => {
  it("renders the VSD · ESD split that sums to 100", () => {
    expect(vsdEsdNote(0.25)).toBe("75% VSD · 25% ESD");
    expect(vsdEsdNote(0.10)).toBe("90% VSD · 10% ESD");
    expect(vsdEsdNote(0.5)).toBe("50% VSD · 50% ESD");
  });

  it("keeps sub-1% precision — the ~0.2% frozen-promo case stays disclosed, not zeroed", () => {
    expect(vsdEsdNote(0.002)).toBe("99.8% VSD · 0.2% ESD");
  });

  it("returns null at share ≤ 0 (same gate as estimatedValueNote — no map / no estimates)", () => {
    expect(vsdEsdNote(0)).toBeNull();
    expect(vsdEsdNote(undefined)).toBeNull();
    expect(vsdEsdNote(-0.1)).toBeNull();
  });

  it("ESD is byte-parity with estimatedValueNote's number, and VSD = 100 − ESD (no recomputation)", () => {
    for (const share of [0.002, 0.014, 0.1, 0.255, 0.5]) {
      const esdOld = Number(estimatedValueNote(share).match(/^([\d.]+)%/)[1]); // the old "X% of value estimated"
      const [, vsd, esd] = vsdEsdNote(share).match(/^([\d.]+)% VSD · ([\d.]+)% ESD$/);
      expect(Number(esd)).toBeCloseTo(esdOld, 5);          // identical ESD figure — pure relabel
      expect(Number(vsd) + Number(esd)).toBeCloseTo(100, 5); // the pair sums to 100
    }
  });

  it("VSD_ESD_TOOLTIP defines both terms", () => {
    expect(VSD_ESD_TOOLTIP).toContain("Verified Sales Data");
    expect(VSD_ESD_TOOLTIP).toContain("Estimated Sales Data");
  });
});
