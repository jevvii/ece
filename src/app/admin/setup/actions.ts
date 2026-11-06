"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
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
import { buildPeriods, type CalendarPattern, type CalendarSpec, validateSpec } from "@/lib/calendar";

const setupRoles = new Set(["company_admin", "payroll_officer"]);

function assertSetupRole(role: string) {
  if (!setupRoles.has(role)) {
    redirect("/admin?error=not-allowed");
  }
}

const companySchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  tradeName: z.string().trim().max(120).optional(),
  tin: z.string().trim().min(9).max(20),
  rdoCode: z.string().trim().max(8).optional(),
  addressLine: z.string().trim().max(240).optional(),
  regionCode: z.string().trim().max(12).optional(),
  employerType: z.enum(["private", "government"]),
  salaryDivisor: z.coerce.number().int().refine((n) => [22, 26, 30].includes(n), {
    message: "Divisor must be 22, 26 or 30.",
  }),
});

export async function saveCompanyDetails(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertSetupRole(membership.role);

  const parsed = companySchema.safeParse({
    legalName: formData.get("legalName"),
    tradeName: formData.get("tradeName") || undefined,
    tin: formData.get("tin"),
    rdoCode: formData.get("rdoCode") || undefined,
    addressLine: formData.get("addressLine") || undefined,
    regionCode: formData.get("regionCode") || undefined,
    employerType: formData.get("employerType"),
    salaryDivisor: formData.get("salaryDivisor"),
  });

  if (!parsed.success) {
    redirect(`/admin/setup?step=1&error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the form")}`);
  }

  await db
    .update(tenants)
    .set({
      ...parsed.data,
      onboardingStep: Math.max(tenant.onboardingStep, 2),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenant.id));

  await db.insert(auditEvents).values({
    tenantId: tenant.id,
    actorUserId: user.id,
    entity: "tenant",
    entityId: tenant.id,
    action: "company.details_updated",
    detail: { salaryDivisor: parsed.data.salaryDivisor },
  });

  revalidatePath("/admin");
  redirect("/admin/setup?step=2&saved=1");
}

export async function saveCalendar(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertSetupRole(membership.role);

  const pattern = String(formData.get("pattern") ?? "26_10") as CalendarPattern;
  const spec: CalendarSpec = {
    pattern,
    cutoff1Start: Number(formData.get("cutoff1Start") ?? 26),
    cutoff1End: Number(formData.get("cutoff1End") ?? 10),
    cutoff2Start: Number(formData.get("cutoff2Start") ?? 11),
    cutoff2End: formData.get("cutoff2End") === "" ? null : Number(formData.get("cutoff2End") ?? 25),
    paydayRule:
      (String(formData.get("paydayRule") ?? "same_day") as CalendarSpec["paydayRule"]) ?? "same_day",
    paydayOffsetDays: Number(formData.get("paydayOffsetDays") ?? 0),
  };

  const problem = validateSpec(spec);
  if (problem) {
    redirect(`/admin/setup?step=2&error=${encodeURIComponent(problem)}`);
  }

  const year = Number(formData.get("year") ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    redirect("/admin/setup?step=2&error=Choose+a+valid+period+year");
  }

  // Replacing a calendar archives it. Nothing is deleted, and periods keep their history.
  await db
    .update(payrollCalendars)
    .set({ archivedAt: new Date() })
    .where(and(eq(payrollCalendars.tenantId, tenant.id), isNull(payrollCalendars.archivedAt)));

  const [calendar] = await db
    .insert(payrollCalendars)
    .values({
      tenantId: tenant.id,
      name:
        pattern === "26_10"
          ? "Semi-monthly · 26–10 / 11–25"
          : pattern === "01_15"
            ? "Semi-monthly · 1–15 / 16–end of month"
            : "Semi-monthly · custom",
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

  if (!calendar) redirect("/admin/setup?step=2&error=Could+not+save+the+calendar");

  await db
    .insert(payrollPeriods)
    .values(buildPeriods(spec, year).map((period) => ({ ...period, calendarId: calendar.id })));

  await db
    .update(tenants)
    .set({ onboardingStep: Math.max(tenant.onboardingStep, 3), updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  await db.insert(auditEvents).values({
    tenantId: tenant.id,
    actorUserId: user.id,
    entity: "payroll_calendar",
    entityId: calendar.id,
    action: "calendar.created",
    detail: { pattern, year, periods: 24 },
  });

  revalidatePath("/admin");
  redirect("/admin/setup?step=3&saved=1");
}

export async function saveSchedule(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertSetupRole(membership.role);

  const name = String(formData.get("name") ?? "").trim();
  const startTime = String(formData.get("startTime") ?? "08:00");
  const endTime = String(formData.get("endTime") ?? "17:00");
  const breakMinutes = Number(formData.get("breakMinutes") ?? 60);
  const workdays = [1, 2, 3, 4, 5, 6, 7].filter((day) => formData.get(`day-${day}`) === "on");

  if (name.length < 2) redirect("/admin/setup?step=3&error=Give+the+schedule+a+name");
  if (workdays.length === 0) redirect("/admin/setup?step=3&error=Select+at+least+one+workday");
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    redirect("/admin/setup?step=3&error=Times+must+be+HH:MM");
  }
  const existing = await db
    .select({ id: workSchedules.id })
    .from(workSchedules)
    .where(and(eq(workSchedules.tenantId, tenant.id), isNull(workSchedules.archivedAt)));

  const makeDefault = formData.get("isDefault") === "on" || existing.length === 0;

  if (makeDefault) {
    await db
      .update(workSchedules)
      .set({ isDefault: false })
      .where(eq(workSchedules.tenantId, tenant.id));
  }

  const [schedule] = await db
    .insert(workSchedules)
    .values({ tenantId: tenant.id, name, isDefault: makeDefault, timezone: "Asia/Manila" })
    .returning();

  if (!schedule) redirect("/admin/setup?step=3&error=Could+not+save+the+schedule");

  await db.insert(workScheduleDays).values(
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      scheduleId: schedule.id,
      weekday,
      isWorkday: workdays.includes(weekday),
      startTime: workdays.includes(weekday) ? startTime : null,
      endTime: workdays.includes(weekday) ? endTime : null,
      breakMinutes,
    })),
  );

  await db
    .update(tenants)
    .set({ onboardingStep: Math.max(tenant.onboardingStep, 4), updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));

  await db.insert(auditEvents).values({
    tenantId: tenant.id,
    actorUserId: user.id,
    entity: "work_schedule",
    entityId: schedule.id,
    action: "schedule.created",
    detail: { name, workdays, startTime, endTime, breakMinutes },
  });

  revalidatePath("/admin");
  redirect("/admin/setup?step=3&saved=1");
}

