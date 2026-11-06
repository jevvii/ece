import Link from "next/link";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { AdminTabs } from "@/components/admin-tabs";
import { WorkspaceFooter, WorkspaceHeader } from "@/components/workspace-header";
import { db } from "@/db/client";
import { employees, payrollCalendars, payrollPeriods, workScheduleDays, workSchedules } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { getSetupProgress } from "@/lib/workspace";
import { restartSetup, saveCalendar, saveCompanyDetails, saveSchedule } from "./actions";
import { CalendarFields } from "./calendar-fields";
import { DivisorField } from "./divisor-field";

const steps = [
  { n: 1, label: "Company details", built: true },
  { n: 2, label: "Cutoff calendar", built: true },
  { n: 3, label: "Work schedules", built: true },
  { n: 4, label: "Employee master", built: true },
  { n: 5, label: "Leave policy", built: false },
  { n: 6, label: "Pay components", built: false },
  { n: 7, label: "Posting accounts", built: false },
  { n: 8, label: "Import mapping", built: false },
  { n: 9, label: "Opening balances", built: false },
  { n: 10, label: "Sample validation", built: false },
];

const weekdays = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
];

const regions = [
  "NCR", "CAR", "I", "II", "III", "IV-A", "IV-B", "V", "VI", "VII", "VIII",
  "IX", "X", "XI", "XII", "XIII", "CARAGA", "BARMM",
];

const input =
  "mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-3 text-[13.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";
