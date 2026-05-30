import { afterEach, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

// SEC-GAP-2 — REGRESSION LOCK: every /api handler must authenticate BEFORE it spends a
// server-held secret. The boundary itself (requireAuth/authenticate in every handler) was
// landed by APISEC-1; this test makes a regression unmergeable.
//
// The handler list is DISCOVERED at runtime by reading the api/ directory — not hardcoded —
// so a newly-added proxy handler that forgets the auth line is caught automatically. Every
// non-helper api/*.js (helpers are the _-prefixed _auth/_cors/_ratelimit) is invoked with NO
// Authorization header; we assert it answers 401 and never reaches the secret-bearing upstream
// fetch.

const apiDir = path.resolve(__dirname, "../api");

const handlerFiles = readdirSync(apiDir)
  .filter((f) => f.endsWith(".js") && !f.startsWith("_"))
  .sort();

async function loadHandler(file) {
  // api/*.js are CommonJS (module.exports = handler); vitest exposes that as `.default`.
  const mod = await import(pathToFileURL(path.join(apiDir, file)).href);
  return mod.default;
}

// No Authorization header → authenticate() returns null before any Clerk/network call → 401.
function mockReq(overrides = {}) {
  return { method: "GET", headers: {}, query: {}, body: undefined, ...overrides };
}

function mockRes() {
  return {
    statusCode: null,
    body: undefined,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
    end(d) { this.ended = true; if (d !== undefined) this.body = d; return this; },
  };
}

let fetchSpy;
beforeEach(() => {
  // The secret-spending upstream call (every proxy) and the Redis call (sync) both go through
  // global fetch. It must NOT be reached on an unauthenticated request.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false, status: 500, text: async () => "", json: async () => ({}),
  });
});
afterEach(() => vi.restoreAllMocks());

// sync.js checks getKv() BEFORE auth and 503s when KV env is absent; give it dummy env so it
// reaches the same 401 as the proxies. The secret-free 503 path is asserted on its own below.
beforeAll(() => {
  process.env.KV_REST_API_URL = "https://dummy.invalid";
  process.env.KV_REST_API_TOKEN = "dummy";
});

describe("SEC-GAP-2 — every /api handler rejects unauthenticated requests", () => {
  it("discovered the handler set (guards against a vacuously-empty enumeration)", () => {
    // 9 proxies + sync.js. If this ever drops, the it.each below would silently assert nothing.
    expect(handlerFiles.length).toBeGreaterThanOrEqual(10);
  });

  it.each(handlerFiles)("%s → 401 and spends no secret when unauthenticated", async (file) => {
    const handler = await loadHandler(file);
    expect(typeof handler).toBe("function");
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.statusCode).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("SEC-GAP-2 — sync.js pre-auth availability check is non-sensitive", () => {
  it("503s (fails closed) and spends no secret when KV is unconfigured", async () => {
    const prev = {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    };
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    try {
      const handler = await loadHandler("sync.js");
      const res = mockRes();
      await handler(mockReq(), res);
      // not_configured — the only thing reachable before auth is "is KV wired?", which leaks
      // nothing sensitive and enters no data/secret path (no upstream fetch, no Redis call).
      expect(res.statusCode).toBe(503);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      process.env.KV_REST_API_URL = prev.url;
      process.env.KV_REST_API_TOKEN = prev.token;
    }
  });
});
