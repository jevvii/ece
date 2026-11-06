import Link from "next/link";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import { employees, importRuns, payAdjustments, payRuns, payrollCalendars, payrollPeriods } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { formatRange } from "@/lib/periods";
import { STATUTORY_APPROVED, STATUTORY_VERSION } from "@/lib/payroll/statutory";
import { getActiveCalendar } from "@/lib/workspace";
import { calculateRun, cancelAdjustment, queueAdjustment } from "./actions";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

const statusLabel: Record<string, string> = {
  draft: "Draft",
  calculated: "Calculated",
  approved: "Approved",
  void: "Void",
};

export default async function ComputationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { tenant, membership } = await requireWorkspace();
  const { error } = await searchParams;
  const canWrite = membership.role === "company_admin" || membership.role === "payroll_officer";

  const calendar = await getActiveCalendar(tenant.id);

  const [periods, runs, imported, people, adjustments] = await Promise.all([
    calendar
      ? db
          .select()
          .from(payrollPeriods)
          .where(eq(payrollPeriods.calendarId, calendar.id))
          .orderBy(desc(payrollPeriods.coverageStart))
          .limit(12)
      : Promise.resolve([]),
    db
      .select({ run: payRuns, period: payrollPeriods })
      .from(payRuns)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payRuns.periodId))
      .where(eq(payRuns.tenantId, tenant.id))
      .orderBy(desc(payRuns.createdAt)),
    db
      .select({ periodId: importRuns.periodId })
      .from(importRuns)
      .where(and(eq(importRuns.tenantId, tenant.id), eq(importRuns.status, "imported"))),
    db
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, tenant.id), eq(employees.status, "active"))),
    db
      .select({ adjustment: payAdjustments, employee: employees })
      .from(payAdjustments)
      .innerJoin(employees, eq(employees.id, payAdjustments.employeeId))
      .where(and(eq(payAdjustments.tenantId, tenant.id), eq(payAdjustments.status, "queued")))
      .orderBy(desc(payAdjustments.createdAt)),
  ]);

  const importedPeriods = new Set(imported.map((row) => row.periodId).filter(Boolean));
  const runByPeriod = new Map(runs.map((row) => [row.run.periodId, row.run]));
  const available = periods.filter(
    (period) => importedPeriods.has(period.id) && runByPeriod.get(period.id)?.status !== "approved",
  );

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / Computation" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/payroll" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Payroll
        </Link>

        <div className="mt-6">
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Payroll computation · {STATUTORY_VERSION}
          </p>
          <h1 className="mt-3 font-serif text-[34px] leading-[1.05] tracking-[-0.03em] sm:text-[40px]">
            Payroll Computation
          </h1>
          <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.6] text-ink-2">
            Calculate a cutoff from its approved time report, review the register, and hand it to a
            second user to approve. Approval freezes time, rates and values.
          </p>
        </div>

        {error ? (
          <div role="alert" className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {error === "not-allowed" ? "Your role cannot calculate payroll." : decodeURIComponent(error)}
          </div>
        ) : null}

        {!STATUTORY_APPROVED ? (
          <div className="mt-6 rounded-[10px] border border-warn/25 bg-[#fbf3db] px-4 py-3">
            <p className="text-[12.5px] leading-[1.6] text-[#7a5a14]">
              Statutory dataset {STATUTORY_VERSION} is not approved by an accountant. A run can be
              calculated, but approval requires an explicit acknowledgement and the output is not
              filing-authoritative.
            </p>
          </div>
        ) : null}

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-[14px] border border-rule bg-surface p-6">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Calculate a cutoff</h2>
            {available.length === 0 ? (
              <p className="mt-4 rounded-[14px] border border-rule bg-surface-2 p-4 text-[13px] leading-[1.6] text-ink-2">
                No cutoff is ready. Import a time report for an open cutoff first, or the cutoff is
                already approved.
              </p>
            ) : (
              <form action={calculateRun} className="mt-4">
                <label htmlFor="periodId" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Cutoff
                </label>
                <select
                  id="periodId"
                  name="periodId"
                  required
                  className="mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[13.5px]"
                >
                  {available.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.cycleLabel} · cutoff {period.cutoffNo} · {formatRange(period.coverageStart, period.coverageEnd)}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!canWrite}
                  className="mt-5 h-10 w-full rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-40"
                >
                  Calculate register
                </button>
                <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                  Recalculating a draft replaces its lines. An approved run cannot be recalculated.
                </p>
              </form>
            )}
          </section>

          <section className="rounded-[14px] border border-rule bg-surface">
            <div className="flex items-center justify-between border-b border-rule px-5 py-3">
              <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Runs</h2>
              <span className="figure text-[12px] text-muted">{runs.length}</span>
            </div>
            {runs.length === 0 ? (
              <p className="px-5 py-8 text-[13px] text-muted">No payroll has been calculated yet.</p>
            ) : (
              <ul>
                {runs.map(({ run, period }) => {
                  const totals = (run.totals ?? {}) as Record<string, number>;
                  return (
                    <li key={run.id} className="border-b border-rule last:border-b-0">
                      <Link
                        href={`/payroll/computation/${run.id}`}
                        className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2"
                      >
                        <span className="min-w-0">
                          <span className="block text-[13px]">
                            {period.cycleLabel} · cutoff {period.cutoffNo}
                          </span>
                          <span className="figure block text-[11.5px] text-muted">
                            {run.status === "approved" ? "Frozen · " : ""}
                            {totals.employees ?? 0} employees
                          </span>
                        </span>
                        <span className="ml-auto text-right">
                          <span className="figure block text-[12.5px]">
                            {peso.format(totals.netPay ?? 0)}
                          </span>
                          <span
                            className={`block text-[10.5px] uppercase tracking-[0.08em] ${
                              run.status === "approved" ? "text-accent" : "text-warn"
                            }`}
                          >
                            {statusLabel[run.status] ?? run.status}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <section className="mt-6 rounded-[14px] border border-rule bg-surface">
          <div className="flex items-center justify-between border-b border-rule px-5 py-3">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Adjustments queue</h2>
            <span className="figure text-[12px] text-muted">{adjustments.length}</span>
          </div>
          {adjustments.length === 0 ? (
            <p className="px-5 py-4 text-[12.5px] text-muted">
              No queued adjustments. Entries apply to the next calculation, never silently.
            </p>
          ) : (
            <ul>
              {adjustments.map(({ adjustment, employee }) => (
                <li key={adjustment.id} className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-2.5 last:border-b-0">
                  <span className="text-[12.5px]">
                    <span className="figure mr-2 text-[11.5px] text-muted">{employee.employeeCode}</span>
                    {employee.lastName}, {employee.firstName}
                  </span>
                  <span className="text-[12px] text-ink-2">{adjustment.label}</span>
                  <span className={`figure ml-auto text-[12.5px] ${adjustment.kind === "deduction" ? "text-[#9f2f2d]" : "text-accent"}`}>
                    {adjustment.kind === "deduction" ? "−" : "+"}
                    {peso.format(Number(adjustment.amount))}
                  </span>
                  <form action={cancelAdjustment}>
                    <input type="hidden" name="adjustmentId" value={adjustment.id} />
                    <button type="submit" className="text-[11px] uppercase tracking-[0.08em] text-muted hover:text-ink">
                      Cancel
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={queueAdjustment} className="grid gap-3 border-t border-rule px-5 py-4 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label htmlFor="employeeId" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Employee</label>
              <select id="employeeId" name="employeeId" className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]">
                {people.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.employeeCode} · {employee.lastName}, {employee.firstName}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="kind" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Kind</label>
              <select id="kind" name="kind" className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]">
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
              </select>
            </div>
            <div>
              <label htmlFor="label" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Label</label>
              <input id="label" name="label" required className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]" />
            </div>
            <div>
              <label htmlFor="amount" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Amount</label>
              <input id="amount" name="amount" type="number" min={0.01} step="0.01" required className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px] tabular-nums" />
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={!canWrite} className="h-9 w-full rounded-full border border-rule-strong px-3 text-[12.5px] font-semibold hover:bg-surface-2 disabled:opacity-40">
                Queue
              </button>
            </div>
            <div className="sm:col-span-6">
              <label htmlFor="reason" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Reason</label>
              <input id="reason" name="reason" className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]" />
            </div>
          </form>
        </section>
      </main>

      <WorkspaceFooter />
    </>
  );
}
