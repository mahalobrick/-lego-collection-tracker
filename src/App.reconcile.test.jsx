import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Phase F — A2: a FAILED cloud fetch leaves the cloud state UNKNOWN, so reconcileOnSignIn must
// NOT enable auto-push off the back of it. If it did, the debounced/interval auto-push would
// send this device's (possibly stale) local data up and clobber a newer cloud copy. We render
// the real <App>, fail the reload fetch, then fire the 10s auto-push timer and assert nothing
// is pushed. A successful reconcile (control) must still enable the push.

// --- Mock the heavy leaves so <App> mounts in jsdom without pulling in the god-modules. ---
vi.mock("./BudgetDashboard", () => ({ default: () => null }));
vi.mock("./WantedList", () => ({ default: () => null }));
vi.mock("./MyCollection", () => ({ default: () => null }));
vi.mock("./AppSettings", () => ({ default: () => null }));
vi.mock("./utils/beSyncValues", () => ({ runDailyBEBatch: vi.fn(async () => {}) }));

// Clerk: a stable signed-in user. getToken is irrelevant here (fetch is mocked).
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: async () => "tok", userId: "user_1", isLoaded: true }),
  Show: () => null,
  SignInButton: () => null,
  SignUpButton: () => null,
  UserButton: () => null,
}));

// Keep all the real sync utils (census/hash/etc. read real localStorage) — only the network
// boundary (fetch) and the push are stubbed so we can fail the fetch and detect a push.
vi.mock("./utils/exportBackup", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchFromCloudAuth: vi.fn(), pushToCloudAuth: vi.fn(async () => ({})) };
});

import App from "./App";
import { fetchFromCloudAuth, pushToCloudAuth } from "./utils/exportBackup";

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

// Mount <App> and let the on-mount reconcile effect run to completion (the awaited fetch
// settles on the microtask queue), without yet advancing the auto-push timers.
async function mountAndSettleReconcile() {
  await act(async () => { root.render(<App />); });
  // Flush any trailing microtasks from the async reconcile (its catch/return).
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("reconcileOnSignIn — A2: a failed reload fetch must not enable auto-push", () => {
  it("dirty local + FAILED fetch → the 10s auto-push timer sends NOTHING (no stale push over cloud)", async () => {
    // A dirty, in-sync-user device: real data + a stale push hash so it is unmistakably the
    // kind of state that, if pushed, would overwrite whatever is in the cloud.
    localStorage.setItem("blSyncedUserId", "user_1");
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
    localStorage.setItem("blLastPushHash", "STALE"); // localDirty would be true

    fetchFromCloudAuth.mockRejectedValue(new Error("network down"));

    await mountAndSettleReconcile();

    // Cloud state is UNKNOWN after the failed fetch. Fire the 10s post-mount auto-push.
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });

    expect(fetchFromCloudAuth).toHaveBeenCalledTimes(1);
    expect(pushToCloudAuth).not.toHaveBeenCalled(); // ← fails on current code (syncReadyRef=true)
  });

  it("control: a successful reconcile (local current, same user) DOES enable the auto-push", async () => {
    // Same-user device whose local is current/ahead of cloud → reconcile keeps local and
    // enables auto-push. Proves the harness detects pushes and the A2 fix doesn't over-correct.
    localStorage.setItem("blSyncedUserId", "user_1");
    localStorage.setItem("blOwnedSets", JSON.stringify([{ setNumber: "10497" }]));
    localStorage.setItem("blLastPushHash", "STALE");
    // Local last-push timestamp is newer than the cloud export → cloudNewer is false.
    localStorage.setItem("blLastCloudPush", "2026-05-30T00:00:00Z");

    fetchFromCloudAuth.mockResolvedValue({ version: 2, exportedAt: "2026-01-01T00:00:00Z", ownedSets: [] });

    await mountAndSettleReconcile();
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });

    expect(pushToCloudAuth).toHaveBeenCalled();
  });
});
