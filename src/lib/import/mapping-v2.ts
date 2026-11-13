import { detectMapping } from "./detect";
import type { MappingV2, V2Unit } from "./apply-v2";
import type { Sheet } from "./types";

export type { ApplyV2Input, ApplyV2Output, EmployeeLite, ImportMode, MappingV2, V2Unit } from "./apply-v2";
export { applyMappingV2, bucketColumns, premiumCodes } from "./apply-v2";

/**
 * Turns the v1 per-column detection into the target-shaped v2 mapping the
 * mapping screen edits. Detection stays in one place; this is the adapter.
 */
export function detectMappingV2(sheet: Sheet): MappingV2 {
  const base = detectMapping(sheet);

  const employeeCode = base.columns.find((column) => column.role === "employee_code")?.index ?? null;
  const employeeName = base.columns.find((column) => column.role === "employee_name")?.index ?? null;

  const dayColumns = base.columns
    .filter((column) => column.role === "day" && column.day)
    .map((column) => column.index)
    .sort((a, b) => a - b);

  const lateColumn =
    base.columns.find((column) => column.code === "LATE_MINUTES") ??
    base.columns.find((column) => /late|absent/i.test(column.header));

  const buckets: Record<string, number[]> = {};
  for (const column of base.columns) {
    if (column.role === "bucket" && column.code) {
      (buckets[column.code] ??= []).push(column.index);
    }
  }

  const mode = dayColumns.length > 0 ? "days" : lateColumn ? "late" : "days";
  const defaultUnit: V2Unit = base.suggestedUnit === "minutes" ? "minutes" : "hours";

  const dayUnits: Record<string, V2Unit> = {};
  for (const index of dayColumns) dayUnits[String(index)] = defaultUnit;

  const used = new Set<number>();
  if (employeeCode != null) used.add(employeeCode);
  if (employeeName != null) used.add(employeeName);
  for (const index of dayColumns) used.add(index);
  for (const indexes of Object.values(buckets)) for (const index of indexes) used.add(index);
  if (lateColumn) used.add(lateColumn.index);

  return {
    version: 2,
    sheetName: base.sheetName,
    companyName: base.companyName,
    mode,
    headerRow: base.headerRow,
    dataStartRow: base.dataStartRow,
    employeeCode,
    employeeName,
    dayStart: dayColumns[0] ?? null,
    dayEnd: dayColumns[dayColumns.length - 1] ?? null,
    dayUnits,
    buckets,
    periodLate: lateColumn ? { index: lateColumn.index, unit: "minutes" } : null,
    ignored: base.columns.map((column) => column.index).filter((index) => !used.has(index)),
    signature: base.signature,
    notes: base.notes,
  };
}

export { validateMappingV2 } from "./review";
