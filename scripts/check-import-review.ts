import assert from "node:assert/strict";
import { parseEmployeeWorkbook } from "../src/lib/employees/parse-file";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { parseTimeReportFile } from "../src/lib/import/parse-file";
import { applyMappingV2, type MappingV2 } from "../src/lib/import/apply-v2";
import { detectMappingV2 } from "../src/lib/import/mapping-v2";
import { validateMappingV2 } from "../src/lib/import/review";

const mapping: MappingV2 = {
  version: 2, sheetName: "Attendance", mode: "days", headerRow: 0, dataStartRow: 1,
  employeeCode: 0, employeeName: null, dayStart: 1, dayEnd: 1, dayUnits: {},
  buckets: {}, periodLate: null, ignored: [], signature: "test", notes: [],
};
const bytes = strToU8('Code;26\nEXT-1;"1,200"');
const sheet = parseTimeReportFile(bytes, "attendance.csv");
assert.equal(detectMappingV2(parseTimeReportFile(strToU8("Code,Name,26,27,28\nE1,Jane,8,8,8"), "attendance.csv")).employeeCode, 0, "a Code header works with one employee");
assert.equal(sheet.rows[1]?.[1]?.value, 1200, "delimiter and numeric values are preserved");
assert.throws(() => parseTimeReportFile(strToU8("not a zip"), "attendance.xlsx"), /archive/);
assert.throws(() => parseTimeReportFile(strToU8(""), "attendance.csv"), /empty/);
const xlsx = zipSync({
  "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Attendance" r:id="rId1"/></sheets></workbook>'),
  "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Code</t></is></c><c r="B1"><v>26</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>E1</t></is></c><c r="B2"><v>8</v></c></row></sheetData></worksheet>'),
});
assert.equal(parseTimeReportFile(xlsx, "attendance.xlsx").rows[1]?.[1]?.value, 8);
const farRow = unzipSync(xlsx);
farRow["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(farRow["xl/worksheets/sheet1.xml"]!).replace("</sheetData>", '<row r="6001"><c r="A6001" t="inlineStr"><is><t>E2</t></is></c></row></sheetData>'));
assert.throws(() => parseTimeReportFile(zipSync(farRow), "large.xlsx"), /rows/, "data beyond the reader limit must never disappear silently");

assert.throws(() => parseTimeReportFile(strToU8(`Code,26\n${"E1,8\n".repeat(501)}`), "large.csv"), /500/);
assert.throws(() => parseEmployeeWorkbook(strToU8(`Code,Name\n${"E1,Jane\n".repeat(501)}`), "large.csv"), /500/, "employee roster overflow is rejected instead of truncated");
assert.match(validateMappingV2({ ...mapping, dataStartRow: 3 }, sheet) ?? "", /data row/);
assert.match(validateMappingV2({ ...mapping, employeeCode: 5 }, sheet) ?? "", /outside/);
assert.match(validateMappingV2({ ...mapping, employeeCode: 1 }, sheet) ?? "", /more than one/);
const employee = { id: "e1", employeeCode: "E1", lastName: "Doe", firstName: "Jane" };
const input = {
  sheet: parseTimeReportFile(strToU8("Code,26\nEXT-1,8\nE1,8"), "attendance.csv"), mapping,
  period: { coverageStart: "2026-10-26", coverageEnd: "2026-10-26" },
  employees: [employee], externalIds: [{ code: "EXT-1", employeeId: "e1" }], schedules: {},
};
const result = applyMappingV2(input);
assert.equal(result.days.length, 1, "reviewed alias includes the employee immediately");
assert.equal(result.blockingIssueCount, 1, "duplicate alias and canonical code blocks saving");
const corrected = applyMappingV2({ ...input, mapping: { ...mapping, dataStartRow: 2 } });
assert.equal(corrected.blockingIssueCount, 0, "chosen data start excludes the duplicate");
const negative = applyMappingV2({ ...input, sheet: parseTimeReportFile(strToU8("Code,26\nE1,-1"), "attendance.csv") });
assert.ok(negative.blockingIssueCount > 0, "negative hours block import");
const capped = applyMappingV2({ ...input, sheet: { name: "test", rows: [input.sheet.rows[0]!, ...Array.from({ length: 450 }, () => input.sheet.rows[1]!)] } });
assert.equal(capped.issues.length, 300);
assert.equal(capped.blockingIssueCount, 449, "issue cap cannot hide blocking conflicts");
for (const [value, mode] of [["-5", "late"], ["99999", "late"], ["HD=99999", "days"]] as const) {
  const invalid = applyMappingV2({ ...input, mapping: { ...mapping, mode }, schedules: { e1: { 1: 8 } },
    sheet: parseTimeReportFile(strToU8(`Code,26\nE1,${value}`), "attendance.csv") });
  assert.ok(invalid.blockingIssueCount > 0, `${value} in ${mode} mode blocks importing`);
}
const invalidPremium = applyMappingV2({ ...input, mapping: { ...mapping, buckets: { ROT: [2] } },
  sheet: parseTimeReportFile(strToU8("Code,26,ROT\nE1,8,oops"), "attendance.csv") });
assert.ok(invalidPremium.blockingIssueCount > 0, "non-numeric premium cannot be silently discarded");

const namedMapping = { ...mapping, employeeName: 1, dayStart: 2, dayEnd: 2 };
function matchRow(code: string, name: string, employees = [employee], externalIds = input.externalIds) {
  return applyMappingV2({ ...input, employees, externalIds, mapping: namedMapping,
    sheet: parseTimeReportFile(strToU8(`Code,Name,26\n${code},"${name}",8`), "attendance.csv") });
}
for (const name of ["  jane   DOE ", " doe ,  Jane "]) {
  const matched = matchRow("EXPORT-1", name);
  assert.equal(matched.days[0]?.employeeId, employee.id, "unique full names match despite case and whitespace differences");
  assert.equal(matched.blockingIssueCount, 0);
}
assert.equal(matchRow("", "Jane Doe").days[0]?.employeeId, employee.id, "a unique full name can match a blank source code");
assert.equal(matchRow("EXPORT-1", "Jane").matchedEmployees, 0, "partial names never auto-match");
assert.equal(matchRow("EXPORT-1", "Jane Do").matchedEmployees, 0, "approximate names never auto-match");
assert.equal(matchRow("EXPORT-1", "Jane Doe", []).matchedEmployees, 0, "only the selected company's roster is eligible");
const namesake = { ...employee, id: "e2", employeeCode: "E2" };
const ambiguous = matchRow("EXPORT-1", "Jane Doe", [employee, namesake]);
assert.equal(ambiguous.matchedEmployees, 0, "duplicate full names require an explicit match");
assert.deepEqual(ambiguous.unknownCodes, ["EXPORT-1"]);
assert.ok(ambiguous.blockingIssueCount > 0);
assert.equal(matchRow("E2", "Jane Doe", [employee, namesake]).days[0]?.employeeId, "e2", "canonical codes take precedence over ambiguous names");
assert.equal(matchRow("EXT-1", "Jane Doe", [employee, namesake]).days[0]?.employeeId, "e1", "saved aliases take precedence over names");
assert.equal(matchRow("EXPORT-1", "Jane Doe", [employee, namesake], [{ code: "EXPORT-1", employeeId: "e2" }]).days[0]?.employeeId, "e2", "reviewed aliases resolve ambiguous names");
assert.equal(matchRow("E1", "Jane Doe", [employee], [{ code: "E1", employeeId: "e2" }]).days[0]?.employeeId, "e1", "an alias cannot override a canonical code");
assert.equal(matchRow("FOREIGN", "Unknown Person", [employee], [{ code: "FOREIGN", employeeId: "outside-company" }]).matchedEmployees, 0, "foreign aliases cannot resolve an employee outside this company");
const collision = matchRow("E1", "Jane Doe", [employee, { ...namesake, employeeCode: " e1 " }]);
assert.equal(collision.matchedEmployees, 0, "normalized code collisions cannot silently pick an employee");
assert.ok(collision.blockingIssueCount > 0);
for (const [mode, unit, value, hours, late] of [
  ["days", "hours", 8, 8, 0], ["days", "minutes", 480, 8, 0],
  ["late", "hours", 0.5, 7.5, 30], ["late", "minutes", 30, 7.5, 30],
] as const) {
  const applied = applyMappingV2({ ...input, schedules: { e1: { 1: 8 } },
    mapping: { ...mapping, mode, dayUnits: { "1": unit }, buckets: { ROT: [2, 3] }, periodLate: { index: 4, unit: "minutes" } },
    sheet: parseTimeReportFile(strToU8(`Code,26,ROT,ROT,Total late\nE1,${value},2,0.25,30`), "attendance.csv") });
  assert.equal(applied.blockingIssueCount, 0, `${mode}/${unit} accepts consistent totals`);
  assert.equal(applied.days[0]?.hours, hours);
  assert.equal(applied.days[0]?.lateMinutes, late);
  assert.equal(applied.buckets[0]?.hours, 2.25, "special pays remain accumulated hours in every date mode");
  assert.equal(applied.totals.reduce((sum, total) => sum + total.minutes, 0) + late, 30, "cutoff lateness is counted once");
}
const lateMapping: MappingV2 = { ...mapping, mode: "late", dayEnd: 2,
  dayUnits: { "1": "minutes", "2": "hours" }, periodLate: { index: 3, unit: "hours" } };
const reconcile = (summary: string) => applyMappingV2({ ...input, mapping: lateMapping,
  schedules: { e1: { 1: 8, 2: 8 } }, period: { ...input.period, coverageEnd: "2026-10-27" },
  sheet: parseTimeReportFile(strToU8(`Code,26,27,Total late\nE1,30,0.5,${summary}`), "attendance.csv") });
assert.equal(reconcile("1").blockingIssueCount, 0, "daily late units and cutoff total units convert independently");
assert.deepEqual(reconcile("1").totals, [], "a reconciled total isn't persisted as additional lateness");
assert.ok(reconcile("2").issues.some((issue) => issue.kind === "total_mismatch"), "inconsistent cutoff totals block saving");
assert.ok(reconcile("0").blockingIssueCount > 0, "explicit zero total must also reconcile");
assert.equal(reconcile("").blockingIssueCount, 0, "an empty optional total does not invent a mismatch");
console.log("import review checks passed");
