import { premiumMatrix } from "@/lib/payroll/statutory";
import type { ImportIssue, Sheet } from "./types";

/**
 * Pure apply engine for the time-report mapping.
 *
 * Kept separate from detection because detection hashes headers with
 * node:crypto; this module is safe to run in the browser for the live preview.
 */

export type ImportMode = "days" | "late";
export type V2Unit = "hours" | "minutes";

export type MappingV2 = {
  version: 2;
  sheetName: string;
  companyName?: string;
  mode: ImportMode;
  headerRow: number;
  dataStartRow: number;
  employeeCode: number | null;
  employeeName: number | null;
  dayStart: number | null;
  dayEnd: number | null;
  dayUnits: Record<string, V2Unit>;
  /**
   * Premium code → source column(s). An export can repeat a label, so a code
   * may collect several columns and their hours are summed.
   */
  buckets: Record<string, number | number[]>;
  periodLate: { index: number; unit: V2Unit } | null;
  ignored: number[];
  signature: string;
  notes: string[];
};

export const premiumCodes = Object.keys(premiumMatrix).sort();

export type EmployeeLite = {
  id: string;
  employeeCode: string;
  lastName: string;
  firstName: string;
};

export type ApplyV2Input = {
  sheet: Sheet;
  mapping: MappingV2;
  period: { coverageStart: string; coverageEnd: string };
  employees: EmployeeLite[];
  externalIds: Array<{ code: string; employeeId: string }>;
  schedules: Record<string, Record<number, number>>;
};

export type ApplyV2Output = {
  days: Array<{ employeeId: string; workDate: string; hours: number; lateMinutes: number; sourceValue: string }>;
  buckets: Array<{ employeeId: string; code: string; hours: number }>;
  totals: Array<{ employeeId: string; minutes: number }>;
  issues: ImportIssue[];
  unknownCodes: string[];
  matchedEmployees: number;
  rowsRead: number;
};

const MAX_ISSUES = 300;
const FALLBACK_DAY_HOURS = 8;

