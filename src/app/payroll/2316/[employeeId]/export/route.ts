import { annualSummary } from "@/lib/payroll/annual";
import { requireWorkspace } from "@/lib/auth";

export async function GET(
  _request: Request,
  { params, }: { params: Promise<{ employeeId: string }> },
) {
  const { employeeId } = await params;
  const { tenant } = await requireWorkspace();
  const year = new URL(_request.url).searchParams.get("year");
  const taxYear = Number(year ?? 2026) || 2026;

  const rows = await annualSummary(tenant.id, taxYear);
  const row = rows.find((candidate) => candidate.employeeId === employeeId);
  if (!row) return new Response("Not found", { status: 404 });

  const lines = [
    ["Field", "Value"],
    ["Tax year", String(taxYear)],
    ["Employee code", row.employeeCode],
    ["Employee", row.name],
    ["TIN", row.tin ?? ""],
    ["Gross compensation", row.gross.toFixed(2)],
    ["SSS employee", row.sssEmployee.toFixed(2)],
    ["PhilHealth employee", row.philhealthEmployee.toFixed(2)],
    ["Pag-IBIG employee", row.pagibigEmployee.toFixed(2)],
    ["Taxable compensation", row.taxable.toFixed(2)],
    ["Tax due", row.taxDue.toFixed(2)],
    ["Tax withheld", row.taxWithheld.toFixed(2)],
    ["Adjustment", row.difference.toFixed(2)],
    ["Basic salary", row.basic.toFixed(2)],
    ["Allowances", row.allowance.toFixed(2)],
    ["Overtime and premium", row.premium.toFixed(2)],
    ["13th month accrued", row.thirteenthAccrual.toFixed(2)],
  ];

  const csv = lines.map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="2316-${row.employeeCode}-${taxYear}.csv"`,
    },
  });
}
