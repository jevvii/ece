import type { DetectedMapping, ImportIssue, Sheet } from "./types";
import { toHours, type Unit } from "./types";

export type EmployeeLite = {
  id: string;
  employeeCode: string;
  lastName: string;
  firstName: string;
};

export type ApplyInput = {
  sheet: Sheet;
  mapping: DetectedMapping;
  dayUnit: Unit;
  period: { coverageStart: string; coverageEnd: string };
  employees: EmployeeLite[];
  externalIds: Array<{ code: string; employeeId: string }>;
};

export type ApplyOutput = {
  days: Array<{ employeeId: string; workDate: string; hours: number; sourceValue: string }>;
  buckets: Array<{ employeeId: string; code: string; hours: number }>;
  issues: ImportIssue[];
  unknownCodes: string[];
  matchedEmployees: number;
  rowsRead: number;
};

const MAX_ISSUES = 300;

const normalizeCode = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();

const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Day-of-month → the one date inside the cutoff that matches it. */
function dateIndex(start: string, end: string) {
  const index = new Map<number, string>();
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);

  while (cursor <= last) {
    const day = cursor.getUTCDate();
    if (!index.has(day)) index.set(day, iso(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return index;
}

export function applyMapping(input: ApplyInput): ApplyOutput {
  const { sheet, mapping, dayUnit, period, employees, externalIds } = input;

  const byCode = new Map<string, string>();
  for (const employee of employees) byCode.set(normalizeCode(employee.employeeCode), employee.id);
  for (const alias of externalIds) byCode.set(normalizeCode(alias.code), alias.employeeId);

  const dates = dateIndex(period.coverageStart, period.coverageEnd);

  const codeColumn = mapping.columns.find((column) => column.role === "employee_code");
  const dayColumns = mapping.columns.filter((column) => column.role === "day" && column.day);
  const bucketColumns = mapping.columns.filter((column) => column.role === "bucket" && column.code);

  if (!codeColumn) throw new Error("The mapping has no employee code column");

  const issues: ImportIssue[] = [];
  const days: ApplyOutput["days"] = [];
  const buckets: ApplyOutput["buckets"] = [];
  const unknown = new Set<string>();
  const seen = new Set<string>();

  const pushIssue = (issue: ImportIssue) => {
    if (issues.length < MAX_ISSUES) issues.push(issue);
  };

  for (const column of dayColumns) {
    if (!dates.has(column.day!)) {
      pushIssue({
        row: mapping.dataStartRow,
        column: column.index,
        kind: "out_of_period",
        message: `Day ${column.day} does not occur inside ${period.coverageStart} – ${period.coverageEnd}.`,
      });
    }
  }

  const rows = sheet.rows;
  let matchedEmployees = 0;
  let rowsRead = 0;

  for (let rowIndex = mapping.dataStartRow; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;

    const rawCode = row[codeColumn.index]?.text ?? "";
    const code = normalizeCode(rawCode);
    if (!code) continue;

    rowsRead += 1;

    const employeeId = byCode.get(code);
    if (!employeeId) {
      unknown.add(code);
      pushIssue({
        row: rowIndex + 1,
        column: codeColumn.index,
        code,
        kind: "unknown_employee",
        message: `Code ${code} is not bound to an employee in this company.`,
      });
      continue;
    }

    if (seen.has(employeeId)) {
      pushIssue({
        row: rowIndex + 1,
        code,
        kind: "duplicate_employee",
        message: `Employee appears more than once in the file; later rows were ignored.`,
      });
      continue;
    }
    seen.add(employeeId);
    matchedEmployees += 1;

    for (const column of dayColumns) {
      const cell = row[column.index];
      if (!cell) continue;

      const text = cell.text.trim();
      if (text === "" && cell.value === null) continue;

      const date = column.day ? dates.get(column.day) : undefined;
      if (!date) continue;

      let hours: number | null = null;

      const halfDay = text.match(/HD\s*=\s*(\d+(?:\.\d+)?)/i);
      if (halfDay) {
        const minutes = Number(halfDay[1]);
        hours = minutes / 60;
        pushIssue({
          row: rowIndex + 1,
          column: column.index,
          code,
          kind: "half_day_annotation",
          message: `"${text}" read as ${minutes} minutes (${hours.toFixed(2)} h). Confirm this against the source.`,
        });
      } else if (cell.value !== null) {
        hours = toHours(cell.value, column.unit ?? dayUnit);
      } else {
        pushIssue({
          row: rowIndex + 1,
          column: column.index,
          code,
          kind: "non_numeric",
          message: `"${text}" is not a number and was skipped.`,
        });
        continue;
      }

      if (hours > 24) {
        pushIssue({
          row: rowIndex + 1,
          column: column.index,
          code,
          kind: "implausible_hours",
          message: `${hours.toFixed(2)} h on ${date} exceeds a day. The day unit is probably wrong.`,
        });
      }

      days.push({
        employeeId,
        workDate: date,
        hours: Math.round(hours * 100) / 100,
        sourceValue: text || String(cell.value),
      });
    }

    for (const column of bucketColumns) {
      const cell = row[column.index];
      if (!cell || cell.value === null || cell.value <= 0) continue;

      const hours = toHours(cell.value, column.unit ?? "hours");
      buckets.push({
        employeeId,
        code: column.code!,
        hours: Math.round(hours * 100) / 100,
      });
    }
  }

  return {
    days,
    buckets,
    issues,
    unknownCodes: [...unknown].sort(),
    matchedEmployees,
    rowsRead,
  };
}
