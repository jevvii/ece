import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseCsv } from "../src/lib/import/csv";
import { parseOds } from "../src/lib/import/ods";
import {
  applyMappingV2,
  detectMappingV2,
  validateMappingV2,
  type MappingV2,
} from "../src/lib/import/mapping-v2";
import type { Sheet } from "../src/lib/import/types";

const cell = (text: string) => ({
  text,
  value: /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null,
});

const weekdayOf = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

const employee = { id: "e1", employeeCode: "E1", lastName: "Doe", firstName: "Jane" };
const period = { coverageStart: "2026-10-26", coverageEnd: "2026-10-28" };

function baseMapping(overrides: Partial<MappingV2>): MappingV2 {
  return {
    version: 2,
    sheetName: "test",
    mode: "days",
    headerRow: 0,
    dataStartRow: 1,
    employeeCode: 0,
    employeeName: null,
    dayStart: null,
    dayEnd: null,
    dayUnits: {},
    buckets: {},
    periodLate: null,
    ignored: [],
    signature: "test",
    notes: [],
    ...overrides,
  };
}

/* CSV fixture: day hours, 48 day records, unique buckets. */
const csv = parseCsv(readFileSync("fixtures/sample-attendance.csv", "utf8"));
const csvMapping = detectMappingV2(csv);
assert.equal(csvMapping.mode, "days", "CSV mode");
assert.equal(csvMapping.employeeCode, 0, "CSV code column");
assert.equal(csvMapping.dayStart, 2, "CSV first day column");
assert.equal(csvMapping.dayEnd, 17, "CSV last day column");

const csvResult = applyMappingV2({
  sheet: csv,
  mapping: csvMapping,
  period: { coverageStart: "2026-10-26", coverageEnd: "2026-11-10" },
  employees: [
    { id: "e1", employeeCode: "BAY-0001", lastName: "Santos", firstName: "Maria" },
    { id: "e2", employeeCode: "BAY-0002", lastName: "Reyes", firstName: "Juan" },
    { id: "e3", employeeCode: "BAY-0003", lastName: "Cruz", firstName: "Ana" },
  ],
  externalIds: [],
  schedules: {},
});

assert.equal(csvResult.matchedEmployees, 3, "CSV matched employees");
assert.equal(csvResult.days.length, 48, "CSV day records");
assert.equal(csvResult.unknownCodes.length, 0, "CSV no unknown codes");
assert.ok(csvResult.days.every((day) => day.lateMinutes === 0), "CSV has no lateness");
const csvKeys = new Set(csvResult.buckets.map((bucket) => `${bucket.employeeId}|${bucket.code}`));
assert.equal(csvKeys.size, csvResult.buckets.length, "CSV buckets unique");

/* Day minutes: 480 in a day column is eight hours. */
const minuteSheet: Sheet = {
  name: "minutes",
  rows: [[cell("CODE"), cell("26")], [cell("E1"), cell("480")]],
};
const minuteResult = applyMappingV2({
  sheet: minuteSheet,
  mapping: baseMapping({ dayStart: 1, dayEnd: 1, dayUnits: { "1": "minutes" } }),
  period,
  employees: [employee],
  externalIds: [],
  schedules: {},
});
assert.equal(minuteResult.days[0]?.hours, 8, "day minutes become hours");

/* Late mode: blank = full day, value = full minus late, rest day = issue. */
const lateSheet: Sheet = {
  name: "late",
  rows: [
    [cell("CODE"), cell("26"), cell("27"), cell("28")],
    [cell("E1"), cell(""), cell("60"), cell("90")],
  ],
};
const lateDates = ["2026-10-26", "2026-10-27", "2026-10-28"];
const restWeekday = weekdayOf(lateDates[1] ?? "");
const workWeekday = weekdayOf(lateDates[0] ?? "");
const otherWeekday = weekdayOf(lateDates[2] ?? "");

const lateResult = applyMappingV2({
  sheet: lateSheet,
  mapping: baseMapping({ mode: "late", dayStart: 1, dayEnd: 3, dayUnits: { "1": "minutes", "2": "minutes", "3": "minutes" } }),
  period,
  employees: [employee],
  externalIds: [],
  schedules: { e1: { [workWeekday]: 8, [restWeekday]: 0, [otherWeekday]: 8 } },
});

