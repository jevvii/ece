import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  employees,
  memberships,
  payrollCalendars,
  payrollPeriods,
  ranks,
  tenants,
  workScheduleDays,
  workSchedules,
} from "@/db/schema";
import {
  buildPeriods,
  type CalendarPattern,
  type CalendarSpec,
  validateSpec,
} from "@/lib/calendar";

/**
 * Shared company-setup logic.
 *
 * Both presentations — the guided payroll flow and the Admin stage list — call
 * these functions. Nothing here redirects or reads session state, so the same
 * behaviour is reachable from either surface.
 */

export type CompanyDetailsInput = {
  legalName: string;
  tradeName?: string;
  tin?: string;
  rdoCode?: string;
  addressLine?: string;
  regionCode?: string;
  employerType: "private" | "government";
  salaryDivisor: number;
};

export type ScheduleInput = {
  name: string;
  workdays: number[];
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isDefault: boolean;
  /** Guided setup and restarts replace the active schedule; Admin adds alongside. */
  replace: boolean;
};

export type EmployeeInput = {
  employeeCode: string;
  employeeName: string;
  tin?: string;
  birthday?: string;
  address?: string;
  hireDate: string;
  separationDate?: string;
  monthlyRate: number;
  rankId?: string;
  scheduleId?: string;
};

export type EmployeeError = { row: number; message: string };

async function audit(
  tenantId: string,
  actorUserId: string,
  entity: string,
  action: string,
  detail: Record<string, unknown>,
  entityId?: string,
) {
  await db.insert(auditEvents).values({
    tenantId,
    actorUserId,
    entity,
    entityId,
    action,
    detail,
  });
}

