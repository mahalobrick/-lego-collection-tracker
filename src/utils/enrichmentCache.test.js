import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createEntryCache, MS_TS, ISO_TS } from "./enrichmentCache";

// ─────────────────────────────────────────────────────────────────────────────
// P3.1 — ISOLATED unit tests for the inert generalized cache factory.
//
// These exercise the GENERIC factory only (synthetic keys/values) — they must NOT touch or
// route through any real cache. They prove the factory absorbs the 6 catalogued divergences and
// matches valueCache's memo/store coherence, so the P3.2–P3.5 migrations can lean on it.
// ─────────────────────────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

// A minimal Response stub for readThrough's funnel (matches what readSource consumes).
const okRes = (body) => ({ ok: true, status: 200, json: async () => body });
const failRes = (status, env) => ({ ok: false, status, json: async () => env });

describe("createEntryCache — config validation", () => {
  it("throws without a key or a positive ttl", () => {
    expect(() => createEntryCache({ ttlMs: 1 })).toThrow(/key/);
    expect(() => createEntryCache({ key: "k" })).toThrow(/ttl/);
    expect(() => createEntryCache({ key: "k", ttlMs: 0 })).toThrow(/ttl/);
  });
});

describe("timestamp formats — ms-epoch vs ISO both parse for freshness", () => {
  it("MS_TS: numeric `fetchedAt`, fresh under TTL, stale past it", () => {
    const c = createEntryCache({ key: "msCache", ttlMs: DAY, valueField: "record", ts: MS_TS });
    localStorage.setItem("msCache", JSON.stringify({ "a": { record: 1, fetchedAt: Date.now() - HOUR } }));
    expect(c.peek(["a"])).toEqual({ a: 1 });
    localStorage.setItem("msCache", JSON.stringify({ "a": { record: 1, fetchedAt: Date.now() - (DAY + HOUR) } }));
    expect(c.peek(["a"])).toEqual({});
    // an ISO string in an MS cache is the wrong type → NaN → not fresh (mirrors valueCache's typeof guard)
    localStorage.setItem("msCache", JSON.stringify({ "a": { record: 1, fetchedAt: new Date().toISOString() } }));
    expect(c.peek(["a"])).toEqual({});
  });

  it("ISO_TS: string `fetchedAt`, fresh under TTL, stale past it", () => {
    const c = createEntryCache({ key: "isoCache", ttlMs: 7 * DAY, ts: ISO_TS });
    const iso = (ms) => new Date(ms).toISOString();
    localStorage.setItem("isoCache", JSON.stringify({ "a": { data: { x: 1 }, fetchedAt: iso(Date.now() - DAY) } }));
    expect(c.peek(["a"])).toEqual({ a: { x: 1 } });
    localStorage.setItem("isoCache", JSON.stringify({ "a": { data: { x: 1 }, fetchedAt: iso(Date.now() - 8 * DAY) } }));
    expect(c.peek(["a"])).toEqual({});
  });
});

describe("tsField split — `cachedAt` instead of `fetchedAt`", () => {
  it("reads + writes the configured timestamp field", () => {
    const c = createEntryCache({ key: "pg", ttlMs: 6 * HOUR, tsField: "cachedAt", ts: MS_TS });
    c.put("x", { avg: 5 });
    const raw = JSON.parse(localStorage.getItem("pg"));
    expect(raw.x).toHaveProperty("cachedAt");
    expect(raw.x).not.toHaveProperty("fetchedAt");
    expect(typeof raw.x.cachedAt).toBe("number");
    expect(c.peek(["x"])).toEqual({ x: { avg: 5 } });
  });
});

