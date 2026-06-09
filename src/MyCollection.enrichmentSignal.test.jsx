import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// P4.4.3 — EMITTER: MyCollection emits `brickledger:enrichmentsettled` when an
// enrichment cycle settles, so the App force-push effect can refresh the cloud
// snapshot on coverage growth (docs/enrichment-p4.4-plan.md §1). The plan's two
// settle points: the value-overlay `.then` (blValueCache) and the Brickset
// mount-IIFE completion (bricksetSetCache). This pins that a settle DOES emit.
//
// MyCollection is a god-module; mount it with the jsdom-hostile leaves (recharts,
// detail panels) and the network data-sources mocked to deterministic no-ops, so
// the on-mount enrichment effects run to completion without real fetches.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("recharts", () => {
  const C = () => null;
  return { __esModule: true, PieChart: C, Pie: C, Cell: C, ResponsiveContainer: C, Tooltip: C,
    BarChart: C, Bar: C, XAxis: C, YAxis: C, AreaChart: C, Area: C, CartesianGrid: C };
});
vi.mock("./SetDetailPanel", () => ({ default: () => null, openSetDetail: () => {} }));
vi.mock("./WatchDetailPanel", () => ({ default: () => null }));
vi.mock("./TriValueCell", () => ({ default: () => null }));
vi.mock("./RowHoverCard", () => ({ default: () => null }));
vi.mock("./ConditionPill", () => ({ default: () => null }));
// Data-source leaves: resolve trivially so the enrichment effects settle deterministically.
vi.mock("./utils/valueCache", async (io) => ({ ...(await io()), fetchValues: vi.fn(async () => ({})), peekValueCache: vi.fn(() => ({})) }));
vi.mock("./utils/brickset", async (io) => ({ ...(await io()), fetchBricksetSet: vi.fn(async () => null), fetchLegoThemes: vi.fn(async () => []), searchBricksetCatalog: vi.fn(async () => []) }));
vi.mock("./utils/rebrickable", () => ({ loadRebrickable: vi.fn(), rbLookupSet: vi.fn(), rbReady: () => false }));
vi.mock("./utils/bricklink-client", () => ({ fetchBrickLinkPriceGuide: vi.fn(), hasBrickLinkAuth: () => false }));

import MyCollection from "./MyCollection";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe("P4.4.3 EMITTER — MyCollection emits brickledger:enrichmentsettled on settle", () => {
  it("an owned set's enrichment cycle settles → at least one brickledger:enrichmentsettled fires", async () => {
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497-1", qty: 1, condition: "new" }]));
    let fired = 0;
    const onSettled = () => { fired++; };
    window.addEventListener("brickledger:enrichmentsettled", onSettled);

    await act(async () => { root.render(<MyCollection onBuyNow={() => {}} onSwitchTab={() => {}} />); });
    // Let the on-mount enrichment effects (value .then + Brickset IIFE) settle on the microtask queue.
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

    window.removeEventListener("brickledger:enrichmentsettled", onSettled);
    expect(fired).toBeGreaterThan(0); // a completed settle emits the event the App force-push listens for
  });

  it("the emitted event is a plain CustomEvent of type 'brickledger:enrichmentsettled' (no payload contract)", async () => {
    // Pins the event NAME the App effect listens for. Per plan §1 the emitter fires on every settle
    // (the strict-greater gate, not the cadence, is the anti-storm guard) — so the event carries no
    // payload; the gate reads coverage from the caches, not from the event.
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497-1", qty: 1, condition: "new" }]));
    const types = [];
    const onSettled = (e) => { types.push(e.type); };
    window.addEventListener("brickledger:enrichmentsettled", onSettled);

    await act(async () => { root.render(<MyCollection onBuyNow={() => {}} onSwitchTab={() => {}} />); });
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

    window.removeEventListener("brickledger:enrichmentsettled", onSettled);
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((t) => t === "brickledger:enrichmentsettled")).toBe(true);
  });
});
