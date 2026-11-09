"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import {
  addEmployees,
  addRank,
  calendarSpecFromPreset,
  createCompany,
  markSetupComplete,
  setCalendar,
  setSalaryDivisor,
  setSchedule,
} from "@/lib/setup/core";
import { getSetupState } from "@/lib/setup/stages";
import type { CalendarPattern } from "@/lib/calendar";

const setupRoles = new Set(["company_admin", "payroll_officer"]);

function basePath(formData: FormData) {
  return String(formData.get("from") ?? "") === "guided"
    ? "/payroll/onboarding"
    : "/admin/setup";
}

function fail(formData: FormData, step: number, message: string): never {
  redirect(`${basePath(formData)}?step=${step}&error=${encodeURIComponent(message)}`);
}

function done(formData: FormData, step: number, saved = "1"): never {
  redirect(`${basePath(formData)}?step=${step}&saved=${saved}`);
}

async function requireSetupRole(role: string, formData: FormData, step: number) {
  if (!setupRoles.has(role)) fail(formData, step, "Your role cannot change company setup.");
}

const workweeks: Record<string, { label: string; days: number[] }> = {
  monfri: { label: "Mon–Fri", days: [1, 2, 3, 4, 5] },
  monsat: { label: "Mon–Sat", days: [1, 2, 3, 4, 5, 6] },
  suntue: { label: "Sun–Thu", days: [7, 1, 2, 3, 4] },
};

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ---------------------------------------------------------------- */
/* Guided flow                                                       */
/* ---------------------------------------------------------------- */

const divisorSchema = z.coerce
  .number()
  .int()
  .refine((n) => [22, 26, 30].includes(n), { message: "Divisor must be 22, 26 or 30." });

export async function saveDivisorAction(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  await requireSetupRole(membership.role, formData, 1);

  const parsed = divisorSchema.safeParse(formData.get("divisor"));
  if (!parsed.success) fail(formData, 1, parsed.error.issues[0]?.message ?? "Choose a divisor");

  await setSalaryDivisor(tenant.id, user.id, parsed.data);
  revalidatePath("/payroll/onboarding");
  done(formData, 2);
}

export async function saveCalendarPresetAction(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  await requireSetupRole(membership.role, formData, 2);

  const pattern = String(formData.get("pattern") ?? "26_10") as CalendarPattern;
  if (pattern !== "26_10" && pattern !== "01_15") {
    fail(formData, 2, "Choose a cutoff pattern");
  }

  const year = new Date().getFullYear();
  const result = await setCalendar(tenant.id, user.id, calendarSpecFromPreset(pattern), year);
  if ("error" in result && result.error) fail(formData, 2, result.error);

  revalidatePath("/payroll/onboarding");
  done(formData, 3);
}

export async function saveWorkweekAction(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  await requireSetupRole(membership.role, formData, 3);

  const workweekKey = String(formData.get("workweek") ?? "monfri");
  const startTime = String(formData.get("startTime") ?? "08:00");
  const endTime = String(formData.get("endTime") ?? "17:00");
  const breakMinutes = Number(formData.get("breakMinutes") ?? 60);

  const workweek = workweeks[workweekKey];
  if (!workweek) fail(formData, 3, "Choose a workweek");
  if (!timePattern.test(startTime) || !timePattern.test(endTime) || startTime >= endTime) {
    fail(formData, 3, "Check the working hours");
  }
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 240) {
    fail(formData, 3, "Check the unpaid break");
  }

  const result = await setSchedule(tenant.id, user.id, {
    name: `${workweek.label} · ${startTime} to ${endTime}`,
    workdays: workweek.days,
    startTime,
    endTime,
    breakMinutes,
    isDefault: true,
    replace: true,
  });
  if ("error" in result && result.error) fail(formData, 3, result.error);

  revalidatePath("/payroll/onboarding");
  done(formData, 4);
}

/* ---------------------------------------------------------------- */
/* Shared stages                                                     */
/* ---------------------------------------------------------------- */

