import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { erpModules } from "@/lib/navigation";

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug === "admin") redirect("/admin");
  const entry = erpModules.find((candidate) => candidate.slug === slug);

  if (!entry) notFound();

  return (
    <>
      <WorkspaceHeader breadcrumb={entry.name} />

      <main className="mx-auto w-full max-w-[880px] flex-1 px-6 pb-20 pt-12">
        <Link href="/" className="text-[12.5px] text-muted hover:text-ink-2">
          ← All modules
        </Link>

        <p className="mt-10 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          Module {entry.index} · {entry.statusNote}
        </p>
        <h1 className="mt-3 font-serif text-[32px] leading-[1.08] sm:text-[40px] sm:leading-[1.05] tracking-[-0.03em]">{entry.name}</h1>
        <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.65] text-ink-2">{entry.description}</p>

        <div className="mt-10 rounded-[14px] border border-rule bg-surface p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            {entry.status === "planned" ? "Planned" : "Shared"}
          </p>
          <p className="mt-2 max-w-[58ch] text-[13.5px] leading-[1.65] text-ink-2">
            {entry.status === "planned"
              ? "This module is in the workspace map but has no screens yet. It is not simulated and holds no data."
              : "This area is shared with Payroll. Company setup, employees, ranks, access and numbering are configured once and used by every module."}
          </p>
        </div>
      </main>

      <WorkspaceFooter />
    </>
  );
}