export const bucketColumns = (value: number | number[] | undefined): number[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const normalizeCode = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
const round2 = (value: number) => Math.round(value * 100) / 100;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function weekdayOf(date: string) {
  // 1 = Monday … 7 = Sunday
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export function applyMappingV2(input: ApplyV2Input): ApplyV2Output {
  const { sheet, mapping, period, employees, externalIds, schedules } = input;

  if (mapping.employeeCode == null) throw new Error("The mapping has no employee code column");

  const byCode = new Map<string, string>();
  for (const employee of employees) byCode.set(normalizeCode(employee.employeeCode), employee.id);
  for (const alias of externalIds) byCode.set(normalizeCode(alias.code), alias.employeeId);

  const issues: ImportIssue[] = [];
  const days: ApplyV2Output["days"] = [];
  const bucketTotals = new Map<string, { employeeId: string; code: string; hours: number }>();
  const totals = new Map<string, number>();
  const unknown = new Set<string>();
  const seen = new Set<string>();

  const pushIssue = (issue: ImportIssue) => {
    if (issues.length < MAX_ISSUES) issues.push(issue);
  };

  const dateColumns: Array<{ index: number; date: string | null }> = [];
  if (mapping.dayStart != null && mapping.dayEnd != null) {
    let cursor = new Date(`${period.coverageStart}T00:00:00Z`);
    const last = new Date(`${period.coverageEnd}T00:00:00Z`);
    for (let index = mapping.dayStart; index <= mapping.dayEnd; index += 1) {
      const date = cursor <= last ? isoDate(cursor) : null;
      dateColumns.push({ index, date });
      if (date) cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const headerRow = sheet.rows[mapping.headerRow] ?? [];
  for (const column of dateColumns) {
    if (!column.date) {
      pushIssue({
        row: mapping.headerRow + 1,
        column: column.index,
        kind: "out_of_period",
        message: "This day column falls outside the cutoff and was skipped.",
      });
      continue;
    }
    const headerDay = Number((headerRow[column.index]?.text ?? "").trim());
    const dateDay = Number(column.date.slice(8, 10));
    if (Number.isFinite(headerDay) && headerDay !== dateDay) {
      pushIssue({
        row: mapping.headerRow + 1,
        column: column.index,
        kind: "day_mismatch",
        message: `Header says day ${headerDay}, but the cutoff maps this column to ${column.date}.`,
      });
    }
  }

  const unitFor = (index: number) =>
    mapping.dayUnits[String(index)] ?? (mapping.mode === "late" ? "minutes" : "hours");

  const completeHours = (employeeId: string, date: string) => {
    const schedule = schedules[employeeId];
    if (!schedule) return FALLBACK_DAY_HOURS;
    return schedule[weekdayOf(date)] ?? 0;
  };

  const rows = sheet.rows;
  let matchedEmployees = 0;
  let rowsRead = 0;

  for (let rowIndex = mapping.dataStartRow; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;

    const rawCode = row[mapping.employeeCode]?.text ?? "";
    const code = normalizeCode(rawCode);
    if (!code) continue;

    rowsRead += 1;

    const employeeId = byCode.get(code);
    if (!employeeId) {
      unknown.add(code);
      pushIssue({
        row: rowIndex + 1,
        column: mapping.employeeCode,
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
        message: "Employee appears more than once in the file; later rows were ignored.",
      });
      continue;
    }
    seen.add(employeeId);
    matchedEmployees += 1;

    for (const column of dateColumns) {
      if (!column.date) continue;
      const cell = row[column.index];
      if (!cell) continue;

      const text = cell.text.trim();
      const blank = text === "" && cell.value === null;

      if (mapping.mode === "days") {
        if (blank) continue;
        if (cell.value === null) {
          pushIssue({
            row: rowIndex + 1,
            column: column.index,
            code,
            kind: "non_numeric",
            message: `"${text}" is not a number and was skipped.`,
          });
          continue;
        }

        const hours = unitFor(column.index) === "minutes" ? cell.value / 60 : cell.value;
        if (hours > 24) {
          pushIssue({
            row: rowIndex + 1,
            column: column.index,
            code,
            kind: "implausible_hours",
            message: `${hours.toFixed(2)} h on ${column.date} exceeds a day. Check the unit.`,
          });
        }

        days.push({
          employeeId,
          workDate: column.date,
          hours: round2(hours),
          lateMinutes: 0,
          sourceValue: text || String(cell.value),
        });
        continue;
      }

      const complete = completeHours(employeeId, column.date);
      if (blank) {
        if (complete > 0) {
          days.push({ employeeId, workDate: column.date, hours: round2(complete), lateMinutes: 0, sourceValue: "" });
        }
        continue;
      }

      if (cell.value === null) {
        pushIssue({
          row: rowIndex + 1,
          column: column.index,
          code,
          kind: "non_numeric",
          message: `"${text}" is not a number and was skipped.`,
        });
        continue;
      }

      if (complete <= 0) {
        pushIssue({
          row: rowIndex + 1,
          column: column.index,
          code,
          kind: "late_on_rest_day",
          message: `${text} late on ${column.date}, which is not a scheduled workday for this employee.`,
        });
        continue;
      }

      const lateMinutes = unitFor(column.index) === "minutes" ? cell.value : cell.value * 60;
      const hours = Math.max(0, complete - lateMinutes / 60);

      days.push({
        employeeId,
        workDate: column.date,
        hours: round2(hours),
        lateMinutes: Math.round(lateMinutes),
        sourceValue: text || String(cell.value),
      });
    }

    for (const [bucketCode, value] of Object.entries(mapping.buckets)) {
      let bucketHours = 0;
      for (const columnIndex of bucketColumns(value)) {
        const cell = row[columnIndex];
        if (!cell || cell.value === null || cell.value <= 0) continue;
        bucketHours += cell.value;
      }
      if (bucketHours <= 0) continue;
      const key = `${employeeId}|${bucketCode}`;
      const existing = bucketTotals.get(key);
      if (existing) existing.hours += bucketHours;
      else bucketTotals.set(key, { employeeId, code: bucketCode, hours: bucketHours });
    }

    if (mapping.periodLate) {
      const cell = row[mapping.periodLate.index];
      if (cell && cell.value !== null) {
        const minutes = mapping.periodLate.unit === "minutes" ? cell.value : cell.value * 60;
        totals.set(employeeId, Math.round(minutes));
      }
    }
  }

  return {
    days,
    buckets: [...bucketTotals.values()].map((bucket) => ({ ...bucket, hours: round2(bucket.hours) })),
    totals: [...totals.entries()].map(([employeeId, minutes]) => ({ employeeId, minutes })),
    issues,
    unknownCodes: [...unknown].sort(),
    matchedEmployees,
    rowsRead,
  };
}
