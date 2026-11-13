import { parseCsvAuto } from "@/lib/import/csv";
import { parseOdsSheets } from "@/lib/import/ods";
import { parseXlsx } from "@/lib/import/xlsx";
import type { Sheet } from "@/lib/import/types";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_COLS = 200;

export type ImportSheet = { name: string; rows: string[][] };
export type ImportedWorkbook = {
  fileName: string;
  kind: "csv" | "ods" | "xlsx";
  sheets: ImportSheet[];
};

function decodeText(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function isZip(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function looksBinary(bytes: Uint8Array) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  return sample.includes(0);
}

function toGrid(sheet: Sheet): ImportSheet {
  if (sheet.rows.some((row, index) => row.some((cell, column) =>
    (index >= MAX_IMPORT_ROWS || column >= MAX_IMPORT_COLS) && cell.text.trim() !== "",
  ))) {
    throw new Error("Use a sheet with at most 500 rows and 200 columns. Split larger rosters before importing.");
  }
  const rows = sheet.rows
    .slice(0, MAX_IMPORT_ROWS)
    .map((row) => row.slice(0, MAX_IMPORT_COLS).map((cell) => cell.text));

  // Spreadsheet files carry hundreds of empty trailing cells (the reference
  // ODS expands to 200 columns, 191 of them blank). Keep only columns that
  // hold data somewhere, or the mapping screen is a wall of "Column N".
  let width = 0;
  for (const row of rows) {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if ((row[index] ?? "").trim() !== "") {
        width = Math.max(width, index + 1);
        break;
      }
    }
  }

  while (rows.length > 0 && (rows[rows.length - 1] ?? []).every((cell) => cell.trim() === "")) {
    rows.pop();
  }

  return { name: sheet.name, rows: rows.map((row) => row.slice(0, width)) };
}

/**
 * Parses a roster file into bounded text grids. The extension decides which
 * reader runs, but the bytes must actually look like that format — a .csv that
 * is really a spreadsheet, or a .xlsx that is not a zip, is rejected here
 * rather than producing nonsense rows.
 */
export function parseEmployeeWorkbook(bytes: Uint8Array, fileName: string): ImportedWorkbook {
  if (bytes.length === 0) throw new Error("The file is empty.");
  if (bytes.length > MAX_IMPORT_BYTES) {
    throw new Error("Files must be 5 MB or smaller.");
  }

  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "xls") {
    throw new Error("Legacy .xls files are not supported. Save the sheet as .xlsx and try again.");
  }

  if (extension === "csv") {
    if (looksBinary(bytes)) {
      throw new Error("This file is not plain text. Save it as CSV or upload the .xlsx/.ods file.");
    }
    return {
      fileName,
      kind: "csv",
      sheets: [toGrid(parseCsvAuto(decodeText(bytes), "CSV"))],
    };
  }

  if (extension === "ods") {
    if (!isZip(bytes)) throw new Error("This .ods file is not a valid spreadsheet archive.");
    return { fileName, kind: "ods", sheets: parseOdsSheets(bytes).map(toGrid) };
  }

  if (extension === "xlsx") {
    if (!isZip(bytes)) throw new Error("This .xlsx file is not a valid spreadsheet archive.");
    return { fileName, kind: "xlsx", sheets: parseXlsx(bytes).map(toGrid) };
  }

  throw new Error("Upload a .csv, .xlsx or .ods file.");
}
