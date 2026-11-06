import type { CSSProperties } from "react";
import Link from "next/link";
import { Arrow, Icon } from "@/components/icon";
import type { ErpModule, PayrollApp } from "@/lib/navigation";

const statusTone = {
  active: { dot: "bg-accent", text: "text-accent" },
  shared: { dot: "bg-rule-strong", text: "text-ink-2" },
  planned: { dot: "border border-rule-strong", text: "text-muted" },
} as const;

const cardClass =
  "rise group/card flex min-h-[168px] flex-col bg-surface p-5  sm:p-6 transition-[background-color,border-color,transform] duration-200 hover:-translate-y-[1px] hover:border-accent/35 hover:bg-[#FBFDFB] ";

export function ErpCard({ module, index }: { module: ErpModule; index: number }) {
  const tone = statusTone[module.status];
  const body = (
    <>
      <div className="flex items-start justify-between">
        <span className="tnum font-mono text-[12px] tracking-[0.06em] text-muted">{module.index}</span>
        <Icon name={module.icon} className="text-ink-2" />
      </div>

      <div className="mt-7 sm:mt-9">
        <h2 className="text-[16px] font-semibold leading-snug tracking-[-0.01em]">{module.name}</h2>
        <p className="mt-1.5 max-w-[32ch] text-[13px] leading-[1.55] text-ink-2">{module.description}</p>
      </div>

      <div className="mt-auto pt-5 sm:pt-6">
        <div className="flex items-center gap-2 border-t border-rule pt-3">
          <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
          <span className={`text-[11.5px] font-semibold uppercase tracking-[0.09em] ${tone.text}`}>
            {module.statusNote}
          </span>
          {module.status === "active" ? <Arrow className="ml-auto text-muted transition-colors group-hover:text-accent" /> : null}
        </div>
      </div>
    </>
  );

  if (module.status === "planned") {
    return (
      <div className={cardClass} style={{ "--i": index } as CSSProperties} aria-disabled="true">
        {body}
      </div>
    );
  }

  return (
    <Link
      href={module.status === "active" ? "/payroll" : `/modules/${module.slug}`}
      className={`${cardClass} group`}
      style={{ "--i": index } as CSSProperties}
    >
      {body}
    </Link>
  );
}

const payrollTone = {
  active: { dot: "bg-accent", text: "text-accent" },
  idle: { dot: "bg-rule-strong", text: "text-ink-2" },
  locked: { dot: "border border-rule-strong", text: "text-muted" },
} as const;

export function PayrollCard({ app, index }: { app: PayrollApp; index: number }) {
  const tone = payrollTone[app.tone];

  return (
    <Link
      href={`/payroll/${app.slug}`}
      className={`${cardClass} group ${app.wide ? "sm:col-span-2 lg:col-span-3" : ""}`}
      style={{ "--i": index } as CSSProperties}
    >
      <div className="flex items-start justify-between">
        <span className="tnum font-mono text-[12px] tracking-[0.06em] text-muted">{app.index}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-rule text-muted transition-colors group-hover:border-accent/30 group-hover:bg-accent-soft group-hover:text-accent"><Arrow /></span>
      </div>

      <div className={app.wide ? "mt-7 sm:mt-8" : "mt-8 sm:mt-9"}>
        <h2 className="text-[16px] font-semibold leading-snug tracking-[-0.01em]">{app.name}</h2>
        <p className="mt-1.5 max-w-[44ch] text-[13px] leading-[1.55] text-ink-2">{app.description}</p>
      </div>

      <div className="mt-auto pt-5 sm:pt-6">
        <div className="flex items-center gap-2 border-t border-rule pt-3">
          <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
          <span className={`text-[11.5px] font-semibold uppercase tracking-[0.09em] ${tone.text}`}>{app.status}</span>
        </div>
      </div>
    </Link>
  );
}
