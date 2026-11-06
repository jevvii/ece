import { createHash } from "node:crypto";
import type { Cell, ColumnMapping, DetectedMapping, Sheet, Unit } from "./types";

const DAY_MAX = 31;
const WEEKDAY = /^(M|T|W|TH|F|SAT|SUN|MON|TUE|WED|THU|FRI)$/i;

function isDayNumber(cell: Cell | undefined): boolean {
  if (!cell) return false;
  if (cell.value !== null && Number.isInteger(cell.value) && cell.value >= 1 && cell.value <= DAY_MAX) {
    return true;
  }
  return /^\d{1,2}$/.test(cell.text) && Number(cell.text) >= 1 && Number(cell.text) <= DAY_MAX;
}

function headerText(sheet: Sheet, column: number, untilRow: number): string {
  const parts: string[] = [];

  for (let row = Math.max(0, untilRow - 3); row < untilRow; row += 1) {
    const text = sheet.rows[row]?.[column]?.text?.replace(/\s+/g, " ").trim() ?? "";
    if (!text) continue;
    if (/\d{1,2}:\d{2}/.test(text)) continue;
    if (/^NOTE:?$/i.test(text) || /FOR CORRECTIONS/i.test(text)) continue;
    if (parts[parts.length - 1] !== text) parts.push(text);
  }

  return parts.join(" · ");
}

