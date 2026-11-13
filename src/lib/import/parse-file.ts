import { parseCsvAuto } from "./csv";
import { parseOds } from "./ods";
import { parseXlsx } from "./xlsx";
import type { Sheet } from "./types";

export const MAX_TIME_REPORT_BYTES = 10 * 1024 * 1024;

/** Keep the exact cells and numeric values shared by review and confirmation. */
export function parseTimeReportFile(bytes: Uint8Array, fileName: string): Sheet {
  if (!bytes.length) throw new Error("The file is empty.");
  if (bytes.length > MAX_TIME_REPORT_BYTES) throw new Error("Files must be 10 MB or smaller.");
  const extension = fileName.split(".").pop()?.toLowerCase();
  let sheet: Sheet;
  if (extension === "csv") {
    if (bytes.includes(0)) throw new Error("Save the file as UTF-8 CSV, XLSX or ODS and try again.");
    sheet = parseCsvAuto(new TextDecoder().decode(bytes));
  } else if (extension === "ods" || extension === "xlsx") {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("This file is not a valid spreadsheet archive.");
    sheet = extension === "ods" ? parseOds(bytes) : parseXlsx(bytes)[0]!;
  } else {
    throw new Error("Choose a CSV, XLSX or ODS file.");
  }

  let height = 0;
  let width = 0;
  sheet.rows.forEach((row, index) => row.forEach((cell, column) => {
    if (cell.text.trim() || cell.value !== null) {
      height = Math.max(height, index + 1);
      width = Math.max(width, column + 1);
    }
  }));
  if (!height) throw new Error("The first worksheet is empty. Move the attendance sheet first and try again.");
  if (height > 500 || width > 200) {
    throw new Error("Use a file with at most 500 rows and 200 columns. Split larger reports before importing.");
  }
  return { ...sheet, rows: sheet.rows.slice(0, height).map((row) =>
    Array.from({ length: width }, (_, column) => row[column] ?? { text: "", value: null }),
  ) };
}
