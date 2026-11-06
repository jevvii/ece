import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseCsv } from "../src/lib/import/csv";
import { parseOds } from "../src/lib/import/ods";
import { detectMapping } from "../src/lib/import/detect";
import { applyMapping } from "../src/lib/import/apply";

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

// Optional ODS fixture, passed as an argument or ODS_FIXTURE. Never hardcode a
// client export: the parser is exercised with synthetic files in CI.
const odsPath = process.env.ODS_FIXTURE ?? process.argv[2];
if (odsPath && existsSync(odsPath)) {
  const ods = parseOds(new Uint8Array(readFileSync(odsPath)));
  const odsMap = detectMapping(ods);

  assert.ok(odsMap.columns.some((column) => column.role === "day"), "ODS day columns");
  assert.ok(odsMap.headerRow >= 0, "ODS header row");

  applyMapping({
    sheet: ods,
    mapping: odsMap,
    dayUnit: odsMap.suggestedUnit,
    period: { coverageStart: "2026-10-26", coverageEnd: "2026-11-10" },
    employees: [],
    externalIds: [],
  });
} else {
  console.log("skip: no optional ODS fixture supplied");
}

console.log("import engine checks passed");