const bucketPatterns: Array<[RegExp, string]> = [
  [/ROT\s*ND|ROTND/i, "ROT_ND"],
  [/SAT\s*ND|SATND/i, "SAT_ND"],
  [/SUN\s*ND|SUNND/i, "SUN_ND"],
  [/REG\.?\s*OT\s*(W\/|WITH)\s*ND/i, "REG_OT_ND"],
  [/REG\.?\s*OT/i, "REG_OT"],
  [/SUNDAY\s*OT\s*(W\/|WITH)\s*ND/i, "SUN_OT_ND"],
  [/SUNDAY\s*OT/i, "SUN_OT"],
  [/SPECIAL\s*HOL(?:IDAY)?\s*OT/i, "SH_OT"],
  [/LEGAL\s*HOL(?:IDAY)?\s*OT/i, "LH_OT"],
  [/SPECIAL\s*HOL(?:IDAY)?/i, "SH"],
  [/LEGAL\s*HOL(?:IDAY)?|\bRH\b/i, "LH"],
  [/SUN\s*(EXCESS)?/i, "SUN"],
  [/SAT(?:URDAY)?/i, "SAT"],
  [/\bROT\b/i, "ROT"],
  [/NIGHT\s*DIFF|\bND\b/i, "ND"],
  [/BACK\s*PAY/i, "BACK_PAY"],
  [/CASH\s*ADVANCE/i, "CASH_ADVANCE"],
  [/LATES?\s*\/?\s*ABSENT/i, "LATE_MINUTES"],
  [/PRESENT|#\s*OF\s*HOURS/i, "PRESENT_TOTAL"],
  [/^T$/i, "TOTAL"],
  [/^EXT(ENSION)?$/i, "EXT"],
];

function bucketCode(header: string): string | null {
  for (const [pattern, code] of bucketPatterns) {
    if (pattern.test(header)) return code;
  }
  return null;
}

function slugCode(header: string): string {
  return header
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

export function detectMapping(sheet: Sheet): DetectedMapping {
  const rows = sheet.rows;
  if (rows.length === 0) throw new Error("The sheet is empty");

  let codeColumn = -1;
  let codeHeaderRow = -1;

  for (let row = 0; row < Math.min(20, rows.length); row += 1) {
    const cells = rows[row] ?? [];
    for (let column = 0; column < cells.length; column += 1) {
      const text = cells[column]?.text ?? "";
      if (/EMPLOYEE\s*(ID|NO|NUMBER|CODE)/i.test(text) || /^EMPLOYEE$/i.test(text)) {
        codeColumn = column;
        codeHeaderRow = row;
        break;
      }
    }
    if (codeColumn !== -1) break;
  }

  // The day header is the row carrying the most 1–31 numbers.
  let dayHeaderRow = -1;
  let dayColumns: number[] = [];
  let bestUnique = 0;

  for (let row = 0; row < Math.min(20, rows.length); row += 1) {
    const cells = rows[row] ?? [];
    const found: number[] = [];
    const unique = new Set<number>();

    for (let column = 0; column < cells.length; column += 1) {
      if (isDayNumber(cells[column])) {
        found.push(column);
        unique.add(Number(cells[column]?.text));
      }
    }

    // A data row can contain many equal values (everyone worked 8 hours);
    // the real header is the row with the most distinct days.
    if (unique.size > bestUnique || (unique.size === bestUnique && found.length > dayColumns.length)) {
      dayColumns = found;
      bestUnique = unique.size;
      dayHeaderRow = row;
    }
  }

  if (dayHeaderRow === -1 || dayColumns.length < 3) {
    throw new Error("Could not find the day columns. The header must contain day numbers 1–31.");
  }

  if (codeColumn === -1) {
    for (let column = 0; column < 6 && codeColumn === -1; column += 1) {
      const samples = rows
        .slice(dayHeaderRow + 1, dayHeaderRow + 12)
        .map((row) => row[column]?.text ?? "")
        .filter(Boolean);
      if (samples.length >= 2 && samples.every((text) => /^[A-Z0-9][A-Z0-9\-_.]{1,}$/i.test(text))) {
        codeColumn = column;
      }
    }
  }

  const nameColumn = findNameColumn(sheet, codeColumn, dayHeaderRow + 1, dayColumns);

  // Data starts after both the code header and the day header.
  let dataStartRow = Math.max(dayHeaderRow, codeHeaderRow) + 1;
  const searchFrom = dataStartRow;

  for (let row = searchFrom; row < Math.min(searchFrom + 12, rows.length); row += 1) {
    const code = rows[row]?.[codeColumn]?.text?.trim() ?? "";
    const name = rows[row]?.[nameColumn]?.text?.trim() ?? "";
    const looksLikeCode = code.length >= 2 && !WEEKDAY.test(code) && (/\d/.test(code) || code.includes("-"));
    if (looksLikeCode && /[A-Za-z]{2,}/.test(name)) {
      dataStartRow = row;
      break;
    }
  }

  const maxDayColumn = dayColumns[dayColumns.length - 1] ?? 0;
  let lastUsed = maxDayColumn;

  for (const row of rows.slice(dataStartRow, dataStartRow + 30)) {
    row.forEach((cell, index) => {
      if ((cell.text !== "" || cell.value !== null) && index > lastUsed) lastUsed = index;
    });
  }

  const columns: ColumnMapping[] = [];
  const dayValues: number[] = [];

  for (let column = 0; column <= lastUsed; column += 1) {
    if (column === codeColumn) {
      columns.push({ index: column, header: "Employee code", role: "employee_code" });
      continue;
    }
    if (column === nameColumn) {
      columns.push({ index: column, header: "Employee name", role: "employee_name" });
      continue;
    }

    const dayCell = rows[dayHeaderRow]?.[column];
    if (dayColumns.includes(column) && isDayNumber(dayCell)) {
      const weekday = rows[dayHeaderRow + 1]?.[column]?.text?.trim() ?? "";
      const day = Number(dayCell?.text ?? dayCell?.value);
      columns.push({
        index: column,
        header: WEEKDAY.test(weekday) ? `${day} · ${weekday.toUpperCase()}` : `Day ${day}`,
        role: "day",
        day,
      });

      for (let row = dataStartRow; row < rows.length; row += 1) {
        const cell = rows[row]?.[column];
        if (cell?.value !== null && cell?.value !== undefined && cell.value > 0) {
          dayValues.push(cell.value);
        }
      }
      continue;
    }

    const header = headerText(sheet, column, dataStartRow);

    if (!header) {
      columns.push({ index: column, header: "—", role: "ignore" });
      continue;
    }

    const code = bucketCode(header);
    if (code) {
      const role = code === "LATE_MINUTES" || code === "PRESENT_TOTAL" || code === "TOTAL" ? "total" : "bucket";
      columns.push({ index: column, header, role, code });
      continue;
    }

    columns.push({ index: column, header, role: "ignore", code: slugCode(header) || undefined });
  }

  const dayMedian = median(dayValues);
  const dayMax = dayValues.reduce((max, value) => Math.max(max, value), 0);
  const allIntegers = dayValues.every((value) => Number.isInteger(value));
  // No single day can exceed 24 hours, so any whole number above that is a unit hint.
  const suggestedUnit: Unit = allIntegers && dayMax > 24 ? "tenths" : "hours";

  const notes: string[] = [
    `Header spans ${dataStartRow} ${dataStartRow === 1 ? "row" : "rows"}; data begins on row ${dataStartRow + 1}.`,
  ];
  if (dayMax > 24 && allIntegers) {
    notes.push(
      `Day values are whole numbers with a median of ${dayMedian}; most likely tenths of an hour (80 = 8h). Confirm the unit before importing.`,
    );
  }

  const companyCell = rows
    .slice(0, 8)
    .flat()
    .find((cell) => /(INC\.?|CORP\.?|CORPORATION|COMPANY|ENTERPRISES?)/i.test(cell.text) && cell.text.length > 6);

  const signature = createHash("sha256")
    .update(`${sheet.name}|${columns.map((column) => column.header).join("|")}`)
    .digest("hex")
    .slice(0, 16);

  return {
    sheetName: sheet.name,
    headerRow: codeHeaderRow >= 0 ? codeHeaderRow : dayHeaderRow,
    dataStartRow,
    columns,
    suggestedUnit,
    signature,
    companyName: companyCell?.text,
    notes,
  };
}

function findNameColumn(sheet: Sheet, codeColumn: number, fromRow: number, dayColumns: number[]) {
  const firstDayColumn = dayColumns[0] ?? Number.MAX_SAFE_INTEGER;

  for (let column = codeColumn + 1; column < firstDayColumn; column += 1) {
    const samples = sheet.rows
      .slice(fromRow, fromRow + 12)
      .map((row) => row[column]?.text ?? "")
      .filter((text) => text && !WEEKDAY.test(text));
    if (samples.length >= 2 && samples.some((text) => /[A-Za-z]{3,}/.test(text))) {
      return column;
    }
  }

  return codeColumn + 1;
}
