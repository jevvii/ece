import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, payrollCalendars, ranks, workSchedules } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { getSetupState } from "@/lib/setup/stages";
import {
  finishSetupAction,
  saveCalendarPresetAction,
  saveDivisorAction,
  saveEmployeesAction,
  saveRankAction,
  saveWorkweekAction,
} from "@/lib/setup/actions";
import { EmployeesStage } from "@/components/setup/employees-stage";

const button =
  "rounded-full bg-accent px-7 py-3 text-[14.5px] font-semibold text-white transition hover:brightness-95 active:scale-[0.99] disabled:opacity-40";
const input =
  "mt-1.5 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-3 text-[14px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const label = "block text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted";

function Choice({
  name,
  value,
  title,
  sub,
  badge,
  defaultChecked,
}: {
  name: string;
  value: string;
  title: string;
  sub: string;
  badge?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label
      className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-[14px] border border-rule-strong px-5 py-4 text-left transition-colors hover:border-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15.5px] font-semibold tracking-[-0.01em]">{title}</span>
          {badge ? (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-accent">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[13px] leading-[1.5] text-muted">{sub}</span>
      </span>
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-rule-strong has-[:checked]:border-accent has-[:checked]:bg-accent"
        aria-hidden="true"
      >
        <input type="radio" name={name} value={value} defaultChecked={defaultChecked} className="sr-only" />
      </span>
    </label>
  );
}

function Progress({ step }: { step: number }) {
  const shown = Math.min(step, 5);
  const percent = step > 5 ? 100 : (shown / 5) * 100;
  return (
    <div className="flex items-center gap-4" aria-label={step > 5 ? "Review" : `Step ${shown} of 5`}>
      <div className="h-[2px] flex-1 overflow-hidden rounded-full bg-rule">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 text-[12.5px] text-muted">
        {step > 5 ? "Review" : `${shown} of 5`}
      </span>
    </div>
  );
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string; saved?: string; restarted?: string }>;
}) {
  const params = await searchParams;
  const { tenant, membership } = await requireWorkspace();
  const state = await getSetupState(tenant);

  if (tenant.onboardingCompletedAt && state.requiredComplete && params.restarted !== "1") {
    redirect("/payroll");
  }

  const requested = Number(params.step ?? 0);
  const step = requested === 0 ? state.nextStep : Math.min(Math.max(requested, 1), 6);

  if (step <= 5 && step > state.nextStep) redirect(`/payroll/onboarding?step=${state.nextStep}`);
  if (step === 6 && !state.requiredComplete) redirect(`/payroll/onboarding?step=${state.nextStep}`);

  const [calendar, schedules, rankRows, employeeRows] = await Promise.all([
    db
      .select()
      .from(payrollCalendars)
      .where(and(eq(payrollCalendars.tenantId, tenant.id), isNull(payrollCalendars.archivedAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(workSchedules)
      .where(and(eq(workSchedules.tenantId, tenant.id), isNull(workSchedules.archivedAt)))
      .orderBy(asc(workSchedules.createdAt)),
    db.select().from(ranks).where(eq(ranks.tenantId, tenant.id)).orderBy(asc(ranks.level), asc(ranks.name)),
    db
      .select({ employee: employees, rank: ranks, schedule: workSchedules })
      .from(employees)
      .leftJoin(ranks, eq(ranks.id, employees.rankId))
      .leftJoin(workSchedules, eq(workSchedules.id, employees.scheduleId))
      .where(and(eq(employees.tenantId, tenant.id), isNull(employees.archivedAt)))
      .orderBy(asc(employees.employeeCode)),
  ]);

  const canSetup = membership.role === "company_admin" || membership.role === "payroll_officer";
  const companyName = tenant.tradeName ?? tenant.legalName;
  const defaultSchedule = schedules.find((schedule) => schedule.isDefault) ?? schedules[0] ?? null;

  const existing = employeeRows.map(({ employee, rank, schedule }) => ({
    id: employee.id,
    employeeCode: employee.employeeCode,
    lastName: employee.lastName,
    firstName: employee.firstName,
    tin: employee.tin,
    birthday: employee.birthday,
    address: employee.address,
    hireDate: employee.hireDate,
    separationDate: employee.separationDate,
    monthlyRate: employee.monthlyRate,
    rankName: rank?.name ?? null,
    scheduleName: schedule?.name ?? null,
  }));

  return (
    <div className="min-h-screen bg-paper font-instrument text-ink">
      <div className="mx-auto w-full max-w-[720px] px-6 py-7 sm:py-10">
        <header className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[14.5px] font-bold tracking-[-0.01em]">
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
            ECE
          </span>
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">
            Company setup
          </span>
        </header>

        {params.error ? (
          <div role="alert" className="mt-6 rounded-[12px] border border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-3 text-[13px] text-[#7c2523]">
            {decodeURIComponent(params.error)}
          </div>
        ) : null}
        {params.saved ? (
          <div className="mt-6 rounded-[12px] border border-accent/20 bg-accent-soft px-4 py-3 text-[13px] text-accent">
            Saved.
          </div>
        ) : null}
        {params.restarted ? (
          <div className="mt-6 rounded-[12px] border border-rule bg-surface-2 px-4 py-3 text-[12.5px] text-ink-2">
            The previous calendar and schedules were archived. Build the new setup below.
          </div>
        ) : null}

        <div className="pt-10 sm:pt-14">
          {step === 1 ? (
            <form action={saveDivisorAction}>
              <input type="hidden" name="from" value="guided" />
              <Progress step={1} />
              <h1 className="mt-8 font-instrument-serif text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.05] tracking-[-0.03em]">
                How should a month become a day?
              </h1>
              <p className="mt-4 max-w-[48ch] text-[14.5px] leading-[1.6] text-ink-2">
                {companyName}. The divisor sets every daily and hourly rate — absences, late
                minutes, overtime and premium hours all inherit it.
              </p>

              <div role="radiogroup" aria-label="Salary divisor" className="mt-8 grid gap-3">
                <Choice name="divisor" value="26" title="26 days" sub="The common semi-monthly divisor. A ₱30,000 salary is ₱1,153.85 a day." badge="Recommended" defaultChecked={tenant.salaryDivisor === 26} />
                <Choice name="divisor" value="22" title="22 days" sub="Working days only. A ₱30,000 salary is ₱1,363.64 a day." defaultChecked={tenant.salaryDivisor === 22} />
                <Choice name="divisor" value="30" title="30 days" sub="Calendar days. A ₱30,000 salary is ₱1,000.00 a day." defaultChecked={tenant.salaryDivisor === 30} />
              </div>

              <div className="mt-9 flex items-center justify-between">
                <span className="text-[13px] text-muted">Step 1 of 5</span>
                <button type="submit" disabled={!canSetup} className={button}>Continue</button>
              </div>
            </form>
          ) : null}

          {step === 2 ? (
            <form action={saveCalendarPresetAction}>
              <input type="hidden" name="from" value="guided" />
              <Progress step={2} />
              <h1 className="mt-8 font-instrument-serif text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.05] tracking-[-0.03em]">
                When does the cutoff close?
              </h1>
              <p className="mt-4 max-w-[48ch] text-[14.5px] leading-[1.6] text-ink-2">
                Coverage dates are inclusive, and the payday stays separate from the cutoff.
              </p>

              <div role="radiogroup" aria-label="Cutoff pattern" className="mt-8 grid gap-3">
                <Choice name="pattern" value="26_10" title="26–10, then 11–25" sub="First cutoff runs from the 26th of the previous month to the 10th. Second runs 11–25." badge="Recommended" defaultChecked={!calendar || calendar.patternCode === "26_10"} />
                <Choice name="pattern" value="01_15" title="1–15, then 16–month end" sub="First cutoff is the 1st to the 15th. Second closes at the end of the month." defaultChecked={calendar?.patternCode === "01_15"} />
              </div>

              <div className="mt-9 flex items-center justify-between">
                <a href="/payroll/onboarding?step=1" className="text-[13.5px] text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink">Back</a>
                <button type="submit" disabled={!canSetup} className={button}>Continue</button>
              </div>
            </form>
          ) : null}

          {step === 3 ? (
            <form action={saveWorkweekAction}>
              <input type="hidden" name="from" value="guided" />
              <Progress step={3} />
              <h1 className="mt-8 font-instrument-serif text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.05] tracking-[-0.03em]">
                Which days does the team work?
              </h1>
              <p className="mt-4 max-w-[48ch] text-[14.5px] leading-[1.6] text-ink-2">
                Rest days are kept as rest days, not as zero-hour workdays.
              </p>

              <div role="radiogroup" aria-label="Workweek" className="mt-8 grid gap-3">
                <Choice name="workweek" value="monfri" title="Monday to Friday" sub="The usual office week." badge="Recommended" defaultChecked />
                <Choice name="workweek" value="monsat" title="Monday to Saturday" sub="Six working days, Saturday at the normal rate." />
                <Choice name="workweek" value="suntue" title="Sunday to Thursday" sub="For teams that operate on a Sunday–Thursday week." />
              </div>

              <div className="mt-6 grid gap-4 rounded-[14px] border border-rule px-5 py-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="startTime" className={label}>Start</label>
                  <input id="startTime" name="startTime" type="time" defaultValue="08:00" className={input} />
                </div>
                <div>
                  <label htmlFor="endTime" className={label}>End</label>
                  <input id="endTime" name="endTime" type="time" defaultValue="17:00" className={input} />
                </div>
                <div>
                  <label htmlFor="breakMinutes" className={label}>Unpaid break</label>
                  <input id="breakMinutes" name="breakMinutes" type="number" min={0} max={240} defaultValue={60} className={`${input} tabular-nums`} />
                </div>
              </div>

              <div className="mt-9 flex items-center justify-between">
                <a href="/payroll/onboarding?step=2" className="text-[13.5px] text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink">Back</a>
                <button type="submit" disabled={!canSetup} className={button}>Continue</button>
              </div>
            </form>
          ) : null}

          {step === 4 ? (
            <div>
              <Progress step={4} />
              <h1 className="mt-8 font-instrument-serif text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.05] tracking-[-0.03em]">
                Any job grades?
              </h1>
              <p className="mt-4 max-w-[48ch] text-[14.5px] leading-[1.6] text-ink-2">
                Optional. Ranks group employees for leave policies and rates later; you can add more
                in Admin.
              </p>

              {rankRows.length > 0 ? (
                <div className="mt-7 rounded-[14px] border border-rule">
                  {rankRows.map((rank) => (
                    <div key={rank.id} className="flex items-center gap-4 border-b border-rule px-4 py-3 last:border-b-0">
                      <span className="text-[13.5px] font-medium">{rank.name}</span>
                      <span className="figure ml-auto text-[12px] text-muted">Level {rank.level}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <form action={saveRankAction} className="mt-6">
                <input type="hidden" name="from" value="guided" />
                <input type="hidden" name="step" value="4" />
                <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                  <div>
                    <label htmlFor="rankName" className={label}>Rank name</label>
                    <input id="rankName" name="name" required placeholder="Rank and file" className={input} />
                  </div>
                  <div>
                    <label htmlFor="rankLevel" className={label}>Level</label>
                    <input id="rankLevel" name="level" type="number" min={1} max={99} defaultValue={1} className={input} />
                  </div>
                </div>
                <button type="submit" disabled={!canSetup} className="mt-4 h-10 rounded-full border border-rule-strong px-5 text-[13px] font-semibold hover:bg-surface-2">
                  Add rank
                </button>
              </form>

              <div className="mt-9 flex items-center justify-between">
                <a href="/payroll/onboarding?step=3" className="text-[13.5px] text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink">Back</a>
                <a href="/payroll/onboarding?step=5" className={button}>Continue</a>
              </div>
            </div>
          ) : null}

          {step === 5 ? (
            <div>
              <Progress step={5} />
              <h1 className="mt-8 font-instrument-serif text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.05] tracking-[-0.03em]">
                Who are we paying?
              </h1>
              <p className="mt-4 max-w-[48ch] text-[14.5px] leading-[1.6] text-ink-2">
                Optional — payroll can open without them. Names go in as <span className="font-mono text-[13.5px]">Last, First</span>.
              </p>

              <EmployeesStage
                existing={existing}
                ranks={rankRows.map((rank) => ({ id: rank.id, name: rank.name }))}
                schedules={schedules.map((schedule) => ({ id: schedule.id, name: schedule.name }))}
                action={saveEmployeesAction}
                step={5}
                from="guided"
                canSetup={canSetup}
              />

              <div className="mt-9 flex items-center justify-between">
                <a href="/payroll/onboarding?step=4" className="text-[13.5px] text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink">Back</a>
                <a href="/payroll/onboarding?step=6" className={button}>Continue</a>
              </div>
            </div>
          ) : null}

          {step === 6 ? (
            <div>
              <Progress step={6} />
              <h1 className="mt-8 font-instrument-serif text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.05] tracking-[-0.03em]">
                Ready to open payroll.
              </h1>
              <p className="mt-4 max-w-[48ch] text-[14.5px] leading-[1.6] text-ink-2">
                Everything stays editable in Admin. Payroll needs the company details, a calendar and
                a work schedule — all three are in place.
              </p>

              <dl className="mt-7 divide-y divide-rule rounded-[14px] border border-rule">
                {[
                  ["Company", companyName],
                  ["Salary divisor", `${tenant.salaryDivisor} days`],
                  ["Cutoff", calendar?.name ?? "—"],
                  ["Schedule", defaultSchedule?.name ?? "—"],
                  ["Ranks", `${rankRows.length}`],
                  ["Employees", `${existing.length}`],
                ].map(([labelText, value]) => (
                  <div key={labelText} className="flex items-baseline justify-between gap-4 px-5 py-3">
                    <dt className="text-[12px] uppercase tracking-[0.08em] text-muted">{labelText}</dt>
                    <dd className="text-right text-[14px] font-medium">{value}</dd>
                  </div>
                ))}
              </dl>

              <form action={finishSetupAction} className="mt-8">
                <input type="hidden" name="from" value="guided" />
                <div className="flex items-center justify-between">
                  <a href="/payroll/onboarding?step=5" className="text-[13.5px] text-muted underline decoration-rule-strong underline-offset-4 hover:text-ink">Back</a>
                  <button type="submit" disabled={!canSetup} className={button}>Finish setup</button>
                </div>
              </form>
            </div>
          ) : null}
        </div>

        <footer className="mt-16 border-t border-rule pt-5 text-[12px] text-muted">
          Company setup · {new Date().getFullYear()} · You can change any answer later in Admin.
        </footer>
      </div>
    </div>
  );
}
