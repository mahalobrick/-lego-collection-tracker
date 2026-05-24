export function asNumber(value) {
  if (typeof value === "number") return value;
  return Number(String(value || "0").replace(/[$,]/g, "")) || 0;
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

  // Retirement confidence bonus
  if      (item.retirementConfidence === "High")   score += 15;
  else if (item.retirementConfidence === "Medium") score += 8;

  // Discount bonus — use live store price if available, otherwise target price
  const msrp = asNumber(item.msrp);
  if (msrp > 0) {
    const storePrice  = asNumber(item.storePrice);
    const targetPrice = asNumber(item.targetPrice);
    const refPrice = storePrice > 0 ? storePrice : targetPrice;
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