describe("keyFn namespacing — prefix, de-variant, trim-only", () => {
  it("brickset_<n> prefix: stored + returned under the prefixed storage key", () => {
    const c = createEntryCache({ key: "bs", ttlMs: 7 * DAY, keyFn: (n) => `brickset_${n}` });
    c.put("10300-1", { minifigs: 2 });
    expect(Object.keys(JSON.parse(localStorage.getItem("bs")))).toEqual(["brickset_10300-1"]);
    expect(c.peek(["10300-1"])).toEqual({ "brickset_10300-1": { minifigs: 2 } });
    expect(c.keyOf("10300-1")).toBe("brickset_10300-1");
  });

  it("-1 de-variant: `10300-1` and `10300` collapse to one entry", () => {
    const c = createEntryCache({ key: "be", ttlMs: DAY, keyFn: (n) => String(n).replace(/-1$/, "") });
    c.put("10300-1", { v: 1 });
    expect(Object.keys(JSON.parse(localStorage.getItem("be")))).toEqual(["10300"]);
    c.put("10300", { v: 2 });                       // same storage key → overwrite
    expect(Object.keys(JSON.parse(localStorage.getItem("be")))).toEqual(["10300"]);
    expect(c.peek(["10300-1"])).toEqual({ "10300": { v: 2 } });
  });

  it("trim-only (valueCache default): no de-variant, raw number preserved; empty ids dropped", () => {
    const c = createEntryCache({ key: "val", ttlMs: DAY, valueField: "record", ts: MS_TS });
    c.put(" 10300-1 ", { amount: 9 });
    expect(Object.keys(JSON.parse(localStorage.getItem("val")))).toEqual(["10300-1"]); // trimmed, NOT de-varianted
    expect(c.staleKeys(["", "  ", "10300-1"])).toEqual([]);                            // empties filtered; one is fresh
  });
});

describe("requireValue — value-presence freshness guard (bricketSetCache's `&& data`)", () => {
  it("an entry with a fresh ts but a falsy value is NOT fresh when requireValue is set", () => {
    const c = createEntryCache({ key: "rv", ttlMs: 7 * DAY, ts: ISO_TS, requireValue: true });
    const now = new Date().toISOString();
    // fresh ts, real data → fresh
    localStorage.setItem("rv", JSON.stringify({ a: { data: { minifigs: 2 }, fetchedAt: now } }));
    expect(c.peek(["a"])).toEqual({ a: { minifigs: 2 } });
    // fresh ts but data null/absent → treated as NOT fresh (re-fetch), matching brickset's guard
    localStorage.setItem("rv", JSON.stringify({ a: { data: null, fetchedAt: now } }));
    expect(c.peek(["a"])).toEqual({});
    expect(c.staleKeys(["a"])).toEqual(["a"]);
    localStorage.setItem("rv", JSON.stringify({ a: { fetchedAt: now } })); // no data field at all
    expect(c.peek(["a"])).toEqual({});
  });

  it("default (requireValue false) keeps valueCache semantics — a cached null is still fresh", () => {
    const c = createEntryCache({ key: "rv2", ttlMs: DAY, valueField: "record", ts: MS_TS });
    localStorage.setItem("rv2", JSON.stringify({ a: { record: null, fetchedAt: Date.now() } }));
    expect(c.peek(["a"])).toEqual({ a: null }); // present + fresh, value is a legit cached null
  });
});

describe("per-call TTL override — the dual-TTL (6h single / 12h bulk) shape", () => {
  it("the SAME 7h-old entry is stale at 6h but fresh at 12h", () => {
    const c = createEntryCache({ key: "dual", ttlMs: 6 * HOUR, tsField: "cachedAt", ts: MS_TS });
    localStorage.setItem("dual", JSON.stringify({ "75192": { data: { avg: 1 }, cachedAt: Date.now() - 7 * HOUR } }));
    expect(c.peek(["75192"])).toEqual({});                                  // default 6h → stale
    expect(c.staleKeys(["75192"])).toEqual(["75192"]);                      // default 6h → needs refresh
    expect(c.peek(["75192"], { ttlMs: 12 * HOUR })).toEqual({ "75192": { avg: 1 } }); // 12h → fresh
    expect(c.staleKeys(["75192"], { ttlMs: 12 * HOUR })).toEqual([]);       // 12h → skip
  });
});

describe("validation — a malformed value coerces, never poisons", () => {
  it("validate runs on put and on readThrough writes", async () => {
    const validate = (r) => (r && typeof r === "object" ? r : null); // accept objects, else null
    const c = createEntryCache({ key: "v", ttlMs: DAY, valueField: "record", ts: MS_TS, validate });
    c.put("ok", { a: 1 });
    c.put("bad", 42); // not an object → coerced to null
    expect(c.peek(["ok", "bad"])).toEqual({ ok: { a: 1 }, bad: null }); // cached null is still a fresh entry

    const c2 = createEntryCache({ key: "v2", ttlMs: DAY, valueField: "record", ts: MS_TS, validate });
    await c2.readThrough(["x", "y"], { fetch: async () => okRes({ x: { a: 2 }, y: "junk" }), source: "test" });
    const raw = JSON.parse(localStorage.getItem("v2"));
    expect(raw.x.record).toEqual({ a: 2 });
    expect(raw.y.record).toBeNull();
  });
});

