import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { annualSummary } from "@/lib/payroll/annual";
import { STATUTORY_APPROVED, STATUTORY_VERSION } from "@/lib/payroll/statutory";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-1.5">
      <span className={`text-[10.5px] ${strong ? "font-medium" : "text-ink-2"}`}>{label}</span>
      <span className={`figure text-[11px] ${strong ? "font-medium" : ""}`}>{value}</span>
    </div>
  );
}

export default async function CertificatePage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { employeeId } = await params;
  const { year: rawYear } = await searchParams;
  const { tenant } = await requireWorkspace();
  const year = Number(rawYear ?? 2026) || 2026;

  const rows = await annualSummary(tenant.id, year);
  const row = rows.find((candidate) => candidate.employeeId === employeeId);
  if (!row) notFound();

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee) notFound();

  const nonTaxable = row.sssEmployee + row.philhealthEmployee + row.pagibigEmployee;

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / 2316 / Certificate" />

      <main className="mx-auto w-full max-w-[880px] flex-1 px-6 pb-16 pt-10">
        <div className="no-print flex flex-wrap items-center justify-between gap-4">
          <Link href={`/payroll/2316?year=${year}`} className="text-[11.5px] text-muted hover:text-ink-2">
            ← 2316
          </Link>
          <div className="flex items-center gap-3">
            <a
              href={`/payroll/2316/${employeeId}/export?year=${year}`}
              className="h-9 rounded-full border border-rule px-4 text-[12px] font-semibold leading-9 text-ink-2 hover:bg-surface-2"
            >
              Export data
            </a>
            <a
              href={`/payroll/2316/${employeeId}/pdf?year=${year}`}
              target="_blank"
              rel="noreferrer"
              className="no-print h-9 rounded-full border border-rule-strong px-4 text-[12px] font-semibold leading-9 hover:bg-surface-2"
            >
              Print official 2316 (PDF)
            </a>
          </div>
        </div>

        <p className="no-print mt-6 max-w-[70ch] text-[11.5px] leading-relaxed text-muted">
          This screen is a review summary. The print action opens the official BIR Form 2316
          (September 2021 ENCS) with these figures placed on it.
        </p>

        <article className="certificate relative mt-6 overflow-hidden border border-rule bg-white p-6 sm:p-10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
            style={{ transform: "rotate(-28deg)" }}
          >
            <span className="whitespace-nowrap text-[34px] font-semibold uppercase tracking-[0.18em] text-[#9f2f2d]/[0.05]">
              Demo — not for filing
            </span>
          </div>

          <header className="relative border-b-2 border-ink pb-3">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted">BIR Form No. 2316</p>
                <p className="mt-1 text-[13px] font-semibold">Certificate of Compensation Payment / Tax Withheld</p>
                <p className="mt-0.5 text-[10px] text-ink-2">September 2021 (ENCS) · for calendar year {year}</p>
              </div>
              <div className="text-right text-[10px] text-ink-2">
                <p className="font-semibold uppercase tracking-[0.08em]">For employee</p>
                <p>Not for filing</p>
              </div>
            </div>
          </header>

          {!STATUTORY_APPROVED ? (
            <div className="relative mt-3 rounded-full border border-[#9f2f2d] px-3 py-2 text-center">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#9f2f2d]">
                Demo — for review only — not for filing
              </p>
            </div>
          ) : null}

          <section className="relative mt-5 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">Part I · Employee</p>
              <div className="mt-2 space-y-1 text-[11px]">
                <p><span className="text-muted">Name</span> · {employee.lastName}, {employee.firstName} {employee.middleName ?? ""}</p>
                <p className="figure"><span className="text-muted">TIN</span> · {employee.tin ?? "—"}</p>
                <p className="figure"><span className="text-muted">Hired</span> · {employee.hireDate}</p>
                <p><span className="text-muted">Address</span> · not on file</p>
              </div>
            </div>
            <div>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">Part II · Employer</p>
              <div className="mt-2 space-y-1 text-[11px]">
                <p>{tenant.legalName}</p>
                <p className="figure"><span className="text-muted">TIN</span> · {tenant.tin ?? "—"}</p>
                <p className="figure"><span className="text-muted">RDO</span> · {tenant.rdoCode ?? "—"}</p>
                <p>{tenant.addressLine ?? "—"}</p>
              </div>
            </div>
          </section>

          <section className="relative mt-6">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">Part IV-A · Summary</p>
            <div className="mt-2">
              <Line label="Gross compensation income" value={peso.format(row.gross)} />
              <Line label="Less: non-taxable compensation (employee contributions)" value={peso.format(nonTaxable)} />
              <Line label="Taxable compensation" value={peso.format(row.taxable)} strong />
              <Line label="Tax due" value={peso.format(row.taxDue)} strong />
              <Line label="Tax withheld" value={peso.format(row.taxWithheld)} />
              <Line
                label={row.difference >= 0 ? "Tax still due" : "Tax over-withheld (refund)"}
                value={peso.format(Math.abs(row.difference))}
                strong
              />
            </div>
          </section>

          <section className="relative mt-6">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">Part IV-B · Detail</p>
            <div className="mt-2">
              <Line label="Basic salary" value={peso.format(row.basic)} />
              <Line label="Allowances" value={peso.format(row.allowance)} />
              <Line label="Overtime, holiday and premium pay" value={peso.format(row.premium)} />
              <Line label="SSS employee contribution" value={peso.format(row.sssEmployee)} />
              <Line label="PhilHealth employee contribution" value={peso.format(row.philhealthEmployee)} />
              <Line label="Pag-IBIG employee contribution" value={peso.format(row.pagibigEmployee)} />
              <Line label="13th month accrued (not yet paid)" value={peso.format(row.thirteenthAccrual)} />
            </div>
          </section>

          <footer className="relative mt-8 grid grid-cols-2 gap-10">
            <div>
              <div className="h-8 border-b border-ink/40" />
              <p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-muted">Employee signature</p>
            </div>
            <div>
              <div className="h-8 border-b border-ink/40" />
              <p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-muted">Employer / authorised officer</p>
            </div>
          </footer>

          <p className="relative mt-6 text-[8.5px] leading-relaxed text-muted">
            Generated from {row.runs} approved cutoff{row.runs === 1 ? "" : "s"} in {year} and statutory
            dataset {STATUTORY_VERSION}, which is pending accountant approval. A partial year is a
            projection, not a final annualization; prior-employer income and opening balances are not
            yet reconciled. This page is a review representation, not the official BIR layout.
          </p>
        </article>
      </main>
    </>
  );
}
