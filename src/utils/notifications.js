/**
 * Browser notification utilities for BrickLedger.
 *
 * Notifications are opt-in (blNotificationsEnabled in localStorage) and
 * throttled to once per calendar day to avoid spam on every page load.
 * Only fires while the browser tab is open — no service-worker push yet.
 */

export function notificationsSupported() {
  return "Notification" in window;
}

export function notificationPermission() {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return "unsupported";
  return await Notification.requestPermission();
}

/**
 * Fire price-drop and last-chance notifications on app open.
 * Throttled: at most once per calendar day.
 *
 * @param {Array} priceDropItems  - items whose storePrice ≤ targetPrice
 * @param {Array} lastChanceItems - items flagged isLastChance
 */
export function fireOpenNotifications(priceDropItems, lastChanceItems) {
  if (!notificationsSupported()) return;
  if (Notification.permission !== "granted") return;
  if (!localStorage.getItem("blNotificationsEnabled")) return;

  // Throttle to once per calendar day
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem("blLastNotifyDate") === today) return;
  localStorage.setItem("blLastNotifyDate", today);

  priceDropItems.forEach(item => {
    const sp   = Number(item.storePrice) || 0;
    const msrp = Number(item.msrp) || 0;
    const pct  = msrp > 0 && sp > 0 ? ((msrp - sp) / msrp * 100).toFixed(0) : null;
    try {
      new Notification(`💰 Price Drop: ${item.name || `Set #${item.setNumber}`}`, {
        body: [
          pct ? `${pct}% off MSRP` : "",
          item.theme || "",
          sp > 0 ? `Store: $${sp.toFixed(2)}` : "",
        ].filter(Boolean).join(" · "),
        tag:  `bl-price-${item.setNumber}`,  // OS-level dedup per set
        icon: "/favicon.ico",
      });
    } catch {}
  });

  lastChanceItems.forEach(item => {
    try {
      new Notification(`🚨 Last Chance: ${item.name || `Set #${item.setNumber}`}`, {
        body: [
          "On LEGO Last Chance to Buy list",
          item.theme || "",
          item.msrp ? `MSRP: $${Number(item.msrp).toFixed(2)}` : "",
        ].filter(Boolean).join(" · "),
        tag:  `bl-lc-${item.setNumber}`,
        icon: "/favicon.ico",
      });
    } catch {}
  });
}
