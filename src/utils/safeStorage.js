// Single guarded localStorage write choke point (Phase E — closes OBS-2 / formalizes DATA-4).
//
// Every BrickLedger write goes through setItemSafe instead of raw localStorage.setItem.
// This replaces the former global main.jsx monkey-patch and gives us:
//   • Quota safety (OBS-2): a QuotaExceeded failure is surfaced to the user via a
//     "brickledger:storagefull" event (App renders a deduped banner) and returns false,
//     instead of throwing uncaught and silently diverging in-memory state from storage.
//   • The auto-push trigger: "brickledger:datachange" is dispatched from the SAME choke
//     point that performs the write — change-detected and prefix/skip-filtered exactly as
//     the old patch did — so the debounced auto-sync in App.jsx is preserved.
//
// Policy (decided in Phase E): one uniform guard for all keys; quota-fail returns false and
// never throws (most call sites are fire-and-forget event handlers); non-quota errors are
// re-thrown (real bugs, not a full disk). The few integrity-critical callers (backup/sync)
// check the boolean return.

// Metadata / cache / push-internal keys: writes to these must NOT trigger an auto-push
// (they're sync bookkeeping or regeneratable caches). Mirrors the old patch's set exactly.
const SYNC_SKIP_KEYS = new Set([
  "blLastPushHash", "blLastCloudPush", "blLastAutoExport", "blLastTab",
  "blLastNotifyDate", "blSyncedUserId", "bricksetSetCache", "brickEconomySetCache",
  "brickEconomyCollectionCache", "blPriceGuideCache",
  "blSessionToken", "blBrickLinkAccessToken",
]);

// Cross-browser QuotaExceeded detection (Chrome/Safari: name/code 22; Firefox: 1014).
function isQuotaError(err) {
  return !!err && (
    err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err.code === 22 || err.code === 1014
  );
}

/**
 * Guarded localStorage.setItem — the ONE write path for BrickLedger data.
 *
 * Success path is byte-for-byte equivalent to `localStorage.setItem(key, String(value))`,
 * then dispatches "brickledger:datachange" when a real (non-skip) data key actually changed.
 *
 * @returns {boolean} true if persisted; false if the write failed because the quota is full
 *   (a "brickledger:storagefull" event is dispatched in that case). Non-quota errors throw.
 */
export function setItemSafe(key, value) {
  const str = String(value);
  const changed = localStorage.getItem(key) !== str;
  try {
    localStorage.setItem(key, str);
  } catch (err) {
    if (isQuotaError(err)) {
      window.dispatchEvent(new CustomEvent("brickledger:storagefull", { detail: { key } }));
      return false;
    }
    throw err;
  }
  if (changed && !SYNC_SKIP_KEYS.has(key) && (key.startsWith("bl") || key.startsWith("brickEconomy"))) {
    window.dispatchEvent(new CustomEvent("brickledger:datachange"));
  }
  return true;
}

/**
 * Raw, UNGUARDED restore of a key to a prior value — the ONLY sanctioned raw localStorage
 * write besides setItemSafe, kept HERE so the DATA-4 lint can ban raw setItem everywhere else.
 *
 * Used solely by applyBackupToLocalStorage's atomic rollback: it reverts a key to a value that
 * ALREADY fit in storage moments earlier, so it must deliberately bypass the quota guard and
 * must NOT emit datachange/storagefull (the revert is a no-op as far as sync is concerned).
 * A null prevValue means the key was absent before the apply → remove it. Best-effort: a failed
 * revert is swallowed (the apply has already failed; we want the closest-to-prior state we can get).
 *
 * @param {string} key
 * @param {string|null} prevValue  the snapshotted pre-apply value (null = key was absent)
 */
export function restoreRaw(key, prevValue) {
  try {
    if (prevValue === null) localStorage.removeItem(key);
    else localStorage.setItem(key, prevValue);
  } catch { /* best-effort revert */ }
}
