"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  attendanceBuckets,
  attendanceDays,
  auditEvents,
  payAdjustments,
  employees,
  importRuns,
  payRunLines,
  payRuns,
  payrollCalendars,
  payrollPeriods,
  workScheduleDays,
  workSchedules,
} from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { computePayroll } from "@/lib/payroll/compute";
import { STATUTORY_APPROVED, STATUTORY_VERSION } from "@/lib/payroll/statutory";

function assertWriter(role: string) {
  if (role !== "company_admin" && role !== "payroll_officer") {
    redirect("/payroll/computation?error=not-allowed");
  }
}

export async function calculateRun(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertWriter(membership.role);

  const periodId = String(formData.get("periodId") ?? "");
  if (!periodId) redirect("/payroll/computation?error=Choose+a+cutoff");

  const [periodRow] = await db
    .select({ period: payrollPeriods, calendar: payrollCalendars })
    .from(payrollPeriods)
    .innerJoin(payrollCalendars, eq(payrollCalendars.id, payrollPeriods.calendarId))
    .where(and(eq(payrollPeriods.id, periodId), eq(payrollCalendars.tenantId, tenant.id)))
    .limit(1);

  if (!periodRow) redirect("/payroll/computation?error=Cutoff+not+found");

  const [existing] = await db
    .select()
    .from(payRuns)
    .where(and(eq(payRuns.tenantId, tenant.id), eq(payRuns.periodId, periodId)))
    .limit(1);

  if (existing?.status === "approved") {
    redirect(`/payroll/computation/${existing.id}?error=This+run+is+approved+and+frozen`);
  }

  if (existing) {
    await db
      .update(payAdjustments)
      .set({ status: "queued", runId: null, appliedAt: null })
      .where(and(eq(payAdjustments.runId, existing.id), eq(payAdjustments.status, "applied")));
  }

  const queuedAdjustments = await db
    .select()
    .from(payAdjustments)
    .where(and(eq(payAdjustments.tenantId, tenant.id), eq(payAdjustments.status, "queued")));

  const [attendanceRun] = await db
    .select()
    .from(importRuns)
    .where(
      and(
        eq(importRuns.tenantId, tenant.id),
        eq(importRuns.periodId, periodId),
        eq(importRuns.status, "imported"),
      ),
    )
    .limit(1);

  if (!attendanceRun) {
    redirect("/payroll/computation?error=Import+the+time+report+for+this+cutoff+first");
  }

  const [employeeRows, scheduleRows, dayRows, bucketRows] = await Promise.all([
    db
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, tenant.id), eq(employees.status, "active"))),
    db
      .select({ scheduleId: workSchedules.id, weekday: workScheduleDays.weekday, isWorkday: workScheduleDays.isWorkday })
      .from(workSchedules)
      .innerJoin(workScheduleDays, eq(workScheduleDays.scheduleId, workSchedules.id))
      .where(eq(workSchedules.tenantId, tenant.id)),
    db
      .select({ employeeId: attendanceDays.employeeId, workDate: attendanceDays.workDate, hours: attendanceDays.hours })
      .from(attendanceDays)
      .where(eq(attendanceDays.runId, attendanceRun.id)),
    db
      .select({ employeeId: attendanceBuckets.employeeId, code: attendanceBuckets.code, hours: attendanceBuckets.hours })
      .from(attendanceBuckets)
      .where(eq(attendanceBuckets.runId, attendanceRun.id)),
  ]);

  const schedules = new Map<string, Set<number>>();
  for (const row of scheduleRows) {
    if (!row.isWorkday) continue;
    const set = schedules.get(row.scheduleId) ?? new Set<number>();
    set.add(row.weekday);
    schedules.set(row.scheduleId, set);
  }

  const result = computePayroll({
    cutoffNo: periodRow.period.cutoffNo,
    divisor: tenant.salaryDivisor,
    employees: employeeRows.map((employee) => ({
      id: employee.id,
      employeeCode: employee.employeeCode,
      lastName: employee.lastName,
      firstName: employee.firstName,
      monthlyRate: Number(employee.monthlyRate),
      monthlyAllowance: Number(employee.monthlyAllowance),
      scheduleId: employee.scheduleId,
      mweStatus: employee.mweStatus,
    })),
    schedules,
    attendance: dayRows.map((day) => ({
      employeeId: day.employeeId,
      workDate: day.workDate,
      hours: Number(day.hours),
    })),
    buckets: bucketRows.map((bucket) => ({
      employeeId: bucket.employeeId,
      code: bucket.code,
      hours: Number(bucket.hours),
    })),
    adjustments: queuedAdjustments.map((adjustment) => ({
      employeeId: adjustment.employeeId,
      kind: adjustment.kind === "deduction" ? ("deduction" as const) : ("earning" as const),
      amount: Number(adjustment.amount),
    })),
  });

  const assumptions = {
    divisor: tenant.salaryDivisor,
    statutoryVersion: STATUTORY_VERSION,
    statutoryApproved: STATUTORY_APPROVED,
    premiumMatrix: "DOLE/BWC 2024 defaults, compounding",
    attendanceRun: attendanceRun.id,
    note: "Basic pay is driven by attendance on scheduled workdays. Premium buckets are paid as additional hours.",
  };

  const runId = existing?.id ?? crypto.randomUUID();

  await db.transaction(async (tx) => {
    if (existing) {
      await tx.delete(payRunLines).where(eq(payRunLines.runId, existing.id));
      await tx
        .update(payRuns)
        .set({
          status: "calculated",
          assumptions,
          issues: result.issues,
          totals: result.totals,
          statutoryVersion: STATUTORY_VERSION,
          calculatedAt: new Date(),
        })
        .where(eq(payRuns.id, existing.id));
    } else {
      await tx.insert(payRuns).values({
        id: runId,
        tenantId: tenant.id,
        periodId,
        cutoffNo: periodRow.period.cutoffNo,
        cycleLabel: periodRow.period.cycleLabel,
        status: "calculated",
        statutoryVersion: STATUTORY_VERSION,
        assumptions,
        issues: result.issues,
        totals: result.totals,
        createdBy: user.id,
        calculatedAt: new Date(),
      });
    }

    if (result.lines.length > 0) {
      await tx.insert(payRunLines).values(
        result.lines.map((line) => ({
          runId,
          tenantId: tenant.id,
          employeeId: line.employeeId,
          dailyRate: line.dailyRate.toFixed(4),
          hourlyRate: line.hourlyRate.toFixed(4),
          daysPaid: line.daysPaid.toFixed(2),
          basic: line.basic.toFixed(2),
          allowance: line.allowance.toFixed(2),
          overtime: line.overtime.toFixed(2),
          nightDiff: line.nightDiff.toFixed(2),
          holiday: line.holiday.toFixed(2),
          premium: line.premium.toFixed(2),
          gross: line.gross.toFixed(2),
          sssEmployee: line.sssEmployee.toFixed(2),
          sssEmployer: line.sssEmployer.toFixed(2),
          philhealthEmployee: line.philhealthEmployee.toFixed(2),
          philhealthEmployer: line.philhealthEmployer.toFixed(2),
          pagibigEmployee: line.pagibigEmployee.toFixed(2),
          pagibigEmployer: line.pagibigEmployer.toFixed(2),
          tax: line.tax.toFixed(2),
          adjustmentEarning: line.adjustmentEarning.toFixed(2),
          otherDeductions: line.otherDeductions.toFixed(2),
          netPay: line.netPay.toFixed(2),
          thirteenthAccrual: line.thirteenthAccrual.toFixed(2),
          breakdown: line.breakdown,
        })),
      );
    }

    if (queuedAdjustments.length > 0) {
      await tx
        .update(payAdjustments)
        .set({ status: "applied", runId, appliedAt: new Date() })
        .where(
          inArray(
            payAdjustments.id,
            queuedAdjustments.map((adjustment) => adjustment.id),
          ),
        );
    }

    await tx.insert(auditEvents).values({
      tenantId: tenant.id,
      actorUserId: user.id,
      entity: "pay_run",
      entityId: runId,
      action: existing ? "pay_run.recalculated" : "pay_run.calculated",
      detail: { periodId, cutoffNo: periodRow.period.cutoffNo, employees: result.lines.length },
    });
  });

  revalidatePath("/payroll/computation");
  redirect(`/payroll/computation/${runId}`);
}

