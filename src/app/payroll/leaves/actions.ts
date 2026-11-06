"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditEvents, employees, leaveBalances, leaveEntries, leavePolicies, leaveTypes } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { initializeLeaveYear } from "@/lib/payroll/leaves";

function assertWriter(role: string) {
  if (role !== "company_admin" && role !== "payroll_officer") {
    redirect("/payroll/leaves?error=not-allowed");
  }
}

export async function initializeYear(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertWriter(membership.role);

  const year = Number(formData.get("year") ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    redirect("/payroll/leaves?error=Choose+a+valid+year");
  }

  await initializeLeaveYear(tenant.id, year);

  await db.insert(auditEvents).values({
    tenantId: tenant.id,
    actorUserId: user.id,
    entity: "leave_balance",
    action: "leave_year.initialized",
    detail: { year },
  });

  revalidatePath("/payroll/leaves");
  redirect(`/payroll/leaves?year=${year}&saved=1`);
}

export async function savePolicy(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertWriter(membership.role);

  const leaveTypeId = String(formData.get("leaveTypeId") ?? "");
  const rankId = String(formData.get("rankId") ?? "");
  const annualDays = Number(formData.get("annualDays") ?? 0);
  const carryOverCap = Number(formData.get("carryOverCap") ?? 0);

  const [type] = await db
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.id, leaveTypeId), eq(leaveTypes.tenantId, tenant.id)))
    .limit(1);

  if (!type) redirect("/payroll/leaves?error=Leave+type+not+found");
  if (annualDays < 0 || carryOverCap < 0) {
    redirect("/payroll/leaves?error=Days+cannot+be+negative");
  }

  const existing = await db
    .select()
    .from(leavePolicies)
    .where(
      and(
        eq(leavePolicies.tenantId, tenant.id),
        eq(leavePolicies.leaveTypeId, leaveTypeId),
        rankId ? eq(leavePolicies.rankId, rankId) : isNull(leavePolicies.rankId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(leavePolicies)
      .set({ annualDays: annualDays.toFixed(2), carryOverCap: carryOverCap.toFixed(2) })
      .where(eq(leavePolicies.id, existing[0].id));
  } else {
    await db.insert(leavePolicies).values({
      tenantId: tenant.id,
      leaveTypeId,
      rankId: rankId || null,
      annualDays: annualDays.toFixed(2),
      carryOverCap: carryOverCap.toFixed(2),
    });
  }

  await db.insert(auditEvents).values({
    tenantId: tenant.id,
    actorUserId: user.id,
    entity: "leave_policy",
    entityId: leaveTypeId,
    action: "leave_policy.saved",
    detail: { rankId: rankId || null, annualDays, carryOverCap },
  });

  revalidatePath("/payroll/leaves");
  redirect("/payroll/leaves?saved=1");
}

export async function recordLeave(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertWriter(membership.role);

  const employeeId = String(formData.get("employeeId") ?? "");
  const leaveTypeId = String(formData.get("leaveTypeId") ?? "");
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const days = Number(formData.get("days") ?? 0);
  const note = String(formData.get("note") ?? "").trim();
  const year = Number(startDate.slice(0, 4));

  if (!employeeId || !leaveTypeId || !startDate || !endDate || days <= 0) {
    redirect("/payroll/leaves?error=Complete+the+leave+entry");
  }

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, tenant.id)))
    .limit(1);

  if (!employee) redirect("/payroll/leaves?error=Employee+not+found");

  const [balance] = await db
    .select()
    .from(leaveBalances)
    .where(
      and(
        eq(leaveBalances.tenantId, tenant.id),
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year),
      ),
    )
    .limit(1);

  if (!balance) {
    redirect(`/payroll/leaves?error=Initialize+${year}+balances+first`);
  }

  const available =
    Number(balance.granted) + Number(balance.carried) - Number(balance.used);

  if (days > available + 0.001) {
    redirect(`/payroll/leaves?error=Only+${available.toFixed(2)}+days+available+for+this+leave+type`);
  }

  await db.transaction(async (tx) => {
    await tx.insert(leaveEntries).values({
      tenantId: tenant.id,
      employeeId,
      leaveTypeId,
      startDate,
      endDate,
      days: days.toFixed(2),
      note: note || null,
      createdBy: user.id,
    });

    await tx
      .update(leaveBalances)
      .set({ used: sql`${leaveBalances.used} + ${days.toFixed(2)}::numeric` })
      .where(eq(leaveBalances.id, balance.id));

    await tx.insert(auditEvents).values({
      tenantId: tenant.id,
      actorUserId: user.id,
      entity: "leave_entry",
      entityId: employeeId,
      action: "leave.recorded",
      detail: { leaveTypeId, days, startDate, endDate },
    });
  });

  revalidatePath("/payroll/leaves");
  redirect(`/payroll/leaves?year=${year}&saved=1`);
}
