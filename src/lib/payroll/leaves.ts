import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, leaveBalances, leavePolicies, leaveTypes, ranks } from "@/db/schema";

export const defaultLeaveTypes = [
  { code: "VL", name: "Vacation leave", statutory: false, paid: true, countingBasis: "working", annualDays: "15.00", carryOverCap: "5.00" },
  { code: "SL", name: "Sick leave", statutory: false, paid: true, countingBasis: "working", annualDays: "15.00", carryOverCap: "0.00" },
  { code: "SIL", name: "Service incentive leave", statutory: true, paid: true, countingBasis: "working", annualDays: "5.00", carryOverCap: "0.00" },
  { code: "MAT", name: "Maternity leave", statutory: true, paid: true, countingBasis: "calendar", annualDays: "105.00", carryOverCap: "0.00" },
  { code: "PAT", name: "Paternity leave", statutory: true, paid: true, countingBasis: "working", annualDays: "7.00", carryOverCap: "0.00" },
  { code: "SOLO", name: "Solo parent leave", statutory: true, paid: true, countingBasis: "working", annualDays: "7.00", carryOverCap: "0.00" },
  { code: "VAWC", name: "VAWC leave", statutory: true, paid: true, countingBasis: "working", annualDays: "10.00", carryOverCap: "0.00" },
  { code: "WOMEN", name: "Special leave for women", statutory: true, paid: true, countingBasis: "calendar", annualDays: "60.00", carryOverCap: "0.00" },
] as const;

export async function ensureLeaveTypes(tenantId: string) {
  await db
    .insert(leaveTypes)
    .values(defaultLeaveTypes.map((type) => ({ ...type, tenantId })))
    .onConflictDoNothing({ target: [leaveTypes.tenantId, leaveTypes.code] });

  return db.select().from(leaveTypes).where(eq(leaveTypes.tenantId, tenantId));
}

export type Entitlement = { annualDays: number; carryOverCap: number };

export function entitlementFor(
  type: { id: string; annualDays: string; carryOverCap: string },
  rankId: string | null,
  policies: Array<{ leaveTypeId: string; rankId: string | null; annualDays: string; carryOverCap: string }>,
): Entitlement {
  const override = policies.find(
    (policy) => policy.leaveTypeId === type.id && policy.rankId !== null && policy.rankId === rankId,
  );

  return override
    ? { annualDays: Number(override.annualDays), carryOverCap: Number(override.carryOverCap) }
    : { annualDays: Number(type.annualDays), carryOverCap: Number(type.carryOverCap) };
}

export async function initializeLeaveYear(tenantId: string, year: number) {
  const types = await ensureLeaveTypes(tenantId);
  const policies = await db.select().from(leavePolicies).where(eq(leavePolicies.tenantId, tenantId));
  const people = await db
    .select()
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.status, "active")));

  const previous = await db
    .select()
    .from(leaveBalances)
    .where(and(eq(leaveBalances.tenantId, tenantId), eq(leaveBalances.year, year - 1)));

  const previousKey = new Map(previous.map((row) => [`${row.employeeId}:${row.leaveTypeId}`, row]));

  for (const employee of people) {
    for (const type of types) {
      const entitlement = entitlementFor(type, employee.rankId, policies);
      const prior = previousKey.get(`${employee.id}:${type.id}`);
      const priorUnused = prior ? Math.max(0, Number(prior.granted) + Number(prior.carried) - Number(prior.used)) : 0;
      const carried = Math.min(priorUnused, entitlement.carryOverCap);

      await db
        .insert(leaveBalances)
        .values({
          tenantId,
          employeeId: employee.id,
          leaveTypeId: type.id,
          year,
          granted: entitlement.annualDays.toFixed(2),
          carried: carried.toFixed(2),
          used: "0",
        })
        .onConflictDoUpdate({
          target: [leaveBalances.tenantId, leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.year],
          set: {
            granted: entitlement.annualDays.toFixed(2),
            carried: carried.toFixed(2),
          },
        });
    }
  }
}

export async function rankList(tenantId: string) {
  return db.select().from(ranks).where(eq(ranks.tenantId, tenantId));
}
