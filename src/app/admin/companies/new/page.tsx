import Link from "next/link";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { requireWorkspace } from "@/lib/auth";
import { createCompanyAction } from "@/lib/setup/actions";

const input =
  "mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-3 text-[13.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";
const label = "block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted";

const regions = [
  "NCR", "CAR", "I", "II", "III", "IV-A", "IV-B", "V", "VI", "VII", "VIII",
  "IX", "X", "XI", "XII", "XIII", "CARAGA", "BARMM",
];

export default async function NewCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { tenant, membership } = await requireWorkspace();
  const params = await searchParams;
  const canCreate = membership.role === "company_admin" || membership.role === "payroll_officer";

  return (
    <>
      <WorkspaceHeader breadcrumb="Admin / New company" />

      <main className="mx-auto w-full max-w-[720px] flex-1 px-6 pb-16 pt-12">
        <Link href="/admin" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Admin
        </Link>

        <div className="mt-6">
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            New client company
          </p>
          <h1 className="mt-4 font-serif text-[clamp(2.25rem,4.5vw,3rem)] leading-[1.04] tracking-[-0.03em]">
            Add a company
          </h1>
          <p className="mt-4 max-w-[60ch] text-[14px] leading-[1.65] text-ink-2">
            The company joins your firm and you become its company admin. Everything else — divisor,
            calendar, schedule, ranks and employees — is collected in setup.
          </p>
        </div>

        {params.error ? (
          <div role="alert" className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {decodeURIComponent(params.error)}
          </div>
        ) : null}
        {!canCreate ? (
          <div className="mt-6 rounded-[10px] border border-rule-strong bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
            Your role cannot create companies. A company admin or payroll officer can.
          </div>
        ) : null}

        <form action={createCompanyAction} className="mt-8 rounded-[14px] border border-rule bg-surface p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="legalName" className={label}>Registered name</label>
              <input id="legalName" name="legalName" required placeholder="Ilaya Manufacturing Inc." className={input} />
            </div>
            <div>
              <label htmlFor="tin" className={label}>TIN</label>
              <input id="tin" name="tin" required placeholder="000-000-000-000" className={input} />
            </div>
            <div>
              <label htmlFor="regionCode" className={label}>Region</label>
              <select id="regionCode" name="regionCode" defaultValue={tenant.regionCode ?? "NCR"} className={input}>
                {regions.map((region) => (
                  <option key={region} value={region}>{region}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-rule pt-5">
            <p className="text-[12px] text-muted">Setup opens immediately after this.</p>
            <button
              type="submit"
              disabled={!canCreate}
              className="h-10 rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-40"
            >
              Create company
            </button>
          </div>
        </form>
      </main>

      <WorkspaceFooter />
    </>
  );
}
