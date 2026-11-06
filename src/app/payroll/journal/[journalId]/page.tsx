import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import {
  glAccounts,
  payJournalLines,
  payJournals,
  payRuns,
  paySettlements,
  payrollPeriods,
} from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { formatRange } from "@/lib/periods";
import { postJournal, recordSettlement } from "../actions";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });

export default async function JournalPage({
  params,
  searchParams,
}: {
  params: Promise<{ journalId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { journalId } = await params;
  const { error } = await searchParams;
  const { tenant, membership } = await requireWorkspace();

  const [journal] = await db
    .select()
    .from(payJournals)
    .where(and(eq(payJournals.id, journalId), eq(payJournals.tenantId, tenant.id)))
    .limit(1);

  if (!journal) notFound();

  const [[run], periodRows, lines, settlements] = await Promise.all([
    db.select().from(payRuns).where(eq(payRuns.id, journal.runId)).limit(1),
    db
      .select({ period: payrollPeriods })
      .from(payRuns)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payRuns.periodId))
      .where(eq(payRuns.id, journal.runId))
      .limit(1)
      .then((rows) => rows.map((row) => row.period)),
    db
      .select({ line: payJournalLines, account: glAccounts })
      .from(payJournalLines)
      .innerJoin(glAccounts, eq(glAccounts.id, payJournalLines.accountId))
      .where(eq(payJournalLines.journalId, journal.id))
      .orderBy(asc(glAccounts.code)),
    db.select().from(paySettlements).where(eq(paySettlements.journalId, journal.id)),
  ]);

  const period = periodRows[0] ?? null;
  const totals = (journal.totals ?? {}) as Record<string, number>;
  const canWrite = membership.role === "company_admin" || membership.role === "payroll_officer";
  const balanced = Math.abs((totals.debit ?? 0) - (totals.credit ?? 0)) < 0.005;

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / Journal / Entry" />

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-6 pb-16 pt-12">
        <Link href="/payroll/journal" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Journal
        </Link>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              {period?.cycleLabel} · cutoff {run?.cutoffNo} · {journal.status}
            </p>
            <h1 className="mt-3 font-serif text-[32px] leading-[1.06] tracking-[-0.03em] sm:text-[38px]">
              Payroll journal
            </h1>
            <p className="mt-2 text-[13px] text-ink-2">
              {period
                ? `${formatRange(period.coverageStart, period.coverageEnd)} · ${run?.cycleLabel}`
                : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`/payroll/journal/${journal.id}/export`}
              className="flex h-9 items-center border border-rule px-4 text-[12.5px] font-semibold text-ink-2 hover:bg-surface-2"
            >
              Export CSV
            </a>
            <Link
              href={`/payroll/computation/${journal.runId}`}
              className="flex h-9 items-center border border-rule px-4 text-[12.5px] font-semibold text-ink-2 hover:bg-surface-2"
            >
              Open register
            </Link>
          </div>
        </div>

        {error ? (
          <div role="alert" className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {decodeURIComponent(error)}
          </div>
        ) : null}

        <div className="mt-7 grid gap-px border border-rule bg-rule sm:grid-cols-3">
          {[
            ["Debits", peso.format(totals.debit ?? 0)],
            ["Credits", peso.format(totals.credit ?? 0)],
            ["Difference", balanced ? "Balanced" : peso.format(totals.difference ?? 0)],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
              <p className={`figure mt-1 text-[15.5px] ${label === "Difference" ? (balanced ? "text-accent" : "text-[#9f2f2d]") : ""}`}>
                {value}
              </p>
            </div>
          ))}
        </div>

        <section className="mt-6 rounded-[14px] border border-rule bg-surface">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Journal entry</h2>
            <span className="figure text-[12px] text-muted">{lines.length} lines</span>
          </div>
          <div className="scroll-x">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-rule">
                  {["Code", "Account", "Memo", "Debit", "Credit"].map((heading) => (
                    <th
                      key={heading}
                      className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted ${
                        heading === "Debit" || heading === "Credit" ? "text-right" : ""
                      }`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map(({ line, account }) => (
                  <tr key={line.id} className="border-b border-rule last:border-b-0">
                    <td className="figure px-3 py-2 text-[12.5px] text-ink-2">{account.code}</td>
                    <td className="px-3 py-2 text-[12.5px]">{account.name}</td>
                    <td className="px-3 py-2 text-[12.5px] text-ink-2">{line.memo}</td>
                    <td className="figure px-3 py-2 text-right text-[12.5px]">
                      {Number(line.debit) === 0 ? "—" : peso.format(Number(line.debit))}
                    </td>
                    <td className="figure px-3 py-2 text-right text-[12.5px]">
                      {Number(line.credit) === 0 ? "—" : peso.format(Number(line.credit))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink bg-surface-2">
                  <td colSpan={3} className="px-3 py-2 text-[12.5px] font-semibold">
                    Totals
                  </td>
                  <td className="figure px-3 py-2 text-right text-[12.5px] font-medium">{peso.format(totals.debit ?? 0)}</td>
                  <td className="figure px-3 py-2 text-right text-[12.5px] font-medium">{peso.format(totals.credit ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
          <section className="rounded-[14px] border border-rule bg-surface p-5">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Posting</h2>
            {journal.status === "posted" ? (
              <div className="mt-3">
                <p className="text-[13px] text-accent">Posted</p>
                <p className="figure mt-1 text-[12px] text-muted">
                  {journal.postedAt?.toISOString().slice(0, 16).replace("T", " ")}
                </p>
              </div>
            ) : (
              <form action={postJournal} className="mt-3">
                <input type="hidden" name="journalId" value={journal.id} />
                <p className="text-[12.5px] leading-relaxed text-muted">
                  Posting freezes the entry and makes it exportable to the ledger.
                </p>
                <button
                  type="submit"
                  disabled={!canWrite || !balanced}
                  className="mt-3 h-9 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white hover:brightness-95 disabled:opacity-40"
                >
                  Post journal
                </button>
              </form>
            )}
          </section>

          <section className="rounded-[14px] border border-rule bg-surface p-5">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Settlement</h2>
            {settlements.length > 0 ? (
              <ul className="mt-3">
                {settlements.map((settlement) => (
                  <li key={settlement.id} className="flex items-baseline justify-between border-b border-rule py-1.5 last:border-b-0">
                    <span className="text-[12.5px] text-ink-2">
                      {settlement.paidAt} · {settlement.method}
                      {settlement.reference ? ` · ${settlement.reference}` : ""}
                    </span>
                    <span className="figure text-[12.5px]">{peso.format(Number(settlement.amount))}</span>
                  </li>
                ))}
              </ul>
            ) : journal.status !== "posted" ? (
              <p className="mt-3 text-[12.5px] text-muted">Post the journal before recording payment.</p>
            ) : (
              <form action={recordSettlement} className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="journalId" value={journal.id} />
                <div>
                  <label htmlFor="paidAt" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Paid on
                  </label>
                  <input
                    id="paidAt"
                    name="paidAt"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]"
                  />
                </div>
                <div>
                  <label htmlFor="amount" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Amount
                  </label>
                  <input
                    id="amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    required
                    defaultValue={Number(totals.credit ?? 0).toFixed(2)}
                    className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px] tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="method" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Method
                  </label>
                  <select
                    id="method"
                    name="method"
                    className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]"
                  >
                    <option>Bank transfer</option>
                    <option>Cash</option>
                    <option>Check</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="reference" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                    Reference
                  </label>
                  <input
                    id="reference"
                    name="reference"
                    className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={!canWrite}
                    className="h-9 rounded-full border border-rule-strong px-4 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-ink-2 hover:text-ink disabled:opacity-40"
                  >
                    Record settlement
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </main>

      <WorkspaceFooter />
    </>
  );
}
