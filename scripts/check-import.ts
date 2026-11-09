import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseCsv } from "../src/lib/import/csv";
import { parseOds } from "../src/lib/import/ods";
import { detectMapping } from "../src/lib/import/detect";
import { applyMapping } from "../src/lib/import/apply";
import type { DetectedMapping } from "../src/lib/import/types";

const csv = parseCsv(readFileSync("fixtures/sample-attendance.csv", "utf8"));
const csvMap = detectMapping(csv);

assert.equal(csvMap.headerRow, 0, "CSV header row");
assert.equal(csvMap.dataStartRow, 1, "CSV data start");
assert.equal(csvMap.columns.filter((column) => column.role === "day").length, 16, "CSV day columns");
assert.equal(csvMap.columns.find((column) => column.role === "employee_code")?.index, 0, "CSV code column");
assert.equal(csvMap.suggestedUnit, "hours", "CSV unit");

const csvResult = applyMapping({
  sheet: csv,
  mapping: csvMap,
  dayUnit: "hours",
  period: { coverageStart: "2026-10-26", coverageEnd: "2026-11-10" },
  employees: [
    { id: "e1", employeeCode: "BAY-0001", lastName: "Santos", firstName: "Maria" },
    { id: "e2", employeeCode: "BAY-0002", lastName: "Reyes", firstName: "Juan" },
    { id: "e3", employeeCode: "BAY-0003", lastName: "Cruz", firstName: "Ana" },
  ],
  externalIds: [],
});

assert.equal(csvResult.matchedEmployees, 3, "CSV matched employees");
assert.equal(csvResult.days.length, 48, "CSV day records");
assert.equal(csvResult.unknownCodes.length, 0, "CSV no unknown codes");
assert.equal(csvResult.days.filter((day) => day.hours > 24).length, 0, "CSV sane hours");

// Two source columns can carry the same premium code (the client export repeats
// SH, RH and Sun headers). Buckets are totals per employee and code, so they
// must be summed rather than inserted twice into attendance_buckets.
const cell = (text: string) => ({
  text,
  value: /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null,
});

const duplicateMapping: DetectedMapping = {
  sheetName: "duplicate buckets",
  headerRow: 0,
  dataStartRow: 1,
  suggestedUnit: "hours",
  signature: "test-duplicate-buckets",
  notes: [],
  columns: [
    { index: 0, header: "EMPLOYEE ID NUMBER", role: "employee_code" },
    { index: 1, header: "ROT", role: "bucket", code: "ROT", unit: "hours" },
    { index: 2, header: "ROT", role: "bucket", code: "ROT", unit: "hours" },
  ],
};

const duplicateResult = applyMapping({
  sheet: {
    name: "duplicate buckets",
    rows: [[cell("EMPLOYEE ID NUMBER"), cell("ROT"), cell("ROT")], [cell("E1"), cell("2"), cell("3")]],
  },
  mapping: duplicateMapping,
  dayUnit: "hours",
  period: { coverageStart: "2026-10-26", coverageEnd: "2026-11-10" },
  employees: [{ id: "e1", employeeCode: "E1", lastName: "Doe", firstName: "Jane" }],
  externalIds: [],
});

assert.equal(duplicateResult.buckets.length, 1, "duplicate bucket codes produce one row");
assert.equal(duplicateResult.buckets[0]?.hours, 5, "duplicate bucket hours are summed");

const bucketKeys = new Set(csvResult.buckets.map((bucket) => `${bucket.employeeId}|${bucket.code}`));
assert.equal(bucketKeys.size, csvResult.buckets.length, "CSV buckets are unique per employee and code");

// Optional ODS fixture, passed as an argument or ODS_FIXTURE. Never hardcode a
// client export: the parser is exercised with synthetic files in CI.
const odsPath = process.env.ODS_FIXTURE ?? process.argv[2];
if (odsPath && existsSync(odsPath)) {
  const ods = parseOds(new Uint8Array(readFileSync(odsPath)));
  const odsMap = detectMapping(ods);

  assert.ok(odsMap.columns.some((column) => column.role === "day"), "ODS day columns");
  assert.ok(odsMap.headerRow >= 0, "ODS header row");

  // Bind every code in the file so buckets are actually produced, then assert
  // the (employee, code) pairs an insert would target are unique.
  const codeColumn = odsMap.columns.find((column) => column.role === "employee_code");
  const odsEmployees: Array<{ id: string; employeeCode: string; lastName: string; firstName: string }> = [];
  if (codeColumn) {
    const codes = new Set<string>();
    for (const row of ods.rows.slice(odsMap.dataStartRow)) {
      const code = (row[codeColumn.index]?.text ?? "").trim();
      if (!code || codes.has(code)) continue;
      codes.add(code);
      odsEmployees.push({
        id: `o${codes.size}`,
        employeeCode: code,
        lastName: "Test",
        firstName: `Employee ${codes.size}`,
      });
    }
  }

  const odsResult = applyMapping({
    sheet: ods,
    mapping: odsMap,
    dayUnit: odsMap.suggestedUnit,
    period: { coverageStart: "2026-10-26", coverageEnd: "2026-11-10" },
    employees: odsEmployees,
    externalIds: [],
  });

  const odsKeys = new Set(odsResult.buckets.map((bucket) => `${bucket.employeeId}|${bucket.code}`));
  assert.equal(odsKeys.size, odsResult.buckets.length, "ODS buckets are unique per employee and code");
  console.log(
    `ODS: ${odsResult.rowsRead} rows, ${odsResult.matchedEmployees} matched, ${odsResult.buckets.length} buckets, ${odsResult.issues.length} issues`,
  );
} else {
  console.log("skip: no optional ODS fixture supplied");
}

console.log("import engine checks passed");
