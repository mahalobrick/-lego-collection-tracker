export function asNumber(value) {
  if (typeof value === "number") return value;
  return Number(String(value || "0").replace(/[$,]/g, "")) || 0;
}

export function money(value) {
  return "$" + asNumber(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

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

export function priorityScore(item) {
  let score = 0;

  // Priority 1 = most urgent (50pts), Priority 5 = least urgent (10pts)
  const priority = asNumber(item.priority) || 3;
  score += (6 - priority) * 10;

  // Retirement urgency — retiringSoon flag takes precedence to avoid double-counting
  if (item.retiringSoon) {
    score += 35;
  } else {
    const currentYear = new Date().getFullYear();
    if (String(item.retirementYear) === String(currentYear))       score += 25;
    else if (String(item.retirementYear) === String(currentYear + 1)) score += 10;
  }

  // Retirement confidence bonus
  if (item.retirementConfidence === "High")   score += 15;
  else if (item.retirementConfidence === "Medium") score += 8;

  // Discount bonus — use live store price if available, otherwise target price
  const msrp = asNumber(item.msrp);
  if (msrp > 0) {
    const storePrice  = asNumber(item.storePrice);
    const targetPrice = asNumber(item.targetPrice);
    const refPrice = storePrice > 0 ? storePrice : targetPrice;
    if (refPrice > 0) {
      const discount = ((msrp - refPrice) / msrp) * 100;
      if (discount >= 30)      score += 25;
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
