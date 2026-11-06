export type Cell = {
  text: string;
  value: number | null;
};

export type Sheet = {
  name: string;
  rows: Cell[][];
};

export type ColumnRole = "ignore" | "employee_code" | "employee_name" | "day" | "bucket" | "total";

/** How a raw number becomes hours. Client exports disagree on this. */
export type Unit = "hours" | "tenths" | "minutes" | "days";

export type ColumnMapping = {
  index: number;
  header: string;
  role: ColumnRole;
  /** For buckets and totals: ROT, ROT_ND, SAT, SAT_ND, SUN, SH, LH, ND, ... */
  code?: string;
  /** For day columns: day of month as printed in the header. */
  day?: number;
  unit?: Unit;
};

export type DetectedMapping = {
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  columns: ColumnMapping[];
  suggestedUnit: Unit;
  signature: string;
  companyName?: string;
  notes: string[];
};

export type ImportIssue = {
  row: number;
  column?: number;
  code?: string;
  kind:
    | "unknown_employee"
    | "duplicate_employee"
    | "non_numeric"
    | "half_day_annotation"
    | "out_of_period"
    | "implausible_hours"
    | "no_days"
    | "total_mismatch";
  message: string;
};

export const dayUnitLabel: Record<Unit, string> = {
  hours: "Hours (8.0 = 8h)",
  tenths: "Tenths of an hour (80 = 8h)",
  minutes: "Minutes (480 = 8h)",
  days: "Days (1 = 8h)",
};

export function toHours(raw: number, unit: Unit): number {
  switch (unit) {
    case "tenths":
      return raw / 10;
    case "minutes":
      return raw / 60;
    case "days":
      return raw * 8;
    case "hours":
    default:
      return raw;
  }
}