export async function approveRun(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  const runId = String(formData.get("runId") ?? "");
  const acknowledge = formData.get("acknowledge") === "on";
  const overrideReason = String(formData.get("overrideReason") ?? "").trim();

  if (membership.role !== "company_admin" && membership.role !== "approver" && membership.role !== "payroll_officer") {
    redirect(`/payroll/computation/${runId}?error=Your+role+cannot+approve+payroll`);
  }

  const [run] = await db
    .select()
    .from(payRuns)
    .where(and(eq(payRuns.id, runId), eq(payRuns.tenantId, tenant.id)))
    .limit(1);

  if (!run) redirect("/payroll/computation?error=Run+not+found");
  if (run.status === "approved") redirect(`/payroll/computation/${runId}?error=Already+approved`);

  if (!acknowledge) {
    redirect(`/payroll/computation/${runId}?error=Acknowledge+the+unapproved+statutory+dataset`);
  }

  const runLines = await db.select().from(payRunLines).where(eq(payRunLines.runId, run.id));
  if (runLines.some((line) => Number(line.netPay) < 0)) {
    redirect(`/payroll/computation/${runId}?error=Negative+net+pay+must+be+resolved+before+approval`);
  }

  const selfApproval = run.createdBy === user.id;
  if (selfApproval) {
    if (membership.role !== "company_admin" || overrideReason.length < 10) {
      redirect(
        `/payroll/computation/${runId}?error=Approval+must+come+from+another+user+unless+a+company+admin+records+a+reason`,
      );
    }
  }

  const assumptions = {
    ...(run.assumptions as Record<string, unknown> | null),
    approvedOn: new Date().toISOString(),
    selfApproval,
    overrideReason: overrideReason || null,
    statutoryAcknowledged: true,
  };

  await db.transaction(async (tx) => {
    await tx
      .update(payRuns)
      .set({
        status: "approved",
        approvedBy: user.id,
        approvedAt: new Date(),
        acknowledgedBy: user.id,
        acknowledgedAt: new Date(),
        assumptions,
      })
      .where(eq(payRuns.id, run.id));

    await tx.insert(auditEvents).values({
      tenantId: tenant.id,
      actorUserId: user.id,
      entity: "pay_run",
      entityId: run.id,
      action: selfApproval ? "pay_run.approved_self" : "pay_run.approved",
      detail: { overrideReason, totals: run.totals },
    });
  });

  revalidatePath("/payroll/computation");
  redirect(`/payroll/computation/${run.id}`);
}

