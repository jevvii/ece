import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { payrollCalendars, payrollPeriods, tenants } from "@/db/schema";
import { getSetupState, type SetupCheck } from "@/lib/setup/stages";

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
  requiredComplete: boolean;
  checks: SetupCheck[];
};

/**
 * Setup progress for the Admin stage list and the payroll launcher.
 *
 * Only the first three stages gate payroll (company details, calendar and work
 * schedule). Ranks and employees are encouraged but never block, and the six
 * deferred stages are reported as "Later" rather than counted as incomplete work.
 */
export async function getSetupProgress(
  tenant: typeof tenants.$inferSelect,
): Promise<SetupProgress> {
  const state = await getSetupState(tenant);
  const built = state.checks.filter((check) => check.built);
  const done = built.filter((check) => check.done).length;
  const next = built.find((check) => !check.done);

  return {
    done,
    total: built.length,
    nextLabel: next?.label ?? "Ready to run payroll",
    requiredComplete: state.requiredComplete,
    checks: state.checks,
  };
}
