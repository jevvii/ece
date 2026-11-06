import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { annualSummary } from "@/lib/payroll/annual";
import { buildForm2316 } from "@/lib/payroll/form2316";
import { STATUTORY_APPROVED } from "@/lib/payroll/statutory";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const { employeeId } = await params;
  const { tenant } = await requireWorkspace();
  const year = Number(new URL(request.url).searchParams.get("year") ?? 2026) || 2026;

  const rows = await annualSummary(tenant.id, year);
  const row = rows.find((candidate) => candidate.employeeId === employeeId);
  if (!row) return new Response("Not found", { status: 404 });

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee) return new Response("Not found", { status: 404 });

  const pdf = await buildForm2316({
    year,
    employee: {
      name: `${employee.lastName}, ${employee.firstName}${employee.middleName ? ` ${employee.middleName}` : ""}`,
      tin: employee.tin,
    },
    employer: {
      name: tenant.legalName,
      tin: tenant.tin,
      address: tenant.addressLine,
    },
    figures: {
      gross: row.gross,
      nonTaxable: row.sssEmployee + row.philhealthEmployee + row.pagibigEmployee,
      taxable: row.taxable,
      taxDue: row.taxDue,
      taxWithheld: row.taxWithheld,
      basic: row.basic,
      allowance: row.allowance,
      premium: row.premium,
    },
    watermark: !STATUTORY_APPROVED,
  });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="2316-${row.employeeCode}-${year}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
