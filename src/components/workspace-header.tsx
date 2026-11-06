import Link from "next/link";
import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { Chevron } from "@/components/icon";
import { signOutAction, switchCompanyAction } from "@/app/actions/auth";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/db/client";
import { payrollCalendars, payrollPeriods } from "@/db/schema";
import { patternLabel } from "@/lib/periods";

export async function WorkspaceHeader({ breadcrumb }: { breadcrumb?: string }) {
  const { user, tenant, memberships } = await requireWorkspace();
  const today = new Date().toISOString().slice(0, 10);

  const [calendar] = await db
    .select()
    .from(payrollCalendars)
    .where(and(eq(payrollCalendars.tenantId, tenant.id), isNull(payrollCalendars.archivedAt)))
    .limit(1);

  const [period] = calendar
    ? await db
        .select()
        .from(payrollPeriods)
        .where(
          and(
            eq(payrollPeriods.calendarId, calendar.id),
            gte(payrollPeriods.coverageEnd, today),
          ),
        )
        .orderBy(asc(payrollPeriods.coverageStart))
        .limit(1)
    : [];

  const periodLabel = period ? `${period.cycleLabel} · Cutoff ${period.cutoffNo}` : "Setup in progress";

  return (
    <header className="no-print border-b border-rule bg-paper">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-3 px-5 sm:gap-5 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="ECE Accounting, workspace home">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
          <span className="text-[14.5px] font-bold tracking-[-0.01em]">ECE</span>
          <span className="hidden text-[13px] font-normal text-muted sm:inline">Accounting</span>
        </Link>

        <span className="hidden h-5 w-px bg-rule sm:block" aria-hidden="true" />

        <details className="switcher relative min-w-0">
          <summary className="flex items-center gap-2 rounded-full px-2 py-1.5 hover:bg-surface-2">
            <span className="max-w-[190px] truncate text-[13.5px] font-medium sm:max-w-none">
              {tenant.legalName}
            </span>
            <span className="tnum hidden text-[12px] text-muted sm:inline">
              {calendar ? patternLabel(calendar.patternCode) : "—"}
            </span>
            <Chevron className="chevron shrink-0 text-muted" />
          </summary>

          <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-[330px] rounded-[14px] border border-rule bg-surface p-1.5 shadow-[0_10px_30px_rgba(26,25,21,0.04)]">
            <p className="px-2.5 pb-2 pt-1.5 text-[11px] uppercase tracking-[0.12em] text-muted">
              {memberships.length} {memberships.length === 1 ? "company" : "companies"} · {user.name}
            </p>

            {memberships.map((row) => {
              const current = row.tenant.id === tenant.id;
              return (
                <form key={row.tenant.id} action={switchCompanyAction}>
                  <input type="hidden" name="tenantId" value={row.tenant.id} />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between gap-3 rounded-[9px] px-2.5 py-2 text-left hover:bg-surface-2"
                  >
                    <span className={current ? "text-[13.5px] font-medium" : "text-[13.5px] text-ink-2"}>
                      {row.tenant.legalName}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11.5px] uppercase tracking-[0.06em] text-muted">
                        {row.membership.role.replaceAll("_", " ")}
                      </span>
                      {current ? (
                        <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-label="Current company" />
                      ) : null}
                    </span>
                  </button>
                </form>
              );
            })}

            <div className="mt-1 flex items-center justify-between border-t border-rule px-2.5 py-2">
              <Link href="/admin" className="text-[12px] text-ink-2 hover:text-ink">
                Company setup
              </Link>
              <form action={signOutAction}>
                <button type="submit" className="text-[12px] text-muted hover:text-ink">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </details>

        {breadcrumb ? (
          <span className="hidden min-w-0 items-center gap-3 sm:flex">
            <span className="text-[12.5px] text-rule-strong" aria-hidden="true">
              /
            </span>
            <span className="truncate text-[13px] text-ink-2">{breadcrumb}</span>
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-5">
          <span className="tnum hidden font-mono text-[12px] uppercase tracking-[0.08em] text-muted md:inline">
            {periodLabel}
          </span>
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-[11.5px] font-semibold tracking-[0.04em] text-accent"
            title={`${user.name} · ${user.email}`}
          >
            {user.name
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </span>
        </div>
      </div>
    </header>
  );
}

export function WorkspaceFooter() {
  return (
    <footer className="no-print mt-auto border-t border-rule bg-paper">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" />
          <span className="text-[12px] text-ink-2">
            Ledger rules <span className="font-mono">PH-2026.1</span>
            <span className="mx-1.5 text-rule-strong" aria-hidden="true">·</span>
            pending accountant approval
          </span>
        </div>
        <span className="text-[12px] text-muted">Demo workspace · synthetic data</span>
      </div>
    </footer>
  );
}
