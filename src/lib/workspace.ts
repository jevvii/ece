import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  employees,
  glAccounts,
  importProfiles,
  leaveBalances,
  payJournals,
  payRuns,
  payrollCalendars,
  payrollPeriods,
  tenants,
  workSchedules,
} from "@/db/schema";

export async function getActiveCalendar(tenantId: string) {
  const [calendar] = await db
    .select()
    .from(payrollCalendars)
    .where(and(eq(payrollCalendars.tenantId, tenantId), isNull(payrollCalendars.archivedAt)))
    .limit(1);
  return calendar ?? null;
}

export async function getOpenPeriod(tenantId: string) {
  const calendar = await getActiveCalendar(tenantId);
  if (!calendar) return null;

  const today = new Date().toISOString().slice(0, 10);
  const [period] = await db
    .select()
    .from(payrollPeriods)
    .where(
      and(eq(payrollPeriods.calendarId, calendar.id), gte(payrollPeriods.coverageEnd, today)),
    )
    .orderBy(asc(payrollPeriods.coverageStart))
    .limit(1);

  return period ?? null;
}

export type SetupProgress = {
  done: number;
  total: number;
  nextLabel: string;
  checks: { key: string; label: string; done: boolean }[];
};

export async function getSetupProgress(tenant: typeof tenants.$inferSelect): Promise<SetupProgress> {
  const [calendar, schedules, people, balances, runs, journals, profiles, accounts] = await Promise.all([
    getActiveCalendar(tenant.id),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(workSchedules)
      .where(and(eq(workSchedules.tenantId, tenant.id), isNull(workSchedules.archivedAt))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(employees)
      .where(and(eq(employees.tenantId, tenant.id), isNull(employees.archivedAt))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(leaveBalances)
      .where(eq(leaveBalances.tenantId, tenant.id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(payRuns)
      .where(eq(payRuns.tenantId, tenant.id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(payJournals)
      .where(eq(payJournals.tenantId, tenant.id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(importProfiles)
      .where(eq(importProfiles.tenantId, tenant.id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(glAccounts)
      .where(eq(glAccounts.tenantId, tenant.id)),
  ]);

  const checks = [
    { key: "profile", label: "Company details", done: Boolean(tenant.legalName && tenant.tin) },
    { key: "calendar", label: "Cutoff calendar", done: Boolean(calendar) },
    { key: "schedules", label: "Work schedules", done: (schedules[0]?.count ?? 0) > 0 },
    { key: "employees", label: "Employee master", done: (people[0]?.count ?? 0) > 0 },
    { key: "leaves", label: "Leave policy", done: (balances[0]?.count ?? 0) > 0 },
    { key: "components", label: "Pay components", done: (runs[0]?.count ?? 0) > 0 },
    { key: "accounts", label: "Posting accounts", done: (journals[0]?.count ?? 0) > 0 || (accounts[0]?.count ?? 0) > 0 },
    { key: "mapping", label: "Import mapping", done: (profiles[0]?.count ?? 0) > 0 },
    { key: "openings", label: "Opening balances", done: false },
    { key: "validation", label: "Sample validation", done: false },
  ];

  const done = checks.filter((check) => check.done).length;
  const next = checks.find((check) => !check.done);

  return {
    done,
    total: checks.length,
    nextLabel: next?.label ?? "Ready to run payroll",
    checks,
  };
}
