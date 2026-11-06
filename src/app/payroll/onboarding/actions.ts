"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  employees,
  payrollCalendars,
  payrollPeriods,
  tenants,
  workScheduleDays,
  workSchedules,
} from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { buildPeriods, calendarPresets, validateSpec } from "@/lib/calendar";

const allowedDivisors = new Set([22, 26, 30]);
const workweeks: Record<string, { label: string; days: number[] }> = {
  monfri: { label: "Mon–Fri", days: [1, 2, 3, 4, 5] },
  monsat: { label: "Mon–Sat", days: [1, 2, 3, 4, 5, 6] },
  suntue: { label: "Sun–Thu", days: [7, 1, 2, 3, 4] },
};

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function completeOnboarding(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();

  if (membership.role !== "company_admin" && membership.role !== "payroll_officer") {
    redirect("/payroll/onboarding?error=Your+role+cannot+complete+company+setup");
  }

  const divisor = Number(formData.get("divisor") ?? 0);
  const pattern = String(formData.get("pattern") ?? "26_10");
  const workweekKey = String(formData.get("workweek") ?? "monfri");
  const startTime = String(formData.get("startTime") ?? "08:00");
  const endTime = String(formData.get("endTime") ?? "17:00");
  const breakMinutes = Number(formData.get("breakMinutes") ?? 60);

  if (!allowedDivisors.has(divisor)) {
    redirect("/payroll/onboarding?error=Choose+a+salary+divisor");
  }
  if (pattern !== "26_10" && pattern !== "01_15") {
    redirect("/payroll/onboarding?error=Choose+a+cutoff+pattern");
  }

  const workweek = workweeks[workweekKey];
  if (!workweek) {
    redirect("/payroll/onboarding?error=Choose+a+workweek");
  }
  if (!timePattern.test(startTime) || !timePattern.test(endTime) || startTime >= endTime) {
    redirect("/payroll/onboarding?error=Check+the+working+hours");
  }
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 240) {
    redirect("/payroll/onboarding?error=Check+the+unpaid+break");
  }

  const spec = pattern === "01_15" ? calendarPresets["01_15"] : calendarPresets["26_10"];
  const problem = validateSpec(spec);
  if (problem) {
    redirect(`/payroll/onboarding?error=${encodeURIComponent(problem)}`);
  }

  const year = new Date().getFullYear();

  await db
    .update(payrollCalendars)
    .set({ archivedAt: new Date() })
    .where(and(eq(payrollCalendars.tenantId, tenant.id), isNull(payrollCalendars.archivedAt)));

  const staleSchedules = await db
    .select({ id: workSchedules.id })
    .from(workSchedules)
    .where(and(eq(workSchedules.tenantId, tenant.id), isNull(workSchedules.archivedAt)));

  await db
    .update(workSchedules)
    .set({ archivedAt: new Date() })
    .where(and(eq(workSchedules.tenantId, tenant.id), isNull(workSchedules.archivedAt)));

  const [calendar] = await db
    .insert(payrollCalendars)
    .values({
      tenantId: tenant.id,
      name:
        pattern === "26_10"
          ? "Semi-monthly · 26–10 / 11–25"
          : "Semi-monthly · 1–15 / 16–end of month",
      patternCode: pattern,
      cutoff1StartDay: spec.cutoff1Start,
      cutoff1EndDay: spec.cutoff1End,
      cutoff2StartDay: spec.cutoff2Start,
      cutoff2EndDay: spec.cutoff2End,
      paydayRule: spec.paydayRule,
      paydayOffsetDays: spec.paydayOffsetDays,
      effectiveFrom: `${year}-01-01`,
    })
    .returning();

  if (!calendar) redirect("/payroll/onboarding?error=Could+not+create+the+cutoff+calendar");

  await db
    .insert(payrollPeriods)
    .values(buildPeriods(spec, year).map((period) => ({ ...period, calendarId: calendar.id })));

  const [schedule] = await db
    .insert(workSchedules)
    .values({
      tenantId: tenant.id,
      name: `${workweek.label} · ${startTime} to ${endTime}`,
      isDefault: true,
      timezone: "Asia/Manila",
    })
    .returning();

  if (!schedule) redirect("/payroll/onboarding?error=Could+not+create+the+work+schedule");

  await db.insert(workScheduleDays).values(
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      scheduleId: schedule.id,
      weekday,
      isWorkday: workweek.days.includes(weekday),
      startTime: workweek.days.includes(weekday) ? startTime : null,
      endTime: workweek.days.includes(weekday) ? endTime : null,
      breakMinutes,
    })),
  );

  // Employees still pointing at an archived (or missing) schedule follow the new one.
  const staleIds = staleSchedules.map((row) => row.id);
  const employeeFilter =
    staleIds.length > 0
      ? and(
          eq(employees.tenantId, tenant.id),
          isNull(employees.archivedAt),
          or(isNull(employees.scheduleId), inArray(employees.scheduleId, staleIds)),
        )
      : and(eq(employees.tenantId, tenant.id), isNull(employees.archivedAt), isNull(employees.scheduleId));

  await db.update(employees).set({ scheduleId: schedule.id }).where(employeeFilter);

  await db
    .update(tenants)
    .set({
      salaryDivisor: divisor,
      onboardingStep: 4,
      onboardingCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenant.id));

  await db.insert(auditEvents).values({
    tenantId: tenant.id,
    actorUserId: user.id,
    entity: "tenant",
    entityId: tenant.id,
    action: "onboarding.completed",
    detail: { divisor, pattern, workweek: workweekKey, startTime, endTime, breakMinutes, year },
  });

  revalidatePath("/payroll");
  redirect("/payroll?setup=done");
}
