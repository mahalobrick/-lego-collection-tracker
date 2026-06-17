// @vitest-environment node
//
// L1 (Jun-17 audit) — the BrickLink third-party-app (TPA) client id is a PUBLIC client identifier
// (sent in the x-bl-tpa-client-id header and the verify-and-create-session clientId), NOT a secret.
// It's centralized in api/_bricklink.js as a single source shared by both BL endpoints
// (bricklink-auth, bricklink-priceguide), and overridable via the BL_TPA_CLIENT_ID env var for
// rotation hygiene — with a non-breaking fallback to the current value so the endpoints work with
// no env var set. This test pins the resolution precedence (env override > fallback).

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const FALLBACK = "ca629c09-4d8c-45dc-8a6f-bfb2b058f720";

async function loadModule() {
  vi.resetModules(); // re-evaluate so the import-time env read is re-resolved per test
  return import("../api/_bricklink.js");
}

beforeEach(() => { delete process.env.BL_TPA_CLIENT_ID; });
afterEach(() => { delete process.env.BL_TPA_CLIENT_ID; vi.resetModules(); });

describe("BrickLink TPA client id (L1)", () => {
  it("falls back to the current public client id when BL_TPA_CLIENT_ID is unset", async () => {
    delete process.env.BL_TPA_CLIENT_ID;
    const { BL_TPA_CLIENT_ID } = await loadModule();
    expect(BL_TPA_CLIENT_ID).toBe(FALLBACK);
  });

  it("resolves to the BL_TPA_CLIENT_ID env override when set", async () => {
    process.env.BL_TPA_CLIENT_ID = "tpa-override-123";
    const { BL_TPA_CLIENT_ID } = await loadModule();
    expect(BL_TPA_CLIENT_ID).toBe("tpa-override-123");
  });
});
