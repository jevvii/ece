/** Production-server regression check against local DB and a fake private storage API. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { chromium } from "playwright-core";
import { zipSync, strToU8 } from "fflate";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://ece@127.0.0.1:55432/ece_dev";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname), "local database only");
const sql = postgres(databaseUrl, { max: 1 });
const fileName = `upload-storage-test-${crypto.randomUUID()}.xlsx`;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const testKey = "synthetic-storage-test-key";
let allowed = ["text/csv", "application/vnd.oasis.opendocument.spreadsheet"];
const objects = new Map();
let updates = 0;
const storageErrors = [];
const storage = createServer(async (req, res) => {
  try {
  res.setHeader("Content-Type", "application/json");
  if (req.url.startsWith("/storage/v1/bucket/")) {
    if (req.method === "PUT") {
      let input = ""; for await (const chunk of req) input += chunk;
      const body = JSON.parse(input);
      assert.equal(body.public, false);
      assert.equal(body.file_size_limit, 10485760);
      allowed = body.allowed_mime_types; updates++;
    }
    return res.end(JSON.stringify({ public: false, allowed_mime_types: allowed, file_size_limit: 10485760 }));
  }
  if (req.method === "POST") {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (!allowed.includes(req.headers["content-type"])) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ statusCode: "415", error: "InvalidMimeType", message: `mime type ${XLSX} is not supported` }));
    }
    objects.set(req.url, Buffer.concat(chunks));
    return res.end(JSON.stringify({ Key: req.url }));
  }
  const file = objects.get(req.url);
  if (!file) { res.statusCode = 404; return res.end("{}"); }
  res.setHeader("Content-Type", XLSX); res.end(file);
  } catch (error) { storageErrors.push(error.message); res.statusCode = 500; res.end("{}"); }
});
await new Promise((resolve) => storage.listen(0, "127.0.0.1", resolve));
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const appPort = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const base = `http://localhost:${appPort}`;
const env = { ...process.env, NODE_ENV: "production", DATABASE_URL: databaseUrl, STORAGE_BACKEND: "supabase",
  SUPABASE_URL: `http://127.0.0.1:${storage.address().port}`, SUPABASE_SERVICE_ROLE_KEY: testKey, SUPABASE_STORAGE_BUCKET: "ece-uploads" };
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(appPort)], { env, stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "";
app.stdout.on("data", (chunk) => { serverOutput += chunk; }); app.stderr.on("data", (chunk) => { serverOutput += chunk; });
const cache = join(homedir(), ".cache/ms-playwright");
const candidates = readdirSync(cache).filter((x) => x.startsWith("chromium-")).reverse()
  .flatMap((v) => [join(cache, v, "chrome-linux64/chrome"), join(cache, v, "chrome-linux/chrome")]);
let browser;
try {
  const deadline = Date.now() + 45000;
  while (true) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (Date.now() > deadline || app.exitCode !== null) throw new Error("Production test server did not become ready");
    await delay(200);
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? candidates.find(existsSync), headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(); page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/sign-in`);
  await page.getByLabel("Work email").fill(process.env.CHECK_EMAIL ?? "maria@tala.ph");
  await page.getByLabel("Password").fill(process.env.CHECK_PASSWORD ?? "payroll123");
  await page.locator("form").evaluate((form) => form.requestSubmit());
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  await page.goto(`${base}/payroll/time-report`);
  const periodId = await page.locator("#periodId option").evaluateAll((entries) => entries.find((entry) => entry.value)?.value);
  assert.ok(periodId);
  await page.locator("#periodId").selectOption(periodId);
  const file = zipSync({
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Attendance" r:id="rId1"/></sheets></workbook>'),
    "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Employee Code</t></is></c><c r="B1"><v>11</v></c><c r="C1"><v>12</v></c><c r="D1"><v>13</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>TEST-UPLOAD</t></is></c><c r="B2"><v>8</v></c><c r="C2"><v>8</v></c><c r="D2"><v>8</v></c></row></sheetData></worksheet>'),
  });
  const chooseFile = () => page.setInputFiles("#file", { name: fileName, mimeType: XLSX, buffer: Buffer.from(file) });
  await chooseFile();
  await page.getByRole("alert").filter({ hasText: "This file type is temporarily unavailable" }).waitFor();
  assert.equal(await page.locator("#periodId").inputValue(), periodId, "selected cutoff survives a failed upload");
  assert.equal(await page.locator("#file").isEnabled(), true, "file selection stays usable after failure");
  const failed = await sql`select id from import_runs where file_name = ${fileName}`;
  assert.equal(failed.length, 0, "rejected files do not create import runs");
  assert.ok(serverOutput.includes('"event":"time_report_upload_failed"'));
  assert.ok(serverOutput.includes('"reason":"file_type_not_allowed"'));
  assert.ok(!serverOutput.includes(testKey), "logs never expose the service key");
  await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/configure-upload-storage.ts"], { env });
  assert.equal(updates, 1);
  assert.ok(allowed.includes(XLSX));
  await chooseFile();
  await page.waitForURL((url) => /^\/payroll\/time-report\/[a-f0-9-]+$/.test(url.pathname));
  await page.getByRole("button", { name: "Review mapping" }).waitFor();
  assert.deepEqual(errors, [], "upload failures must not crash the page");
  assert.deepEqual(storageErrors, [], "storage configuration preserves its constraints");
  const saved = await sql`select status from import_runs where file_name = ${fileName}`;
  assert.equal(saved[0]?.status, "mapping");
  console.log("storage browser check passed: MIME rejection stays in the upload flow; deployment fixes the allowlist; XLSX opens its preview on retry");
} finally {
  if (browser) await browser.close();
  app.kill("SIGTERM");
  await new Promise((resolve) => app.exitCode !== null ? resolve() : app.once("exit", resolve));
  await new Promise((resolve) => storage.close(resolve));
  await sql`delete from import_runs where file_name = ${fileName}`;
  await sql.end();
}
