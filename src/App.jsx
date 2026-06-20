import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "react-hot-toast";
import { Show, SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/react";
import BudgetDashboard from "./BudgetDashboard";
import WantedList from "./WantedList";
import MyCollection from "./MyCollection";
import AppSettings from "./AppSettings";
import Sidebar from "./Sidebar";
import { exportFullBackup, applyBackupToLocalStorage, pushToCloudAuth, pushSnapshotIfGrown, fetchFromCloudAuth, markSynced, localContentHash, summarizeLocal, summarizeBackup, clearLocalUserData, hasAnyLocalData, snapshotSig } from "./utils/exportBackup";
import { runDailyBEBatch } from "./utils/beSyncValues";
import { restoreEnrichmentSnapshot } from "./utils/enrichmentSnapshot";
import { setItemSafe } from "./utils/safeStorage";

export default function App() {
  const [view, setView] = useState(() => localStorage.getItem("blLastTab") || "collection");
  const [theme, setTheme] = useState(() => localStorage.getItem("blTheme") || "dark");
  const [sidebarPinned, setSidebarPinned] = useState(() => localStorage.getItem("blSidebarPinned") === "true");
  const [pendingPurchase, setPendingPurchase] = useState(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | pending | syncing | saved
  const [syncConflict, setSyncConflict] = useState(null); // { cloud, local, cloudSummary } | null
  const { getToken, userId, isLoaded } = useAuth();
  // Gate auth auto-push until first-sign-in reconciliation finishes (or a conflict is resolved),
  // so we never push local data up before deciding whether it should win.
  const syncReadyRef = useRef(false);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 220);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Heritage Luxe — reflect the theme onto <html data-theme> so the token sheet's
  // [data-theme="light"] overrides engage. The sidebar foot owns the toggle (toggleTheme below).
  // Device-local: blTheme + blSidebarPinned are skip-listed in setItemSafe (no cloud push).
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    setItemSafe("blTheme", theme);
  }, [theme]);
  useEffect(() => { setItemSafe("blSidebarPinned", String(sidebarPinned)); }, [sidebarPinned]);

  // One-shot toast after a sign-out wipe + reload.
  useEffect(() => {
    if (sessionStorage.getItem("blSignedOutCleared")) {
      sessionStorage.removeItem("blSignedOutCleared");
      toast.success("Signed out — your data was cleared from this device.", { duration: 4000 });
    }
  }, []);

  // Surface a quota failure from the guarded write path (setItemSafe) so a full device
  // never silently loses data (OBS-2). Deduped via a stable toast id so repeated failed
  // writes (e.g. on tab switch) collapse into one banner instead of stacking.
  useEffect(() => {
    const onFull = () => toast.error(
      "This device's storage is full — recent changes weren't saved. Export a backup now, or free up space, to avoid losing data.",
      { id: "storagefull", duration: 8000 }
    );
    window.addEventListener("brickledger:storagefull", onFull);
    return () => window.removeEventListener("brickledger:storagefull", onFull);
  }, []);

  function switchTab(tab) { setView(tab); setItemSafe("blLastTab", tab); }
  const toggleTheme = () => setTheme(t => (t === "dark" ? "light" : "dark"));

  function handleBuyNow(item) {
    setPendingPurchase(item);
    switchTab("budget");
  }

  // Auto-export: check on every app boot whether the interval has elapsed.
  // showSaveFilePicker is unavailable here (no user gesture), so it always
  // falls back to the Downloads folder — which is what you want for auto.
  useEffect(() => {
    const days = Number(localStorage.getItem("blAutoExportDays") || "0");
    if (!days) return;
    // Never auto-export empty data — e.g. right after a sign-out wipe, the schedule
    // is still on but there's nothing to back up. (Firefox would silently download it.)
    const s = summarizeLocal();
    if (!s.sets && !s.wanted && !s.purchases) return;
    const last = localStorage.getItem("blLastAutoExport");
    const daysSince = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
    if (daysSince >= days) {
      exportFullBackup().then(date => {
        if (date) toast.success(`Auto-backup saved · brickledger-backup-${date}.json`, { duration: 7000 });
      });
    }
  }, []);

  // Cloud sync check on load — two paths depending on auth state.
  // Auth user: fetch from /api/sync, auto-apply if cloud is newer (no passphrase needed).
  // Passphrase user: existing encrypted-banner flow.
  useEffect(() => {
    if (!isLoaded) return;

    if (userId) {
      reconcileOnSignIn();
    } else {
      // Signed out / session ended. Stop auto-push immediately (BIZLOGIC-2) — the push
      // effects' cleanups also cancel any pending debounced/interval push when userId
      // clears. If an auth account's data is still on this device, wipe it synchronously
      // on this userId→null transition (not deferred to a later load) so a shared
      // computer can't leak the previous user's data.
      syncReadyRef.current = false;
      if (localStorage.getItem("blSyncedUserId")) {
        // A4: clearLocalUserData refuses to wipe unsynced edits (offline/failed-sync sign-out).
        // Only reload+toast when it actually cleared; otherwise keep the data on this device
        // so the next sign-in can reconcile and push it rather than destroying it.
        if (clearLocalUserData().cleared) {
          sessionStorage.setItem("blSignedOutCleared", "1"); // toast after reload
          window.location.reload();
        }
      }
    }
    // Note: the legacy passphrase auto-restore banner was retired here — it assumed a
    // single global backup, which is wrong now that data is per-account. Passphrase users
    // can still pull manually from Settings → Cloud Sync.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, userId]);

  // Apply a pulled cloud backup, then mark it synced — but ONLY when the restore fully landed.
  // If a guarded write failed (device storage full), the restore is partial: we must NOT mark it
  // synced (a partial local state read as "clean" would auto-push up and clobber the good cloud
  // copy) and must NOT report success. Freezes auto-push and surfaces an actionable error.
  // Returns true when the device now holds the full cloud data and was marked synced.
  function applyCloudBackup(cloud) {
    const restore = applyBackupToLocalStorage(cloud);
    if (!restore.ok) {
      syncReadyRef.current = false; // freeze auto-push so the partial state can't escape to cloud
      toast.error(
        "Couldn't load your cloud data — this device's storage is full. Free up space or export a backup, then reload.",
        { id: "storagefull", duration: 8000 }
      );
      return false;
    }
    // P4.3 — seed the enrichment caches from the snapshot so this device starts WARM (no 4-7 min
    // minifig trickle). This runs ONLY after the atomic apply succeeded, and OUTSIDE its block:
    // restoreEnrichmentSnapshot is cache-only and swallows quota (returns false, never throws), so a
    // failed seed can't corrupt the just-applied user data — the device degrades to cold-but-correct
    // (OBS-2). It writes to localStorage (survives the caller's reload → reloaded surfaces hydrate
    // warm) and reconciles the memos (covers an in-session no-reload apply). A backup with no
    // enrichmentSnapshot (pre-P4.2 / BE-era) is a safe no-op. Return value intentionally ignored —
    // a missing/failed snapshot must not fail the sync.
    restoreEnrichmentSnapshot(cloud.enrichmentSnapshot);
    // P4.4 — seed the force-push gate to the restored coverage so this freshly-restored device does
    // NOT force-push the very snapshot it just pulled (echo guard, plan §4/§5). blLastSnapshotSig is
    // device-local sync bookkeeping (SYNC_SKIP_KEYS → no datachange churn); a missing snapshot → "0:0".
    // Runs OUTSIDE the atomic apply, after the cache restore, via setItemSafe (a quota failure here is
    // cold-but-correct — the gate just stays unseeded, and the first real growth pushes correctly).
    setItemSafe("blLastSnapshotSig", snapshotSig(cloud.enrichmentSnapshot));
    markSynced(cloud, userId);
    return true;
  }

  // First-sign-in reconciliation — decide between local and cloud data WITHOUT ever
  // silently destroying unsynced work. Sets syncReadyRef when safe to auto-push.
  async function reconcileOnSignIn() {
    syncReadyRef.current = false;
    let cloud = null;
    try { cloud = await fetchFromCloudAuth(getToken); }
    catch (err) {
      // A2: a failed fetch leaves the cloud state UNKNOWN. Do NOT enable auto-push off the back
      // of it — a later push would send this device's (possibly stale) local data up and clobber
      // a newer cloud copy. syncReadyRef stays false (set at the top of this fn); it flips true
      // only on a confirmed successful reconcile. A subsequent reload retries the fetch.
      console.warn("[BrickLedger] Sync fetch failed:", err.message);
      return;
    }

    const syncedUser = localStorage.getItem("blSyncedUserId");
    const foreign = !!syncedUser && syncedUser !== userId;

    let local    = summarizeLocal();      // counts (owned/wanted/purchases) for the conflict dialog
    let hasLocal = hasAnyLocalData();     // SYNC-CRIT-1: full-key census, not just 3 buckets

    // Shared browser (BIZLOGIC-1): the local data belongs to a DIFFERENT account.
    // Never let it flow into this user's cloud — wipe it and treat this as a fresh
    // device for the signing-in user.
    if (foreign) {
      // BIZLOGIC-1: foreign data must be wiped regardless of its sync state, so force past
      // the A4 guard. (A1 — adding a recoverable backup before this wipe — is out of scope here.)
      if (hasLocal) { clearLocalUserData({ force: true }); local = summarizeLocal(); hasLocal = false; }
      else localStorage.removeItem("blLastPushHash");
    }

    // ── Cloud empty ──────────────────────────────────────────────
    if (!cloud) {
      if (hasLocal) {
        // Claim the account with this device's data — push up immediately.
        try { await pushToCloudAuth(getToken); } catch { /* interval will retry */ }
      }
      setItemSafe("blSyncedUserId", userId);
      syncReadyRef.current = true;
      return;
    }

    // ── Fresh device (no local data) → pull silently ─────────────
    if (!hasLocal) {
      if (applyCloudBackup(cloud)) {
        toast.success("Synced from cloud ✓", { duration: 3000 });
        setTimeout(() => window.location.reload(), 1500);
      }
      return;
    }

    // ── Both sides have data ─────────────────────────────────────
    const cloudTime  = cloud.exportedAt ? new Date(cloud.exportedAt).getTime() : 0;
    const lastPush   = localStorage.getItem("blLastCloudPush");
    const localTime  = lastPush ? new Date(lastPush).getTime() : 0;
    const cloudNewer = cloudTime > localTime + 60_000;
    const localDirty = localContentHash() !== localStorage.getItem("blLastPushHash");
    const sameUser   = syncedUser === userId;

    // Safe to pull silently only if this device has no unsynced edits AND belongs to this user.
    if (sameUser && cloudNewer && !localDirty) {
      if (applyCloudBackup(cloud)) {
        toast.success("Synced from cloud ✓", { duration: 3000 });
        setTimeout(() => window.location.reload(), 1500);
      }
      return;
    }

    // Same user, local is current or ahead → keep local, let auto-push send it up.
    if (sameUser && !cloudNewer) {
      setItemSafe("blSyncedUserId", userId);
      syncReadyRef.current = true;
      return;
    }

    // Anything else is a genuine conflict (cross-user device, or unsynced local edits vs newer cloud).
    // Ask the user — never auto-destroy.
    setSyncConflict({ cloud, local, cloudSummary: summarizeBackup(cloud) });
  }

  function resolveConflictUseCloud() {
    const { cloud } = syncConflict;
    if (applyCloudBackup(cloud)) {
      setSyncConflict(null);
      toast.success("Loaded your cloud data — reloading…", { duration: 2500 });
      setTimeout(() => window.location.reload(), 1200);
    }
    // On failure the conflict dialog stays open so the user can free space and retry.
  }

  async function resolveConflictKeepLocal() {
    setSyncConflict(null);
    localStorage.removeItem("blLastPushHash"); // force the push through
    try {
      await pushToCloudAuth(getToken);
      setItemSafe("blSyncedUserId", userId);
      toast.success("This device's data is now your cloud copy ✓");
    } catch {
      toast.error("Couldn't upload — will retry automatically.");
    }
    syncReadyRef.current = true;
  }

  // Rolling daily batch: silently syncs 50 oldest-cached sets per day.
  // Cycle length auto-scales with collection size (600 sets = 12-day cycle).
  // New sets get priority — no fetchedAt means they go first.
  useEffect(() => {
    const timer = setTimeout(() => {
      runDailyBEBatch().catch(() => {}); // always silent — errors are non-critical
    }, 15_000); // 15s delay so UI is interactive first
    return () => clearTimeout(timer);
  }, []);

  // Interval auto-push — runs when signed in, no passphrase needed.
  // Gated on syncReadyRef so it never fires during pending reconciliation/conflict.
  useEffect(() => {
    if (!isLoaded || !userId) return;
    const doPush = () => { if (syncReadyRef.current) pushToCloudAuth(getToken).catch(() => {}); };
    const timer = setTimeout(doPush, 10_000);
    const interval = setInterval(doPush, 5 * 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") doPush(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, userId]);

  // Change-triggered auto-push: debounce 15s after any data write (signed-in only).
  // Shows a small nav indicator while pending/syncing.
  useEffect(() => {
    if (!isLoaded || !userId) return;
    let timer = null;
    const onChange = () => {
      setSyncStatus("pending");
      clearTimeout(timer);
      timer = setTimeout(async () => {
        // Don't push while reconciliation/conflict is still pending.
        if (!syncReadyRef.current) { setSyncStatus("idle"); return; }
        setSyncStatus("syncing");
        try {
          await pushToCloudAuth(getToken);
          setSyncStatus("saved");
          setTimeout(() => setSyncStatus("idle"), 3000);
        } catch {
          setSyncStatus("idle");
        }
      }, 15_000);
    };
    window.addEventListener("brickledger:datachange", onChange);
    return () => { window.removeEventListener("brickledger:datachange", onChange); clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, userId]);

  // P4.4 — enrichment-settle force-push: when an enrichment cycle completes (MyCollection emits
  // brickledger:enrichmentsettled) AND coverage grew, refresh the cloud snapshot WITHOUT a manual
  // data-change. Mirrors the datachange push effect above — same ~15s debounce (deliberately matching
  // it) and the same syncReadyRef gating (never push during pending reconcile/conflict). The
  // strict-greater coverage gate inside pushSnapshotIfGrown is the real anti-storm guard, so coalescing
  // every settle into one debounced attempt is safe: a no-growth settle skips (snapshot_no_growth), and
  // the shared blLastSnapshotSig means an opportunistic push that already captured the growth wins.
  useEffect(() => {
    if (!isLoaded || !userId) return;
    let timer = null;
    const onSettled = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!syncReadyRef.current) return; // never force-push before reconcile decides who wins
        pushSnapshotIfGrown(getToken).catch(() => {});
      }, 15_000);
    };
    window.addEventListener("brickledger:enrichmentsettled", onSettled);
    return () => { window.removeEventListener("brickledger:enrichmentsettled", onSettled); clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, userId]);

  return (
    <>
      {syncConflict && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "var(--bk-scrim)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
          fontFamily: "'Inter', sans-serif",
        }}>
          <div style={{
            background: "var(--bk-surface)", border: "1px solid var(--bk-gold-deep)", borderRadius: 16,
            maxWidth: 460, width: "100%", padding: 28, boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 20, color: "var(--bk-text)", fontWeight: 800 }}>Choose which data to keep</h2>
            <p style={{ margin: "0 0 20px", fontSize: 13.5, lineHeight: 1.5, color: "var(--bk-text-muted)" }}>
              This device has data that doesn't match your account. Pick which copy to keep —
              the other will be replaced. This won't merge them.
            </p>
            <div style={{ display: "flex", gap: 12, marginBottom: 22 }}>
              {[
                { title: "This device", s: syncConflict.local },
                { title: "Your account", s: syncConflict.cloudSummary },
              ].map(({ title, s }) => (
                <div key={title} style={{ flex: 1, background: "var(--bk-bg)", border: "1px solid var(--bk-border)", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--bk-gold-ink)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{title}</div>
                  <div style={{ fontSize: 13, color: "var(--bk-text)", lineHeight: 1.7 }}>
                    {s.sets} sets<br />{s.wanted} wanted<br />{s.purchases} purchases
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick={resolveConflictUseCloud} style={{ background: "var(--bk-action)", color: "var(--bk-action-ink)", border: "none", borderRadius: 9, padding: "11px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
                Use my account data
              </button>
              <button onClick={resolveConflictKeepLocal} style={{ background: "transparent", color: "var(--bk-text-muted)", border: "1px solid var(--bk-border)", borderRadius: 9, padding: "11px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                Keep this device's data
              </button>
            </div>
            <p style={{ margin: "16px 0 0", fontSize: 11.5, color: "var(--bk-text-muted)", textAlign: "center" }}>
              Tip: export a backup first (Settings → Data) if you're unsure.
            </p>
          </div>
        </div>
      )}
      <style>{`
        /* Self-hosted variable fonts (TPR-1) — no external Google Fonts dependency. */
        @font-face {
          font-family: 'Inter';
          font-style: normal;
          font-weight: 100 900;
          font-display: swap;
          src: url('/fonts/inter-variable.woff2') format('woff2');
        }
        @font-face {
          font-family: 'Playfair Display';
          font-style: normal;
          font-weight: 400 900;
          font-display: swap;
          src: url('/fonts/playfair-display.woff2') format('woff2');
        }
        * { box-sizing: border-box; }
        .stat-card-val { font-variant-numeric: tabular-nums; } /* Heritage Luxe — aligned KPI figures */
        .bk-action-btn:hover { background: var(--bk-action-hover); } /* gold CTA hover (inline styles can't :hover) */
        @media (max-width: 700px) {
          .app-shell { padding: 6px !important; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .owned-table-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .owned-table-scroll::-webkit-scrollbar-track { background: transparent; }
        .owned-table-scroll::-webkit-scrollbar-thumb { background: var(--bk-border); border-radius: 10px; }
        @media (max-width: 600px) {
          .page-content { padding: 6px !important; }
          /* Reclaim mobile width (<=600 only): trim each tab's own root padding (22 -> 10) and
             drop the secondary stat-card grids to a smaller min so they sit 2-up on a phone instead
             of 1-up. These grids carry an inline grid-template-columns (their desktop spec), so the
             override below is !important to beat inline at <=600; above 600 no rule applies and the
             inline desktop column counts are untouched. Hero tier keeps its larger min (stays 1-up).
             .stat-card-grid is app-wide: My Collection secondary tiers + Budget/Wanted KPI grids. */
          .tab-page { padding: 10px !important; }
          .stat-card-grid { grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)) !important; }
          /* At 2-up each card is ~143px; shrink the value font so a full 5-digit currency figure
             fits on one line instead of ellipsis-truncating. Scoped UNDER .stat-card-grid so hero
             cards (heroGrid, full-width) keep their 27/21px and Metrics used elsewhere keep 24px. */
          .stat-card-grid .stat-card-val { font-size: 18px !important; }
          /* Deep-dive content panels (My Collection): the half-width 1fr 1fr split squishes each
             panel to ~159px on a phone (charts/tables unreadable). Stack them 1-up at <=600; the
             inline 1fr 1fr stays the desktop spec, so above 600px the panels stay side-by-side. */
          .dd-panel-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div className="app-shell" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: "radial-gradient(ellipse at top, var(--bk-surface-2) 0%, var(--bk-bg) 55%, var(--bk-bg) 100%)", minHeight: "100vh", padding: 0 }}>
        <Sidebar
          view={view}
          onNavigate={switchTab}
          theme={theme}
          onToggleTheme={toggleTheme}
          pinned={sidebarPinned}
          onTogglePin={() => setSidebarPinned(p => !p)}
        />
        <div className="app-main" style={{ marginLeft: sidebarPinned ? 232 : 64, transition: "margin-left 0.18s ease", minHeight: "100vh" }}>
          {/* Slim top bar — sync + auth only (wordmark + nav moved to the sidebar). Its height
              feeds --bl-nav-h so the My Collection quick-nav sticks directly below it. */}
          <header className="app-topbar" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "10px 24px", position: "sticky", top: 0, zIndex: 100, background: "var(--bk-bg)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderBottom: "1px solid var(--bk-border)" }}>
            {/* Cloud sync status — shown for signed-in users */}
            {userId && syncStatus !== "idle" && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, pointerEvents: "none", color: syncStatus === "saved" ? "var(--bk-positive)" : "var(--bk-gold-ink)" }}>
                {syncStatus === "pending" && <span style={{ fontSize: 7, animation: "pulse-dot 1.5s ease-in-out infinite" }}>●</span>}
                {syncStatus === "syncing" && <span style={{ display: "inline-block", animation: "spin 0.8s linear infinite" }}>↻</span>}
                {syncStatus === "saved"   && <span>✓</span>}
                <span>{syncStatus === "pending" ? "Unsaved" : syncStatus === "syncing" ? "Syncing…" : "Saved"}</span>
              </div>
            )}
            {/* Auth controls */}
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button style={{ background: "transparent", color: "var(--bk-text-muted)", border: "1px solid var(--bk-border)", borderRadius: 999, padding: "6px 13px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button style={{ background: "var(--bk-action)", color: "var(--bk-action-ink)", border: "none", borderRadius: 999, padding: "6px 13px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  Sign Up
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <UserButton appearance={{ elements: { avatarBox: { width: 28, height: 28 } } }} />
            </Show>
          </header>

          <Toaster
            position="bottom-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: "var(--bk-surface)",
                color: "var(--bk-text)",
                border: "1px solid var(--bk-border)",
                borderRadius: 10,
                fontSize: 13,
                fontFamily: "'Inter', sans-serif",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              },
              success: { iconTheme: { primary: "#22C55E", secondary: "#0C0F14" } }, // literal: react-hot-toast SVG icon
              error:   { iconTheme: { primary: "#EF4444", secondary: "#0C0F14" } },
            }}
          />

          <div className="page-content" style={{ maxWidth: 1400, margin: "0 auto" }}>
            {(view === "collection" || view === "performance") && <MyCollection mode={view} onBuyNow={handleBuyNow} onSwitchTab={switchTab} />}
            {view === "acquisition" && <WantedList onBuyNow={handleBuyNow} />}
            {view === "budget" && (
              <BudgetDashboard
                pendingPurchase={pendingPurchase}
                onPendingPurchaseConsumed={() => setPendingPurchase(null)}
                onNavigateToSettings={() => switchTab("settings")}
              />
            )}
{view === "settings" && <AppSettings />}
          </div>
        </div>
      </div>

      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title="Back to top"
          aria-label="Scroll to top"
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 200,
            width: 38, height: 38, borderRadius: "50%",
            background: "var(--bk-surface)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
            border: "1px solid var(--bk-border)",
            color: "var(--bk-gold-ink)", fontSize: 18, lineHeight: 1,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.45)",
            transition: "opacity 0.15s ease",
          }}
        >
          ↑
        </button>
      )}
    </>
  );
}
