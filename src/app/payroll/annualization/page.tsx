import Link from "next/link";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { requireWorkspace } from "@/lib/auth";
import { annualSummary } from "@/lib/payroll/annual";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });

export default async function AnnualizationPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: rawYear } = await searchParams;
  const { tenant } = await requireWorkspace();
  const year = Number(rawYear ?? 2026) || 2026;

  const rows = await annualSummary(tenant.id, year);

  const totals = rows.reduce(
    (sum, row) => ({
      gross: sum.gross + row.gross,
      taxable: sum.taxable + row.taxable,
      due: sum.due + row.taxDue,
      withheld: sum.withheld + row.taxWithheld,
      difference: sum.difference + row.difference,
    }),
    { gross: 0, taxable: 0, due: 0, withheld: 0, difference: 0 },
  );

  const maxRuns = rows.reduce((max, row) => Math.max(max, row.runs), 0);
  const partial = maxRuns > 0 && maxRuns < 22;

  return (
    <>
      <WorkspaceHeader breadcrumb="Payroll / Annualization" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/payroll" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Payroll
        </Link>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              Annualization · tax year {year}
            </p>
            <h1 className="mt-3 font-serif text-[34px] leading-[1.05] tracking-[-0.03em] sm:text-[40px]">
              Annualization
            </h1>
            <p className="mt-3 max-w-[62ch] text-[13.5px] leading-[1.6] text-ink-2">
              Year-to-date pay from approved runs, compared with the annual tax due. A shortfall is
              withheld from December pay; an excess is refunded. Nothing is applied automatically.
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

        {partial ? (
          <div className="mt-6 rounded-[10px] border border-warn/25 bg-[#fbf3db] px-4 py-3">
            <p className="text-[12.5px] leading-[1.6] text-[#7a5a14]">
              Only {maxRuns} approved cutoff{maxRuns === 1 ? "" : "s"} exist for {year}. These are
              projected figures — annualization becomes final once all cutoffs are approved.
            </p>
          </div>
        ) : null}

        <div className="mt-7 grid gap-px border border-rule bg-rule sm:grid-cols-4">
          {[
            ["Gross compensation", peso.format(totals.gross)],
            ["Taxable compensation", peso.format(totals.taxable)],
            ["Tax withheld", peso.format(totals.withheld)],
            ["Balance", peso.format(totals.difference)],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
              <p className="figure mt-1 text-[15.5px]">{value}</p>
            </div>
          ))}
        </div>

        <section className="mt-6 rounded-[14px] border border-rule bg-surface">
          <div className="scroll-x">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-rule">
                  {["Employee", "Gross", "Contributions", "Taxable", "Tax due", "Withheld", "Adjustment"].map((heading) => (
                    <th
                      key={heading}
                      className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted ${
                        ["Gross", "Contributions", "Taxable", "Tax due", "Withheld", "Adjustment"].includes(heading)
                          ? "text-right"
                          : ""
                      }`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employeeId} className="border-b border-rule last:border-b-0 hover:bg-surface-2">
                    <td className="px-3 py-2 text-[12.5px]">
                      <span className="figure mr-2 text-[11.5px] text-muted">{row.employeeCode}</span>
                      {row.name}
                    </td>
                    <td className="figure px-3 py-2 text-right text-[12.5px]">{peso.format(row.gross)}</td>
                    <td className="figure px-3 py-2 text-right text-[12.5px] text-ink-2">
                      {peso.format(row.sssEmployee + row.philhealthEmployee + row.pagibigEmployee)}
                    </td>
                    <td className="figure px-3 py-2 text-right text-[12.5px]">{peso.format(row.taxable)}</td>
                    <td className="figure px-3 py-2 text-right text-[12.5px]">{peso.format(row.taxDue)}</td>
                    <td className="figure px-3 py-2 text-right text-[12.5px] text-ink-2">{peso.format(row.taxWithheld)}</td>
                    <td className={`figure px-3 py-2 text-right text-[12.5px] ${row.difference > 0 ? "text-[#9f2f2d]" : "text-accent"}`}>
                      {peso.format(row.difference)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-[13px] text-muted">
                      No approved payroll in {year}.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <p className="mt-5 max-w-[80ch] text-[12px] leading-relaxed text-muted">
          A positive adjustment is tax still due and is withheld from the December cutoff; a negative
          adjustment is a refund. Prior-employer and opening figures are not yet reconciled into this
          table, so mid-year hires require a reviewed opening before filing.
        </p>
      </main>

      <WorkspaceFooter />
    </>
  );
}