const employeeSchema = z.object({
  employeeCode: z.string().trim().min(2).max(24),
  lastName: z.string().trim().min(1).max(80),
  firstName: z.string().trim().min(1).max(80),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monthlyRate: z.coerce.number().min(0).max(10_000_000),
  rankId: z.string().uuid().optional().or(z.literal("")),
  scheduleId: z.string().uuid().optional().or(z.literal("")),
});

export async function createEmployee(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertSetupRole(membership.role);

  const parsed = employeeSchema.safeParse({
    employeeCode: formData.get("employeeCode"),
    lastName: formData.get("lastName"),
    firstName: formData.get("firstName"),
    hireDate: formData.get("hireDate"),
    monthlyRate: formData.get("monthlyRate"),
    rankId: formData.get("rankId") || undefined,
    scheduleId: formData.get("scheduleId") || undefined,
  });

  if (!parsed.success) {
    redirect(
      `/admin/employees?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the form")}`,
    );
  }

  const data = parsed.data;

  try {
    const [employee] = await db
      .insert(employees)
      .values({
        tenantId: tenant.id,
        employeeCode: data.employeeCode,
        lastName: data.lastName,
        firstName: data.firstName,
        hireDate: data.hireDate,
        monthlyRate: data.monthlyRate.toFixed(2),
        dailyRate: (data.monthlyRate / tenant.salaryDivisor).toFixed(2),
        rankId: data.rankId || null,
        scheduleId: data.scheduleId || null,
        regionCode: tenant.regionCode,
      })
      .returning();

    await db.insert(auditEvents).values({
      tenantId: tenant.id,
      actorUserId: user.id,
      entity: "employee",
      entityId: employee?.id,
      action: "employee.created",
      detail: { employeeCode: data.employeeCode },
    });
  } catch {
    redirect("/admin/employees?error=That+employee+code+is+already+used");
  }

  revalidatePath("/admin/employees");
  redirect("/admin/employees?saved=1");
}

export async function restartSetup(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertSetupRole(membership.role);

  const confirmation = String(formData.get("confirmation") ?? "").trim().toUpperCase();
  if (confirmation !== "RESTART") {
    redirect("/admin/setup?step=1&error=Type+RESTART+to+confirm");
  }

  // Archive, never delete: previous calendars and schedules keep their periods and history.
  await db
    .update(payrollCalendars)
    .set({ archivedAt: new Date() })
    .where(and(eq(payrollCalendars.tenantId, tenant.id), isNull(payrollCalendars.archivedAt)));

  await db
    .update(workSchedules)
    .set({ archivedAt: new Date() })
    .where(and(eq(workSchedules.tenantId, tenant.id), isNull(workSchedules.archivedAt)));

  await db
    .update(tenants)
    .set({
      onboardingStep: 1,
      onboardingCompletedAt: null,
      setupVersion: tenant.setupVersion + 1,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenant.id));

  await db.insert(auditEvents).values({
    tenantId: tenant.id,
    actorUserId: user.id,
    entity: "tenant",
    entityId: tenant.id,
    action: "setup.restarted",
    detail: { setupVersion: tenant.setupVersion + 1 },
  });

  revalidatePath("/admin");
  redirect("/payroll/onboarding?restarted=1");
}
