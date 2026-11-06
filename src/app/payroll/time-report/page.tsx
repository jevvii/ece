import Link from "next/link";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import { importProfiles, importRuns, payrollCalendars, payrollPeriods } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { formatRange } from "@/lib/periods";
import { getActiveCalendar } from "@/lib/workspace";
import { uploadTimeReport } from "./actions";

const statusLabel: Record<string, string> = {
  mapping: "Mapping",
  review: "Needs review",
  imported: "Imported",
  failed: "Failed",
};

const statusTone: Record<string, string> = {
  mapping: "text-ink-2",
  review: "text-warn",
  imported: "text-accent",
  failed: "text-[#9f2f2d]",
};

export default async function TimeReportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { tenant, membership } = await requireWorkspace();
  const { error } = await searchParams;
  const canWrite = membership.role === "company_admin" || membership.role === "payroll_officer";

  const calendar = await getActiveCalendar(tenant.id);
  const today = new Date().toISOString().slice(0, 10);
  const floor = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [periods, runs, profiles] = await Promise.all([
    calendar
      ? db
          .select()
          .from(payrollPeriods)
          .where(and(eq(payrollPeriods.calendarId, calendar.id), gte(payrollPeriods.coverageEnd, floor)))
          .orderBy(asc(payrollPeriods.coverageStart))
      : Promise.resolve([]),
    db
      .select({ run: importRuns, period: payrollPeriods })
      .from(importRuns)
      .leftJoin(payrollPeriods, eq(payrollPeriods.id, importRuns.periodId))
      .where(eq(importRuns.tenantId, tenant.id))
      .orderBy(desc(importRuns.createdAt))
      .limit(10),
    db
      .select()
      .from(importProfiles)
      .where(eq(importProfiles.tenantId, tenant.id))
      .orderBy(desc(importProfiles.createdAt)),
  ]);

  const upcoming = periods
    .filter((period) => period.coverageEnd >= today)
    .slice(0, 12);

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / Time Report" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/payroll" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Payroll
        </Link>

        <div className="mt-6">
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Time report · import and review
          </p>
          <h1 className="mt-3 font-serif text-[34px] leading-[1.05] tracking-[-0.03em] sm:text-[40px]">
            Time Report
          </h1>
          <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.6] text-ink-2">
            Upload the client&apos;s attendance export. The parser proposes a column mapping from the
            header, you confirm it once, and it runs the same way every cutoff after that.
          </p>
        </div>

        {error ? (
          <div role="alert" className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {error === "not-allowed" ? "Your role cannot import time reports." : decodeURIComponent(error)}
          </div>
        ) : null}

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[14px] border border-rule bg-surface p-6">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">New import</h2>
            <p className="mt-1.5 text-[12.5px] text-muted">
              ODS and CSV in this build. The file is stored against the company and never shared
              across tenants.
            </p>

            {!calendar ? (
              <p className="mt-5 rounded-[14px] border border-rule bg-surface-2 p-4 text-[13px] text-ink-2">
                This company has no cutoff calendar yet. Finish company setup first.
              </p>
            ) : (
              <form action={uploadTimeReport} className="mt-5">
                <label htmlFor="file" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Attendance export
                </label>
                <input
                  id="file"
                  name="file"
                  type="file"
                  accept=".ods,.csv"
                  required
                  className="mt-2 block w-full cursor-pointer rounded-[14px] border border-dashed border-rule-strong bg-surface-2/50 px-3 py-4 text-[12.5px] text-muted transition-colors hover:border-accent/50 file:mr-3 file:rounded-full file:border file:border-rule-strong file:bg-surface file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-ink-2"
                />

                <label htmlFor="periodId" className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Cutoff covered by this file
                </label>
                <select id="periodId" name="periodId" required className="mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[13.5px]">
                  {upcoming.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.cycleLabel} · cutoff {period.cutoffNo} · {formatRange(period.coverageStart, period.coverageEnd)}
                    </option>
                  ))}
                </select>

                <button
                  type="submit"
                  disabled={!canWrite}
                  className="mt-6 h-10 w-full rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-40"
                >
                  Upload and detect columns
                </button>
              </form>
            )}
          </section>

          <section className="rounded-[14px] border border-rule bg-surface">
            <div className="border-b border-rule px-5 py-3">
              <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Saved profiles</h2>
            </div>
            {profiles.length === 0 ? (
              <p className="px-5 py-6 text-[12.5px] text-muted">
                No profiles yet. The first confirmed import creates one.
              </p>
            ) : (
              <ul>
                {profiles.map((profile) => (
                  <li key={profile.id} className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3 last:border-b-0">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px]">{profile.name}</span>
                      <span className="figure block text-[11.5px] text-muted">
                        v{profile.version} · {profile.sourceSignature}
                      </span>
                    </span>
                    <span className="text-[11px] uppercase tracking-[0.08em] text-muted">Saved</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="mt-6 rounded-[14px] border border-rule bg-surface">
          <div className="flex items-center justify-between border-b border-rule px-5 py-3">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Recent imports</h2>
            <span className="figure text-[12px] text-muted">{runs.length}</span>
          </div>
          {runs.length === 0 ? (
            <p className="px-5 py-8 text-[13px] text-muted">
              No attendance file has been imported for this company.
            </p>
          ) : (
            <div className="scroll-x">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-rule">
                    {["File", "Cutoff", "Status", "Rows", "Uploaded"].map((heading) => (
                      <th key={heading} className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map(({ run, period }) => (
                    <tr key={run.id} className="border-b border-rule last:border-b-0 hover:bg-surface-2">
                      <td className="px-4 py-3 text-[13px]">
                        <Link href={`/payroll/time-report/${run.id}`} className="hover:underline">
                          {run.fileName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[12.5px] text-ink-2">
                        {period ? `${period.cycleLabel} · ${period.cutoffNo}` : "—"}
                      </td>
                      <td className={`px-4 py-3 text-[11.5px] uppercase tracking-[0.08em] ${statusTone[run.status] ?? "text-ink-2"}`}>
                        {statusLabel[run.status] ?? run.status}
                      </td>
                      <td className="figure px-4 py-3 text-[12.5px] text-ink-2">{run.rowCount}</td>
                      <td className="figure px-4 py-3 text-[12px] text-muted">
                        {run.createdAt.toISOString().slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <WorkspaceFooter />
    </>
  );
}
