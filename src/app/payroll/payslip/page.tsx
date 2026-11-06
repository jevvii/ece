import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import { payRuns, payrollPeriods } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { formatRange } from "@/lib/periods";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });

export default async function PayslipIndexPage() {
  const { tenant } = await requireWorkspace();

  const runs = await db
    .select({ run: payRuns, period: payrollPeriods })
    .from(payRuns)
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payRuns.periodId))
    .where(eq(payRuns.tenantId, tenant.id))
    .orderBy(desc(payRuns.createdAt));

  const approved = runs.filter((row) => row.run.status === "approved");

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / Payslip" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/payroll" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Payroll
        </Link>

        <div className="mt-6">
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Payslip · issued from approved runs
          </p>
          <h1 className="mt-3 font-serif text-[34px] leading-[1.05] tracking-[-0.03em] sm:text-[40px]">
            Payslip
          </h1>
          <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.6] text-ink-2">
            A payslip exists only after a run is approved. It is generated from the frozen snapshot,
            so it can never disagree with the register.
          </p>
        </div>

        <section className="mt-8 rounded-[14px] border border-rule bg-surface">
          <div className="flex items-center justify-between border-b border-rule px-5 py-3">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Approved runs</h2>
            <span className="figure text-[12px] text-muted">{approved.length}</span>
          </div>
          {approved.length === 0 ? (
            <p className="px-5 py-8 text-[13px] text-muted">
              No approved run yet. Approve a payroll computation to issue payslips.
            </p>
          ) : (
            <ul>
              {approved.map(({ run, period }) => {
                const totals = (run.totals ?? {}) as Record<string, number>;
                return (
                  <li key={run.id} className="border-b border-rule last:border-b-0">
                    <Link
                      href={`/payroll/payslip/${run.id}`}
                      className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-surface-2"
                    >
                      <span>
                        <span className="block text-[13.5px]">
                          {period.cycleLabel} · cutoff {period.cutoffNo}
                        </span>
                        <span className="figure block text-[11.5px] text-muted">
                          {formatRange(period.coverageStart, period.coverageEnd)} · payday {period.payDate}
                        </span>
                      </span>
                      <span className="ml-auto text-right">
                        <span className="figure block text-[13px]">{peso.format(totals.netPay ?? 0)}</span>
                        <span className="block text-[11px] uppercase tracking-[0.08em] text-muted">
                          {totals.employees ?? 0} payslips
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <WorkspaceFooter />
    </>
  );
}
