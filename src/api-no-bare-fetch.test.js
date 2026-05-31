// @vitest-environment node
//
// P3 S5 — BY-CONSTRUCTION LOCK (sibling to api-auth.test.js): no /api handler may call the global
// fetch() directly. Every upstream fetch must go through fetchWithTimeout (api/_fetch.js), which
// applies a timeout and maps abort/network throws to a typed FetchFailure. A new proxy that forgets
// and calls bare fetch( fails CI here — so it cannot silently skip the timeout.
//
// Handlers are DISCOVERED at runtime (non-_ api/*.js), exactly like api-auth.test.js. The _-prefixed
// helpers are excluded by convention: _fetch.js owns the ONE sanctioned fetch( call; _ratelimit.js is
// the deliberately fail-open limiter (docs/security.md), outside this lock's scope.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const apiDir = path.resolve(__dirname, "../api");

const handlerFiles = readdirSync(apiDir)
  .filter((f) => f.endsWith(".js") && !f.startsWith("_"))
  .sort();

// Strip comments first (so a comment mentioning fetch() can't trip the lock), then count bare fetch(
// calls. `fetchWithTimeout(` never matches: after "fetch" comes "W", not "(" — so /fetch\s*\(/ only
// matches a direct global fetch( call.
function bareFetchCount(src) {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return (code.match(/fetch\s*\(/g) || []).length;
}

describe("P3 S5 — no /api handler calls bare fetch() (timeout lock)", () => {
  it("discovered the handler set (guards against a vacuously-empty enumeration)", () => {
    // 8 proxies + sync.js.
    expect(handlerFiles.length).toBeGreaterThanOrEqual(9);
  });

  it.each(handlerFiles)("%s uses fetchWithTimeout, never bare fetch()", (file) => {
    const src = readFileSync(path.join(apiDir, file), "utf8");
    expect(bareFetchCount(src), `${file} contains a bare fetch( — route it through fetchWithTimeout`).toBe(0);
  });

  it("the sanctioned bare fetch( lives in _fetch.js (so the lock isn't vacuous)", () => {
    const src = readFileSync(path.join(apiDir, "_fetch.js"), "utf8");
    expect(bareFetchCount(src)).toBeGreaterThanOrEqual(1);
  });
});
