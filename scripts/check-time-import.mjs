/** Local-only integration check. Creates synthetic runs and removes its own records. */
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { zipSync, strToU8 } from "fflate";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://ece@127.0.0.1:55432/ece_dev";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname), "Run against a local database only");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(BASE).hostname), "Run against the local app only");
const sql = postgres(databaseUrl, { max: 1 });
const namespace = `import-check-${crypto.randomUUID()}`;
const alias = `TEST-${crypto.randomUUID()}`.toUpperCase();
let payrollId = null;
const problems = [];
const cache = join(homedir(), ".cache/ms-playwright");
const candidates = existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith("chromium-")).reverse()
  .flatMap((version) => [join(cache, version, "chrome-linux64/chrome"), join(cache, version, "chrome-linux/chrome")]) : [];
const executablePath = process.env.CHROME_PATH ?? [...candidates, "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(60_000);
page.on("pageerror", (error) => problems.push(error.message));
page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Work email").fill(process.env.CHECK_EMAIL ?? "maria@tala.ph");
  await page.getByLabel("Password").fill(process.env.CHECK_PASSWORD ?? "payroll123");
  await page.locator("form").evaluate((form) => form.requestSubmit());
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  await page.goto(`${BASE}/payroll/time-report`, { waitUntil: "networkidle" });
  const options = await page.locator("#periodId option").evaluateAll((entries) => entries.map((entry) => ({ value: entry.value, text: entry.textContent })));
  const option = options.find((entry) => entry.text?.includes("Oct 26") && entry.text?.includes("Nov 10"));
  assert.ok(option, "demo calendar includes the sample cutoff");
  const [period] = await sql`select p.*, c.tenant_id from payroll_periods p join payroll_calendars c on c.id = p.calendar_id where p.id = ${option.value}`;
  const [employee] = await sql`select * from employees where tenant_id = ${period.tenant_id} and schedule_id is not null order by employee_code limit 1`;
  assert.ok(employee, "a scheduled demo employee exists");
  const activeBefore = await sql`select id from import_runs where period_id = ${period.id} and status = 'imported'`;
  assert.equal(activeBefore.length, 0, "test cutoff must have no existing attendance; use a clean local demo cutoff");

  async function upload(suffix, contents, kind = "csv") {
    await page.goto(`${BASE}/payroll/time-report`, { waitUntil: "networkidle" });
    await page.locator("#periodId").selectOption(period.id);
    await page.setInputFiles("#file", { name: `${namespace}-${suffix}.${kind}`, mimeType: kind === "ods" ? "application/vnd.oasis.opendocument.spreadsheet" : "text/csv", buffer: Buffer.from(contents) });
    await page.waitForURL((url) => /^\/payroll\/time-report\/[a-f0-9-]+$/.test(url.pathname));
    const id = page.url().split("/").pop();
    await page.getByRole("button", { name: "Review mapping" }).waitFor();
    assert.equal(await page.getByText("Step 1 of 3 · Detect").count(), 0, "no artificial delay screen");
    return id;
  }

  // Match the reference ODS layout using invented header text and employee names.
  const odsRows = [["EXAMPLE COMPANY INC."], [], [], [], ["", "", "", "26", "27", "28"],
    ["", "", "", "MON", "TUE", "WED"], ["", "EMPLOYEE ID NUMBER", "EXAMPLE COMPANY INC."],
    ["", employee.employee_code, "Synthetic employee", "8", "8", "8"]];
  const escapeXml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const ods = zipSync({ "content.xml": strToU8(`<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="Attendance">${odsRows.map((row) => `<table:table-row>${row.map((value) => `<table:table-cell><text:p>${escapeXml(value)}</text:p></table:table-cell>`).join("")}</table:table-row>`).join("")}</table:table></office:spreadsheet></office:body></office:document-content>`) });
  const odsId = await upload("multi-header", ods, "ods");
  const [odsRun] = await sql`select mapping from import_runs where id = ${odsId}`;
  assert.equal(odsRun.mapping.headerRow, 6);
  assert.equal(odsRun.mapping.dataStartRow, 7);
  assert.equal(odsRun.mapping.employeeCode, 1);
  assert.equal(odsRun.mapping.employeeName, 2);
  // A bad mapping saved by the previous detector must recover when reopened.
  await sql`update import_runs set mapping = ${sql.json({ ...odsRun.mapping, headerRow: 4, dataStartRow: 5, employeeCode: 4, employeeName: 5 })} where id = ${odsId}`;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Column settings", { exact: true }).click();
  assert.equal(await page.getByLabel("First data row", { exact: true }).inputValue(), "8");
  assert.equal(await page.getByLabel("Employee code", { exact: true }).inputValue(), "1");
  assert.equal(await page.getByLabel("Employee name", { exact: true }).inputValue(), "2");
  await page.getByRole("button", { name: "Review mapping" }).click();
  assert.equal(await page.getByRole("button", { name: "Confirm and import", exact: true }).isDisabled(), false);
  await upload("code-only", `Employee Code,26,27,28\n${employee.employee_code},8,8,8`);
  await page.getByRole("button", { name: "Review mapping" }).click();
  assert.equal(await page.getByRole("button", { name: "Confirm and import", exact: true }).isDisabled(), false);
  console.log("multi-row ODS, existing preview recovery, and code-only detection passed");

  const runId = await upload("alias", `Code,Name,26,27,28\nIGNORE,Not attendance,8,8,8\n${alias},Synthetic employee,0,60,0`);
  await page.getByText("Column settings", { exact: true }).click();
  await page.getByLabel("First data row", { exact: true }).fill("3");
  await page.getByRole("radio", { name: "Lateness", exact: true }).click();
  await page.getByRole("button", { name: "Review mapping" }).click();
  const confirm = page.getByRole("button", { name: "Confirm and import", exact: true });
  assert.ok(await confirm.isDisabled(), "unknown employee blocks importing");
  assert.equal(await page.getByLabel("Match employee IGNORE", { exact: true }).count(), 0, "selected data start excludes the note row");
  await page.getByLabel(`Match employee ${alias}`, { exact: true }).selectOption(employee.id);
  assert.equal(await confirm.isDisabled(), false, "reviewed match recalculates attendance immediately");
  const previewCells = await page.locator("table tbody tr").first().locator("td").allTextContents();
  const previewHours = Number(previewCells[3]);
  const previewLate = Number(previewCells[4]);
  assert.equal(previewLate, 60, "late mode uses minutes");
  await page.screenshot({ path: "/tmp/ece-time-review-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/ece-time-review-mobile.png", fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "review fits a mobile viewport");
  await page.setViewportSize({ width: 1440, height: 900 });
  await confirm.click();
  await page.getByRole("heading", { name: "Attendance grid", exact: true }).waitFor();
  const [saved] = await sql`select status, mapping from import_runs where id = ${runId}`;
  assert.equal(saved.status, "imported");
  assert.equal(saved.mapping.dataStartRow, 2, "data start persists");
  const [totals] = await sql`select count(*)::int as count, sum(hours)::float as hours, sum(late_minutes)::int as late from attendance_days where run_id = ${runId}`;
  assert.equal(totals.count, 3, "new alias attendance is included on the first confirmation");
  assert.equal(totals.hours, previewHours, "preview hours equal persisted hours");
  assert.equal(totals.late, previewLate, "preview lateness equals persisted lateness");

  console.log("preview/save parity passed");
  await upload("saved-alias", `Code,Name,26,27,28\n${alias},Synthetic employee,8,8,8`);
  await page.getByRole("button", { name: "Review mapping" }).click();
  assert.equal(await page.getByLabel(`Match employee ${alias}`, { exact: true }).count(), 0, "saved aliases match automatically");
  assert.match(await page.locator("table tbody").innerText(), new RegExp(employee.employee_code), "saved alias appears in review");

  assert.ok(await confirm.isDisabled(), "replacing a cutoff requires explicit confirmation");
  await page.getByLabel("Replace the previous attendance import", { exact: false }).check();
  assert.equal(await confirm.isDisabled(), false);
  await confirm.click();
  await page.getByRole("heading", { name: "Attendance grid", exact: true }).waitFor();
  const [previous] = await sql`select status from import_runs where id = ${runId}`;
  assert.equal(previous.status, "superseded", "the previous import stays in history");
  const active = await sql`select id from import_runs where period_id = ${period.id} and status = 'imported'`;
  assert.equal(active.length, 1, "one attendance import is active per cutoff");
  console.log("saved alias matched; explicit replacement preserved history");
  await upload("duplicate", `Code,Name,26,27,28\n${alias},Synthetic employee,8,8,8\n${employee.employee_code},Synthetic duplicate,8,8,8`);
  await page.getByRole("button", { name: "Review mapping" }).click();
  assert.ok(await confirm.isDisabled(), "duplicate employee via two codes blocks importing");
  assert.ok(await page.getByText(/Employee appears more than once/).count());
  const [existingPayroll] = await sql`select id from pay_runs where period_id = ${period.id} and tenant_id = ${period.tenant_id}`;
  assert.equal(existingPayroll, undefined, "the synthetic test must not replace existing payroll");
  payrollId = crypto.randomUUID();
  await sql`insert into pay_runs(id,tenant_id,period_id,cutoff_no,cycle_label,status,assumptions,issues,totals)
    values(${payrollId},${period.tenant_id},${period.id},${period.cutoff_no},${period.cycle_label},'calculated',${sql.json({ attendanceRun: runId })},'[]','{}')`;
  await page.goto(`${BASE}/payroll/computation/${payrollId}`, { waitUntil: "networkidle" });
  await page.locator('input[name="acknowledge"]').check();
  await page.getByRole("button", { name: "Approve and freeze", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Attendance was replaced" }).waitFor();
  const [unapproved] = await sql`select status from pay_runs where id = ${payrollId}`;
  assert.equal(unapproved.status, "calculated", "payroll based on replaced attendance cannot be approved");
  const lockedId = await upload("locked", `Code,Name,26,27,28\n${employee.employee_code},Synthetic employee,8,8,8`);
  await page.getByRole("button", { name: "Review mapping" }).click();
  await page.getByLabel("Replace the previous attendance import", { exact: false }).check();
  assert.equal(await confirm.isDisabled(), false, "replacement is ready before payroll approval");
  // Simulate approval in another session while this officer has the review open.
  await sql`update pay_runs set status = 'approved' where id = ${payrollId}`;
  await confirm.click();
  await page.getByRole("alert").filter({ hasText: "Payroll is approved" }).waitFor();
  await page.getByRole("button", { name: "Review mapping" }).click();
  assert.ok(await confirm.isDisabled(), "approved payroll blocks attendance edits in the UI");
  const [lockedRun] = await sql`select status from import_runs where id = ${lockedId}`;
  assert.equal(lockedRun.status, "mapping", "server also rejects attendance changes after approval");
  assert.deepEqual(problems, [], "no browser errors");
  console.log("time import browser check passed: automatic upload, matching, schedules, first data row, duplicate blocking, and preview/save parity");
} catch (error) {
  await page.screenshot({ path: "/tmp/ece-time-import-failure.png", fullPage: true });
  console.error("Failed at", page.url(), (await page.locator("body").innerText()).slice(-1500));
  throw error;
} finally {
  await browser.close();
  if (payrollId) await sql`delete from pay_runs where id = ${payrollId}`;
  const owned = await sql`select id, tenant_id, storage_key, profile_id, file_kind from import_runs where file_name like ${`${namespace}%`}`;
  for (const row of owned) {
    await sql`delete from import_runs where id = ${row.id}`;
    if (row.profile_id) await sql`delete from import_profiles where id = ${row.profile_id}`;
    const key = `${row.tenant_id}/${row.id}.${row.file_kind}`;
    if (row.storage_key === key) await unlink(join(process.cwd(), ".data/uploads", key)).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
  await sql`delete from employee_external_ids where code = ${alias}`;
  await sql.end();
}
