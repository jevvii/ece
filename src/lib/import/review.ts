import type { MappingV2 } from "./apply-v2";
import type { ImportIssue, Sheet } from "./types";

export const isBlockingIssue = (issue: ImportIssue) => issue.kind !== "half_day_annotation";

export function validateMappingV2(mapping: MappingV2, sheet?: Sheet): string | null {
  if (mapping.employeeCode == null) return "Map the employee code column.";
  if (mapping.dayStart == null || mapping.dayEnd == null) {
    return "Map the first and last day columns. A period total on its own cannot produce attendance days.";
  }
  if (![mapping.dayStart, mapping.dayEnd].every((index) => Number.isInteger(index) && index >= 0 && index < 200)) {
    return "A mapped column is outside the worksheet. Review the column assignments.";
  }
  if (mapping.dayStart > mapping.dayEnd) return "The first day column must come before the last.";
  if (!Number.isInteger(mapping.dataStartRow) || mapping.dataStartRow <= mapping.headerRow ||
      (sheet && mapping.dataStartRow >= sheet.rows.length)) {
    return "Choose a first data row after the header and within the worksheet.";
  }
  const assigned = [mapping.employeeCode, ...(mapping.employeeName == null ? [] : [mapping.employeeName]),
    ...Array.from({ length: mapping.dayEnd - mapping.dayStart + 1 }, (_, i) => mapping.dayStart! + i),
    ...Object.values(mapping.buckets).flatMap((value) => Array.isArray(value) ? value : [value]),
    ...(mapping.periodLate ? [mapping.periodLate.index] : []),
  ];
  const width = sheet ? Math.max(0, ...sheet.rows.map((row) => row.length)) : 200;
  if (assigned.some((index) => !Number.isInteger(index) || index < 0 || index >= width)) {
    return "A mapped column is outside the worksheet. Review the column assignments.";
  }
  if (new Set(assigned).size !== assigned.length) return "A column is assigned to more than one field.";
  return null;
}