const label = "block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; saved?: string; error?: string; restarted?: string }>;
}) {
  const params = await searchParams;
  const { tenant, membership } = await requireWorkspace();

  const step = Math.min(Math.max(Number(params.step ?? 1) || 1, 1), 10);
  const canSetup = membership.role === "company_admin" || membership.role === "payroll_officer";

  const [progress, calendar, schedules, people] = await Promise.all([
    getSetupProgress(tenant),
    db
      .select()
      .from(payrollCalendars)
      .where(and(eq(payrollCalendars.tenantId, tenant.id), isNull(payrollCalendars.archivedAt)))
      .limit(1),
    db
      .select()
      .from(workSchedules)
      .where(and(eq(workSchedules.tenantId, tenant.id), isNull(workSchedules.archivedAt)))
      .orderBy(asc(workSchedules.createdAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(employees)
      .where(and(eq(employees.tenantId, tenant.id), isNull(employees.archivedAt))),
  ]);

  const activeCalendar = calendar[0] ?? null;
  const scheduleIds = schedules.map((schedule) => schedule.id);
  const days =
    scheduleIds.length > 0
      ? await db
          .select()
          .from(workScheduleDays)
          .where(inArray(workScheduleDays.scheduleId, scheduleIds))
      : [];

  const periodCount = activeCalendar
    ? (
        await db
          .select({ count: sql<number>`count(*)::int` })
          .from(payrollPeriods)
          .where(eq(payrollPeriods.calendarId, activeCalendar.id))
      )[0]?.count ?? 0
    : 0;

  const employeeCount = people[0]?.count ?? 0;

  return (
    <>
      <WorkspaceHeader breadcrumb="Admin / Setup" />

      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-12">
        <Link href="/admin" className="text-[12.5px] text-muted hover:text-ink-2">
          ← Admin
        </Link>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Onboarding · setup v{tenant.setupVersion}
          </p>
          <h1 className="mt-3 font-serif text-[32px] leading-[1.06] tracking-[-0.03em] sm:text-[40px]">
            {tenant.legalName}
          </h1>
          <p className="mt-3 max-w-[60ch] text-[13.5px] leading-[1.6] text-ink-2">
            Configure the company once. Payroll cannot open a cutoff until the calendar, schedules
            and employee master are complete.
          </p>
          </div>
          <Link
            href="/payroll/onboarding"
            className="text-[12.5px] text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-ink"
          >
            Open guided setup
          </Link>
        </div>

        <AdminTabs current="setup" />

        {params.error ? (
          <div role="alert" className="mt-6 rounded-[10px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {decodeURIComponent(params.error)}
          </div>
        ) : null}
        {params.saved ? (
          <div className="mt-6 rounded-[10px] border border-accent/20 bg-accent-soft px-4 py-3 text-[13px] text-accent">
            Saved.
          </div>
        ) : null}
        {params.restarted ? (
          <div className="mt-6 rounded-[10px] border border-warn/25 bg-[#fbf3db] px-4 py-3 text-[13px] text-[#956400]">
            Setup restarted. Previous calendars and schedules were archived, not deleted.
          </div>
        ) : null}
        {!canSetup ? (
          <div className="mt-6 rounded-[10px] border border-rule-strong bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
            Your role is read-only for setup. A company admin or payroll officer can make changes.
          </div>
        ) : null}

        <nav aria-label="Setup steps" className="mt-6 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {steps.map((item) => {
            const active = item.n === step;
            return (
              <Link
                key={item.n}
                href={`/admin/setup?step=${item.n}`}
                aria-current={active ? "step" : undefined}
                className={`figure flex h-8 shrink-0 items-center rounded-full border px-3 text-[12px] ${
                  active ? "border-accent bg-accent text-white" : "border-rule bg-surface text-ink-2"
                }`}
              >
                {String(item.n).padStart(2, "0")}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 grid gap-8 lg:mt-8 lg:grid-cols-[240px_1fr]">
          <nav aria-label="Setup steps" className="hidden self-start rounded-[14px] border border-rule bg-surface lg:block">
            {steps.map((item) => {
              const active = item.n === step;
              const done = progress.checks[item.n - 1]?.done ?? false;
              return (
                <Link
                  key={item.n}
                  href={`/admin/setup?step=${item.n}`}
                  aria-current={active ? "step" : undefined}
                  className={`flex items-center gap-3 border-b border-rule px-4 py-3 last:border-b-0 ${
                    active ? "bg-accent-soft" : "hover:bg-surface-2"
                  }`}
                >
                  <span className="figure text-[11.5px] text-muted">
                    {String(item.n).padStart(2, "0")}
                  </span>
                  <span
                    className={`h-[5px] w-[5px] shrink-0 rounded-full ${
                      done ? "bg-accent" : "border border-rule-strong"
                    }`}
                    aria-hidden="true"
                  />
                  <span className={`text-[12.5px] ${active ? "font-semibold text-accent" : "text-ink-2"}`}>
                    {item.label}
                  </span>
                  {!item.built ? (
                    <span className="ml-auto text-[10.5px] uppercase tracking-[0.08em] text-muted">
                      Later
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <section className="rounded-[14px] border border-rule bg-surface p-6">
            {step === 1 ? (
              <form action={saveCompanyDetails}>
                <StepHead n="01" title="Company details" note="Legal identity used on payslips, 2316 and every register." />

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="legalName" className={label}>Registered name</label>
                    <input id="legalName" name="legalName" required defaultValue={tenant.legalName} className={input} />
                  </div>
                  <div>
                    <label htmlFor="tradeName" className={label}>Trade name</label>
                    <input id="tradeName" name="tradeName" defaultValue={tenant.tradeName ?? ""} className={input} />
                  </div>
                  <div>
                    <label htmlFor="tin" className={label}>TIN</label>
                    <input id="tin" name="tin" required defaultValue={tenant.tin ?? ""} placeholder="000-000-000-000" className={input} />
                  </div>
                  <div>
                    <label htmlFor="rdoCode" className={label}>RDO code</label>
                    <input id="rdoCode" name="rdoCode" defaultValue={tenant.rdoCode ?? ""} className={input} />
                  </div>
                  <div>
                    <label htmlFor="regionCode" className={label}>Region</label>
                    <select id="regionCode" name="regionCode" defaultValue={tenant.regionCode ?? "NCR"} className={input}>
                      {regions.map((region) => (
                        <option key={region} value={region}>{region}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="addressLine" className={label}>Registered address</label>
                    <input id="addressLine" name="addressLine" defaultValue={tenant.addressLine ?? ""} className={input} />
                  </div>
                  <div>
                    <label htmlFor="employerType" className={label}>Employer type</label>
                    <select id="employerType" name="employerType" defaultValue={tenant.employerType} className={input}>
                      <option value="private">Private</option>
                      <option value="government">Government</option>
                    </select>
                  </div>
                </div>

                <div className="mt-8 border-t border-rule pt-6">
                  <DivisorField defaultValue={tenant.salaryDivisor} />
                </div>

                <StepActions canSetup={canSetup} next="Save and continue to the calendar" />
              </form>
            ) : step === 2 ? (
              <form action={saveCalendar}>
                <StepHead
                  n="02"
                  title="Cutoff calendar"
                  note={
                    activeCalendar
                      ? `${activeCalendar.name} · ${periodCount} periods generated. Saving a new pattern archives this one.`
                      : "No calendar yet. Payroll cannot open a cutoff without one."
                  }
                />
                <div className="mt-6">
                  <CalendarFields year={new Date().getFullYear()} />
                </div>
                <StepActions canSetup={canSetup} next="Generate cutoffs" />
              </form>
            ) : step === 3 ? (
              <div>
                <StepHead
                  n="03"
                  title="Work schedules"
                  note="Per-weekday work and rest days, with scheduled hours and an unpaid break."
                />

                {schedules.length > 0 ? (
                  <div className="mt-6 rounded-[14px] border border-rule">
                    {schedules.map((schedule) => {
                      const scheduleDays = days.filter((day) => day.scheduleId === schedule.id);
                      const worked = scheduleDays.filter((day) => day.isWorkday);
                      const first = worked[0];
                      return (
                        <div
                          key={schedule.id}
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule px-4 py-3 last:border-b-0"
                        >
                          <span className="text-[13px] font-medium">{schedule.name}</span>
                          {schedule.isDefault ? (
                            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">Default</span>
                          ) : null}
                          <span className="tnum ml-auto font-mono text-[12px] text-muted">
                            {worked.map((day) => weekdays.find((w) => w.n === day.weekday)?.label).join(" ")}
                            {first ? ` · ${first.startTime?.slice(0, 5)}–${first.endTime?.slice(0, 5)}` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <form action={saveSchedule} className="mt-6 border-t border-rule pt-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label htmlFor="name" className={label}>Schedule name</label>
                      <input id="name" name="name" required placeholder="Mon–Fri · 8:00 to 17:00" className={input} />
                    </div>
                    <div>
                      <label htmlFor="startTime" className={label}>Start</label>
                      <input id="startTime" name="startTime" type="time" defaultValue="08:00" className={input} />
                    </div>
                    <div>
                      <label htmlFor="endTime" className={label}>End</label>
                      <input id="endTime" name="endTime" type="time" defaultValue="17:00" className={input} />
                    </div>
                    <div>
                      <label htmlFor="breakMinutes" className={label}>Unpaid break (minutes)</label>
                      <input id="breakMinutes" name="breakMinutes" type="number" min={0} max={240} defaultValue={60} className={input} />
                    </div>
                    <label className="mt-6 flex items-center gap-2 text-[12.5px] text-ink-2">
                      <input type="checkbox" name="isDefault" className="h-4 w-4 accent-[#0c7a43]" />
                      Make this the default schedule
                    </label>
                  </div>

                  <fieldset className="mt-5">
                    <legend className={label}>Workdays</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {weekdays.map((day) => (
                        <label
                          key={day.n}
                          className="flex cursor-pointer items-center gap-2 rounded-full border border-rule px-3.5 py-2 text-[12.5px] transition-colors has-[:checked]:border-accent/40 has-[:checked]:bg-accent-soft has-[:checked]:text-accent"
                        >
                          <input
                            type="checkbox"
                            name={`day-${day.n}`}
                            defaultChecked={day.n <= 5}
                            className="h-3.5 w-3.5 accent-[#0c7a43]"
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <StepActions canSetup={canSetup} next="Add schedule" />
                </form>
              </div>
            ) : step === 4 ? (
              <div>
                <StepHead
                  n="04"
                  title="Employee master"
                  note={`${employeeCount} employees on this company. Employee records never consume an operator seat.`}
                />
                <div className="mt-6 rounded-[14px] border border-rule bg-surface-2 p-5">
                  <p className="text-[13.5px] leading-[1.65] text-ink-2">
                    Employees carry a stable company code, employment dates, rank, schedule and
                    monthly rate. The daily rate is derived from the company divisor, not typed by
                    hand.
                  </p>
                  <Link
                    href="/admin/employees"
                    className="mt-4 inline-flex h-9 items-center rounded-full border border-rule-strong px-4 text-[12.5px] font-semibold uppercase tracking-[0.08em] hover:bg-surface"
                  >
                    Open employee master
                  </Link>
                </div>
              </div>
            ) : (
              <div>
                <StepHead
                  n={String(step).padStart(2, "0")}
                  title={steps[step - 1]?.label ?? "Setup"}
                  note="This stage is defined in the payroll specification but is not part of this build."
                />
                <div className="mt-6 rounded-[14px] border border-rule bg-surface-2 p-5">
                  <p className="max-w-[60ch] text-[13.5px] leading-[1.65] text-ink-2">
                    The screen is deliberately absent rather than simulated. It will be built with
                    the payroll engine, once the calendar, schedules and employees are proven against
                    a real cutoff.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="mt-10 rounded-[14px] border border-rule bg-surface">
          <details>
            <summary className="cursor-pointer list-none px-5 py-4 text-[12.5px] font-semibold uppercase tracking-[0.08em] marker:hidden">
              Restart setup for testing
            </summary>
            <div className="border-t border-rule px-5 py-4">
              <p className="max-w-[70ch] text-[12.5px] leading-[1.65] text-ink-2">
                Archives the active calendar and schedules, increments the setup version, and returns
                this company to step 1. Employees and audit history are kept. Type{" "}
                <span className="font-mono">RESTART</span> to confirm.
              </p>
              <form action={restartSetup} className="mt-4 flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="confirmation" className={label}>Confirmation</label>
                  <input id="confirmation" name="confirmation" required className={`${input} w-[200px]`} />
                </div>
                <button
                  type="submit"
                  disabled={!canSetup}
                  className="h-10 rounded-full border border-[#9f2f2d] px-4 text-[13px] font-semibold text-[#9f2f2d] hover:bg-[#fdebec] disabled:opacity-40"
                >
                  Restart setup
                </button>
              </form>
            </div>
          </details>
        </section>
      </main>

      <WorkspaceFooter />
    </>
  );
}

function StepHead({ n, title, note }: { n: string; title: string; note: string }) {
  return (
    <div>
      <p className="figure text-[11.5px] text-muted">Step {n}</p>
      <h2 className="mt-2 text-[17px] font-medium tracking-[-0.01em]">{title}</h2>
      <p className="mt-1.5 max-w-[62ch] text-[12.5px] leading-[1.6] text-muted">{note}</p>
    </div>
  );
}

function StepActions({ canSetup, next }: { canSetup: boolean; next: string }) {
  return (
    <div className="mt-8 flex items-center justify-between border-t border-rule pt-5">
      <p className="text-[12px] text-muted">Saved to this company only.</p>
      <button
        type="submit"
        disabled={!canSetup}
        className="h-10 rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-40"
      >
        {next}
      </button>
    </div>
  );
}
