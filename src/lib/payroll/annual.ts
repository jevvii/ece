import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, payRunLines, payRuns, payrollPeriods } from "@/db/schema";
import { round2 } from "./statutory";

export const annualBrackets = [
  { over: 0, base: 0, rate: 0 },
  { over: 250000, base: 0, rate: 0.15 },
  { over: 400000, base: 22500, rate: 0.2 },
  { over: 800000, base: 102500, rate: 0.25 },
  { over: 2000000, base: 402500, rate: 0.3 },
  { over: 8000000, base: 2202500, rate: 0.35 },
] as const;

export function annualTax(taxable: number) {
  if (taxable <= 0) return 0;
  let bracket: (typeof annualBrackets)[number] = annualBrackets[0];
  for (const candidate of annualBrackets) {
    if (taxable > candidate.over) bracket = candidate;
  }
  return round2(bracket.base + (taxable - bracket.over) * bracket.rate);
}

export type AnnualRow = {
  employeeId: string;
  employeeCode: string;
  name: string;
  tin: string | null;
  gross: number;
  basic: number;
  allowance: number;
  premium: number;
  thirteenthAccrual: number;
  sssEmployee: number;
  philhealthEmployee: number;
  pagibigEmployee: number;
  taxWithheld: number;
  netPay: number;
  taxable: number;
  taxDue: number;
  difference: number;
  runs: number;
};

export async function annualSummary(tenantId: string, year: number): Promise<AnnualRow[]> {
  const rows = await db
    .select({
      employeeId: payRunLines.employeeId,
      employeeCode: employees.employeeCode,
      lastName: employees.lastName,
      firstName: employees.firstName,
      tin: employees.tin,
      gross: sql<string>`coalesce(sum(${payRunLines.gross}), 0)`,
      basic: sql<string>`coalesce(sum(${payRunLines.basic}), 0)`,
      allowance: sql<string>`coalesce(sum(${payRunLines.allowance}), 0)`,
      premium: sql<string>`coalesce(sum(${payRunLines.overtime} + ${payRunLines.nightDiff} + ${payRunLines.holiday} + ${payRunLines.premium}), 0)`,
      thirteenthAccrual: sql<string>`coalesce(sum(${payRunLines.thirteenthAccrual}), 0)`,
      sssEmployee: sql<string>`coalesce(sum(${payRunLines.sssEmployee}), 0)`,
      philhealthEmployee: sql<string>`coalesce(sum(${payRunLines.philhealthEmployee}), 0)`,
      pagibigEmployee: sql<string>`coalesce(sum(${payRunLines.pagibigEmployee}), 0)`,
      taxWithheld: sql<string>`coalesce(sum(${payRunLines.tax}), 0)`,
      netPay: sql<string>`coalesce(sum(${payRunLines.netPay}), 0)`,
      runs: sql<number>`count(*)::int`,
    })
    .from(payRunLines)
    .innerJoin(payRuns, eq(payRuns.id, payRunLines.runId))
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payRuns.periodId))
    .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
    .where(
      and(
        eq(payRunLines.tenantId, tenantId),
        eq(payRuns.status, "approved"),
        sql`extract(year from ${payrollPeriods.coverageEnd}) = ${year}`,
      ),
    )
    .groupBy(
      payRunLines.employeeId,
      employees.employeeCode,
      employees.lastName,
      employees.firstName,
      employees.tin,
    )
    .orderBy(employees.employeeCode);

  return rows.map((row) => {
    const gross = round2(Number(row.gross));
    const sss = round2(Number(row.sssEmployee));
    const ph = round2(Number(row.philhealthEmployee));
    const pi = round2(Number(row.pagibigEmployee));
    const taxWithheld = round2(Number(row.taxWithheld));
    const taxable = Math.max(0, round2(gross - sss - ph - pi));
    const taxDue = annualTax(taxable);

    return {
      employeeId: row.employeeId,
      employeeCode: row.employeeCode,
      name: `${row.lastName}, ${row.firstName}`,
      tin: row.tin,
      gross,
      basic: round2(Number(row.basic)),
      allowance: round2(Number(row.allowance)),
      premium: round2(Number(row.premium)),
      thirteenthAccrual: round2(Number(row.thirteenthAccrual)),
      sssEmployee: sss,
      philhealthEmployee: ph,
      pagibigEmployee: pi,
      taxWithheld,
      netPay: round2(Number(row.netPay)),
      taxable,
      taxDue,
      difference: round2(taxDue - taxWithheld),
      runs: row.runs,
    };
  });
}
