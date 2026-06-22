import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// Trend swap, Phase 2 — the OWNED SetDetailPanel value-history LineChart, fed by
// the Phase-1 BL read path (fetchHistory → blHistoryCache → /api/history), mapped
// by historyFromBL. ADDITIVE + fully BL. The WANTED WatchDetailPanel BE chart is
// untouched (separate component). historyCache is mocked (the network boundary);
// historyFromBL runs for real (it's the pure adapter under test as the consumer).
// ─────────────────────────────────────────────────────────────────────────────

const { fetchHistoryMock, peekMock } = vi.hoisted(() => ({
  fetchHistoryMock: vi.fn(),
  peekMock: vi.fn(() => ({})),
}));
vi.mock("./utils/historyCache", () => ({
  fetchHistory: fetchHistoryMock,
  peekHistoryCache: peekMock,
  clearHistoryCache: () => {},
}));

import SetDetailPanel from "./SetDetailPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  localStorage.clear();
  fetchHistoryMock.mockReset().mockResolvedValue({});
  peekMock.mockReset().mockReturnValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// 2+ points, newest-first (as /api/history returns it).
const SERIES = [
  { asOf: "2026-06-07T03:00:01.779Z", new: 119.56, used: 89.67 },
  { asOf: "2026-06-02T00:57:57.212Z", new: 120.84, used: 90.63 },
];
const ONE_POINT = [SERIES[0]];

const ITEM = {
  setNumber: "10300-1", name: "Eiffel Tower", theme: "Icons",
  condition: "new", qty: 3, paidPrice: 120, currentValue: 300,
};

async function renderPanel(item = ITEM) {
  await act(async () => { root.render(<SetDetailPanel item={item} onClose={() => {}} />); });
  await act(async () => { await Promise.resolve(); }); // flush the fetchHistory().then setState
}
const hasText = (t) => container.textContent.includes(t);

describe("SetDetailPanel — value-history chart (Phase 2, owned-set, BL)", () => {
  it("renders the Value History chart when historyFromBL yields ≥2 points", async () => {
    fetchHistoryMock.mockResolvedValue({ "10300-1": SERIES });
    await renderPanel();
    expect(hasText("Value History")).toBe(true);
    expect(hasText("Value (BrickLink sold)")).toBe(true); // the BL legend, not a BE label
  });

  it("hides the chart when the set has no history ([])", async () => {
    fetchHistoryMock.mockResolvedValue({ "10300-1": [] });
    await renderPanel();
    expect(hasText("Value History")).toBe(false);
  });

  it("hides the chart when there is only 1 point (<2)", async () => {
    fetchHistoryMock.mockResolvedValue({ "10300-1": ONE_POINT });
    await renderPanel();
    expect(hasText("Value History")).toBe(false);
  });

  it("fetches history exactly once, for this set, on open (cache gates refetch within TTL)", async () => {
    fetchHistoryMock.mockResolvedValue({ "10300-1": SERIES });
    await renderPanel();
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);
    expect(fetchHistoryMock).toHaveBeenCalledWith(["10300-1"]);
  });

  it("paints from the warm peek immediately (and still fires one background refresh)", async () => {
    peekMock.mockReturnValue({ "10300-1": SERIES }); // device cache warm
    fetchHistoryMock.mockResolvedValue({ "10300-1": SERIES });
    await renderPanel();
    expect(hasText("Value History")).toBe(true);
    expect(peekMock).toHaveBeenCalledWith(["10300-1"]);
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("is ADDITIVE — the rest of the panel renders regardless of history", async () => {
    fetchHistoryMock.mockResolvedValue({ "10300-1": [] }); // no chart
    await renderPanel();
    expect(hasText("Value History")).toBe(false);
    // core panel content is intact (the Paid StatBox, the title)
    expect(hasText("Paid")).toBe(true);
    expect(hasText("Eiffel Tower")).toBe(true);
  });
});