describe("readThrough — the valueCache batch funnel, generalized", () => {
  it("seeds fresh from cache, fetches only the stale keys, writes back, returns the merged map", async () => {
    const c = createEntryCache({ key: "rt", ttlMs: DAY, valueField: "record", ts: MS_TS });
    localStorage.setItem("rt", JSON.stringify({ "fresh": { record: { a: 1 }, fetchedAt: Date.now() } }));
    const fetch = vi.fn(async (need) => okRes(Object.fromEntries(need.map((k) => [k, { got: k }]))));
    const out = await c.readThrough(["fresh", "stale1", "stale2"], { fetch, source: "test" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0].sort()).toEqual(["stale1", "stale2"]); // ONLY the stale keys fetched
    expect(out).toEqual({ fresh: { a: 1 }, stale1: { got: "stale1" }, stale2: { got: "stale2" } });
  });

  it("force re-fetches everything; all-fresh short-circuits with no fetch", async () => {
    const c = createEntryCache({ key: "rt2", ttlMs: DAY, valueField: "record", ts: MS_TS });
    localStorage.setItem("rt2", JSON.stringify({ "a": { record: 1, fetchedAt: Date.now() } }));
    const fetch = vi.fn(async (need) => okRes(Object.fromEntries(need.map((k) => [k, 9]))));
    expect(await c.readThrough(["a"], { fetch, source: "t" })).toEqual({ a: 1 });
    expect(fetch).not.toHaveBeenCalled();                                   // fresh → no I/O
    await c.readThrough(["a"], { fetch, source: "t", force: true });
    expect(fetch).toHaveBeenCalledTimes(1);                                 // force → fetched
  });

  it("a funnel failure serves cached data and reports (never throws)", async () => {
    const c = createEntryCache({ key: "rt3", ttlMs: DAY, valueField: "record", ts: MS_TS });
    localStorage.setItem("rt3", JSON.stringify({ "a": { record: 1, fetchedAt: Date.now() - 2 * DAY } })); // stale
    // a "broke" envelope → readSource returns ok:false → readThrough serves whatever is cached (here: nothing fresh)
    const fetch = async () => failRes(503, { error: { kind: "upstream_error", source: "t", message: "down" } });
    const out = await c.readThrough(["a"], { fetch, source: "t" });
    expect(out).toEqual({});            // stale entry not returned, fetch failed → empty, no throw
    // a pre-response throw is also swallowed
    const out2 = await c.readThrough(["b"], { fetch: async () => { throw new Error("offline"); }, source: "t" });
    expect(out2).toEqual({});
  });
});

describe("memo / store coherence — matched to valueCache exactly", () => {
  it("the memo shadows the store after a put (survives a store rewrite of the same key)", () => {
    const c = createEntryCache({ key: "m", ttlMs: DAY, valueField: "record", ts: MS_TS });
    c.put("a", { v: "memo" });
    // overwrite the localStorage mirror behind the cache's back; memo must still win
    localStorage.setItem("m", JSON.stringify({ "a": { record: { v: "store" }, fetchedAt: Date.now() } }));
    expect(c.peek(["a"])).toEqual({ a: { v: "memo" } });
  });

  it("clear() wipes BOTH memo and the mirror", () => {
    const c = createEntryCache({ key: "m2", ttlMs: DAY, valueField: "record", ts: MS_TS });
    c.put("a", { v: 1 });
    c.clear();
    expect(localStorage.getItem("m2")).toBe("{}");
    expect(c.peek(["a"])).toEqual({});
  });

  it("a fresh peek does NOT hit localStorage-parse errors fatally (malformed store → {})", () => {
    const c = createEntryCache({ key: "m3", ttlMs: DAY, ts: ISO_TS });
    localStorage.setItem("m3", "not json");
    expect(c.peek(["a"])).toEqual({}); // tolerated, like valueCache's loadStore try/catch
  });

  it("writes go through setItemSafe (DATA-4) — a real datachange fires for a bl* non-skip key", () => {
    const calls = [];
    const fn = () => calls.push(1);
    window.addEventListener("brickledger:datachange", fn);
    const c = createEntryCache({ key: "blFactoryProbe", ttlMs: DAY, valueField: "record", ts: MS_TS });
    c.put("a", { v: 1 }); // "blFactoryProbe" is bl*, not in SYNC_SKIP_KEYS → fires (proves setItemSafe is the write path)
    window.removeEventListener("brickledger:datachange", fn);
    expect(calls.length).toBe(1);
  });
});