export async function setSalaryDivisor(tenantId: string, userId: string, divisor: number) {
  await db
    .update(tenants)
    .set({ salaryDivisor: divisor, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  await audit(tenantId, userId, "tenant", "company.divisor_updated", { salaryDivisor: divisor });
}

export async function setCompanyDetails(
  tenantId: string,
  userId: string,
  data: CompanyDetailsInput,
) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error("Company not found");

  await db
    .update(tenants)
    .set({
      ...data,
      onboardingStep: Math.max(tenant.onboardingStep, 2),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  await audit(tenantId, userId, "tenant", "company.details_updated", {
    salaryDivisor: data.salaryDivisor,
  });
}

export async function setCalendar(
  tenantId: string,
  userId: string,
  spec: CalendarSpec,
  year: number,
) {
  const problem = validateSpec(spec);
  if (problem) return { error: problem } as const;

  const name =
    spec.pattern === "26_10"
      ? "Semi-monthly · 26–10 / 11–25"
      : spec.pattern === "01_15"
        ? "Semi-monthly · 1–15 / 16–end of month"
        : "Semi-monthly · custom";

  await db
    .update(payrollCalendars)
    .set({ archivedAt: new Date() })
    .where(and(eq(payrollCalendars.tenantId, tenantId), isNull(payrollCalendars.archivedAt)));

  const [calendar] = await db
    .insert(payrollCalendars)
    .values({
      tenantId,
      name,
      patternCode: spec.pattern,
      cutoff1StartDay: spec.cutoff1Start,
      cutoff1EndDay: spec.cutoff1End,
      cutoff2StartDay: spec.cutoff2Start,
      cutoff2EndDay: spec.cutoff2End,
      paydayRule: spec.paydayRule,
      paydayOffsetDays: spec.paydayOffsetDays,
      effectiveFrom: `${year}-01-01`,
    })
    .returning();

  if (!calendar) return { error: "Could not save the calendar" } as const;

  const periods = buildPeriods(spec, year);
  if (periods.length > 0) {
    await db
      .insert(payrollPeriods)
      .values(periods.map((period) => ({ ...period, calendarId: calendar.id })));
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  await db
    .update(tenants)
    .set({ onboardingStep: Math.max(tenant?.onboardingStep ?? 1, 3), updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  // The period count is computed, never assumed.
  await audit(tenantId, userId, "payroll_calendar", "calendar.created", {
    pattern: spec.pattern,
    year,
    periods: periods.length,
  }, calendar.id);

  return { calendarId: calendar.id, periodCount: periods.length } as const;
}

export function calendarSpecFromPreset(pattern: CalendarPattern): CalendarSpec {
  return pattern === "01_15"
    ? { pattern: "01_15", cutoff1Start: 1, cutoff1End: 15, cutoff2Start: 16, cutoff2End: null, paydayRule: "same_day", paydayOffsetDays: 0 }
    : { pattern: "26_10", cutoff1Start: 26, cutoff1End: 10, cutoff2Start: 11, cutoff2End: 25, paydayRule: "same_day", paydayOffsetDays: 0 };
}

export async function setSchedule(tenantId: string, userId: string, input: ScheduleInput) {
  const active = await db
    .select({ id: workSchedules.id })
    .from(workSchedules)
    .where(and(eq(workSchedules.tenantId, tenantId), isNull(workSchedules.archivedAt)));

  if (input.replace && active.length > 0) {
    await db
      .update(workSchedules)
      .set({ archivedAt: new Date() })
      .where(and(eq(workSchedules.tenantId, tenantId), isNull(workSchedules.archivedAt)));
  }

  if (input.isDefault) {
    await db
      .update(workSchedules)
      .set({ isDefault: false })
      .where(eq(workSchedules.tenantId, tenantId));
  }

  const [schedule] = await db
    .insert(workSchedules)
    .values({
      tenantId,
      name: input.name,
      isDefault: input.isDefault,
      timezone: "Asia/Manila",
    })
    .returning();

  if (!schedule) return { error: "Could not save the schedule" } as const;

  await db.insert(workScheduleDays).values(
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      scheduleId: schedule.id,
      weekday,
      isWorkday: input.workdays.includes(weekday),
      startTime: input.workdays.includes(weekday) ? input.startTime : null,
      endTime: input.workdays.includes(weekday) ? input.endTime : null,
      breakMinutes: input.breakMinutes,
    })),
  );

  // Employees on an archived or missing schedule follow the replacement.
  if (input.replace) {
    const staleIds = active.map((row) => row.id);
    const filter = staleIds.length > 0
      ? and(
          eq(employees.tenantId, tenantId),
          isNull(employees.archivedAt),
          inArray(employees.scheduleId, staleIds),
        )
      : and(eq(employees.tenantId, tenantId), isNull(employees.archivedAt), isNull(employees.scheduleId));

    await db.update(employees).set({ scheduleId: schedule.id }).where(filter);
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  await db
    .update(tenants)
    .set({ onboardingStep: Math.max(tenant?.onboardingStep ?? 1, 4), updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  await audit(tenantId, userId, "work_schedule", "schedule.created", {
    name: input.name,
    workdays: input.workdays,
    startTime: input.startTime,
    endTime: input.endTime,
    breakMinutes: input.breakMinutes,
  }, schedule.id);

  return { scheduleId: schedule.id } as const;
}

export async function addRank(
  tenantId: string,
  userId: string,
  input: { name: string; level: number },
) {
  const [rank] = await db
    .insert(ranks)
    .values({ tenantId, name: input.name, level: input.level })
    .returning();

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  await db
    .update(tenants)
    .set({ onboardingStep: Math.max(tenant?.onboardingStep ?? 1, 5), updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  await audit(tenantId, userId, "rank", "rank.created", { name: input.name, level: input.level }, rank?.id);
  return rank ?? null;
}

/** "Dela Cruz, Maria Clara" → { lastName: "Dela Cruz", firstName: "Maria Clara" } */
export function splitEmployeeName(name: string) {
  const trimmed = name.trim();
  const comma = trimmed.indexOf(",");
  if (comma <= 0) return null;
  const lastName = trimmed.slice(0, comma).trim();
  const firstName = trimmed.slice(comma + 1).trim();
  if (!lastName || !firstName) return null;
  return { lastName, firstName };
}

export async function addEmployees(
  tenantId: string,
  userId: string,
  divisor: number,
  regionCode: string | null,
  inputs: EmployeeInput[],
) {
  const errors: EmployeeError[] = [];
  const [existing, rankRows, scheduleRows] = await Promise.all([
    db.select({ code: employees.employeeCode }).from(employees).where(eq(employees.tenantId, tenantId)),
    db.select({ id: ranks.id }).from(ranks).where(eq(ranks.tenantId, tenantId)),
    db
      .select({ id: workSchedules.id, isDefault: workSchedules.isDefault })
      .from(workSchedules)
      .where(and(eq(workSchedules.tenantId, tenantId), isNull(workSchedules.archivedAt)))
      .orderBy(asc(workSchedules.createdAt)),
  ]);
  const taken = new Set(existing.map((row) => row.code));
  const validRanks = new Set(rankRows.map((row) => row.id));
  const validSchedules = new Set(scheduleRows.map((row) => row.id));
  // "Default" in the employee form means the company's default schedule, not no
  // schedule at all. Without this, imported employees have no schedule and every
  // date — including weekends — is treated as a workday downstream.
  const defaultScheduleId = scheduleRows.find((row) => row.isDefault)?.id ?? scheduleRows[0]?.id ?? null;

  const valid: { input: EmployeeInput; name: { lastName: string; firstName: string } }[] = [];

  for (const [index, input] of inputs.entries()) {
    const name = splitEmployeeName(input.employeeName);
    if (!name) {
      errors.push({ row: index + 1, message: "Name must be written \"Last, First\"." });
      continue;
    }
    if (taken.has(input.employeeCode)) {
      errors.push({ row: index + 1, message: `Code ${input.employeeCode} is already used.` });
      continue;
    }
    if (input.rankId && !validRanks.has(input.rankId)) {
      errors.push({ row: index + 1, message: "That rank does not belong to this company." });
      continue;
    }
    if (input.scheduleId && !validSchedules.has(input.scheduleId)) {
      errors.push({ row: index + 1, message: "That schedule does not belong to this company." });
      continue;
    }

    // Claim the code now so duplicates inside the same file are caught too.
    taken.add(input.employeeCode);
    valid.push({ input, name });
  }

  // All-or-nothing: one bad row leaves the roster untouched.
  if (errors.length > 0) return { created: 0, errors };

  try {
    await db.transaction(async (tx) => {
      for (const { input, name } of valid) {
        await tx.insert(employees).values({
          tenantId,
          employeeCode: input.employeeCode,
          lastName: name.lastName,
          firstName: name.firstName,
          tin: input.tin || null,
          birthday: input.birthday || null,
          address: input.address || null,
          hireDate: input.hireDate,
          separationDate: input.separationDate || null,
          status: input.separationDate ? "separated" : "active",
          monthlyRate: input.monthlyRate.toFixed(2),
          dailyRate: (input.monthlyRate / divisor).toFixed(2),
          rankId: input.rankId || null,
          scheduleId: input.scheduleId || defaultScheduleId,
          regionCode,
        });
      }
    });
  } catch {
    return {
      created: 0,
      errors: [{ row: 0, message: "The roster could not be saved. Nothing was written." }],
    };
  }

  const created = valid.length;

  if (created > 0) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    await db
      .update(tenants)
      .set({ onboardingStep: Math.max(tenant?.onboardingStep ?? 1, 6), updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    await audit(tenantId, userId, "employee", "employee.bulk_created", {
      created,
      skipped: errors.length,
    });
  }

  return { created, errors };
}

export async function createCompany(
  userId: string,
  firmId: string | null,
  input: { legalName: string; tin: string; regionCode: string },
) {
  const [tenant] = await db
    .insert(tenants)
    .values({
      firmId,
      legalName: input.legalName,
      tin: input.tin,
      regionCode: input.regionCode,
      employerType: "private",
      salaryDivisor: 26,
      onboardingStep: 1,
    })
    .returning();

  if (!tenant) return null;

  const seatRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.tenantId, tenant.id));

  await db.insert(memberships).values({
    tenantId: tenant.id,
    userId,
    role: "company_admin",
    seatNo: (seatRows[0]?.count ?? 0) + 1,
  });

  await audit(tenant.id, userId, "tenant", "company.created", {
    legalName: input.legalName,
    tin: input.tin,
  }, tenant.id);

  return tenant;
}

export async function markSetupComplete(tenantId: string, userId: string) {
  await db
    .update(tenants)
    .set({ onboardingCompletedAt: new Date(), onboardingStep: 6, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  await audit(tenantId, userId, "tenant", "onboarding.completed", { source: "setup" });
}
