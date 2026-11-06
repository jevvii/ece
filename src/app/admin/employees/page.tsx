import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { AdminTabs } from "@/components/admin-tabs";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import { employees, ranks, workSchedules } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { createEmployee } from "../setup/actions";

const input =
  "mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-3 text-[13.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";
const label = "block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { tenant, membership } = await requireWorkspace();
  const params = await searchParams;
  const canSetup = membership.role === "company_admin" || membership.role === "payroll_officer";

  const [rows, rankList, scheduleList] = await Promise.all([
    db
      .select({ employee: employees, rank: ranks, schedule: workSchedules })
      .from(employees)
      .leftJoin(ranks, eq(ranks.id, employees.rankId))
      .leftJoin(workSchedules, eq(workSchedules.id, employees.scheduleId))
      .where(and(eq(employees.tenantId, tenant.id), isNull(employees.archivedAt)))
      .orderBy(asc(employees.employeeCode)),
    db.select().from(ranks).where(eq(ranks.tenantId, tenant.id)).orderBy(asc(ranks.level)),
    db
      .select()
      .from(workSchedules)
      .where(and(eq(workSchedules.tenantId, tenant.id), isNull(workSchedules.archivedAt)))
      .orderBy(asc(workSchedules.createdAt)),
  ]);

  return (
    <>
      <WorkspaceHeader breadcrumb="Admin / Employees" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/admin" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Admin
        </Link>

        <div className="mt-6">
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Employee master · {rows.length} active
          </p>
          <h1 className="mt-4 font-serif text-[clamp(2.25rem,4.5vw,3rem)] leading-[1.04] tracking-[-0.03em]">
            Employees
          </h1>
          <p className="mt-4 max-w-[60ch] text-[14px] leading-[1.65] text-ink-2">
            Company codes are stable and never reused. Names never create an employee — imports match
            on the code, and unknown codes stop at review.
          </p>
        </div>

        <AdminTabs current="employees" />

        {params.error ? (
          <div role="alert" className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {decodeURIComponent(params.error)}
          </div>
        ) : null}
        {params.saved ? (
          <div className="mt-6 rounded-[10px] border border-accent/20 bg-accent-soft px-4 py-3 text-[13px] text-accent">
            Employee added. The daily rate was derived from the {tenant.salaryDivisor}-day divisor.
          </div>
        ) : null}

        <div className="mt-8 rounded-[14px] border border-rule bg-surface">
          <div className="scroll-x">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-rule">
                  {["Code", "Employee", "Rank", "Schedule", "Monthly", "Daily"].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted ${
                        heading === "Monthly" || heading === "Daily" ? "text-right" : ""
                      }`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ employee, rank, schedule }) => (
                  <tr key={employee.id} className="border-b border-rule last:border-b-0 hover:bg-surface-2">
                    <td className="figure px-4 py-3 text-[12.5px] text-ink-2">{employee.employeeCode}</td>
                    <td className="px-4 py-3 text-[13px]">
                      {employee.lastName}, {employee.firstName}
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-ink-2">{rank?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-ink-2">{schedule?.name ?? "—"}</td>
                    <td className="figure px-4 py-3 text-right text-[13px]">
                      {peso.format(Number(employee.monthlyRate))}
                    </td>
                    <td className="figure px-4 py-3 text-right text-[13px] text-ink-2">
                      {employee.dailyRate ? peso.format(Number(employee.dailyRate)) : "—"}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-muted">
                      No employees yet. Add the first one below.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <section className="mt-8 rounded-[14px] border border-rule bg-surface p-6">
          <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Add employee</h2>
          <p className="mt-1.5 text-[12.5px] text-muted">
            Daily rate is computed as monthly ÷ {tenant.salaryDivisor} and stays auditable.
          </p>

          <form action={createEmployee} className="mt-5 grid gap-4 sm:grid-cols-6">
            <div>
              <label htmlFor="employeeCode" className={label}>Code</label>
              <input id="employeeCode" name="employeeCode" required placeholder="BAY-0009" className={input} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="lastName" className={label}>Last name</label>
              <input id="lastName" name="lastName" required className={input} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="firstName" className={label}>First name</label>
              <input id="firstName" name="firstName" required className={input} />
            </div>
            <div>
              <label htmlFor="hireDate" className={label}>Hire date</label>
              <input id="hireDate" name="hireDate" type="date" required defaultValue="2026-01-05" className={input} />
            </div>
            <div>
              <label htmlFor="monthlyRate" className={label}>Monthly rate</label>
              <input id="monthlyRate" name="monthlyRate" type="number" min={0} step="0.01" required className={`${input} tabular-nums`} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="rankId" className={label}>Rank</label>
              <select id="rankId" name="rankId" defaultValue="" className={input}>
                <option value="">No rank</option>
                {rankList.map((rank) => (
                  <option key={rank.id} value={rank.id}>{rank.name}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="scheduleId" className={label}>Schedule</label>
              <select id="scheduleId" name="scheduleId" defaultValue="" className={input}>
                <option value="">No schedule</option>
                {scheduleList.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>{schedule.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end sm:col-span-1">
              <button
                type="submit"
                disabled={!canSetup}
                className="h-10 w-full rounded-full bg-accent px-4 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </form>
        </section>
      </main>

      <WorkspaceFooter />
    </>
  );
}
