"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  payJournalLines,
  payJournals,
  payRunLines,
  payRuns,
  paySettlements,
  payrollPeriods,
} from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { buildJournalLines, ensurePayrollAccounts } from "@/lib/payroll/journal";
import { round2 } from "@/lib/payroll/statutory";

function assertWriter(role: string) {
  if (role !== "company_admin" && role !== "payroll_officer") {
    redirect("/payroll/journal?error=not-allowed");
  }
}

export async function generateJournal(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertWriter(membership.role);

  const runId = String(formData.get("runId") ?? "");
  const [run] = await db
    .select()
    .from(payRuns)
    .where(and(eq(payRuns.id, runId), eq(payRuns.tenantId, tenant.id)))
    .limit(1);

  if (!run) redirect("/payroll/journal?error=Run+not+found");
  if (run.status !== "approved") redirect("/payroll/journal?error=Only+approved+runs+can+be+journalised");

  const [existing] = await db
    .select()
    .from(payJournals)
    .where(and(eq(payJournals.tenantId, tenant.id), eq(payJournals.runId, run.id)))
    .limit(1);

  if (existing) redirect(`/payroll/journal/${existing.id}`);

  const totals = (run.totals ?? {}) as Record<string, number>;
  const accounts = await ensurePayrollAccounts(tenant.id);
  const lines = buildJournalLines(totals, accounts);

  const debit = round2(lines.reduce((sum, line) => sum + line.debit, 0));
  const credit = round2(lines.reduce((sum, line) => sum + line.credit, 0));

  if (Math.abs(debit - credit) > 0.005) {
    redirect(`/payroll/computation/${run.id}?error=Journal+does+not+balance`);
  }

  const journalId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(payJournals).values({
      id: journalId,
      tenantId: tenant.id,
      runId: run.id,
      status: "draft",
      totals: { debit, credit, difference: round2(debit - credit) },
    });

    await tx.insert(payJournalLines).values(
      lines.map((line) => ({
        journalId,
        accountId: line.accountId,
        memo: line.memo,
        debit: line.debit.toFixed(2),
        credit: line.credit.toFixed(2),
      })),
    );

    await tx.insert(auditEvents).values({
      tenantId: tenant.id,
      actorUserId: user.id,
      entity: "pay_journal",
      entityId: journalId,
      action: "pay_journal.generated",
      detail: { runId: run.id, debit, credit },
    });
  });

  revalidatePath("/payroll/journal");
  redirect(`/payroll/journal/${journalId}`);
}

export async function postJournal(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertWriter(membership.role);

  const journalId = String(formData.get("journalId") ?? "");
  const [journal] = await db
    .select()
    .from(payJournals)
    .where(and(eq(payJournals.id, journalId), eq(payJournals.tenantId, tenant.id)))
    .limit(1);

  if (!journal) redirect("/payroll/journal?error=Journal+not+found");

  await db
    .update(payJournals)
    .set({ status: "posted", postedAt: new Date(), postedBy: user.id })
    .where(eq(payJournals.id, journal.id));

  await db.insert(auditEvents).values({
    tenantId: tenant.id,
    actorUserId: user.id,
    entity: "pay_journal",
    entityId: journal.id,
    action: "pay_journal.posted",
  });

  revalidatePath(`/payroll/journal/${journal.id}`);
  redirect(`/payroll/journal/${journal.id}`);
}

export async function recordSettlement(formData: FormData) {
  const { tenant, user, membership } = await requireWorkspace();
  assertWriter(membership.role);

  const journalId = String(formData.get("journalId") ?? "");
  const paidAt = String(formData.get("paidAt") ?? "");
  const method = String(formData.get("method") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim();

  const [journal] = await db
    .select()
    .from(payJournals)
    .where(and(eq(payJournals.id, journalId), eq(payJournals.tenantId, tenant.id)))
    .limit(1);

  if (!journal) redirect("/payroll/journal?error=Journal+not+found");
  if (journal.status !== "posted") {
    redirect(`/payroll/journal/${journalId}?error=Post+the+journal+before+recording+settlement`);
  }

  const totals = (journal.totals ?? {}) as Record<string, number>;
  const amount = round2(Number(formData.get("amount") ?? totals.credit ?? 0));

  if (!paidAt || !method || amount <= 0) {
    redirect(`/payroll/journal/${journalId}?error=Complete+the+settlement+fields`);
  }

  await db.insert(paySettlements).values({
    journalId,
    paidAt,
    method,
    reference: reference || null,
    amount: amount.toFixed(2),
  });

  await db.insert(auditEvents).values({
    tenantId: tenant.id,
    actorUserId: user.id,
    entity: "pay_journal",
    entityId: journalId,
    action: "pay_journal.settled",
    detail: { amount, method, paidAt },
  });

  revalidatePath(`/payroll/journal/${journalId}`);
  redirect(`/payroll/journal/${journalId}`);
}
