import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, payrollCalendars, ranks, tenants, workSchedules } from "@/db/schema";

/** Stages built in this flow. The first three gate payroll; ranks and employees do not. */
export const setupStages = [
  { n: 1, key: "profile", label: "Company details", required: true },
  { n: 2, key: "calendar", label: "Cutoff calendar", required: true },
  { n: 3, key: "schedule", label: "Work schedules", required: true },
  { n: 4, key: "ranks", label: "Ranks", required: false },
  { n: 5, key: "employees", label: "Employee master", required: false },
] as const;

/** Defined in the specification, visible as "Later", never blocking. */
export const deferredStages = [
  { n: 6, key: "leaves", label: "Leave policy" },
  { n: 7, key: "components", label: "Pay components" },
  { n: 8, key: "accounts", label: "Posting accounts" },
  { n: 9, key: "mapping", label: "Import mapping" },
  { n: 10, key: "openings", label: "Opening balances" },
  { n: 11, key: "validation", label: "Sample validation" },
] as const;

export type SetupCheck = {
  key: string;
  label: string;
  done: boolean;
  required: boolean;
  built: boolean;
};

export type SetupState = {
  profile: boolean;
  calendar: boolean;
  schedule: boolean;
  ranks: boolean;
  employees: boolean;
  requiredComplete: boolean;
  nextStep: number;
  checks: SetupCheck[];
};

export async function getSetupState(
  tenant: typeof tenants.$inferSelect,
): Promise<SetupState> {
  const [calendar, scheduleRows, rankRows, peopleRows] = await Promise.all([
    db
      .select({ id: payrollCalendars.id })
      .from(payrollCalendars)
      .where(and(eq(payrollCalendars.tenantId, tenant.id), isNull(payrollCalendars.archivedAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(workSchedules)
      .where(and(eq(workSchedules.tenantId, tenant.id), isNull(workSchedules.archivedAt))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ranks)
      .where(eq(ranks.tenantId, tenant.id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(employees)
      .where(and(eq(employees.tenantId, tenant.id), isNull(employees.archivedAt))),
  ]);

  const profile = Boolean(tenant.legalName && tenant.tin);
  const hasCalendar = Boolean(calendar);
  const hasSchedule = (scheduleRows[0]?.count ?? 0) > 0;
  const hasRanks = (rankRows[0]?.count ?? 0) > 0;
  const hasEmployees = (peopleRows[0]?.count ?? 0) > 0;

  const checks: SetupCheck[] = [
    ...setupStages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      required: stage.required,
      built: true,
      done:
        stage.key === "profile"
          ? profile
          : stage.key === "calendar"
            ? hasCalendar
            : stage.key === "schedule"
              ? hasSchedule
              : stage.key === "ranks"
                ? hasRanks
                : hasEmployees,
    })),
    ...deferredStages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      required: false,
      built: false,
      done: false,
    })),
  ];

  const nextStep = !profile
    ? 1
    : !hasCalendar
      ? 2
      : !hasSchedule
        ? 3
        : !hasRanks
          ? 4
          : !hasEmployees
            ? 5
            : 6;

  return {
    profile,
    calendar: hasCalendar,
    schedule: hasSchedule,
    ranks: hasRanks,
    employees: hasEmployees,
    requiredComplete: profile && hasCalendar && hasSchedule,
    nextStep,
    checks,
  };
}
