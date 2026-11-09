"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditEvents, payrollCalendars, tenants, workSchedules } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import type { CalendarPattern, CalendarSpec } from "@/lib/calendar";
import { addEmployees, setCalendar, setCompanyDetails, setSchedule } from "@/lib/setup/core";

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

  await setCompanyDetails(tenant.id, user.id, parsed.data);

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

  const year = Number(formData.get("year") ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    redirect("/admin/setup?step=2&error=Choose+a+valid+period+year");
  }

  const result = await setCalendar(tenant.id, user.id, spec, year);
  if ("error" in result && result.error) {
    redirect(`/admin/setup?step=2&error=${encodeURIComponent(result.error)}`);
  }

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

  const result = await setSchedule(tenant.id, user.id, {
    name,
    workdays,
    startTime,
    endTime,
    breakMinutes,
    isDefault: formData.get("isDefault") === "on" || existing.length === 0,
    replace: false,
  });

  if ("error" in result && result.error) {
    redirect(`/admin/setup?step=3&error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/admin");
  redirect("/admin/setup?step=3&saved=1");
}

const employeeSchema = z.object({
  employeeCode: z.string().trim().min(2).max(24),
  lastName: z.string().trim().min(1).max(80),
  firstName: z.string().trim().min(1).max(80),
  tin: z.string().trim().max(20).optional().or(z.literal("")),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  address: z.string().trim().max(240).optional().or(z.literal("")),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  separationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
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
    tin: formData.get("tin") || "",
    birthday: formData.get("birthday") || "",
    address: formData.get("address") || "",
    hireDate: formData.get("hireDate"),
    separationDate: formData.get("separationDate") || "",
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
  const result = await addEmployees(tenant.id, user.id, tenant.salaryDivisor, tenant.regionCode, [
    {
      employeeCode: data.employeeCode,
      employeeName: `${data.lastName}, ${data.firstName}`,
      tin: data.tin || undefined,
      birthday: data.birthday || undefined,
      address: data.address || undefined,
      hireDate: data.hireDate,
      separationDate: data.separationDate || undefined,
      monthlyRate: data.monthlyRate,
      rankId: data.rankId || undefined,
      scheduleId: data.scheduleId || undefined,
    },
  ]);

  if (result.errors.length > 0) {
    redirect(`/admin/employees?error=${encodeURIComponent(result.errors[0]?.message ?? "Could not save the employee")}`);
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
  redirect("/payroll/onboarding?step=1&restarted=1");
}
