import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import {
  attendanceBuckets,
  attendanceDays,
  employees,
  importRuns,
  payrollPeriods,
} from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { parseCsv } from "@/lib/import/csv";
import { parseOds } from "@/lib/import/ods";
import { readUpload } from "@/lib/import/storage";
import { dayUnitLabel, type DetectedMapping, type ImportIssue, type Sheet, type Unit } from "@/lib/import/types";
import { formatRange } from "@/lib/periods";
import { confirmImport } from "../actions";

const roleOptions: Array<[string, string]> = [
  ["ignore", "Ignore"],
  ["employee_code", "Employee code"],
  ["employee_name", "Employee name"],
  ["day", "Day hours"],
  ["bucket", "Premium bucket"],
  ["total", "Source total"],
];

const issueKindLabel: Record<string, string> = {
  unknown_employee: "Unknown code",
  duplicate_employee: "Duplicate",
  non_numeric: "Not a number",
  half_day_annotation: "Half-day note",
  out_of_period: "Outside cutoff",
  implausible_hours: "Implausible hours",
  no_days: "No days",
  total_mismatch: "Total mismatch",
};

function dateForDay(day: number, start: string, end: string) {
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    if (cursor.getUTCDate() === day) return cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return null;
}

export default async function TimeReportRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { runId } = await params;
  const { error } = await searchParams;
  const { tenant } = await requireWorkspace();

  const [run] = await db
    .select()
    .from(importRuns)
    .where(and(eq(importRuns.id, runId), eq(importRuns.tenantId, tenant.id)))
    .limit(1);

  if (!run) notFound();

  const [period] = run.periodId
    ? await db.select().from(payrollPeriods).where(eq(payrollPeriods.id, run.periodId)).limit(1)
    : [];

  const mapping = run.mapping as unknown as DetectedMapping;
  const issues = (run.issues ?? []) as ImportIssue[];
  const isImported = run.status === "imported";

  const employeeRows = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      lastName: employees.lastName,
      firstName: employees.firstName,
    })
    .from(employees)
    .where(eq(employees.tenantId, tenant.id))
    .orderBy(asc(employees.employeeCode));

  let samples: Record<number, string> = {};
  let sheetData: Sheet | null = null;

  if (!isImported && run.storageKey) {
    try {
      const bytes = await readUpload(run.storageKey);
      const sheet =
        run.fileKind === "ods"
          ? parseOds(new Uint8Array(bytes))
          : parseCsv(new TextDecoder().decode(bytes));
      sheetData = sheet;

      samples = Object.fromEntries(
        mapping.columns.map((column) => {
          for (let row = mapping.dataStartRow; row < mapping.dataStartRow + 6; row += 1) {
            const text = sheet.rows[row]?.[column.index]?.text?.trim();
            if (text) return [column.index, text.slice(0, 24)];
          }
          return [column.index, ""];
        }),
      );
    } catch {
      samples = {};
    }
  }

  const unknownIssues = issues.filter((issue) => issue.kind === "unknown_employee");
  const unknownCodes = [...new Set(unknownIssues.map((issue) => issue.code ?? ""))].filter(Boolean);
  const nameColumn = mapping.columns.find((column) => column.role === "employee_name");
  const unknownDetails = unknownCodes.map((code) => {
    const issue = unknownIssues.find((candidate) => candidate.code === code);
    const row = sheetData && issue ? sheetData.rows[issue.row - 1] : undefined;
    const name = nameColumn && row ? (row[nameColumn.index]?.text ?? "") : "";
    return { code, name };
  });

  const dayRows = isImported
    ? await db
        .select({
          day: attendanceDays,
          employeeCode: employees.employeeCode,
          lastName: employees.lastName,
          firstName: employees.firstName,
        })
        .from(attendanceDays)
        .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
        .where(eq(attendanceDays.runId, run.id))
        .orderBy(asc(employees.employeeCode), asc(attendanceDays.workDate))
    : [];

  const bucketRows = isImported
    ? await db
        .select({
          code: attendanceBuckets.code,
          hours: sql<string>`sum(${attendanceBuckets.hours})`,
          employees: sql<number>`count(distinct ${attendanceBuckets.employeeId})::int`,
        })
        .from(attendanceBuckets)
        .where(eq(attendanceBuckets.runId, run.id))
        .groupBy(attendanceBuckets.code)
        .orderBy(asc(attendanceBuckets.code))
    : [];

  const dayColumns = mapping.columns
    .flatMap((column) => {
      if (column.role !== "day" || !column.day || !period) return [];
      const date = dateForDay(column.day, period.coverageStart, period.coverageEnd);
      return date ? [{ ...column, date }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const grid = new Map<string, { code: string; name: string; hours: Map<string, number>; total: number }>();
  for (const row of dayRows) {
    const key = row.day.employeeId;
    const entry =
      grid.get(key) ?? {
        code: row.employeeCode,
        name: `${row.lastName}, ${row.firstName}`,
        hours: new Map<string, number>(),
        total: 0,
      };
    const hours = Number(row.day.hours);
    entry.hours.set(row.day.workDate, hours);
    entry.total += hours;
    grid.set(key, entry);
  }

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / Time Report / Import" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/payroll/time-report" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Time Report
        </Link>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              {run.fileKind.toUpperCase()} · {mapping.sheetName}
            </p>
            <h1 className="mt-4 font-serif text-[clamp(2.25rem,4.5vw,3rem)] leading-[1.04] tracking-[-0.03em]">
              Time report
            </h1>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
              <span className="max-w-[34ch] truncate font-mono text-[12.5px] text-muted">{run.fileName}</span>
              <span className="text-rule-strong" aria-hidden="true">·</span>
              <span>
                {mapping.companyName ? `${mapping.companyName} · ` : ""}
                {period
                  ? `${period.cycleLabel} · cutoff ${period.cutoffNo} · ${formatRange(period.coverageStart, period.coverageEnd)}`
                  : "No cutoff attached"}
              </span>
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Status</p>
            <p className={`mt-1 text-[12.5px] uppercase tracking-[0.08em] ${isImported ? "text-accent" : "text-warn"}`}>
              {isImported ? "Imported" : run.status === "review" ? "Needs review" : "Mapping"}
            </p>
            <p className="figure mt-1 text-[12px] text-muted">
              {run.rowCount} rows · {dayRows.length} day records
            </p>
          </div>
        </div>

        {error ? (
          <div role="alert" className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {decodeURIComponent(error)}
          </div>
        ) : null}

        {!isImported ? (
          <>
            <div className="mt-7 rounded-[10px] border border-rule-strong bg-surface px-4 py-3">
              <p className="text-[12.5px] leading-[1.6] text-ink-2">
                {mapping.notes.join(" ")} Columns were proposed from the header — check the
                employee code, day columns and units before importing.
              </p>
            </div>

            {unknownCodes.length > 0 ? (
              <section id="resolve" className="mt-6 border border-[#e8c98a] bg-[#fbf3db] p-5">
                <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-[#956400]">
                  Unbound employee codes · {unknownCodes.length}
                </h2>
                <p className="mt-1.5 max-w-[70ch] text-[12.5px] leading-[1.6] text-[#7a5a14]">
                  These codes are not in the employee master, and names never create an employee.
                  Bind each one once; the binding is saved for later cutoffs.
                </p>
                <div className="mt-4 max-h-[320px] overflow-auto rounded-[14px] border border-rule bg-surface">
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 bg-surface">
                      <tr className="border-b border-rule">
                        <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Code</th>
                        <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Name in file</th>
                        <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Bind to employee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unknownDetails.slice(0, 60).map((detail, index) => (
                        <tr key={detail.code} className="border-b border-rule last:border-b-0">
                          <td className="figure px-3 py-2 text-[12.5px]">{detail.code}</td>
                          <td className="max-w-[240px] truncate px-3 py-2 text-[12.5px] text-ink-2" title={detail.name}>
                            {detail.name || "—"}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              name={`alias-${index}`}
                              form="mapping-form"
                              defaultValue=""
                              className="h-8 w-full rounded-[10px] border border-rule-strong bg-surface px-1.5 text-[12.5px]"
                            >
                              <option value="">Leave unbound</option>
                              {employeeRows.map((employee) => (
                                <option key={employee.id} value={employee.id}>
                                  {employee.employeeCode} · {employee.lastName}, {employee.firstName}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <form id="mapping-form" action={confirmImport} className="mt-6">
              <input type="hidden" name="runId" value={run.id} />
              <input type="hidden" name="unknownCount" value={unknownCodes.length} />
              {unknownCodes.slice(0, 60).map((code, index) => (
                <input key={code} type="hidden" name={`unknownCode-${index}`} value={code} />
              ))}

              <div className="grid gap-4 rounded-[14px] border border-rule bg-surface p-5 sm:grid-cols-3">
                <div>
                  <label htmlFor="dayUnit" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Day values are
                  </label>
                  <select
                    id="dayUnit"
                    name="dayUnit"
                    defaultValue={mapping.suggestedUnit}
                    className="mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[13.5px]"
                  >
                    {(Object.keys(dayUnitLabel) as Unit[]).map((unit) => (
                      <option key={unit} value={unit}>{dayUnitLabel[unit]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="profileName" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Save profile as
                  </label>
                  <input
                    id="profileName"
                    name="profileName"
                    defaultValue={`${mapping.sheetName} · ${mapping.signature}`}
                    className="mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-3 text-[13.5px]"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    className="h-10 w-full rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors hover:brightness-95"
                  >
                    Confirm mapping and import
                  </button>
                </div>
              </div>

              <div className="mt-6 rounded-[14px] border border-rule bg-surface">
                <div className="flex items-center justify-between border-b border-rule px-4 py-3">
                  <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Column mapping</h2>
                  <span className="figure text-[12px] text-muted">{mapping.columns.length} columns</span>
                </div>
                <div className="max-h-[560px] overflow-auto">
                  <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 bg-surface">
                      <tr className="border-b border-rule">
                        {["#", "Header", "Sample", "Role", "Code / day"].map((heading) => (
                          <th key={heading} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mapping.columns.map((column) => (
                        <tr key={column.index} className="border-b border-rule last:border-b-0">
                          <td className="figure px-3 py-2 text-[11.5px] text-muted">{column.index}</td>
                          <td className="max-w-[280px] truncate px-3 py-2 text-[12.5px]" title={column.header}>
                            {column.header}
                          </td>
                          <td className="figure max-w-[150px] truncate px-3 py-2 text-[12px] text-muted">
                            {samples[column.index] ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              name={`role-${column.index}`}
                              defaultValue={column.role}
                              className="h-8 w-full rounded-[10px] border border-rule-strong bg-surface px-1.5 text-[12.5px]"
                            >
                              {roleOptions.map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {column.role === "bucket" || column.role === "total" ? (
                              <input
                                name={`code-${column.index}`}
                                defaultValue={column.code ?? ""}
                                className="figure h-8 w-full rounded-[10px] border border-rule-strong bg-surface px-1.5 text-[12px]"
                              />
                            ) : (
                              <span className="figure block text-[12px] text-muted">
                                {column.day ? `day ${column.day}` : "—"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className="mt-7 grid gap-px border border-rule bg-rule sm:grid-cols-4">
              {[
                ["Employees matched", String(grid.size)],
                ["Day records", String(dayRows.length)],
                ["Premium buckets", String(bucketRows.length)],
                ["Issues", String(issues.length)],
              ].map(([label, value]) => (
                <div key={label} className="bg-surface px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
                  <p className="figure mt-1 text-[16.5px]">{value}</p>
                </div>
              ))}
            </div>

            <section className="mt-6 rounded-[14px] border border-rule bg-surface">
              <div className="flex items-center justify-between border-b border-rule px-4 py-3">
                <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Attendance grid</h2>
                <span className="figure text-[12px] text-muted">hours per day</span>
              </div>
              <div className="scroll-x">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-rule">
                      <th className="sticky left-0 z-10 min-w-[200px] bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                        Employee
                      </th>
                      {dayColumns.map((column) => (
                        <th key={column.index} className="px-2 py-2 text-right text-[11px] font-medium text-muted">
                          {column.date.slice(5).replace("-", "/")}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...grid.values()].map((row) => (
                      <tr key={row.code} className="border-b border-rule last:border-b-0 hover:bg-surface-2">
                        <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-[12.5px]">
                          <span className="figure mr-2 text-[11.5px] text-muted">{row.code}</span>
                          {row.name}
                        </td>
                        {dayColumns.map((column) => {
                          const hours = row.hours.get(column.date);
                          return (
                            <td key={column.index} className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">
                              {hours === undefined ? "—" : hours.toFixed(2)}
                            </td>
                          );
                        })}
                        <td className="figure px-3 py-2 text-right text-[12.5px] font-medium">
                          {row.total.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {bucketRows.length > 0 ? (
              <section className="mt-6 rounded-[14px] border border-rule bg-surface">
                <div className="border-b border-rule px-4 py-3">
                  <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Premium buckets</h2>
                </div>
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-rule">
                      {["Bucket", "Hours", "Employees"].map((heading) => (
                        <th key={heading} className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted ${heading === "Hours" ? "text-right" : ""}`}>
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bucketRows.map((bucket) => (
                      <tr key={bucket.code} className="border-b border-rule last:border-b-0">
                        <td className="px-4 py-2 text-[12.5px]">{bucket.code.replaceAll("_", " ")}</td>
                        <td className="figure px-4 py-2 text-right text-[12.5px]">{Number(bucket.hours).toFixed(2)}</td>
                        <td className="figure px-4 py-2 text-[12.5px] text-ink-2">{bucket.employees}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {issues.length > 0 ? (
              <section className="mt-6 rounded-[14px] border border-rule bg-surface">
                <div className="flex items-center justify-between border-b border-rule px-4 py-3">
                  <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Import notes</h2>
                  <span className="figure text-[12px] text-muted">{issues.length}</span>
                </div>
                <ul className="max-h-[320px] overflow-auto">
                  {issues.slice(0, 60).map((issue, index) => (
                    <li key={`${issue.row}-${issue.kind}-${index}`} className="flex gap-3 border-b border-rule px-4 py-2 last:border-b-0">
                      <span className="figure w-10 shrink-0 text-[11.5px] text-muted">r{issue.row}</span>
                      <span className="w-[110px] shrink-0 text-[11px] uppercase tracking-[0.06em] text-warn">
                        {issueKindLabel[issue.kind] ?? issue.kind}
                      </span>
                      <span className="text-[12.5px] text-ink-2">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </main>

      <WorkspaceFooter />
    </>
  );
}
