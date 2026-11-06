import Link from "next/link";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { requireWorkspace } from "@/lib/auth";
import { annualSummary } from "@/lib/payroll/annual";
import { STATUTORY_APPROVED } from "@/lib/payroll/statutory";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });

export default async function Form2316IndexPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: rawYear } = await searchParams;
  const { tenant } = await requireWorkspace();
  const year = Number(rawYear ?? 2026) || 2026;
  const rows = await annualSummary(tenant.id, year);

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / 2316" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/payroll" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Payroll
        </Link>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              BIR Form 2316 · {year}
            </p>
            <h1 className="mt-3 font-serif text-[34px] leading-[1.05] tracking-[-0.03em] sm:text-[40px]">
              2316
            </h1>
            <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.6] text-ink-2">
              Certificate of compensation payment and tax withheld. Issued from the annualized
              figures, one per employee, with a data export beside each.
            </p>
          </div>
          <form method="get" className="flex items-end gap-2">
            <div>
              <label htmlFor="year" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Tax year</label>
              <input
                id="year"
                name="year"
                type="number"
                defaultValue={year}
                min={2020}
                max={2100}
                className="mt-1 h-9 w-28 rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px] tabular-nums"
              />
            </div>
            <button type="submit" className="h-9 rounded-full border border-rule-strong px-4 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-ink-2 hover:text-ink">
              View
            </button>
          </form>
        </div>

        {!STATUTORY_APPROVED ? (
          <div className="mt-6 rounded-[10px] border border-warn/25 bg-[#fbf3db] px-4 py-3">
            <p className="text-[12.5px] leading-[1.6] text-[#7a5a14]">
              The statutory dataset is unapproved. Every certificate is marked{" "}
              <span className="font-medium">DEMO — FOR REVIEW ONLY — NOT FOR FILING</span>.
            </p>
          </div>
        ) : null}

        <section className="mt-8 rounded-[14px] border border-rule bg-surface">
          {rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-muted">
              No approved payroll in {year}. A 2316 can only be issued from approved figures.
            </p>
          ) : (
            <ul>
              {rows.map((row) => (
                <li key={row.employeeId} className="border-b border-rule last:border-b-0">
                  <Link
                    href={`/payroll/2316/${row.employeeId}?year=${year}`}
                    className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px]">
                        <span className="figure mr-2 text-[11.5px] text-muted">{row.employeeCode}</span>
                        {row.name}
                      </span>
                      <span className="figure block text-[11.5px] text-muted">
                        TIN {row.tin ?? "—"} · {row.runs} cutoff{row.runs === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="ml-auto text-right">
                      <span className="figure block text-[12.5px]">{peso.format(row.taxable)}</span>
                      <span className="text-[10.5px] uppercase tracking-[0.08em] text-muted">taxable</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <WorkspaceFooter />
    </>
  );
}
