import { afterEach, describe, it, expect, vi } from "vitest";

// Mock the toast lib so reportSourceFailure is observable without rendering anything.
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
import toast from "react-hot-toast";

import { readSource, classifyFailure, reportSourceFailure } from "./readSource";

afterEach(() => vi.clearAllMocks());

// Minimal Response stand-in.
function mockRes({ ok = true, status = 200, body, throwJson = false } = {}) {
  return {
    ok,
    status,
    json: async () => {
      if (throwJson) throw new SyntaxError("not json");
      return body;
    },
  };
}

describe("readSource — parse a proxy Response into a discriminated result", () => {
  it("success → { ok:true, data }", async () => {
    const out = await readSource(mockRes({ ok: true, body: { foo: 1 } }), "brickset");
    expect(out).toEqual({ ok: true, data: { foo: 1 } });
  });

  it("success with non-JSON body → { ok:true, data:null } (does not throw)", async () => {
    const out = await readSource(mockRes({ ok: true, throwJson: true }), "brickset");
    expect(out).toEqual({ ok: true, data: null });
  });

  it("envelope failure → { ok:false, kind, source, message, status }", async () => {
    const res = mockRes({
      ok: false, status: 504,
      body: { ok: false, error: { kind: "timeout", source: "bricklink", message: "BrickLink timed out.", status: 504 } },
    });
    const out = await readSource(res, "bricklink");
    expect(out).toEqual({ ok: false, kind: "timeout", source: "bricklink", message: "BrickLink timed out.", status: 504 });
  });

  it("envelope without `source` falls back to the passed source arg", async () => {
    const res = mockRes({ ok: false, status: 502, body: { ok: false, error: { kind: "bad_gateway", message: "x" } } });
    const out = await readSource(res, "lego");
    expect(out.source).toBe("lego");
    expect(out.kind).toBe("bad_gateway");
  });

  it("legacy non-envelope failure body → synthesized upstream_error (message from body.error/message)", async () => {
    const res = mockRes({ ok: false, status: 503, body: { error: "no_key", message: "Brickset API key not configured." } });
    const out = await readSource(res, "brickset");
    expect(out).toEqual({ ok: false, kind: "upstream_error", source: "brickset", message: "Brickset API key not configured.", status: 503 });
  });

  it("non-JSON failure body → synthesized upstream_error with empty message", async () => {
    const res = mockRes({ ok: false, status: 500, throwJson: true });
    const out = await readSource(res, "brickeconomy");
    expect(out).toEqual({ ok: false, kind: "upstream_error", source: "brickeconomy", message: "", status: 500 });
  });
});

describe("classifyFailure — broke vs absent treatment", () => {
  it("timeout → surface, with a try-again message", () => {
    const c = classifyFailure("timeout", "bricklink");
    expect(c.surface).toBe(true);
    expect(c.message).toBe("BrickLink timed out — try again.");
  });

  it("rate_limited → surface, with a retry-shortly message", () => {
    const c = classifyFailure("rate_limited", "brickset");
    expect(c.surface).toBe(true);
    expect(c.message).toMatch(/rate limited/i);
  });

  it.each(["upstream_error", "bad_gateway"])("%s → surface 'Couldn't reach <source>'", (kind) => {
    const c = classifyFailure(kind, "brickeconomy");
    expect(c.surface).toBe(true);
    expect(c.message).toBe("Couldn't reach BrickEconomy.");
  });

  it.each(["not_found", "not_configured"])("%s → QUIET (no surface, empty message)", (kind) => {
    const c = classifyFailure(kind, "brickset");
    expect(c.surface).toBe(false);
    expect(c.message).toBe("");
  });

  it("unknown kind → quiet by default", () => {
    expect(classifyFailure("weird", "brickset").surface).toBe(false);
  });

  it("maps every source enum token to a display name", () => {
    expect(classifyFailure("timeout", "lego").message).toMatch(/^LEGO\.com/);
    expect(classifyFailure("timeout", "brickfanatics").message).toMatch(/^Brick Fanatics/);
    expect(classifyFailure("timeout", "unknownsrc").message).toMatch(/^the source/);
  });
});

describe("reportSourceFailure — fires one deduped toast for broke kinds only", () => {
  it("fires toast.error for a surface kind, deduped by source id", () => {
    reportSourceFailure({ ok: false, kind: "upstream_error", source: "bricklink", message: "" });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Couldn't reach BrickLink.", { id: "source:bricklink" });
  });

  it("does NOT fire for not_found (the quiet uncatalogued case)", () => {
    reportSourceFailure({ ok: false, kind: "not_found", source: "brickset", message: "" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does NOT fire for not_configured (quiet admin state)", () => {
    reportSourceFailure({ ok: false, kind: "not_configured", source: "brickset", message: "" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("no-op on a success result or null", () => {
    reportSourceFailure({ ok: true, data: {} });
    reportSourceFailure(null);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
