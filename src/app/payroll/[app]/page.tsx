import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { payrollApps } from "@/lib/navigation";

export default async function PayrollAppPage({ params }: { params: Promise<{ app: string }> }) {
  const { app: slug } = await params;
  const app = payrollApps.find((candidate) => candidate.slug === slug);

  if (!app) notFound();

  return (
    <>
      <WorkspaceHeader breadcrumb={`Payroll / ${app.name}`} />

      <main className="mx-auto w-full max-w-[880px] flex-1 px-6 pb-20 pt-12">
        <Link href="/payroll" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Payroll
        </Link>

        <p className="mt-10 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          App {app.index} · {app.status}
        </p>
        <h1 className="mt-3 font-serif text-[32px] leading-[1.08] sm:text-[40px] sm:leading-[1.05] tracking-[-0.03em]">{app.name}</h1>
        <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.65] text-ink-2">{app.description}</p>

        <div className="mt-10 rounded-[14px] border border-rule bg-surface p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Not yet built</p>
          <p className="mt-2 max-w-[58ch] text-[13.5px] leading-[1.65] text-ink-2">
            This screen is part of the payroll release. It is shown here so the navigation and
            layout can be reviewed before the engine is written — it does not accept data.
          </p>
        </div>
      </main>

      <WorkspaceFooter />
    </>
  );
}
