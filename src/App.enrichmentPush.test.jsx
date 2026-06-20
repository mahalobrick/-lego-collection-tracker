import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// ─────────────────────────────────────────────────────────────────────────────
// P4.4.3 — APP EFFECT: a brickledger:enrichmentsettled event, after the ~15s
// debounce and ONLY when syncReady, triggers pushSnapshotIfGrown(getToken). This
// mirrors the existing brickledger:datachange→push effect (same debounce window,
// same syncReadyRef gating). The real coverage GATE (strict-greater → skip on
// no-growth; shared blLastSnapshotSig with the normal push) is unit-pinned in
// exportBackup.snapshotForce.test.js (Areas 2 & 5); here we pin the WIRING:
//   • fires pushSnapshotIfGrown after the debounce when syncReady
//   • does NOT fire before syncReady, nor within the debounce window
//   • repeated rapid settles COALESCE into exactly one call (storm guard at the
//     effect level; the gate guards the same-coverage case end-to-end)
//   • the effect calls pushSnapshotIfGrown (the shared-gate wrapper) — so it
//     inherits the coalesce-with-the-normal-push proven in Area 5.
// Harness mirrors App.reconcile.test.jsx.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("./BudgetDashboard", () => ({ default: () => null }));
vi.mock("./WantedList", () => ({ default: () => null }));
vi.mock("./MyCollection", () => ({ default: () => null }));
vi.mock("./AppSettings", () => ({ default: () => null }));
vi.mock("./utils/beSyncValues", () => ({ runDailyBEBatch: vi.fn(async () => {}) }));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: async () => "tok", userId: "user_1", isLoaded: true }),
  useUser: () => ({ user: null }),
  Show: () => null,
  SignInButton: () => null,
  SignUpButton: () => null,
  UserButton: () => null,
}));

// Keep the real sync utils; spy the network boundary + both push entry points so we can
// detect exactly which push the enrichment effect invokes, isolated from the normal pushes.
vi.mock("./utils/exportBackup", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchFromCloudAuth: vi.fn(),
    pushToCloudAuth: vi.fn(async () => ({})),
    pushSnapshotIfGrown: vi.fn(async () => ({ skipped: "snapshot_no_growth" })),
  };
});

import App from "./App";
import { fetchFromCloudAuth, pushSnapshotIfGrown } from "./utils/exportBackup";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

async function mountAndSettleReconcile() {
  await act(async () => { root.render(<App />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

// A same-user device whose local is current → reconcile keeps local and ENABLES auto-push
// (syncReadyRef.current = true). Mirrors the reconcile-test control path.
function seedSyncReadyDevice() {
  localStorage.setItem("blSyncedUserId", "user_1");
  localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
  localStorage.setItem("blLastPushHash", "STALE");
  localStorage.setItem("blLastCloudPush", "2026-05-30T00:00:00Z");
  fetchFromCloudAuth.mockResolvedValue({ version: 2, exportedAt: "2026-01-01T00:00:00Z", ownedSets: [] });
}

const settle = () => act(() => { window.dispatchEvent(new CustomEvent("brickledger:enrichmentsettled")); });

describe("P4.4.3 APP EFFECT — enrichmentsettled → debounced, syncReady-gated pushSnapshotIfGrown", () => {
  it("syncReady + a settle + the full debounce → pushSnapshotIfGrown is called once", async () => {
    seedSyncReadyDevice();
    await mountAndSettleReconcile();

    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });

    expect(pushSnapshotIfGrown).toHaveBeenCalledTimes(1);
  });

  it("before syncReady (a FAILED reconcile) → a settle pushes NOTHING after the debounce", async () => {
    // A2 path: a failed fetch leaves cloud UNKNOWN → syncReadyRef stays false → no force-push.
    localStorage.setItem("blSyncedUserId", "user_1");
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
    localStorage.setItem("blLastPushHash", "STALE");
    fetchFromCloudAuth.mockRejectedValue(new Error("network down"));
    await mountAndSettleReconcile();

    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });

    expect(pushSnapshotIfGrown).not.toHaveBeenCalled();
  });

  it("within the debounce window → not yet called; only after the window elapses", async () => {
    seedSyncReadyDevice();
    await mountAndSettleReconcile();

    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); }); // still inside the ~15s window
    expect(pushSnapshotIfGrown).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });  // now past 15s
    expect(pushSnapshotIfGrown).toHaveBeenCalledTimes(1);
  });

  it("STORM GUARD: many rapid settles coalesce into exactly ONE pushSnapshotIfGrown call", async () => {
    seedSyncReadyDevice();
    await mountAndSettleReconcile();

    // Five settles in quick succession (e.g. the value .then + Brickset IIFE + re-enrichment) —
    // each resets the debounce; only the trailing edge fires. The gate then absorbs no-growth.
    for (let i = 0; i < 5; i++) {
      await settle();
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });

    expect(pushSnapshotIfGrown).toHaveBeenCalledTimes(1); // coalesced, not once-per-event
  });
});
