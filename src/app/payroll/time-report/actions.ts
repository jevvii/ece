"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  attendanceBuckets,
  attendanceDays,
  attendanceLateTotals,
  employeeExternalIds,
  importProfiles,
  importRuns,
  payrollCalendars,
  payrollPeriods,
  payRuns,
} from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { loadImportContext } from "@/lib/import/context";
import { MAX_TIME_REPORT_BYTES, parseTimeReportFile } from "@/lib/import/parse-file";
import {
  applyMappingV2,
  detectMappingV2,
  getEditableMappingV2,
  premiumCodes,
  validateMappingV2,
  type ImportMode,
  type MappingV2,
  type V2Unit,
} from "@/lib/import/mapping-v2";
import { readUpload, saveUpload } from "@/lib/import/storage";

const MAX_BYTES = MAX_TIME_REPORT_BYTES;

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

  const period = z.uuid().safeParse(periodId).success ? await loadPeriod(tenant.id, periodId) : null;
  if (!period) redirect("/payroll/time-report?error=Choose+the+cutoff+this+file+covers");

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension !== "ods" && extension !== "csv" && extension !== "xlsx") {
    redirect("/payroll/time-report?error=Choose+a+CSV,+XLSX+or+ODS+file");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let sheet;
  try {
    sheet = parseTimeReportFile(bytes, file.name);
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
  if (!z.uuid().safeParse(runId).success) redirect("/payroll/time-report?error=Import+run+not+found");
  const [run] = await db
    .select()
    .from(importRuns)
    .where(and(eq(importRuns.id, runId), eq(importRuns.tenantId, tenant.id)))
    .limit(1);

  if (!run || !run.storageKey) redirect("/payroll/time-report?error=Import+run+not+found");
  if (run.status === "imported") redirect(`/payroll/time-report/${run.id}`);
  if (run.status === "superseded") redirect(`/payroll/time-report/${run.id}?error=This+report+was+replaced+by+a+newer+import`);
  if (!run.periodId) redirect(`/payroll/time-report/${runId}?error=No+cutoff+attached`);

  const period = await loadPeriod(tenant.id, run.periodId);
  if (!period) redirect(`/payroll/time-report/${runId}?error=Cutoff+not+found`);

  const bytes = await readUpload(run.storageKey);
  const sheet = parseTimeReportFile(new Uint8Array(bytes), run.fileName);

  // Match the mapping shown in review, including recovery of broken detection.
  const stored = run.mapping as unknown as MappingV2;
  const base = getEditableMappingV2(sheet, stored);

  const readIndex = (value: FormDataEntryValue | null, fallback: number | null, maximum = 199) => {
    const text = String(value ?? "");
    if (text === "") return null;
    const index = Number(text);
    return Number.isInteger(index) && index >= 0 && index <= maximum ? index : fallback;
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
    dataStartRow: readIndex(formData.get("dataStartRow"), base.dataStartRow, 499) ?? base.dataStartRow,
    employeeCode,
    employeeName,
    dayStart,
    dayEnd,
    dayUnits,
    buckets,
    periodLate,
    ignored: base.ignored.filter((index) => !used.has(index)),
  };

  const problem = validateMappingV2(mapping, sheet);
  if (problem) redirect(`/payroll/time-report/${runId}?error=${encodeURIComponent(problem)}`);

  const context = await loadImportContext(tenant.id);
  let reviewedAliases: Array<{ code: string; employeeId: string }> = [];
  try {
    const submitted: unknown = JSON.parse(String(formData.get("aliases") ?? "[]"));
    if (!Array.isArray(submitted) || submitted.length > 500) throw new Error("Invalid employee matches");
    const allowedEmployees = new Set(context.employees.map((employee) => employee.id));
    reviewedAliases = submitted.map((entry) => {
      if (!entry || typeof entry.code !== "string" || typeof entry.employeeId !== "string" ||
          !entry.code.trim() || entry.code.length > 100 || !allowedEmployees.has(entry.employeeId)) {
        throw new Error("Choose employees from this company");
      }
      return { code: entry.code.trim().replace(/\s+/g, " ").toUpperCase(), employeeId: entry.employeeId };
    });
    // A new match may resolve an unknown source code, never reassign a known code.
    const unbound = new Set(applyMappingV2({ sheet, mapping,
      period: period.period, ...context }).unknownCodes);
    if (reviewedAliases.some((alias) => !unbound.has(alias.code)) ||
        new Set(reviewedAliases.map((alias) => alias.code)).size !== reviewedAliases.length) {
      throw new Error("Review the employee matches again");
    }
  } catch {
    redirect(`/payroll/time-report/${runId}?error=Review+the+employee+matches+and+try+again`);
  }

  const result = applyMappingV2({
    sheet, mapping, period: period.period, ...context,
    externalIds: [...context.externalIds, ...reviewedAliases],
  });

  if (result.blockingIssueCount > 0 || result.days.length === 0) {
    await db.update(importRuns).set({ mapping, status: "review", issues: result.issues })
      .where(and(eq(importRuns.id, run.id), inArray(importRuns.status, ["mapping", "review"])));
    redirect(`/payroll/time-report/${run.id}?error=Resolve+the+highlighted+issues+before+importing`);
  }

  await db.transaction(async (tx) => {
    // A cutoff has one active import. Approval and replacement share this lock.
    await tx.execute(sql`select id from payroll_periods where id = ${period.period.id} for update`);
    const [latestRun] = await tx.select({ status: importRuns.status }).from(importRuns).where(eq(importRuns.id, run.id));
    if (latestRun?.status === "imported") redirect(`/payroll/time-report/${run.id}`);
    if (latestRun?.status === "superseded") redirect(`/payroll/time-report/${run.id}?error=This+report+was+replaced`);
    const [payroll] = await tx.select({ status: payRuns.status }).from(payRuns)
      .where(and(eq(payRuns.tenantId, tenant.id), eq(payRuns.periodId, period.period.id))).for("update");
    if (payroll?.status === "approved") redirect(`/payroll/time-report/${run.id}?error=Payroll+is+approved.+Attendance+cannot+be+changed`);
    const previous = await tx.select({ id: importRuns.id }).from(importRuns).where(and(
      eq(importRuns.tenantId, tenant.id), eq(importRuns.periodId, period.period.id),
      eq(importRuns.status, "imported"), ne(importRuns.id, run.id),
    ));
    const expected = JSON.stringify(previous.map((entry) => entry.id).sort());
    if (previous.length && (formData.get("replacePrevious") !== "on" || String(formData.get("previousImports")) !== expected)) {
      redirect(`/payroll/time-report/${run.id}?error=Attendance+already+exists.+Review+and+confirm+the+replacement`);
    }
    if (previous.length) await tx.update(importRuns).set({ status: "superseded" }).where(inArray(importRuns.id, previous.map((entry) => entry.id)));
    const profileId = await saveProfile(tx, {
      tenantId: tenant.id, userId: user.id, existingProfileId: run.profileId,
      name: String(formData.get("profileName") ?? "").trim().slice(0, 160), mapping, signature: mapping.signature,
    });
    if (reviewedAliases.length > 0) {
      await tx.insert(employeeExternalIds).values(reviewedAliases.map((alias) => ({
        tenantId: tenant.id, employeeId: alias.employeeId, code: alias.code,
      }))).onConflictDoUpdate({
        target: [employeeExternalIds.tenantId, employeeExternalIds.code],
        set: { employeeId: sql`excluded.employee_id` },
      });
    }
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


type ImportTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function saveProfile(tx: ImportTransaction, input: {
  tenantId: string;
  userId: string;
  existingProfileId: string | null;
  name: string;
  mapping: MappingV2;
  signature: string;
}) {
  if (input.existingProfileId) {
    const [existing] = await tx
      .select()
      .from(importProfiles)
      .where(eq(importProfiles.id, input.existingProfileId))
      .limit(1);

    await tx
      .update(importProfiles)
      .set({
        mapping: input.mapping,
        version: (existing?.version ?? 1) + 1,
        sourceSignature: input.signature,
      })
      .where(eq(importProfiles.id, input.existingProfileId));

    return input.existingProfileId;
  }

  const [profile] = await tx
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
