import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import { payJournals, payRuns, payrollPeriods } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { formatRange } from "@/lib/periods";
import { generateJournal } from "./actions";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });

export default async function JournalIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { tenant, membership } = await requireWorkspace();
  const { error } = await searchParams;
  const canWrite = membership.role === "company_admin" || membership.role === "payroll_officer";

  const [runs, journals] = await Promise.all([
    db
      .select({ run: payRuns, period: payrollPeriods })
      .from(payRuns)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payRuns.periodId))
      .where(eq(payRuns.tenantId, tenant.id))
      .orderBy(desc(payRuns.createdAt)),
    db.select().from(payJournals).where(eq(payJournals.tenantId, tenant.id)),
  ]);

  const journalByRun = new Map(journals.map((journal) => [journal.runId, journal]));
  const approved = runs.filter((row) => row.run.status === "approved");

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / Journal" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/payroll" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Payroll
        </Link>

        <div className="mt-6">
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Payroll journal · accrual and settlement
          </p>
          <h1 className="mt-3 font-serif text-[34px] leading-[1.05] tracking-[-0.03em] sm:text-[40px]">
            Payroll Journal
          </h1>
          <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.6] text-ink-2">
            A balanced summary of the approved run — salaries, employer contributions, statutory
            payables and net pay. Payment is recorded as a separate settlement event.
          </p>
        </div>

        {error ? (
          <div role="alert" className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {error === "not-allowed" ? "Your role cannot journalise payroll." : decodeURIComponent(error)}
          </div>
        ) : null}

        <section className="mt-8 rounded-[14px] border border-rule bg-surface">
          <div className="flex items-center justify-between border-b border-rule px-5 py-3">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Approved runs</h2>
            <span className="figure text-[12px] text-muted">{approved.length}</span>
          </div>
          {approved.length === 0 ? (
            <p className="px-5 py-8 text-[13px] text-muted">
              No approved run yet. Approve a computation to generate its journal.
            </p>
          ) : (
            <ul>
              {approved.map(({ run, period }) => {
                const journal = journalByRun.get(run.id);
                const totals = (run.totals ?? {}) as Record<string, number>;
                return (
                  <li key={run.id} className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-4 last:border-b-0">
                    <span className="min-w-0">
                      <span className="block text-[13.5px]">
                        {period.cycleLabel} · cutoff {period.cutoffNo}
                      </span>
                      <span className="figure block text-[11.5px] text-muted">
                        {formatRange(period.coverageStart, period.coverageEnd)} · net {peso.format(totals.netPay ?? 0)}
                      </span>
                    </span>

                    <span className="ml-auto flex items-center gap-3">
                      {journal ? (
                        <Link
                          href={`/payroll/journal/${journal.id}`}
                          className="flex h-9 items-center rounded-full border border-rule-strong px-4 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-ink-2 hover:text-ink"
                        >
                          Open journal · {journal.status}
                        </Link>
                      ) : (
                        <form action={generateJournal}>
                          <input type="hidden" name="runId" value={run.id} />
                          <button
                            type="submit"
                            disabled={!canWrite}
                            className="h-9 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white hover:brightness-95 disabled:opacity-40"
                          >
                            Generate journal
                          </button>
                        </form>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="mt-5 max-w-[80ch] text-[12px] leading-relaxed text-muted">
          Accounts are seeded once per company: salaries, allowances, premium pay, employer
          contributions and 13th month on the debit side; statutory payables, withholding tax,
          accrued salaries and accrued 13th month on the credit side. Journals export without an
          Accounting licence and can post natively when one is active.
        </p>
      </main>

      <WorkspaceFooter />
    </>
  );
}
