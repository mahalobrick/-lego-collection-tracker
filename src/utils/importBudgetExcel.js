function excelDateToISO(XLSX, value) {
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  return value || "";
}

function asNumber(value) {
  if (typeof value === "number") return value;
  return Number(String(value || "0").replace(/[$,]/g, "")) || 0;
}

// Generic: reads first sheet, returns array of row objects keyed by header row
export async function parseExcelFirstSheet(file) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("No sheets found in file.");
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

export async function importBudgetExcel(file) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer);

  const buysSheet = workbook.Sheets["All Buys 2026"];
  if (!buysSheet) throw new Error("Could not find sheet: All Buys 2026");

  const rows = XLSX.utils.sheet_to_json(buysSheet, {
    header: 1,
    defval: ""
  });

  const purchases = rows
    .slice(1)
    .filter(row => row[1] && row[3] !== "")
    .map(row => ({
      date: excelDateToISO(XLSX, row[0]),
      store: String(row[1] || "").trim(),
      item: String(row[2] || ""),
      amount: asNumber(row[3]),
      notes: String(row[4] || ""),
      month: String(row[5] || ""),
      year: Number(row[6] || 2026),
      giftCardUsed: 0,
      cashSpent: asNumber(row[3])
    }));

  return {
    purchases,
    budgets: {}
  };
}
