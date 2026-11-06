import Link from "next/link";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { AdminTabs } from "@/components/admin-tabs";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import { employees, memberships, users } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { getActiveCalendar, getSetupProgress } from "@/lib/workspace";

const seatLabel: Record<string, string> = {
  company_admin: "Company admin",
  payroll_officer: "Payroll officer",
  approver: "Approver",
  viewer: "Viewer",
};

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { tenant, user, membership } = await requireWorkspace();
  const { error } = await searchParams;

  const [progress, calendar, seats, people] = await Promise.all([
    getSetupProgress(tenant),
    getActiveCalendar(tenant.id),
    db
      .select({ membership: memberships, user: users })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.tenantId, tenant.id))
      .orderBy(asc(memberships.seatNo)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(employees)
      .where(and(eq(employees.tenantId, tenant.id), isNull(employees.archivedAt))),
  ]);

  const employeeCount = people[0]?.count ?? 0;
  const canSetup = membership.role === "company_admin" || membership.role === "payroll_officer";
  const firstOpenBuilt = progress.checks.findIndex((check, index) => index < 4 && !check.done);
  const continueStep = firstOpenBuilt === -1 ? 4 : firstOpenBuilt + 1;

  return (
    <>
      <WorkspaceHeader breadcrumb="Admin" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/" className="text-[12.5px] text-muted hover:text-ink-2">
          ← All modules
        </Link>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              Admin · shared by every module
            </p>
            <h1 className="mt-4 font-serif text-[clamp(2.5rem,5vw,3.5rem)] leading-[1.02] tracking-[-0.035em]">
              Company setup
            </h1>
            <p className="mt-5 max-w-[58ch] text-[14.5px] leading-[1.65] text-ink-2">
              One company, one chart of accounts, one numbering policy. Payroll, cash, billing and
              inventory all read the same records from here.
            </p>
          </div>
          <p className="figure text-[12px] text-muted">
            setup v{tenant.setupVersion} · {progress.done}/{progress.total} complete
          </p>
        </div>

        <AdminTabs current="overview" />

        {error ? (
          <div role="alert" className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {error === "not-allowed"
              ? "Only a company admin or payroll officer can change setup."
              : decodeURIComponent(error)}
          </div>
        ) : null}

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[14px] border border-rule bg-surface">
            <div className="flex items-center justify-between border-b border-rule px-5 py-3">
              <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Setup checklist</h2>
              <span className="figure text-[12px] text-muted">
                {progress.done} of {progress.total}
              </span>
            </div>
            <div className="h-[2px] bg-rule">
              <div
                className="h-full bg-accent transition-[width] duration-300"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <ol>
              {progress.checks.map((check, index) => (
                <li
                  key={check.key}
                  className="flex items-center gap-3 border-b border-rule px-5 py-3 last:border-b-0"
                >
                  <span className="figure w-5 text-[11.5px] text-muted">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                      check.done ? "bg-accent" : "border border-rule-strong"
                    }`}
                    aria-hidden="true"
                  />
                  <span className={check.done ? "text-[13px] text-ink-2" : "text-[13px]"}>
                    {check.label}
                  </span>
                  <span className="ml-auto text-[11.5px] uppercase tracking-[0.08em] text-muted">
                    {check.done ? "Done" : index < 4 ? "Open" : "Later"}
                  </span>
                </li>
              ))}
            </ol>
            {canSetup ? (
              <div className="border-t border-rule px-5 py-3">
                <Link
                  href={`/admin/setup?step=${continueStep}`}
                  className="text-[12.5px] text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-ink"
                >
                  Continue setup
                </Link>
              </div>
            ) : null}
          </section>

          <div className="space-y-6">
            <section className="rounded-[14px] border border-rule bg-surface p-5">
              <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Company</h2>
              <dl className="mt-4 space-y-3">
                {[
                  ["Registered name", tenant.legalName],
                  ["Trade name", tenant.tradeName ?? "—"],
                  ["TIN", tenant.tin ?? "—"],
                  ["RDO", tenant.rdoCode ?? "—"],
                  ["Region", tenant.regionCode ?? "—"],
                  ["Salary divisor", `${tenant.salaryDivisor} days`],
                  ["Cutoff calendar", calendar?.name ?? "Not set"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 border-b border-rule pb-2 last:border-b-0 last:pb-0">
                    <dt className="text-[12px] text-muted">{label}</dt>
                    <dd className="text-right text-[13px]">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="rounded-[14px] border border-rule bg-surface">
              <div className="flex items-center justify-between border-b border-rule px-5 py-3">
                <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Seats</h2>
                <span className="figure text-[12px] text-muted">{seats.length} of 3</span>
              </div>
              <ul>
                {seats.map((seat) => (
                  <li key={seat.membership.id} className="flex items-center gap-3 border-b border-rule px-5 py-3 last:border-b-0">
                    <span className="figure text-[11.5px] text-muted">
                      {String(seat.membership.seatNo).padStart(2, "0")}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px]">{seat.user.name}</span>
                      <span className="block truncate text-[11.5px] text-muted">{seat.user.email}</span>
                    </span>
                    <span className="ml-auto text-[11.5px] uppercase tracking-[0.06em] text-muted">
                      {seatLabel[seat.membership.role] ?? seat.membership.role}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="px-5 py-3 text-[12px] text-muted">
                {employeeCount} employees · employee records do not consume a seat.
              </div>
            </section>

            <section className="rounded-[14px] border border-rule bg-surface p-5">
              <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Signed in</h2>
              <p className="mt-2 text-[13px]">{user.name}</p>
              <p className="text-[12px] text-muted">
                {membership.role.replaceAll("_", " ")} on this company
              </p>
            </section>
          </div>
        </div>
      </main>

      <WorkspaceFooter />
    </>
  );
}
