import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import {
  attendanceBuckets,
  attendanceDays,
  attendanceLateTotals,
  employees,
  importRuns,
  payrollPeriods,
} from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { parseCsv } from "@/lib/import/csv";
import { detectMappingV2, type MappingV2 } from "@/lib/import/mapping-v2";
import { parseOds } from "@/lib/import/ods";
import { readUpload } from "@/lib/import/storage";
import type { ImportIssue, Sheet } from "@/lib/import/types";
import { formatRange } from "@/lib/periods";
import { MappingGrid } from "./mapping-grid";

const issueKindLabel: Record<string, string> = {
  unknown_employee: "Unknown code",
  duplicate_employee: "Duplicate",
  non_numeric: "Not a number",
  half_day_annotation: "Half-day note",
  out_of_period: "Outside cutoff",
  implausible_hours: "Implausible hours",
  no_days: "No days",
  total_mismatch: "Total mismatch",
  day_mismatch: "Date mismatch",
  late_on_rest_day: "Late on rest day",
  missing_schedule: "No schedule",
};

function dateAt(start: string, offset: number) {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

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
  searchParams: Promise<{ error?: string; new?: string; ms?: string }>;
}) {
  const { runId } = await params;
  const { error, new: isNew, ms } = await searchParams;
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

  const issues = (run.issues ?? []) as ImportIssue[];
  const isImported = run.status === "imported";
  const storedMapping = run.mapping as unknown as MappingV2 & { version?: number };

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

  let sheetData: Sheet | null = null;
  if (run.storageKey) {
    try {
      const bytes = await readUpload(run.storageKey);
      sheetData =
        run.fileKind === "ods"
          ? parseOds(new Uint8Array(bytes))
          : parseCsv(new TextDecoder().decode(bytes));
    } catch {
      sheetData = null;
    }
  }

  // v1 runs stored a per-column mapping; re-detect into v2 when the file exists.
  const mapping: MappingV2 | null =
    storedMapping?.version === 2
      ? storedMapping
      : sheetData
        ? detectMappingV2(sheetData)
        : null;

  // Trim to populated bounds so the grid never renders hundreds of empty cells.
  let sheetGrid: string[][] = [];
  if (sheetData) {
    const rows = sheetData.rows.slice(0, 500);
    let width = 0;
    for (const row of rows) {
      for (let index = row.length - 1; index >= 0; index -= 1) {
        if ((row[index]?.text ?? "").trim() !== "") {
          width = Math.max(width, index + 1);
          break;
        }
      }
    }
    const capped = rows.map((row) =>
      Array.from({ length: Math.min(width, 200) }, (_, index) => row[index]?.text ?? ""),
    );
    while (capped.length > 0 && (capped[capped.length - 1] ?? []).every((text) => text.trim() === "")) {
      capped.pop();
    }
    sheetGrid = capped;
  }

  const unknownIssues = issues.filter((issue) => issue.kind === "unknown_employee");
  const unknownCodes = [...new Set(unknownIssues.map((issue) => issue.code ?? ""))].filter(Boolean);
  const unknownDetails = unknownCodes.map((code) => {
    const issue = unknownIssues.find((candidate) => candidate.code === code);
    const row = sheetData && issue ? sheetData.rows[issue.row - 1] : undefined;
    const name = mapping?.employeeName != null && row ? (row[mapping.employeeName]?.text ?? "") : "";
    return { code, name };
  });

  // Mapping runs in its own full-viewport shell, modelled on onboarding.
  if (!isImported && mapping && sheetData) {
    return (
      <MappingGrid
        runId={run.id}
        grid={sheetGrid}
        detected={mapping}
        employees={employeeRows}
        unknownCodes={unknownDetails}
        coverageStart={period?.coverageStart ?? ""}
        coverageEnd={period?.coverageEnd ?? ""}
        profileName={`${mapping.sheetName} · ${mapping.signature}`}
        fileName={run.fileName}
        periodLabel={
          period
            ? `${period.cycleLabel} · cutoff ${period.cutoffNo} · ${formatRange(period.coverageStart, period.coverageEnd)}`
            : "No cutoff attached"
        }
        isNew={isNew === "1"}
        detectMs={Number(ms ?? 0) || 0}
        error={error ? decodeURIComponent(error) : undefined}
      />
    );
  }

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

  const lateRows = isImported
    ? await db
        .select({ minutes: sql<string>`coalesce(sum(${attendanceDays.lateMinutes}), 0)` })
        .from(attendanceDays)
        .where(eq(attendanceDays.runId, run.id))
    : [];
  const periodLateRows = isImported
    ? await db
        .select({ minutes: sql<string>`coalesce(sum(${attendanceLateTotals.minutes}), 0)` })
        .from(attendanceLateTotals)
        .where(eq(attendanceLateTotals.runId, run.id))
    : [];
  const lateMinutes = Number(lateRows[0]?.minutes ?? 0) + Number(periodLateRows[0]?.minutes ?? 0);

  const dayColumns =
    period && mapping && mapping.dayStart != null && mapping.dayEnd != null
      ? Array.from({ length: mapping.dayEnd - mapping.dayStart + 1 }, (_, offset) => ({
          index: mapping.dayStart! + offset,
          date: dateAt(period.coverageStart, offset),
        })).filter((column) => column.date <= period.coverageEnd)
      : [];

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
              {run.fileKind.toUpperCase()} · {mapping?.sheetName ?? "mapping unavailable"}
            </p>
            <h1 className="mt-4 font-serif text-[clamp(2.25rem,4.5vw,3rem)] leading-[1.04] tracking-[-0.03em]">
              Time report
            </h1>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
              <span className="max-w-[34ch] truncate font-mono text-[12.5px] text-muted">{run.fileName}</span>
              <span className="text-rule-strong" aria-hidden="true">·</span>
              <span>
                {mapping?.companyName ? `${mapping.companyName} · ` : ""}
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
          <div className="mt-7 rounded-[10px] border border-[#e8c98a] bg-[#fbf3db] px-4 py-3 text-[12.5px] text-[#7a5a14]">
            The uploaded file is no longer available, so this run cannot be mapped. Upload it again.
          </div>
        ) : (
          <>
            <div className="mt-7 grid gap-px border border-rule bg-rule sm:grid-cols-5">
              {[
                ["Employees matched", String(grid.size)],
                ["Day records", String(dayRows.length)],
                ["Premium buckets", String(bucketRows.length)],
                ["Late minutes", String(lateMinutes)],
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
