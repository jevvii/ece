/**
 * Headless smoke check. Fails on any browser console error, page error or
 * failed request while walking the company-setup and employee-import flow.
 *
 *   node scripts/check-browser.mjs
 *   BASE_URL=http://localhost:3000 node scripts/check-browser.mjs
 *
 * Use `localhost`, not `127.0.0.1`: the Turbopack dev server rejects the HMR
 * websocket handshake when the page origin is the bare IP, which shows up as a
 * stream of console errors unrelated to the app.
 *
 * Requires a dev or start server already running.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CREDENTIALS = {
  email: process.env.CHECK_EMAIL ?? "maria@tala.ph",
  password: process.env.CHECK_PASSWORD ?? "payroll123",
};

function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const cache = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    const versions = readdirSync(cache)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const version of versions) {
      for (const candidate of [
        join(cache, version, "chrome-linux64", "chrome"),
        join(cache, version, "chrome-linux", "chrome"),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  for (const candidate of ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"]) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error("No Chromium found. Set CHROME_PATH.");
}

const problems = [];
let currentRoute = "startup";

function record(kind, text) {
  problems.push(`${currentRoute} · ${kind}: ${text}`);
}

const browser = await chromium.launch({
  executablePath: findChromium(),
  headless: true,
  args: ["--no-sandbox"],
});

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on("console", (message) => {
  if (message.type() === "error") record("console", message.text());
});
page.on("pageerror", (error) => record("pageerror", error.message));
page.on("requestfailed", (request) => {
  const failure = request.failure()?.errorText ?? "failed";
  if (!failure.includes("ERR_ABORTED")) record("request", `${request.url()} ${failure}`);
});

async function visit(path) {
  currentRoute = path;
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(250);
  return page.url();
}

async function signIn() {
  currentRoute = "sign-in";
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });

  if (page.url().includes("/sign-in")) {
    await page.getByLabel("Work email").fill(CREDENTIALS.email);
    await page.getByLabel("Password").fill(CREDENTIALS.password);

    // Submitting the form directly avoids racing the dev server's re-render,
    // which detaches the button mid-click.
    await page.locator("form").evaluate((form) => {
      if (form instanceof HTMLFormElement) form.requestSubmit();
    });

    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 });
  }
}

try {
  await signIn();

  for (const route of [
    "/",
    "/payroll",
    "/admin",
    "/admin/setup?step=1",
    "/admin/setup?step=2",
    "/admin/setup?step=3",
    "/admin/setup?step=4",
    "/admin/setup?step=5",
    "/admin/companies/new",
    "/admin/employees",
    "/payroll/time-report",
    "/payroll/computation",
    "/payroll/payslip",
    "/payroll/journal",
    "/payroll/leaves",
    "/payroll/annualization",
    "/payroll/2316",
  ]) {
    await visit(route);
  }

  // The importer itself: upload, map, preview — no save, so nothing is written.
  currentRoute = "import";
  await page.goto(`${BASE}/admin/setup?step=5`, { waitUntil: "networkidle" });
  await page.locator("summary", { hasText: "Import from a spreadsheet" }).click();
  await page.setInputFiles("#employee-file", "fixtures/employees-sample.csv");
  await page.getByRole("button", { name: "Read file" }).click();
  await page.getByText(/data rows found/).waitFor({ timeout: 30_000 });

  const addButton = page.getByRole("button", { name: /Add 3 rows to preview/ });
  await addButton.click();
  const firstCode = await page.getByLabel("Code row 1").inputValue();
  if (firstCode !== "EMP-1001") {
    throw new Error(`Expected the preview to start with EMP-1001, received "${firstCode}"`);
  }

  // Error highlighting: clearing a required date must mark the field and block saving.
  const hire = page.getByLabel("Hire date row 1");
  await hire.fill("");
  await page.waitForTimeout(150);
  if ((await hire.getAttribute("aria-invalid")) !== "true") {
    throw new Error("Clearing a hire date did not mark the field invalid");
  }
  const saveButton = page.getByRole("button", { name: /Save 3 employees/ });
  if (!(await saveButton.isDisabled())) {
    throw new Error("Save stayed enabled while a row was invalid");
  }
  await hire.fill("2026-01-05");
  await page.waitForTimeout(150);
  if ((await hire.getAttribute("aria-invalid")) !== null) {
    throw new Error("Field stayed invalid after it was corrected");
  }
  if (await saveButton.isDisabled()) {
    throw new Error("Save stayed disabled after the row was corrected");
  }

  // Columns must be readable; the table scrolls, so there is no reason to squeeze.
  const codeBox = await page.getByLabel("Code row 1").boundingBox();
  const nameBox = await page.getByLabel("Name row 1").boundingBox();
  const addressBox = await page.getByLabel("Address row 1").boundingBox();
  if (!codeBox || codeBox.width < 90) throw new Error(`Code column too narrow: ${codeBox?.width}px`);
  if (!nameBox || nameBox.width < 170) throw new Error(`Name column too narrow: ${nameBox?.width}px`);
  if (!addressBox || addressBox.width < 200) throw new Error(`Address column too narrow: ${addressBox?.width}px`);

  currentRoute = "done";
} catch (error) {
  record("script", error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}

if (problems.length > 0) {
  console.error(`FAILED with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("browser check OK: no console errors, page errors or failed requests");
