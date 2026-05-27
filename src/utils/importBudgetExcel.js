// Excel import utilities — uses exceljs (replaces vulnerable xlsx/SheetJS).
// Dynamic import keeps exceljs out of the main bundle; it's only loaded when
// the user actually picks an .xlsx file.

function asNumber(value) {
  if (typeof value === "number") return value;
  return Number(String(value || "0").replace(/[$,]/g, "")) || 0;
}

// Extract a plain JS value from an exceljs cell.
// Handles: Date, rich-text objects, formula results, plain primitives.
function cellValue(cell) {
  if (!cell || cell.value == null) return "";
  const v = cell.value;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (v.text  != null) return v.text;   // rich text
    if (v.result != null) return v.result; // formula
  }
  return v;
}

// Convert an exceljs cell value to ISO date string "YYYY-MM-DD".
function toISODate(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // MM/DD/YYYY
  const parts = raw.split("/");
  if (parts.length === 3) {
    const [mo, dy, yr] = parts;
    return `${yr}-${String(mo).padStart(2, "0")}-${String(dy).padStart(2, "0")}`;
  }
  return raw;
}

// Generic: reads the first sheet and returns an array of row objects
// keyed by the header row (row 1). Empty cells become "".
export async function parseExcelFirstSheet(file) {
  const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("No sheets found in file.");

  const rows = [];
  let headers = null;

  sheet.eachRow((row, rowNum) => {
    // row.values is 1-indexed; index 0 is always undefined
    if (rowNum === 1) {
      headers = [];
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        headers[colNum - 1] = String(cellValue(cell) || "").trim();
      });
    } else {
      if (!headers) return;
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = cellValue(row.getCell(i + 1));
      });
      rows.push(obj);
    }
  });

  return rows;
}

// Specific importer for the "All Buys YYYY" sheet format used in the
// BrickLedger budget Excel template.
export async function importBudgetExcel(file) {
  const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  // Find a sheet whose name starts with "All Buys"
  const sheet = workbook.worksheets.find(ws => /all buys/i.test(ws.name));
  if (!sheet) throw new Error(`Could not find "All Buys" sheet. Found: ${workbook.worksheets.map(ws => ws.name).join(", ")}`);

  const purchases = [];

  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header
    const col = i => cellValue(row.getCell(i));

    const store  = String(col(2) || "").trim();
    const amount = asNumber(col(4));
    if (!store || amount === 0) return; // skip blank / non-purchase rows

    purchases.push({
      date:         toISODate(col(1)),
      store,
      item:         String(col(3) || ""),
      amount,
      notes:        String(col(5) || ""),
      month:        String(col(6) || ""),
      year:         Number(col(7)) || new Date().getFullYear(),
      giftCardUsed: 0,
      cashSpent:    amount,
    });
  });

  return { purchases, budgets: {} };
}
