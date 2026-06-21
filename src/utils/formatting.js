export function asNumber(value) {
  if (typeof value === "number") return value;
  return Number(String(value || "0").replace(/[$,]/g, "")) || 0;
}

// ── Date normalization (READ boundary — non-destructive) ──────────────────
// Coerce a date string to ISO yyyy-mm-dd at read time; callers transform on read and
// NEVER rewrite stored localStorage. Idempotent on ISO, parses the US "M/D/YYYY" the
// BE-CSV import leaves behind, takes the date portion of an ISO datetime (Brickset
// launch/exit, e.g. 2017-10-01T00:00:00Z), empty → "", and anything else is returned UNCHANGED
// (never drop a value we don't recognize). This is the read-side twin of AppSettings'
// `csvDateToISO`, which runs on the import WRITE path; kept separate so this can't alter
// import behavior.
export function toISODate(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;           // already ISO — unchanged
  const dt = /^(\d{4}-\d{2}-\d{2})T/.exec(raw); if (dt) return dt[1];  // ISO datetime → date portion
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);     // US M/D/YYYY (4-digit year)
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return raw;                                                // unrecognized — unchanged
}

// Parse a date string (ISO yyyy-mm-dd or US "M/D/YYYY") into a LOCAL date-only Date, or
// null if empty/unrecognized. Built from y/m/d PARTS — NOT `new Date("yyyy-mm-dd")`, which
// the spec parses as UTC midnight and renders the PRIOR calendar day in negative-offset
// zones (e.g. Denver, UTC-7); local construction keeps the intended day.
export function parseLocalDate(value) {
  const iso = toISODate(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // LOCAL midnight
  return isNaN(d.getTime()) ? null : d;
}

// ── Purchase line totaling (canonical — use everywhere) ───────────────────
// lineTotal: face value × qty, respecting newer `total` field and legacy `amount`
export function lineTotal(p) {
  if (p.total != null) return asNumber(p.total);
  return asNumber(p.faceValue ?? p.amount) * (asNumber(p.qty) || 1);
}

// lineCashPaid: what was actually paid after GC / rewards
export function lineCashPaid(p) {
  if (p.cashPaid != null) return asNumber(p.cashPaid);
  return Math.max(0, lineTotal(p) - asNumber(p.gcApplied));
}

// Currency config — symbols + locale for Intl formatting
const CURRENCIES = {
  USD: { symbol: "$",  locale: "en-US" },
  GBP: { symbol: "£",  locale: "en-GB" },
  EUR: { symbol: "€",  locale: "de-DE" },
  CAD: { symbol: "CA$", locale: "en-CA" },
};

export function getDisplayCurrency() {
  try { return localStorage.getItem("blDisplayCurrency") || "USD"; } catch { return "USD"; }
}

export function money(value, overrideCurrency) {
  const code = overrideCurrency || getDisplayCurrency();
  const { symbol, locale } = CURRENCIES[code] || CURRENCIES.USD;
  const n = asNumber(value);
  // Place symbol after the minus sign for negatives: -$1,234.56 not $-1,234.56
  if (n < 0) return "-" + symbol + Math.abs(n).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol + n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export { CURRENCIES };

export function setImageUrl(setNumber) {
  if (!setNumber) return "";
  const clean = String(setNumber).replace("-1", "").trim();
  return `https://images.brickset.com/sets/small/${clean}-1.jpg`;
}

export const CONDITION_LABELS = {
  new: "New",
  sealed: "Sealed",
  used_as_new: "Used — Like New",
  used_good: "Used — Good",
  used_acceptable: "Used — Acceptable",
  used: "Used",
  mixed: "Mixed",
};

export function conditionLabel(raw) {
  if (!raw) return null;
  return CONDITION_LABELS[raw] || raw.replace(/_/g, " ");
}

export function conditionColor(raw) {
  if (!raw) return "#555";
  if (raw === "new" || raw === "sealed") return "#5aa832";
  if (raw === "used_as_new") return "#f59e0b";
  return "#c9c9c9";
}

/**
 * Returns days until a set retires. Negative = already past exit date.
 */
export function daysUntilRetirement(exitDate) {
  if (!exitDate) return null;
  return Math.floor((new Date(exitDate) - new Date()) / 86400000);
}

/**
 * Maps an exit_date to its LEGO wave label (Jul/Dec waves are predictable).
 * Returns null for non-standard months.
 */
export function retirementWaveLabel(exitDate) {
  if (!exitDate) return null;
  const d = new Date(exitDate);
  const month = d.getMonth() + 1; // 1-12
  const year  = d.getFullYear();
  // Mid-year wave: exits May–August
  if (month >= 5 && month <= 8)  return `Jul ${year} wave`;
  // End-year wave: exits October–January
  if (month >= 10 || month <= 1) return `Dec ${year} wave`;
  return null;
}

export function priorityScore(item) {
  let score = 0;

  // Priority 1 = most urgent (50pts), Priority 5 = least urgent (10pts)
  const priority = asNumber(item.priority) || 3;
  score += (6 - priority) * 10;

  // ── Retirement urgency ─────────────────────────────────────────
  if (item.isLastChance) {
    // Confirmed on LEGO's "Last Chance to Buy" page — weeks remaining at most
    score += 40;
  } else if (item.exit_date) {
    // Precise wave-aware urgency from Brickset exit_date
    const days = daysUntilRetirement(item.exit_date);
    if      (days <= 0)   score += 38; // past exit date — buy immediately or it's gone
    else if (days <= 30)  score += 38; // under a month
    else if (days <= 60)  score += 35; // 1–2 months (wave is imminent)
    else if (days <= 120) score += 28; // 2–4 months (approaching wave)
    else if (days <= 180) score += 22; // 4–6 months
    else if (days <= 365) score += 15; // within the year
    else                  score += 5;  // over a year out
  } else if (item.retiringSoon) {
    // Legacy manual flag — kept for backward compatibility
    score += 35;
  } else {
    const currentYear = new Date().getFullYear();
    if      (String(item.retirementYear) === String(currentYear))       score += 25;
    else if (String(item.retirementYear) === String(currentYear + 1))   score += 10;
  }

  // Discount bonus — use target price (storePrice kept as legacy fallback for old data)
  const msrp = asNumber(item.msrp);
  if (msrp > 0) {
    const targetPrice = asNumber(item.targetPrice);
    const storePrice  = asNumber(item.storePrice); // legacy; may be 0 for new items
    const refPrice = targetPrice > 0 ? targetPrice : storePrice;
    if (refPrice > 0) {
      const discount = ((msrp - refPrice) / msrp) * 100;
      if      (discount >= 30) score += 25;
      else if (discount >= 20) score += 15;
      else if (discount >= 10) score += 8;
    }
  }

  return Math.min(score, 100);
}

export function recommendation(score) {
  if (score >= 80) return "Buy Now";
  if (score >= 60) return "Watch Closely";
  return "Safe to Wait";
}
