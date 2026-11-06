import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { getActiveCalendar } from "@/lib/workspace";
import { OnboardingFlow } from "./onboarding-flow";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; restarted?: string }>;
}) {
  const { tenant } = await requireWorkspace();
  const params = await searchParams;
  const calendar = await getActiveCalendar(tenant.id);

  if (calendar && tenant.onboardingCompletedAt) redirect("/payroll");

  const [people] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(employees)
    .where(and(eq(employees.tenantId, tenant.id), eq(employees.status, "active")));

  return (
    <OnboardingFlow
      companyName={tenant.tradeName ?? tenant.legalName}
      employeeCount={people?.count ?? 0}
      year={new Date().getFullYear()}
      error={params.error}
      restarted={params.restarted === "1"}
    />
  );
}
