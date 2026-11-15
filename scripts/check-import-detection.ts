import assert from "node:assert/strict";
import { detectMappingV2, getEditableMappingV2, validateMappingV2 } from "../src/lib/import/mapping-v2";
import type { Sheet } from "../src/lib/import/types";

const sheet = (rows: string[][]): Sheet => ({ name: "Attendance", rows: rows.map((row) => row.map((text) => ({ text, value: /^\d+(\.\d+)?$/.test(text) ? Number(text) : null }))) });
const cases = [
  {
    name: "multi-row ODS header with Employee ID Number",
    sheet: sheet([["Example company"], [], [], [], ["", "", "", "26", "27", "28"], ["", "", "", "MON", "TUE", "WED"], ["", "EMPLOYEE ID NUMBER", "EXAMPLE COMPANY INC."], ["", "STAFF-A1", "Rivera, Alex", "8", "8", "8"], ["", "STAFF-A2", "Cruz, Sam", "8", "8", "8"]]),
    expected: { headerRow: 6, dataStartRow: 7, employeeCode: 1, employeeName: 2, dayStart: 3, dayEnd: 5 },
  },
  {
    name: "no name column must not assign the first date as a name",
    sheet: sheet([["Employee Code", "26", "27", "28"], ["STAFF-A1", "8", "8", "8"], ["STAFF-A2", "7", "8", "8"]]),
    expected: { headerRow: 0, dataStartRow: 1, employeeCode: 0, employeeName: null, dayStart: 1, dayEnd: 3 },
  },
  {
    name: "code-only exports can use alphabetic codes after blank rows",
    sheet: sheet([["Code", "26", "27", "28"], ["", "", "", ""], ["ALPHA", "8", "8", "8"]]),
    expected: { headerRow: 0, dataStartRow: 2, employeeCode: 0, employeeName: null, dayStart: 1, dayEnd: 3 },
  },
  {
    name: "name can appear before employee code",
    sheet: sheet([["Employee Name", "Employee Code", "26", "27", "28"], ["Rivera, Alex", "STAFF-A1", "8", "8", "8"]]),
    expected: { headerRow: 0, dataStartRow: 1, employeeCode: 1, employeeName: 0, dayStart: 2, dayEnd: 4 },
  },
  {
    name: "unrecognized identity columns must not fall back to date values",
    sheet: sheet([["26", "27", "28"], ["8", "8", "8"], ["7", "8", "8"]]),
    expected: { headerRow: 0, dataStartRow: 1, employeeCode: null, employeeName: null, dayStart: 0, dayEnd: 2 },
  },
  {
    name: "date-label rows below the employee header remain eligible",
    sheet: sheet([["Employee Code", "Name"], ["Date", "", "26", "27", "28"], ["", "", "MON", "TUE", "WED"], ["STAFF-A1", "Rivera, Alex", "8", "8", "8"]]),
    expected: { headerRow: 0, dataStartRow: 3, employeeCode: 0, employeeName: 1, dayStart: 2, dayEnd: 4 },
  },
  {
    name: "attendance values cannot win over a shorter date header",
    sheet: sheet([["Employee Code", "Name", "26", "27", "28", "ROT", "SAT", "SUN"], ["STAFF-A1", "Rivera, Alex", "1", "2", "3", "4", "5", "6"], ["STAFF-A2", "Cruz, Sam", "7", "8", "8", "0", "0", "0"]]),
    expected: { headerRow: 0, dataStartRow: 1, employeeCode: 0, employeeName: 1, dayStart: 2, dayEnd: 4 },
  },
];
const failures: string[] = [];
for (const entry of cases) {
  try {
    const result = detectMappingV2(entry.sheet);
    for (const [key, value] of Object.entries(entry.expected)) assert.equal(result[key as keyof typeof result], value, key);
    if (result.employeeCode != null) assert.equal(validateMappingV2(result, entry.sheet), null, "auto-detected roles must not conflict");
  } catch (error) { failures.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const premiumSheet = sheet([["Employee Code", "Name", "26", "27", "28", "ROT calculated hours"], ["STAFF-A1", "Rivera, Alex", "8", "8", "8", "2"]]);
try {
  const result = detectMappingV2(premiumSheet);
  assert.deepEqual(result.buckets.ROT, [5]);
  assert.equal(result.periodLate, null, "calculated premium is not period lateness");
  assert.equal(validateMappingV2(result, premiumSheet), null);
} catch (error) { failures.push(`premium column must have one role: ${error instanceof Error ? error.message : String(error)}`); }
assert.deepEqual(failures, [], failures.join("\n"));
const referenceShape = cases[0]!;
const wrongStored = { ...detectMappingV2(referenceShape.sheet), headerRow: 4, dataStartRow: 5, employeeCode: 4, employeeName: 5 };
const recovered = getEditableMappingV2(referenceShape.sheet, wrongStored);
assert.equal(recovered.employeeCode, 1, "existing broken preview is detected again");
assert.equal(recovered.headerRow, 6, "recovered header is shared by review and confirmation");
assert.equal(recovered.dataStartRow, 7);
const manual = { ...recovered, dataStartRow: 8, dayUnits: { "3": "minutes" as const } };
assert.equal(getEditableMappingV2(referenceShape.sheet, manual), manual, "valid user mapping is preserved");

console.log("import detection checks passed");
