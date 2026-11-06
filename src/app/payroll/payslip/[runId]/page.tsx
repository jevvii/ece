import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import { employees, payRunLines, payRuns, payrollPeriods, users } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { formatRange } from "@/lib/periods";
import { PrintButton } from "../print-button";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });

function Row({ label, value, indent = false }: { label: string; value: string; indent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[3px]">
      <span className={`text-[11px] ${indent ? "pl-4 text-ink-2" : "text-ink"}`}>{label}</span>
      <span className="figure text-[11px]">{value}</span>
    </div>
  );
}

export default async function PayslipRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { tenant } = await requireWorkspace();

  const [run] = await db
    .select()
    .from(payRuns)
    .where(and(eq(payRuns.id, runId), eq(payRuns.tenantId, tenant.id)))
    .limit(1);

  if (!run) notFound();
  if (run.status !== "approved") notFound();

  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(eq(payrollPeriods.id, run.periodId))
    .limit(1);

  const [lines, preparedBy, notedBy] = await Promise.all([
    db
      .select({ line: payRunLines, employee: employees })
      .from(payRunLines)
      .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
      .where(eq(payRunLines.runId, run.id))
      .orderBy(asc(employees.employeeCode)),
    run.createdBy
      ? db.select().from(users).where(eq(users.id, run.createdBy)).limit(1).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    run.approvedBy
      ? db.select().from(users).where(eq(users.id, run.approvedBy)).limit(1).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / Payslip / Batch" />

      <main className="mx-auto w-full max-w-[880px] flex-1 px-6 pb-16 pt-10">
        <div className="no-print flex flex-wrap items-center justify-between gap-4">
          <Link href="/payroll/payslip" className="text-[11.5px] text-muted hover:text-ink-2">
            ← Payslip
          </Link>
          <PrintButton />
        </div>

        <div className="no-print mt-5 mb-8">
          <h1 className="font-serif text-[28px] leading-[1.08] tracking-[-0.03em]">
            {period?.cycleLabel} · cutoff {period?.cutoffNo}
          </h1>
          <p className="mt-1.5 text-[12px] text-ink-2">
            {period ? formatRange(period.coverageStart, period.coverageEnd) : ""} · {lines.length} payslips ·
            approved {run.approvedAt?.toISOString().slice(0, 10)}
          </p>
        </div>

        <div className="space-y-8">
          {lines.map(({ line, employee }) => {
            const earnings = [
              ["Basic pay", Number(line.basic)],
              ["Allowance", Number(line.allowance)],
              ["Adjustment", Number(line.adjustmentEarning)],
              ["Overtime", Number(line.overtime)],
              ["Night differential", Number(line.nightDiff)],
              ["Holiday pay", Number(line.holiday)],
              ["Premium pay", Number(line.premium)],
            ].filter(([, amount]) => (amount as number) !== 0);

            const deductions = [
              ["SSS contribution", Number(line.sssEmployee)],
              ["PhilHealth contribution", Number(line.philhealthEmployee)],
              ["Pag-IBIG contribution", Number(line.pagibigEmployee)],
              ["Withholding tax", Number(line.tax)],
              ["Adjustment deduction", Number(line.otherDeductions)],
            ].filter(([, amount]) => (amount as number) !== 0);

            return (
              <article key={line.id} className="payslip border border-rule bg-white p-10">
                <header className="border-b-2 border-ink pb-3">
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <p className="text-[13px] font-semibold uppercase tracking-[0.04em]">{tenant.legalName}</p>
                      <p className="mt-0.5 text-[10.5px] text-ink-2">{tenant.addressLine ?? ""}</p>
                      <p className="figure mt-0.5 text-[10.5px] text-ink-2">TIN {tenant.tin ?? "—"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Payslip</p>
                      <p className="figure mt-1 text-[10.5px] text-ink-2">#{employee.employeeCode}</p>
                    </div>
                  </div>
                </header>

                <div className="mt-4 flex items-baseline justify-between gap-4 border-b border-rule pb-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Employee</p>
                    <p className="mt-0.5 text-[13px] font-medium">
                      {employee.lastName}, {employee.firstName}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Period</p>
                    <p className="figure mt-0.5 text-[11.5px]">
                      {period ? formatRange(period.coverageStart, period.coverageEnd) : ""}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-x-10 sm:grid-cols-2">
                  <section>
                    <div className="flex items-baseline justify-between border-b border-rule pb-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em]">Earnings</p>
                      <p className="figure text-[10.5px] text-muted">{Number(line.daysPaid)} days paid</p>
                    </div>
                    <div className="mt-1.5">
                      {earnings.map(([label, amount]) => (
                        <Row key={String(label)} label={String(label)} value={peso.format(Number(amount))} />
                      ))}
                    </div>
                    <div className="mt-2 flex items-baseline justify-between border-t border-ink pt-1.5">
                      <span className="text-[12px] font-semibold">Gross pay</span>
                      <span className="figure text-[12px] font-medium">{peso.format(Number(line.gross))}</span>
                    </div>
                  </section>

                  <section>
                    <div className="flex items-baseline justify-between border-b border-rule pb-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em]">Deductions</p>
                      <p className="figure text-[10.5px] text-muted">employee share</p>
                    </div>
                    <div className="mt-1.5">
                      {deductions.map(([label, amount]) => (
                        <Row key={String(label)} label={String(label)} value={peso.format(Number(amount))} />
                      ))}
                      <Row
                        label="Employer SSS"
                        value={peso.format(Number(line.sssEmployer))}
                        indent
                      />
                      <Row
                        label="Employer PhilHealth"
                        value={peso.format(Number(line.philhealthEmployer))}
                        indent
                      />
                      <Row
                        label="Employer Pag-IBIG"
                        value={peso.format(Number(line.pagibigEmployer))}
                        indent
                      />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between border-t border-ink pt-1.5">
                      <span className="text-[12px] font-semibold">Total deductions</span>
                      <span className="figure text-[12px] font-medium">
                        {peso.format(
                          Number(line.sssEmployee) +
                            Number(line.philhealthEmployee) +
                            Number(line.pagibigEmployee) +
                            Number(line.tax) +
                            Number(line.otherDeductions),
                        )}
                      </span>
                    </div>
                  </section>
                </div>

                <div className="mt-6 flex items-baseline justify-between border-y-2 border-ink py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">Net pay</span>
                  <span className="figure text-[18px] font-semibold">{peso.format(Number(line.netPay))}</span>
                </div>

                <footer className="mt-8 grid grid-cols-2 gap-10">
                  <div>
                    <div className="h-7 border-b border-rule" />
                    <p className="mt-1 text-[9.5px] uppercase tracking-[0.08em] text-muted">Prepared by</p>
                    <p className="text-[10.5px]">{preparedBy?.name ?? "—"}</p>
                  </div>
                  <div>
                    <div className="h-7 border-b border-rule" />
                    <p className="mt-1 text-[9.5px] uppercase tracking-[0.08em] text-muted">Noted by</p>
                    <p className="text-[10.5px]">{notedBy?.name ?? "—"}</p>
                  </div>
                </footer>

                <p className="mt-5 text-[9px] leading-relaxed text-muted">
                  Employer contributions are shown for information and are not deducted from net pay.
                  Statutory figures follow dataset {run.statutoryVersion}, which is pending accountant
                  approval.
                </p>
              </article>
            );
          })}
        </div>
      </main>

      <WorkspaceFooter />
    </>
  );
}
