import { ErpCard } from "@/components/module-card";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { requireWorkspace } from "@/lib/auth";
import { erpModules } from "@/lib/navigation";
import { getOpenPeriod, getSetupProgress } from "@/lib/workspace";

export default async function LauncherPage() {
  const { tenant, memberships } = await requireWorkspace();
  const [period, progress] = await Promise.all([
    getOpenPeriod(tenant.id),
    getSetupProgress(tenant),
  ]);

  const modules = erpModules.map((module) =>
    module.slug === "payroll"
      ? {
          ...module,
          statusNote: period ? `Cutoff ${period.cutoffNo} open` : "Setup in progress",
        }
      : module,
  );

  return (
    <>
      <WorkspaceHeader />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-14">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              Workspace · {memberships.length} {memberships.length === 1 ? "company" : "companies"}
            </p>
            <h1 className="mt-4 font-serif text-[clamp(2.5rem,5vw,3.5rem)] leading-[1.02] tracking-[-0.035em]">
              One ledger.
              <br />
              Every department.
            </h1>
            <p className="mt-5 max-w-[54ch] text-[14.5px] leading-[1.65] text-ink-2">
              {tenant.tradeName ?? tenant.legalName} is set up to {progress.done} of {progress.total}{" "}
              stages. Every module shares this company, its chart of accounts, and one audit trail —
              no second login.
            </p>
          </div>

          <div className="rounded-[14px] border border-rule bg-surface-2 px-5 py-4 text-left">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted">
              Dataset <span className="font-mono">PH-2026.1</span>
            </p>
            <p className="mt-1.5 text-[12.5px] text-ink-2">Statutory rules pending approval</p>
            <p className="tnum mt-1 font-mono text-[11.5px] text-muted">
              SSS · PhilHealth · Pag-IBIG · BIR
            </p>
          </div>
        </div>

        <div className="hairline-grid mt-11 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module, index) => (
            <ErpCard key={module.slug} module={module} index={index} />
          ))}
        </div>

        <p className="mt-6 text-[12.5px] leading-relaxed text-muted">
          <span className="mr-2 inline-block h-1 w-1 rounded-full bg-rule-strong align-middle" aria-hidden="true" />
          Modules marked <span className="text-ink-2">Planned</span> are present in the map but have
          no screens yet. They are never simulated.
        </p>
      </main>

      <WorkspaceFooter />
    </>
  );
}