const firstDay = lateResult.days.find((day) => day.workDate === lateDates[0]);
const thirdDay = lateResult.days.find((day) => day.workDate === lateDates[2]);
assert.equal(firstDay?.hours, 8, "blank late means the full scheduled day");
assert.equal(firstDay?.lateMinutes, 0, "blank late stores zero");
assert.equal(thirdDay?.hours, 6.5, "late minutes are subtracted from the full day");
assert.equal(thirdDay?.lateMinutes, 90, "late minutes are stored");
assert.ok(
  lateResult.issues.some((issue) => issue.kind === "late_on_rest_day"),
  "late on a rest day is an issue",
);
assert.ok(!lateResult.days.some((day) => day.workDate === lateDates[1]), "rest day creates no row");

/* A premium code can collect several source columns; their hours are summed. */
const multiBucketSheet: Sheet = {
  name: "multi bucket",
  rows: [
    [cell("CODE"), cell("SH"), cell("SH")],
    [cell("E1"), cell("2"), cell("3")],
  ],
};
const multiBucketResult = applyMappingV2({
  sheet: multiBucketSheet,
  mapping: baseMapping({ dayStart: null, dayEnd: null, buckets: { SH: [1, 2] } }),
  period,
  employees: [employee],
  externalIds: [],
  schedules: {},
});
assert.equal(multiBucketResult.buckets.length, 1, "multi-column bucket produces one row");
assert.equal(multiBucketResult.buckets[0]?.hours, 5, "multi-column bucket hours are summed");

/* Period total: one column for the whole cutoff. */
const totalSheet: Sheet = {
  name: "total",
  rows: [
    [cell("CODE"), cell("26"), cell("LATE")],
    [cell("E1"), cell("8"), cell("45")],
  ],
};
const totalResult = applyMappingV2({
  sheet: totalSheet,
  mapping: baseMapping({ dayStart: 1, dayEnd: 1, periodLate: { index: 2, unit: "minutes" } }),
  period,
  employees: [employee],
  externalIds: [],
  schedules: {},
});
assert.equal(totalResult.totals[0]?.minutes, 45, "period late total stored separately");
assert.equal(totalResult.days[0]?.lateMinutes, 0, "period total is not a day value");

/* Validation: a period total alone cannot produce days. */
assert.ok(
  validateMappingV2(baseMapping({ mode: "late", periodLate: { index: 2, unit: "minutes" } })),
  "late mode without a day range is rejected",
);

/* Optional ODS: buckets must be unique per employee and code. */
const odsPath = process.env.ODS_FIXTURE ?? process.argv[2];
if (odsPath && existsSync(odsPath)) {
  const ods = parseOds(new Uint8Array(readFileSync(odsPath)));
  const odsMapping = detectMappingV2(ods);
  const codeColumn = odsMapping.employeeCode;

  const odsEmployees: Array<{ id: string; employeeCode: string; lastName: string; firstName: string }> = [];
  if (codeColumn != null) {
    const codes = new Set<string>();
    for (const row of ods.rows.slice(odsMapping.dataStartRow)) {
      const code = (row[codeColumn]?.text ?? "").trim();
      if (!code || codes.has(code)) continue;
      codes.add(code);
      odsEmployees.push({ id: `o${codes.size}`, employeeCode: code, lastName: "Test", firstName: `E${codes.size}` });
    }
  }

  const odsResult = applyMappingV2({
    sheet: ods,
    mapping: odsMapping,
    period: { coverageStart: "2026-10-26", coverageEnd: "2026-11-10" },
    employees: odsEmployees,
    externalIds: [],
    schedules: {},
  });

  const keys = new Set(odsResult.buckets.map((bucket) => `${bucket.employeeId}|${bucket.code}`));
  assert.equal(keys.size, odsResult.buckets.length, "ODS buckets unique");
  console.log(
    `ODS: mode ${odsMapping.mode}, ${odsResult.rowsRead} rows, ${odsResult.matchedEmployees} matched, ${odsResult.buckets.length} buckets, ${odsResult.issues.length} issues`,
  );
} else {
  console.log("skip: no optional ODS fixture supplied");
}

console.log("import engine checks passed");