const rankSchema = z.object({
  name: z.string().trim().min(2).max(80),
  level: z.coerce.number().int().min(1).max(99),
});

export async function saveRankAction(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  const step = Number(formData.get("step") ?? 4);
  await requireSetupRole(membership.role, formData, step);

  const parsed = rankSchema.safeParse({
    name: formData.get("name"),
    level: formData.get("level"),
  });

  if (!parsed.success) {
    fail(formData, step, parsed.error.issues[0]?.message ?? "Check the rank");
  }

  await addRank(tenant.id, user.id, parsed.data);
  revalidatePath("/admin/setup");
  revalidatePath("/payroll/onboarding");
  done(formData, step);
}

const employeeRowSchema = z.object({
  employeeCode: z.string().trim().min(2).max(24),
  employeeName: z.string().trim().min(3).max(160),
  tin: z.string().trim().max(20).optional().or(z.literal("")),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  address: z.string().trim().max(240).optional().or(z.literal("")),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  separationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  monthlyRate: z.coerce.number().min(0).max(10_000_000),
  rankId: z.string().uuid().optional().or(z.literal("")),
  scheduleId: z.string().uuid().optional().or(z.literal("")),
});

const employeeRowsSchema = z.array(employeeRowSchema).min(1).max(500);

export async function saveEmployeesAction(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  const step = Number(formData.get("step") ?? 5);
  await requireSetupRole(membership.role, formData, step);

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    fail(formData, step, "Could not read the employee rows");
  }

  const parsed = employeeRowsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail(formData, step, issue?.message ?? "Check the employee rows");
  }

  const result = await addEmployees(
    tenant.id,
    user.id,
    tenant.salaryDivisor,
    tenant.regionCode,
    parsed.data.map((row) => ({
      employeeCode: row.employeeCode,
      employeeName: row.employeeName,
      tin: row.tin || undefined,
      birthday: row.birthday || undefined,
      address: row.address || undefined,
      hireDate: row.hireDate,
      separationDate: row.separationDate || undefined,
      monthlyRate: row.monthlyRate,
      rankId: row.rankId || undefined,
      scheduleId: row.scheduleId || undefined,
    })),
  );

  revalidatePath("/admin/setup");
  revalidatePath("/admin/employees");
  revalidatePath("/payroll/onboarding");

  if (result.errors.length > 0) {
    const first = result.errors[0];
    fail(
      formData,
      step,
      `${result.errors.length} row(s) were not saved. Row ${first?.row}: ${first?.message}`,
    );
  }

  done(formData, step);
}

export async function finishSetupAction(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  await requireSetupRole(membership.role, formData, 5);

  const state = await getSetupState(tenant);
  if (!state.requiredComplete) {
    fail(
      formData,
      5,
      "Company details, a cutoff calendar and a work schedule are required before payroll can open.",
    );
  }

  await markSetupComplete(tenant.id, user.id);
  revalidatePath("/payroll");
  redirect("/payroll?setup=done");
}

/* ---------------------------------------------------------------- */
/* Company creation                                                  */
/* ---------------------------------------------------------------- */

const companyCreateSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  tin: z.string().trim().min(9).max(20),
  regionCode: z.string().trim().min(1).max(12),
});

export async function createCompanyAction(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  await requireSetupRole(membership.role, formData, 1);

  const parsed = companyCreateSchema.safeParse({
    legalName: formData.get("legalName"),
    tin: formData.get("tin"),
    regionCode: formData.get("regionCode") || tenant.regionCode || "NCR",
  });

  if (!parsed.success) {
    redirect(
      `/admin/companies/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the form")}`,
    );
  }

  const created = await createCompany(user.id, tenant.firmId, parsed.data);
  if (!created) {
    redirect("/admin/companies/new?error=Could+not+create+the+company");
  }

  // Switch the active workspace to the new company so setup opens on it.
  const token = (await cookies()).get("ece_session")?.value;
  if (token) {
    await db.update(sessions).set({ tenantId: created.id }).where(eq(sessions.token, token));
  }

  revalidatePath("/admin");
  redirect("/payroll/onboarding?step=1");
}
