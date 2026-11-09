"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  attendanceBuckets,
  attendanceDays,
  attendanceLateTotals,
  employeeExternalIds,
  employees,
  importProfiles,
  importRuns,
  payrollCalendars,
  payrollPeriods,
  workScheduleDays,
  workSchedules,
} from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { parseCsv } from "@/lib/import/csv";
import {
  applyMappingV2,
  detectMappingV2,
  premiumCodes,
  validateMappingV2,
  type ImportMode,
  type MappingV2,
  type V2Unit,
} from "@/lib/import/mapping-v2";
import { parseOds } from "@/lib/import/ods";
import { readUpload, saveUpload } from "@/lib/import/storage";
import type { ImportIssue } from "@/lib/import/types";

const MAX_BYTES = 10 * 1024 * 1024;

function canWrite(role: string) {
  return role === "company_admin" || role === "payroll_officer";
}

async function loadPeriod(tenantId: string, periodId: string) {
  const [row] = await db
    .select({ period: payrollPeriods, calendar: payrollCalendars })
    .from(payrollPeriods)
    .innerJoin(payrollCalendars, eq(payrollCalendars.id, payrollPeriods.calendarId))
    .where(and(eq(payrollPeriods.id, periodId), eq(payrollCalendars.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

export async function uploadTimeReport(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  if (!canWrite(membership.role)) redirect("/payroll/time-report?error=not-allowed");

  const file = formData.get("file");
  const periodId = String(formData.get("periodId") ?? "");

  if (!(file instanceof File) || file.size === 0) {
    redirect("/payroll/time-report?error=Choose+a+file");
  }
  if (file.size > MAX_BYTES) {
    redirect("/payroll/time-report?error=Files+must+be+10+MB+or+smaller");
  }

  const period = periodId ? await loadPeriod(tenant.id, periodId) : null;
  if (!period) redirect("/payroll/time-report?error=Choose+the+cutoff+this+file+covers");

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension !== "ods" && extension !== "csv") {
    redirect("/payroll/time-report?error=Only+.ods+and+.csv+are+supported+in+this+build");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let sheet;
  try {
    sheet = extension === "ods" ? parseOds(bytes) : parseCsv(new TextDecoder().decode(bytes));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The file could not be read";
    redirect(`/payroll/time-report?error=${encodeURIComponent(message)}`);
  }

  let mapping: MappingV2;
  try {
    mapping = detectMappingV2(sheet);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The header could not be detected";
    redirect(`/payroll/time-report?error=${encodeURIComponent(message)}`);
  }

  const runId = crypto.randomUUID();
  const storageKey = await saveUpload(tenant.id, runId, extension, bytes);

  await db.insert(importRuns).values({
    id: runId,
    tenantId: tenant.id,
    periodId: period.period.id,
    fileName: file.name,
    fileKind: extension,
    fileSize: file.size,
    storageKey,
    status: "mapping",
    mapping,
    createdBy: user.id,
  });

  redirect(`/payroll/time-report/${runId}`);
}

export async function confirmImport(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  if (!canWrite(membership.role)) redirect("/payroll/time-report?error=not-allowed");

  const runId = String(formData.get("runId") ?? "");
  const [run] = await db
    .select()
    .from(importRuns)
    .where(and(eq(importRuns.id, runId), eq(importRuns.tenantId, tenant.id)))
    .limit(1);

  if (!run || !run.storageKey) redirect("/payroll/time-report?error=Import+run+not+found");
  if (!run.periodId) redirect(`/payroll/time-report/${runId}?error=No+cutoff+attached`);

  const period = await loadPeriod(tenant.id, run.periodId);
  if (!period) redirect(`/payroll/time-report/${runId}?error=Cutoff+not+found`);

  const bytes = await readUpload(run.storageKey);
  const sheet =
    run.fileKind === "ods"
      ? parseOds(new Uint8Array(bytes))
      : parseCsv(new TextDecoder().decode(bytes));

  // Old runs stored the v1 per-column mapping. Re-detect for those rather than
  // trying to convert it: the screen is target-first now.
  const stored = run.mapping as unknown as MappingV2;
  const base = stored?.version === 2 ? stored : detectMappingV2(sheet);

  const readIndex = (value: FormDataEntryValue | null, fallback: number | null) => {
    const text = String(value ?? "");
    if (text === "") return null;
    const index = Number(text);
    return Number.isInteger(index) && index >= 0 ? index : fallback;
  };

  const mode: ImportMode = String(formData.get("mode") ?? base.mode) === "late" ? "late" : "days";
  const employeeCode = readIndex(formData.get("codeColumn"), base.employeeCode);
  const employeeName = readIndex(formData.get("nameColumn"), base.employeeName);
  const dayStart = readIndex(formData.get("dayStart"), base.dayStart);
  const dayEnd = readIndex(formData.get("dayEnd"), base.dayEnd);

  const dayUnits: Record<string, V2Unit> = {};
  if (dayStart != null && dayEnd != null) {
    for (let index = dayStart; index <= dayEnd; index += 1) {
      const raw = String(formData.get(`unit-${index}`) ?? "");
      dayUnits[String(index)] =
        raw === "hours" || raw === "minutes"
          ? raw
          : base.dayUnits[String(index)] ?? (mode === "late" ? "minutes" : "hours");
    }
  }

  const buckets: Record<string, number[]> = {};
  for (const code of premiumCodes) {
    const indexes = formData
      .getAll(`bucket-${code}`)
      .map((value) => Number(value))
      .filter((index) => Number.isInteger(index) && index >= 0);
    if (indexes.length > 0) buckets[code] = [...new Set(indexes)];
  }

  const periodLateIndex = readIndex(formData.get("periodLateColumn"), base.periodLate?.index ?? null);
  const periodLateUnit = String(formData.get("periodLateUnit") ?? base.periodLate?.unit ?? "minutes");
  const periodLate =
    periodLateIndex == null
      ? null
      : { index: periodLateIndex, unit: (periodLateUnit === "hours" ? "hours" : "minutes") as V2Unit };

  const used = new Set<number>();
  if (employeeCode != null) used.add(employeeCode);
  if (employeeName != null) used.add(employeeName);
  if (dayStart != null && dayEnd != null) {
    for (let index = dayStart; index <= dayEnd; index += 1) used.add(index);
  }
  for (const indexes of Object.values(buckets)) for (const index of indexes) used.add(index);
  if (periodLate) used.add(periodLate.index);

  const mapping: MappingV2 = {
    ...base,
    version: 2,
    mode,
    employeeCode,
    employeeName,
    dayStart,
    dayEnd,
    dayUnits,
    buckets,
    periodLate,
    ignored: base.ignored.filter((index) => !used.has(index)),
  };

  const problem = validateMappingV2(mapping);
  if (problem) redirect(`/payroll/time-report/${runId}?error=${encodeURIComponent(problem)}`);

  const [employeeRows, aliasRows] = await Promise.all([
    db
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        lastName: employees.lastName,
        firstName: employees.firstName,
        scheduleId: employees.scheduleId,
      })
      .from(employees)
      .where(eq(employees.tenantId, tenant.id)),
    db
      .select({ code: employeeExternalIds.code, employeeId: employeeExternalIds.employeeId })
      .from(employeeExternalIds)
      .where(eq(employeeExternalIds.tenantId, tenant.id)),
  ]);

  // Late mode fills a blank cell with the scheduled hours for that weekday.
  const scheduleIds = employeeRows.flatMap((employee) => (employee.scheduleId ? [employee.scheduleId] : []));
  const scheduleDayRows =
    scheduleIds.length > 0
      ? await db
          .select()
          .from(workScheduleDays)
          .where(inArray(workScheduleDays.scheduleId, scheduleIds))
      : [];

  const schedules: Record<string, Record<number, number>> = {};
  for (const employee of employeeRows) {
    if (!employee.scheduleId) continue;
    const hours: Record<number, number> = {};
    for (const day of scheduleDayRows) {
      if (day.scheduleId !== employee.scheduleId) continue;
      if (!day.isWorkday || !day.startTime || !day.endTime) {
        hours[day.weekday] = 0;
        continue;
      }
      const [startHour = 0, startMinute = 0] = day.startTime.split(":").map(Number);
      const [endHour = 0, endMinute = 0] = day.endTime.split(":").map(Number);
      const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute) - day.breakMinutes;
      hours[day.weekday] = Math.max(0, minutes) / 60;
    }
    schedules[employee.id] = hours;
  }

  const result = applyMappingV2({
    sheet,
    mapping,
    period: { coverageStart: period.period.coverageStart, coverageEnd: period.period.coverageEnd },
    employees: employeeRows,
    externalIds: aliasRows,
    schedules,
  });

  // Any reviewed bindings from the resolution panel.
  const aliasCount = Number(formData.get("unknownCount") ?? 0) || 0;
  const newAliases: Array<{ code: string; employeeId: string }> = [];

  for (let index = 0; index < aliasCount; index += 1) {
    const code = String(formData.get(`unknownCode-${index}`) ?? "").trim();
    const employeeId = String(formData.get(`alias-${index}`) ?? "").trim();
    if (code && employeeId) newAliases.push({ code, employeeId });
  }

  if (newAliases.length > 0) {
    await db
      .insert(employeeExternalIds)
      .values(newAliases.map((alias) => ({ tenantId: tenant.id, employeeId: alias.employeeId, code: alias.code })))
      .onConflictDoUpdate({
        target: [employeeExternalIds.tenantId, employeeExternalIds.code],
        set: { employeeId: sql`excluded.employee_id` },
      });
  }

  const remainingUnknown = result.unknownCodes.filter(
    (code) => !newAliases.some((alias) => alias.code.toUpperCase() === code.toUpperCase()),
  );

  if (remainingUnknown.length > 0) {
    const issues: ImportIssue[] = result.issues;
    await db
      .update(importRuns)
      .set({ mapping, status: "review", issues })
      .where(eq(importRuns.id, run.id));

    redirect(`/payroll/time-report/${run.id}#resolve`);
  }

  const profileId = await saveProfile({
    tenantId: tenant.id,
    userId: user.id,
    runId: run.id,
    existingProfileId: run.profileId,
    name: String(formData.get("profileName") ?? "").trim(),
    mapping,
    signature: mapping.signature,
  });

  await db.transaction(async (tx) => {
    await tx.delete(attendanceDays).where(eq(attendanceDays.runId, run.id));
    await tx.delete(attendanceBuckets).where(eq(attendanceBuckets.runId, run.id));
    await tx.delete(attendanceLateTotals).where(eq(attendanceLateTotals.runId, run.id));

    for (let index = 0; index < result.days.length; index += 400) {
      const chunk = result.days.slice(index, index + 400);
      await tx.insert(attendanceDays).values(
        chunk.map((day) => ({
          runId: run.id,
          tenantId: tenant.id,
          employeeId: day.employeeId,
          workDate: day.workDate,
          hours: day.hours.toFixed(2),
          lateMinutes: day.lateMinutes,
          sourceValue: day.sourceValue.slice(0, 40),
        })),
      );
    }

    if (result.buckets.length > 0) {
      await tx.insert(attendanceBuckets).values(
        result.buckets.map((bucket) => ({
          runId: run.id,
          tenantId: tenant.id,
          employeeId: bucket.employeeId,
          code: bucket.code,
          hours: bucket.hours.toFixed(2),
        })),
      );
    }

    if (result.totals.length > 0) {
      await tx.insert(attendanceLateTotals).values(
        result.totals.map((total) => ({
          runId: run.id,
          tenantId: tenant.id,
          employeeId: total.employeeId,
          minutes: total.minutes,
        })),
      );
    }

    await tx
      .update(importRuns)
      .set({
        mapping,
        profileId,
        status: "imported",
        issues: result.issues,
        rowCount: result.rowsRead,
        importedAt: new Date(),
      })
      .where(eq(importRuns.id, run.id));
  });

  revalidatePath("/payroll/time-report");
  redirect(`/payroll/time-report/${run.id}`);
}


async function saveProfile(input: {
  tenantId: string;
  userId: string;
  runId: string;
  existingProfileId: string | null;
  name: string;
  mapping: MappingV2;
  signature: string;
}) {
  if (input.existingProfileId) {
    const [existing] = await db
      .select()
      .from(importProfiles)
      .where(eq(importProfiles.id, input.existingProfileId))
      .limit(1);

    await db
      .update(importProfiles)
      .set({
        mapping: input.mapping,
        version: (existing?.version ?? 1) + 1,
        sourceSignature: input.signature,
      })
      .where(eq(importProfiles.id, input.existingProfileId));

    return input.existingProfileId;
  }

  const [profile] = await db
    .insert(importProfiles)
    .values({
      tenantId: input.tenantId,
      name: input.name || `${input.mapping.sheetName} profile`,
      version: 1,
      mapping: input.mapping,
      sourceSignature: input.signature,
      createdBy: input.userId,
    })
    .returning();

  return profile?.id ?? null;
}
