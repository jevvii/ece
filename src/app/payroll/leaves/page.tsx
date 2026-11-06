import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import { employees, leaveBalances, leaveEntries, leavePolicies, leaveTypes, ranks } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { ensureLeaveTypes } from "@/lib/payroll/leaves";
import { initializeYear, recordLeave, savePolicy } from "./actions";

const basisLabel: Record<string, string> = {
  working: "Working days",
  calendar: "Calendar days",
};

export default async function LeavesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const { tenant, membership } = await requireWorkspace();
  const canWrite = membership.role === "company_admin" || membership.role === "payroll_officer";

  const year = Number(params.year ?? new Date().getFullYear()) || new Date().getFullYear();

  const types = await ensureLeaveTypes(tenant.id);
  const [policies, rankRows, people, balances, entries] = await Promise.all([
    db.select().from(leavePolicies).where(eq(leavePolicies.tenantId, tenant.id)),
    db.select().from(ranks).where(eq(ranks.tenantId, tenant.id)).orderBy(asc(ranks.level)),
    db
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, tenant.id), eq(employees.status, "active")))
      .orderBy(asc(employees.employeeCode)),
    db
      .select({ balance: leaveBalances, employee: employees, type: leaveTypes })
      .from(leaveBalances)
      .innerJoin(employees, eq(employees.id, leaveBalances.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
      .where(and(eq(leaveBalances.tenantId, tenant.id), eq(leaveBalances.year, year)))
      .orderBy(asc(employees.employeeCode), asc(leaveTypes.code)),
    db
      .select({ entry: leaveEntries, employee: employees, type: leaveTypes })
      .from(leaveEntries)
      .innerJoin(employees, eq(employees.id, leaveEntries.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveEntries.leaveTypeId))
      .where(eq(leaveEntries.tenantId, tenant.id))
      .orderBy(desc(leaveEntries.createdAt))
      .limit(8),
  ]);

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / Leaves" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/payroll" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Payroll
        </Link>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              Leaves · {year} · {types.length} types
            </p>
            <h1 className="mt-3 font-serif text-[34px] leading-[1.05] tracking-[-0.03em] sm:text-[40px]">
              Leaves
            </h1>
            <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.6] text-ink-2">
              Company policy by rank, statutory types locked to their legal basis, and balances that
              carry over only up to each type&apos;s cap.
            </p>
          </div>
          <form action={initializeYear} className="flex items-end gap-2">
            <input type="hidden" name="year" value={year} />
            <button
              type="submit"
              disabled={!canWrite}
              className="h-9 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white hover:brightness-95 disabled:opacity-40"
            >
              Initialize {year} balances
            </button>
          </form>
        </div>

        {params.error ? (
          <div role="alert" className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {params.error === "not-allowed" ? "Your role cannot change leave records." : decodeURIComponent(params.error)}
          </div>
        ) : null}
        {params.saved ? (
          <div className="mt-6 rounded-[10px] border border-accent/20 bg-accent-soft px-4 py-3 text-[13px] text-accent">Saved.</div>
        ) : null}

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[14px] border border-rule bg-surface">
            <div className="flex items-center justify-between border-b border-rule px-5 py-3">
              <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Leave types</h2>
              <span className="figure text-[12px] text-muted">{types.length}</span>
            </div>
            <div className="scroll-x">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-rule">
                    {["Code", "Type", "Basis", "Annual", "Carry-over"].map((heading) => (
                      <th key={heading} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {types.map((type) => {
                    const override = policies.find((policy) => policy.leaveTypeId === type.id && policy.rankId === null);
                    return (
                      <tr key={type.id} className="border-b border-rule last:border-b-0">
                        <td className="figure px-3 py-2 text-[12px] text-ink-2">{type.code}</td>
                        <td className="px-3 py-2 text-[12.5px]">
                          {type.name}
                          {type.statutory ? (
                            <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">Statutory</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-[12px] text-ink-2">{basisLabel[type.countingBasis] ?? type.countingBasis}</td>
                        <td className="figure px-3 py-2 text-[12.5px]">
                          {Number(override?.annualDays ?? type.annualDays)}
                        </td>
                        <td className="figure px-3 py-2 text-[12.5px] text-ink-2">
                          {Number(override?.carryOverCap ?? type.carryOverCap)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[14px] border border-rule bg-surface p-5">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Rank policy</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              Overrides the company default for a rank. A statutory entitlement is never reduced
              below its legal minimum.
            </p>
            <form action={savePolicy} className="mt-4 grid gap-3">
              <div>
                <label htmlFor="leaveTypeId" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Leave type</label>
                <select id="leaveTypeId" name="leaveTypeId" className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]">
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>{type.code} · {type.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="rankId" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Rank</label>
                <select id="rankId" name="rankId" className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]">
                  <option value="">All ranks (company default)</option>
                  {rankRows.map((rank) => (
                    <option key={rank.id} value={rank.id}>{rank.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="annualDays" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Annual days</label>
                  <input id="annualDays" name="annualDays" type="number" min={0} step="0.5" defaultValue={15} className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px] tabular-nums" />
                </div>
                <div>
                  <label htmlFor="carryOverCap" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Carry-over cap</label>
                  <input id="carryOverCap" name="carryOverCap" type="number" min={0} step="0.5" defaultValue={5} className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px] tabular-nums" />
                </div>
              </div>
              <button
                type="submit"
                disabled={!canWrite}
                className="h-9 rounded-full border border-rule-strong px-4 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-ink-2 hover:text-ink disabled:opacity-40"
              >
                Save policy
              </button>
            </form>
          </section>
        </div>

        <section className="mt-6 rounded-[14px] border border-rule bg-surface">
          <div className="flex items-center justify-between border-b border-rule px-5 py-3">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Balances · {year}</h2>
            <span className="figure text-[12px] text-muted">{balances.length}</span>
          </div>
          {balances.length === 0 ? (
            <p className="px-5 py-8 text-[13px] text-muted">
              No balances for {year}. Initialize the year to grant entitlements and carry over
              unused leave up to each cap.
            </p>
          ) : (
            <div className="scroll-x">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-rule">
                    {["Employee", "Type", "Granted", "Carried", "Used", "Available"].map((heading) => (
                      <th
                        key={heading}
                        className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted ${
                          heading === "Granted" || heading === "Carried" || heading === "Used" || heading === "Available" ? "text-right" : ""
                        }`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {balances.map(({ balance, employee, type }) => {
                    const available = Number(balance.granted) + Number(balance.carried) - Number(balance.used);
                    return (
                      <tr key={balance.id} className="border-b border-rule last:border-b-0 hover:bg-surface-2">
                        <td className="px-3 py-2 text-[12.5px]">
                          <span className="figure mr-2 text-[11.5px] text-muted">{employee.employeeCode}</span>
                          {employee.lastName}, {employee.firstName}
                        </td>
                        <td className="px-3 py-2 text-[12.5px] text-ink-2">{type.code}</td>
                        <td className="figure px-3 py-2 text-right text-[12.5px]">{Number(balance.granted).toFixed(2)}</td>
                        <td className="figure px-3 py-2 text-right text-[12.5px] text-ink-2">{Number(balance.carried).toFixed(2)}</td>
                        <td className="figure px-3 py-2 text-right text-[12.5px] text-ink-2">{Number(balance.used).toFixed(2)}</td>
                        <td className={`figure px-3 py-2 text-right text-[12.5px] ${available < 0 ? "text-[#9f2f2d]" : ""}`}>
                          {available.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-[14px] border border-rule bg-surface p-5">
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Record leave</h2>
            <form action={recordLeave} className="mt-3 grid gap-3">
              <div>
                <label htmlFor="employeeId" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Employee</label>
                <select id="employeeId" name="employeeId" className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]">
                  {people.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.employeeCode} · {employee.lastName}, {employee.firstName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="leaveTypeIdEntry" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Leave type</label>
                <select id="leaveTypeIdEntry" name="leaveTypeId" className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]">
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>{type.code} · {type.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="startDate" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Start</label>
                  <input id="startDate" name="startDate" type="date" required className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]" />
                </div>
                <div>
                  <label htmlFor="endDate" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">End</label>
                  <input id="endDate" name="endDate" type="date" required className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]" />
                </div>
                <div>
                  <label htmlFor="days" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Days</label>
                  <input id="days" name="days" type="number" min={0.5} step="0.5" required className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px] tabular-nums" />
                </div>
              </div>
              <div>
                <label htmlFor="note" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Note</label>
                <input id="note" name="note" className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]" />
              </div>
              <button
                type="submit"
                disabled={!canWrite || balances.length === 0}
                className="h-9 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white hover:brightness-95 disabled:opacity-40"
              >
                Record leave
              </button>
            </form>
          </section>

          <section className="rounded-[14px] border border-rule bg-surface">
            <div className="flex items-center justify-between border-b border-rule px-5 py-3">
              <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Recent leave</h2>
              <span className="figure text-[12px] text-muted">{entries.length}</span>
            </div>
            {entries.length === 0 ? (
              <p className="px-5 py-6 text-[12.5px] text-muted">No leave recorded yet.</p>
            ) : (
              <ul>
                {entries.map(({ entry, employee, type }) => (
                  <li key={entry.id} className="flex items-center gap-3 border-b border-rule px-5 py-2.5 last:border-b-0">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px]">
                        {employee.lastName}, {employee.firstName} · {type.code}
                      </span>
                      <span className="figure block text-[11.5px] text-muted">
                        {entry.startDate} → {entry.endDate}
                      </span>
                    </span>
                    <span className="figure ml-auto text-[12.5px]">{Number(entry.days).toFixed(2)} d</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      <WorkspaceFooter />
    </>
  );
}