export async function discardRun(formData: FormData) {
  const { tenant, membership } = await requireWorkspace();
  assertWriter(membership.role);

  const runId = String(formData.get("runId") ?? "");
  const [run] = await db
    .select()
    .from(payRuns)
    .where(and(eq(payRuns.id, runId), eq(payRuns.tenantId, tenant.id)))
    .limit(1);

  if (!run) redirect("/payroll/computation?error=Run+not+found");
  if (run.status === "approved") redirect(`/payroll/computation/${runId}?error=Approved+runs+cannot+be+discarded`);

  await db.delete(payRuns).where(eq(payRuns.id, runId));
  revalidatePath("/payroll/computation");
  redirect("/payroll/computation");
}



export async function queueAdjustment(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertWriter(membership.role);

  const employeeId = String(formData.get("employeeId") ?? "");
  const kind = String(formData.get("kind") ?? "earning") === "deduction" ? "deduction" : "earning";
  const label = String(formData.get("label") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const amount = Number(formData.get("amount") ?? 0);

  if (!employeeId || !label || amount <= 0) {
    redirect("/payroll/computation?error=Complete+the+adjustment");
  }

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenant.id)))
    .limit(1);

  if (!employee) redirect("/payroll/computation?error=Employee+not+found");

  await db.insert(payAdjustments).values({
    tenantId: tenant.id,
    employeeId,
    kind,
    label,
    reason: reason || null,
    amount: amount.toFixed(2),
    status: "queued",
    createdBy: user.id,
  });

  await db.insert(auditEvents).values({
    tenantId: tenant.id,
    actorUserId: user.id,
    entity: "pay_adjustment",
    entityId: employeeId,
    action: "adjustment.queued",
    detail: { kind, label, amount },
  });

  revalidatePath("/payroll/computation");
  redirect("/payroll/computation?saved=adjustment");
}

export async function cancelAdjustment(formData: FormData) {
  const { tenant, membership } = await requireWorkspace();
  assertWriter(membership.role);

  const id = String(formData.get("adjustmentId") ?? "");
  const [adjustment] = await db
    .select()
    .from(payAdjustments)
    .where(and(eq(payAdjustments.id, id), eq(payAdjustments.tenantId, tenant.id)))
    .limit(1);

  if (!adjustment || adjustment.status !== "queued") {
    redirect("/payroll/computation?error=Only+queued+adjustments+can+be+cancelled");
  }

  await db.delete(payAdjustments).where(eq(payAdjustments.id, id));
  revalidatePath("/payroll/computation");
  redirect("/payroll/computation");
}
