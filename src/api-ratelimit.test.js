// @vitest-environment node
//
// L2 (Jun-17 audit) — REGRESSION LOCK for the per-bucket rate-limit FAILURE policy.
//
// The limiter (api/_ratelimit.js) fails OPEN when it can't consult KV (Upstash unconfigured, a
// network error, or a non-OK response): every endpoint already requires a verified Clerk user, so
// abuse is bounded to accountable accounts and a Redis hiccup must not brick a working feature.
// The ONE exception is the "scrape" bucket, which fronts the *metered* ScraperAPI endpoint
// (api/brickfanatics-retiring.js): there the limiter fails CLOSED, so a KV outage can never let an
// unthrottled caller burn paid budget. This test pins BOTH halves — scrape denies when KV is
// unavailable; every other bucket still allows — and that the normal (KV-reachable) path is intact.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { rateLimitAllow } from "../api/_ratelimit.js";

const ENV_KEYS = ["KV_REST_API_URL", "KV_REST_API_TOKEN"];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // Configure KV so kv() is truthy → we exercise the fetch path (and its catch), not the
  // unconfigured short-circuit. The one test that wants the unconfigured path deletes these.
  process.env.KV_REST_API_URL = "https://dummy.invalid";
  process.env.KV_REST_API_TOKEN = "dummy-token";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

const scrape = { limit: 60, windowSeconds: 60, bucket: "scrape" };
const proxy = { limit: 1000, windowSeconds: 60, bucket: "proxy" };

describe("rateLimitAllow — per-bucket failure policy (L2)", () => {
  it("scrape bucket fails CLOSED on a KV/Redis error (deny → no ScraperAPI spend)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("simulated KV outage"));
    expect(await rateLimitAllow("user_1", scrape)).toBe(false);
  });

  it("non-scrape (proxy) bucket still fails OPEN on a KV/Redis error (availability preserved)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("simulated KV outage"));
    expect(await rateLimitAllow("user_1", proxy)).toBe(true);
  });

  it("scrape bucket fails CLOSED on a non-OK KV response too", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    expect(await rateLimitAllow("user_1", scrape)).toBe(false);
  });

  it("scrape fails CLOSED when KV is unconfigured; proxy still allows (no round-trip)", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await rateLimitAllow("user_1", scrape)).toBe(false);
    expect(await rateLimitAllow("user_1", proxy)).toBe(true);
    expect(spy).not.toHaveBeenCalled(); // unconfigured → bucket policy decides, no KV call
  });

  it("happy path intact: scrape allows within-limit, denies over-limit when KV responds", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 5 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 61 }) });
    expect(await rateLimitAllow("user_1", scrape)).toBe(true);  // 5 <= 60
    expect(await rateLimitAllow("user_1", scrape)).toBe(false); // 61 > 60
  });
});
