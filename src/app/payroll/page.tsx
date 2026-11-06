import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { Arrow } from "@/components/icon";
import { PayrollCard } from "@/components/module-card";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { requireWorkspace } from "@/lib/auth";
import { payrollApps } from "@/lib/navigation";
import { formatRange } from "@/lib/periods";
import { db } from "@/db/client";
import { importRuns, leaveBalances, payJournals, payRuns } from "@/db/schema";
import { getActiveCalendar, getOpenPeriod, getSetupProgress } from "@/lib/workspace";

export default async function PayrollHomePage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const params = await searchParams;
  const { tenant } = await requireWorkspace();
  const [calendar, period, progress, latestRun, allRuns, journalCount, balanceCount] = await Promise.all([
    getActiveCalendar(tenant.id),
    getOpenPeriod(tenant.id),
    getSetupProgress(tenant),
    db
      .select()
      .from(importRuns)
      .where(eq(importRuns.tenantId, tenant.id))
      .orderBy(desc(importRuns.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ id: payRuns.id, status: payRuns.status, cutoffNo: payRuns.cutoffNo, cycleLabel: payRuns.cycleLabel })
      .from(payRuns)
      .where(eq(payRuns.tenantId, tenant.id))
      .orderBy(desc(payRuns.createdAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(payJournals)
      .where(eq(payJournals.tenantId, tenant.id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leaveBalances)
      .where(eq(leaveBalances.tenantId, tenant.id)),
  ]);

  if (!calendar) redirect("/payroll/onboarding");

  const approvedRuns = allRuns.filter((run) => run.status === "approved");
  const journals = journalCount[0]?.count ?? 0;
  const balances = balanceCount[0]?.count ?? 0;

  const apps = payrollApps.map((app) => {
    if (app.slug === "time-report") {
      if (!latestRun) return app;
      if (latestRun.status === "imported") {
        return { ...app, status: `${latestRun.rowCount} rows imported`, tone: "idle" as const };
      }
      if (latestRun.status === "review") {
        return { ...app, status: "Needs employee binding", tone: "active" as const };
      }
      return { ...app, status: "Mapping in progress", tone: "active" as const };
    }

    if (app.slug === "computation") {
      const latest = allRuns[0];
      if (!latest) return app;
      return {
        ...app,
        status: latest.status === "approved"
          ? `${latest.cycleLabel} · approved`
          : `${latest.cycleLabel} · ${latest.status}`,
        tone: latest.status === "approved" ? ("idle" as const) : ("active" as const),
      };
    }

    if (app.slug === "payslip") {
      return approvedRuns.length > 0
        ? { ...app, status: `${approvedRuns.length} run${approvedRuns.length === 1 ? "" : "s"} issued`, tone: "idle" as const }
        : app;
    }

    if (app.slug === "journal") {
      return journals > 0
        ? { ...app, status: `${journals} journal${journals === 1 ? "" : "s"}`, tone: "idle" as const }
        : app;
    }

    if (app.slug === "leaves") {
      return balances > 0
        ? { ...app, status: `${balances} balances`, tone: "idle" as const }
        : app;
    }

    if (app.slug === "annualization") {
      return approvedRuns.length > 0
        ? {
            ...app,
            status: `Projected · ${approvedRuns.length} cutoff${approvedRuns.length === 1 ? "" : "s"}`,
            tone: "active" as const,
          }
        : app;
    }

    if (app.slug === "2316") {
      return approvedRuns.length > 0
        ? { ...app, status: `${approvedRuns.length} cutoff${approvedRuns.length === 1 ? "" : "s"} annualized`, tone: "idle" as const }
        : app;
    }

    return app;
  });

  const context = [
    {
      label: "Company",
      value: tenant.legalName,
      meta: calendar ? `${calendar.name}` : "No cutoff calendar yet",
    },
    {
      label: "Open cutoff",
      value: period ? `${period.cycleLabel} · cutoff ${period.cutoffNo}` : "None",
      meta: period
        ? `${formatRange(period.coverageStart, period.coverageEnd)} · draft`
        : "Finish setup to open a cutoff",
    },
    {
      label: "Company setup",
      value: `${progress.done} of ${progress.total} steps`,
      meta: `Next: ${progress.nextLabel}`,
    },
  ];

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        {params.setup === "done" ? (
          <div className="mb-6 flex items-center gap-2 rounded-[10px] border border-accent/20 bg-accent-soft px-4 py-3 text-[13px] text-accent">
            Payroll setup complete. Import the first time report when you are ready.
          </div>
        ) : null}
        <Link href="/" className="text-[12.5px] text-muted hover:text-ink-2">
          ← All modules
        </Link>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-8">
          <div>
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              Payroll · semi-monthly
            </p>
            <h1 className="mt-3 font-serif text-[34px] leading-[1.05] tracking-[-0.03em] sm:text-[44px] sm:leading-[1.02]">
              Payroll
            </h1>
            <p className="mt-4 max-w-[56ch] text-[14px] leading-[1.65] text-ink-2">
              Seven apps, one cutoff at a time. Time is imported, computed, approved, paid, and
              posted — each step frozen once it is approved.
            </p>
          </div>
        </div>

        <div className="mt-10 grid divide-y divide-rule overflow-hidden rounded-[14px] border border-rule bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {context.map((item) => (
            <div key={item.label} className="px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{item.label}</p>
              <p className="mt-1.5 truncate text-[13.5px] font-medium">{item.value}</p>
              <p className="mt-0.5 truncate text-[12.5px] text-muted">{item.meta}</p>
            </div>
          ))}
        </div>

        <div className="hairline-grid mt-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app, index) => (
            <PayrollCard key={app.slug} app={app} index={index} />
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-rule pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-muted">
            Cutoff rules, work schedules, leave policy and pay components live in Admin.
          </p>
          <Link
            href="/admin"
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-2 hover:text-ink"
          >
            Company setup <Arrow />
          </Link>
        </div>
      </main>

      <WorkspaceFooter />
    </>
  );
}
