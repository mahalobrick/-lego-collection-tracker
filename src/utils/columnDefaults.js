/**
 * Default column configurations — single source of truth for both the table
 * component and AppSettings Reset buttons. Keeping them here prevents Reset
 * from silently dropping columns added later.
 */

export const DEFAULT_OWNED_COLUMNS = [
  { key: "thumb",        label: "Image",         visible: false },
  { key: "setNumber",    label: "Set #",         visible: true  },
  { key: "name",         label: "Set Name",      visible: true  },
  { key: "theme",        label: "Theme",         visible: true  },
  { key: "condition",    label: "Condition",     visible: false },
  { key: "qty",          label: "Qty",           visible: true  },
  { key: "value",        label: "Value",         visible: true  },
  { key: "gain",         label: "Gain",          visible: true  },
  { key: "roi",          label: "ROI",           visible: true  },
  { key: "minifigs",     label: "Minifigs",      visible: false },
  { key: "acquiredDate", label: "Acquired",      visible: false },
  { key: "retiredDate",  label: "Retired On",    visible: false },
  { key: "releasedDate", label: "Released",      visible: false },
  { key: "blSoldNew",    label: "BL New (6mo)",  visible: false },
  { key: "blSoldUsed",   label: "BL Used (6mo)", visible: false },
  { key: "notes",        label: "Notes",         visible: false },
];

/**
 * Default column configuration for the Wanted List / Tracking table.
 */
export const DEFAULT_WANTED_COLUMNS = [
  // ── Core ─────────────────────────────────────────────────────
  { key: "thumb",                label: "Image",         visible: false, group: "core" },
  { key: "setNumber",            label: "Set #",         visible: true,  group: "core" },
  { key: "name",                 label: "Set Name",      visible: true,  group: "core" },
  { key: "recommendation",       label: "Action",        visible: true,  group: "core" },
  // ── Retirement ───────────────────────────────────────────────
  { key: "retirementDate",       label: "Retires",       visible: true,  group: "retirement" },
  { key: "daysLeft",             label: "Days Left",     visible: true,  group: "retirement" },
  { key: "retiringSoon",         label: "Retiring Soon", visible: false, group: "retirement" },
  { key: "retirementSource",     label: "Data Source",   visible: false, group: "retirement" },
  { key: "lastRetirementUpdate", label: "Last Updated",  visible: false, group: "retirement" },
  // ── Pricing ──────────────────────────────────────────────────
  { key: "msrp",                 label: "MSRP",          visible: true,  group: "pricing" },
  // storePrice (Sale Price) removed — overlaps with Target Price; score falls back to targetPrice
  { key: "targetPrice",          label: "Target Price",  visible: true,  group: "pricing" },
  { key: "discount",             label: "Discount %",    visible: true,  group: "pricing" },
  { key: "currentValue",         label: "Value",         visible: false, group: "pricing" },
  { key: "forecast2yr",          label: "2yr Forecast",  visible: false, group: "pricing" },
  { key: "forecast5yr",          label: "5yr Forecast",  visible: false, group: "pricing" },
  { key: "blPriceNew",           label: "BL Avg (New)",  visible: false, group: "pricing" },
  { key: "blPriceUsed",         label: "BL Avg (Used)", visible: false, group: "pricing" },
  { key: "blPriceNewRange",      label: "BL New Range",  visible: false, group: "pricing" },
  { key: "blPriceUsedRange",     label: "BL Used Range", visible: false, group: "pricing" },
  // ── Details ──────────────────────────────────────────────────
  { key: "owned",                label: "Owned",         visible: false, group: "details" },
  { key: "ageMonths",            label: "Set Age",       visible: false, group: "details" },
  { key: "theme",                label: "Theme",         visible: true,  group: "details" },
  { key: "pieces",               label: "Pieces",        visible: false, group: "details" },
  { key: "subtheme",             label: "Subtheme",      visible: false, group: "details" },
  { key: "minifigs",             label: "Minifigs",      visible: false, group: "details" },
  { key: "rating",               label: "Rating",        visible: false, group: "details" },
  { key: "packagingType",        label: "Packaging",     visible: false, group: "details" },
  { key: "ageMin",               label: "Min Age",       visible: false, group: "details" },
  { key: "weight",               label: "Weight (kg)",   visible: false, group: "details" },
  { key: "ownedByCount",         label: "Owned By",      visible: false, group: "details" },
  { key: "wantedByCount",        label: "Wanted By",     visible: false, group: "details" },
  { key: "notes",                label: "Notes",         visible: true,  group: "details" },
];
