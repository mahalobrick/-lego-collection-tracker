// @vitest-environment node
//
// P3 S4 — unit lock for the shared upstream-fetch + typed-error infra (api/_fetch.js).
// Node env (not jsdom): the wrapper is pure server code and needs Node's AbortSignal.timeout.

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  fetchWithTimeout,
  FetchFailure,
  sendSourceError,
  KIND_STATUS,
} from "../api/_fetch.js";

afterEach(() => vi.restoreAllMocks());

function mockRes() {
  return {
    statusCode: null,
    body: undefined,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
  };
}

describe("fetchWithTimeout — universal timeout + typed failure", () => {
  it("returns the Response on success, passes opts through, injects a signal", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 });
    const r = await fetchWithTimeout("https://x.test", { headers: { a: "b" } }, { timeoutMs: 1000 });
    expect(r.ok).toBe(true);
    const [, opts] = spy.mock.calls[0];
    expect(opts.headers).toEqual({ a: "b" });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps a REAL AbortSignal.timeout firing to FetchFailure kind 'timeout'", async () => {
    // fetch honors the injected signal and rejects with the signal's reason (a TimeoutError).
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      })
    );
    const err = await fetchWithTimeout("https://x.test", {}, { timeoutMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(FetchFailure);
    expect(err.kind).toBe("timeout");
  });

  it("maps a TimeoutError throw to kind 'timeout'", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("t"), { name: "TimeoutError" })
    );
    await expect(fetchWithTimeout("https://x.test")).rejects.toMatchObject({
      name: "FetchFailure",
      kind: "timeout",
    });
  });

  it("maps a generic network throw to kind 'network'", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const err = await fetchWithTimeout("https://x.test").catch((e) => e);
    expect(err).toBeInstanceOf(FetchFailure);
    expect(err.kind).toBe("network");
  });
});

describe("sendSourceError — B2 envelope + fixed kind<->status mapping", () => {
  const EXPECTED = {
    bad_request: 400,
    not_found: 404,
    rate_limited: 429,
    internal: 500,
    bad_gateway: 502,
    upstream_error: 502,
    not_configured: 503,
    timeout: 504,
  };

  it("maps every kind to its fixed HTTP status (and KIND_STATUS agrees)", () => {
    for (const [kind, status] of Object.entries(EXPECTED)) {
      const res = mockRes();
      sendSourceError(res, { kind, source: "brickset", message: "x" });
      expect(res.statusCode, kind).toBe(status);
      expect(KIND_STATUS[kind], kind).toBe(status);
    }
  });

  it("returns the {ok:false, error:{kind,source,message}} shape", () => {
    const res = mockRes();
    sendSourceError(res, {
      kind: "bad_gateway",
      source: "brickeconomy",
      message: "Could not reach BrickEconomy.",
    });
    expect(res.body).toEqual({
      ok: false,
      error: { kind: "bad_gateway", source: "brickeconomy", message: "Could not reach BrickEconomy." },
    });
  });

  it("includes upstream status + sets Retry-After for rate_limited", () => {
    const res = mockRes();
    sendSourceError(res, {
      kind: "rate_limited",
      source: "brickfanatics",
      message: "slow down",
      retryAfter: 60,
      status: 429,
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("60");
    expect(res.body.error.retryAfter).toBe(60);
    expect(res.body.error.status).toBe(429);
  });

  it("secret safety — only the curated message is sent; no field can carry the upstream body", () => {
    const res = mockRes();
    sendSourceError(res, {
      kind: "upstream_error",
      source: "brickeconomy",
      message: "Upstream error.",
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("apikey");
    expect(serialized).not.toContain("<html>");
    expect(res.body.error.message).toBe("Upstream error.");
    // The envelope has no field that could smuggle a raw upstream body.
    expect(Object.keys(res.body.error).sort()).toEqual(["kind", "message", "source"]);
  });
});
