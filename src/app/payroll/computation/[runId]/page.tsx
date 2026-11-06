import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import { employees, payRunLines, payRuns, payrollPeriods, users } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import type { RunIssue } from "@/lib/payroll/compute";
import { STATUTORY_VERSION } from "@/lib/payroll/statutory";
import { formatRange } from "@/lib/periods";
import { approveRun, discardRun } from "../actions";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

const issueLabel: Record<string, string> = {
  no_attendance: "No attendance",
  no_schedule: "No schedule",
  partial_day: "Partial day",
  mwe_unknown: "MWE unknown",
  unknown_bucket: "Unknown bucket",
  rest_day_hours: "Rest-day hours",
  negative_net: "Negative net",
};

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { runId } = await params;
  const { error } = await searchParams;
  const { tenant, user, membership } = await requireWorkspace();

  const [run] = await db
    .select()
    .from(payRuns)
    .where(and(eq(payRuns.id, runId), eq(payRuns.tenantId, tenant.id)))
    .limit(1);

  if (!run) notFound();

  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, run.periodId))
    .limit(1);

  const [lines, approver] = await Promise.all([
    db
      .select({ line: payRunLines, employee: employees })
      .from(payRunLines)
      .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
      .where(eq(payRunLines.runId, run.id))
      .orderBy(asc(employees.employeeCode)),
    run.approvedBy
      ? db.select().from(users).where(eq(users.id, run.approvedBy)).limit(1).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const totals = (run.totals ?? {}) as Record<string, number>;
  const issues = (run.issues ?? []) as RunIssue[];
  const assumptions = (run.assumptions ?? {}) as Record<string, unknown>;
  const selfApproval = run.createdBy === user.id;
  const canApprove =
    membership.role === "company_admin" ||
    membership.role === "approver" ||
    membership.role === "payroll_officer";

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / Computation / Register" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/payroll/computation" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Computation
        </Link>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              {run.cycleLabel} · cutoff {run.cutoffNo} · {STATUTORY_VERSION}
            </p>
            <h1 className="mt-3 font-serif text-[32px] leading-[1.06] tracking-[-0.03em] sm:text-[38px]">
              Payroll register
            </h1>
            <p className="mt-2 text-[13px] text-ink-2">
              {period
                ? `${formatRange(period.coverageStart, period.coverageEnd)} · payday ${new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${period.payDate}T00:00:00Z`))}`
                : "Cutoff not found"}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Status</p>
            <p className={`mt-1 text-[12.5px] uppercase tracking-[0.08em] ${run.status === "approved" ? "text-accent" : "text-warn"}`}>
              {run.status}
            </p>
            <p className="figure mt-1 text-[12px] text-muted">{lines.length} employees</p>
          </div>
        </div>

        {error ? (
          <div role="alert" className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {decodeURIComponent(error)}
          </div>
        ) : null}

        <div className="mt-7 grid gap-px border border-rule bg-rule sm:grid-cols-4">
          {[
            ["Gross pay", peso.format(totals.gross ?? 0)],
            ["Employee contributions", peso.format((totals.sssEmployee ?? 0) + (totals.philhealthEmployee ?? 0) + (totals.pagibigEmployee ?? 0))],
            ["Withholding tax", peso.format(totals.tax ?? 0)],
            ["Net pay", peso.format(totals.netPay ?? 0)],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
              <p className="figure mt-1 text-[15.5px]">{value}</p>
            </div>
          ))}
        </div>

        <section className="mt-6 rounded-[14px] border border-rule bg-surface">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Register</h2>
            <span className="text-[11.5px] uppercase tracking-[0.08em] text-muted">Frozen on approval</span>
          </div>
          <div className="scroll-x">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-rule">
                  <th className="sticky left-0 z-10 min-w-[210px] whitespace-nowrap bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Employee
                  </th>
                  {[
                    ["Days", "days"],
                    ["Basic", "basic"],
                    ["Allow.", "allowance"],
                    ["Adj. +", "adjustmentEarning"],
                    ["OT", "overtime"],
                    ["ND", "nightDiff"],
                    ["Holiday", "holiday"],
                    ["Premium", "premium"],
                    ["Gross", "gross"],
                    ["SSS", "sssEmployee"],
                    ["PhilHealth", "philhealthEmployee"],
                    ["Pag-IBIG", "pagibigEmployee"],
                    ["Tax", "tax"],
                    ["Adj. −", "otherDeductions"],
                    ["Net", "netPay"],
                  ].map(([label]) => (
                    <th key={label} className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map(({ line, employee }) => (
                  <tr key={line.id} className="border-b border-rule last:border-b-0 hover:bg-surface-2">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-2 text-[12.5px]">
                      <span className="figure mr-2 text-[11.5px] text-muted">{employee.employeeCode}</span>
                      {employee.lastName}, {employee.firstName}
                    </td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{Number(line.daysPaid)}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(Number(line.basic))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{peso.format(Number(line.allowance))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{peso.format(Number(line.adjustmentEarning))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{peso.format(Number(line.overtime))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{peso.format(Number(line.nightDiff))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{peso.format(Number(line.holiday))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{peso.format(Number(line.premium))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] font-medium">{peso.format(Number(line.gross))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{peso.format(Number(line.sssEmployee))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{peso.format(Number(line.philhealthEmployee))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{peso.format(Number(line.pagibigEmployee))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{peso.format(Number(line.tax))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] text-ink-2">{peso.format(Number(line.otherDeductions))}</td>
                    <td className="figure px-2 py-2 text-right text-[12.5px] font-medium">{peso.format(Number(line.netPay))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink bg-surface-2">
                  <td className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em]">
                    Totals
                  </td>
                  <td className="figure px-2 py-2 text-right text-[12px] text-ink-2">—</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.basic ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.allowance ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.adjustmentEarning ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.overtime ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.nightDiff ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.holiday ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.premium ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px] font-medium">{peso.format(totals.gross ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.sssEmployee ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.philhealthEmployee ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.pagibigEmployee ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.tax ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px]">{peso.format(totals.otherDeductions ?? 0)}</td>
                  <td className="figure px-2 py-2 text-right text-[12.5px] font-medium">{peso.format(totals.netPay ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[14px] border border-rule bg-surface">
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Review notes</h2>
              <span className="figure text-[12px] text-muted">{issues.length}</span>
            </div>
            {issues.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-muted">No exceptions in this run.</p>
            ) : (
              <ul className="max-h-[320px] overflow-auto">
                {issues.map((issue, index) => (
                  <li key={`${issue.employeeCode}-${issue.kind}-${index}`} className="flex gap-3 border-b border-rule px-4 py-2 last:border-b-0">
                    <span className="w-[120px] shrink-0 text-[11px] uppercase tracking-[0.06em] text-warn">
                      {issueLabel[issue.kind] ?? issue.kind}
                    </span>
                    <span className="text-[12.5px] text-ink-2">
                      {issue.employeeCode ? `${issue.employeeCode} · ` : ""}
                      {issue.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[14px] border border-rule bg-surface p-5">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Cost to company</h2>
            <dl className="mt-4 space-y-2">
              {[
                ["Employer SSS", totals.sssEmployer ?? 0],
                ["Employer PhilHealth", totals.philhealthEmployer ?? 0],
                ["Employer Pag-IBIG", totals.pagibigEmployer ?? 0],
                ["13th month accrual", totals.thirteenthAccrual ?? 0],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-baseline justify-between border-b border-rule pb-1.5 last:border-b-0">
                  <dt className="text-[12.5px] text-muted">{label}</dt>
                  <dd className="figure text-[12.5px]">{peso.format(Number(value))}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
              Premium matrix: {String(assumptions.premiumMatrix ?? "—")}. Divisor{" "}
              {String(assumptions.divisor ?? "—")} days. Statutory dataset{" "}
              {String(assumptions.statutoryVersion ?? "—")}
              {assumptions.statutoryApproved ? " (approved)." : " (not approved)."}
            </p>
          </section>
        </div>

        <section className="mt-6 rounded-[14px] border border-rule bg-surface p-5">
          {run.status === "approved" ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[12.5px] font-medium">Approved and frozen</p>
                <p className="mt-1 text-[12.5px] text-muted">
                  {approver ? `${approver.name} · ` : ""}
                  {run.approvedAt ? run.approvedAt.toISOString().slice(0, 16).replace("T", " ") : ""}
                  {assumptions.selfApproval ? " · single-operator override recorded" : ""}
                </p>
              </div>
              <span className="text-[11px] uppercase tracking-[0.08em] text-accent">Locked</span>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <form action={approveRun}>
                <input type="hidden" name="runId" value={run.id} />
                <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Approve run</p>
                <label className="mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2">
                  <input type="checkbox" name="acknowledge" className="mt-0.5 h-3.5 w-3.5 accent-[#0c7a43]" />
                  I acknowledge that {STATUTORY_VERSION} is not accountant-approved and that this
                  register is not filing-authoritative.
                </label>

                {selfApproval ? (
                  <div className="mt-3">
                    <label htmlFor="overrideReason" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                      Single-operator override reason (company admin only)
                    </label>
                    <textarea
                      id="overrideReason"
                      name="overrideReason"
                      rows={2}
                      className="mt-1.5 w-full rounded-[10px] border border-rule-strong bg-surface px-2 py-1.5 text-[12.5px]"
                    />
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={!canApprove}
                  className="mt-4 h-10 rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-40"
                >
                  Approve and freeze
                </button>
                {selfApproval ? (
                  <p className="mt-2 text-[11.5px] text-warn">
                    You calculated this run. Approval normally comes from another user.
                  </p>
                ) : null}
              </form>

              <form action={discardRun} className="lg:border-l lg:border-rule lg:pl-6">
                <input type="hidden" name="runId" value={run.id} />
                <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Discard</p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                  Deletes this calculated run and its lines. The time report and attendance stay.
                </p>
                <button
                  type="submit"
                  className="mt-4 h-10 rounded-full border border-[#9f2f2d] px-4 text-[13px] font-semibold text-[#9f2f2d] hover:bg-[#fdebec]"
                >
                  Discard draft
                </button>
              </form>
            </div>
          )}
        </section>
      </main>

      <WorkspaceFooter />
    </>
  );
}
