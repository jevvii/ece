import { isBlockingIssue } from "./review";
import { premiumMatrix } from "@/lib/payroll/statutory";
import type { ImportIssue, Sheet } from "./types";
import { createEmployeeMatcher, normalizeEmployeeCode } from "./match-employee";

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
  blockingIssueCount: number;
  matchedEmployees: number;
  rowsRead: number;
};

const MAX_ISSUES = 300;
const FALLBACK_DAY_HOURS = 8;

export const bucketColumns = (value: number | number[] | undefined): number[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

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

  const matchEmployee = createEmployeeMatcher(employees, externalIds);

  const issues: ImportIssue[] = [];
  const days: ApplyV2Output["days"] = [];
  const bucketTotals = new Map<string, { employeeId: string; code: string; hours: number }>();
  const totals = new Map<string, number>();
  const unknown = new Set<string>();
  const seen = new Set<string>();

  let blockingIssueCount = 0;
  const pushIssue = (issue: ImportIssue) => {
    if (isBlockingIssue(issue)) blockingIssueCount += 1;
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

  // The day band is often several rows above the employee-code header (the
  // client ODS has days on row 5 and codes on row 7). Search upward for a
  // 1–31 number in the column instead of assuming it sits on headerRow.
  const headerDayFor = (columnIndex: number) => {
    const limit = Math.min(mapping.headerRow, sheet.rows.length - 1);
    for (let row = 0; row <= limit; row += 1) {
      const text = (sheet.rows[row]?.[columnIndex]?.text ?? "").trim();
      if (!/^\d{1,2}$/.test(text)) continue;
      const day = Number(text);
      if (day >= 1 && day <= 31) return { day, row };
    }
    return null;
  };

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
    const found = headerDayFor(column.index);
    if (!found) continue;
    const dateDay = Number(column.date.slice(8, 10));
    if (found.day !== dateDay) {
      pushIssue({
        row: found.row + 1,
        column: column.index,
        kind: "day_mismatch",
        message: `Header says day ${found.day}, but the cutoff maps this column to ${column.date}.`,
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
    const code = normalizeEmployeeCode(rawCode);
    const name = mapping.employeeName == null ? "" : row[mapping.employeeName]?.text.trim() ?? "";
    if (!code && !name) continue;

    rowsRead += 1;

    const { employeeId, ambiguous } = matchEmployee(code, name);
    if (!employeeId) {
      if (code) unknown.add(code);
      pushIssue({
        row: rowIndex + 1,
        column: mapping.employeeCode,
        code,
        kind: "unknown_employee",
        message: ambiguous
          ? `More than one employee matches ${code || name}. Choose the correct employee or correct the source identifier.`
          : `No employee matches ${code || name} in this company. Check the code and full name or choose an employee.`,
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

    if (mapping.mode === "late" && !schedules[employeeId]) {
      pushIssue({
        row: rowIndex + 1,
        code,
        kind: "missing_schedule",
        message: "No work schedule is assigned, so every date is treated as an 8-hour day, including rest days.",
      });
    }

    for (const column of dateColumns) {
      if (!column.date) continue;
      const cell = row[column.index];
      if (!cell) continue;

      const text = cell.text.trim();
      const blank = text === "" && cell.value === null;
      const halfDay = text.match(/HD\s*=\s*(\d+(?:\.\d+)?)/i);
      const halfMinutes = halfDay ? Number(halfDay[1]) : null;
      if (halfMinutes != null && (!Number.isFinite(halfMinutes) || halfMinutes > 1440)) {
        pushIssue({ row: rowIndex + 1, column: column.index, code, kind: "implausible_hours",
          message: `"${text}" exceeds 24 hours. Correct the half-day annotation.` });
        continue;
      }


      if (mapping.mode === "days") {
        if (blank) continue;
        if (halfMinutes != null) {
          pushIssue({
            row: rowIndex + 1,
            column: column.index,
            code,
            kind: "half_day_annotation",
            message: `"${text}" read as ${halfMinutes} minutes (${(halfMinutes / 60).toFixed(2)} h).`,
          });
          days.push({
            employeeId,
            workDate: column.date,
            hours: round2(halfMinutes / 60),
            lateMinutes: 0,
            sourceValue: text,
          });
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

        const hours = unitFor(column.index) === "minutes" ? cell.value / 60 : cell.value;
        if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
          pushIssue({
            row: rowIndex + 1,
            column: column.index,
            code,
            kind: "implausible_hours",
            message: `${hours.toFixed(2)} h on ${column.date} must be between 0 and 24. Check the value and unit.`,
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
      const minutes = halfMinutes ?? (cell.value == null ? null : unitFor(column.index) === "minutes" ? cell.value : cell.value * 60);
      if (minutes != null && (!Number.isFinite(minutes) || minutes < 0 || (complete > 0 && minutes > complete * 60))) {
        pushIssue({ row: rowIndex + 1, column: column.index, code, kind: "implausible_hours",
          message: `Lateness on ${column.date} must be between zero and the scheduled workday. Check the value and unit.` });
        continue;
      }
      if (complete <= 0 && minutes === 0) continue;

      if (blank) {
        if (complete > 0) {
          days.push({ employeeId, workDate: column.date, hours: round2(complete), lateMinutes: 0, sourceValue: "" });
        }
        continue;
      }

      if (halfMinutes != null) {
        pushIssue({
          row: rowIndex + 1,
          column: column.index,
          code,
          kind: "half_day_annotation",
          message: `"${text}" read as ${halfMinutes} minutes late.`,
        });
        if (complete <= 0) {
          pushIssue({
            row: rowIndex + 1,
            column: column.index,
            code,
            kind: "late_on_rest_day",
            message: `${text} on ${column.date}, which is not a scheduled workday for this employee.`,
          });
          continue;
        }
        days.push({
          employeeId,
          workDate: column.date,
          hours: round2(Math.max(0, complete - halfMinutes / 60)),
          lateMinutes: Math.round(halfMinutes),
          sourceValue: text,
        });
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
        if (!cell || (!cell.text && cell.value === null)) continue;
        if (cell.value === null || !Number.isFinite(cell.value) || cell.value < 0) {
          pushIssue({ row: rowIndex + 1, column: columnIndex, code, kind: "non_numeric",
            message: `Premium ${bucketCode} must contain a non-negative number of hours.` });
          continue;
        }
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
      if (cell && (cell.text || cell.value !== null)) {
        const minutes = cell.value == null ? NaN : mapping.periodLate.unit === "minutes" ? cell.value : cell.value * 60;
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 31 * 24 * 60) {
          pushIssue({ row: rowIndex + 1, column: mapping.periodLate.index, code, kind: "non_numeric",
            message: "Period lateness must contain a valid non-negative number. Check the value and unit." });
        } else totals.set(employeeId, Math.round(minutes));
      }
    }
  }

  return {
    days,
    buckets: [...bucketTotals.values()].map((bucket) => ({ ...bucket, hours: round2(bucket.hours) })),
    totals: [...totals.entries()].map(([employeeId, minutes]) => ({ employeeId, minutes })),
    issues,
    unknownCodes: [...unknown].sort(),
    blockingIssueCount,
    matchedEmployees,
    rowsRead,
  };
}
