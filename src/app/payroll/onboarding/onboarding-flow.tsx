"use client";

import { useState } from "react";
import { completeOnboarding } from "./actions";

type Pattern = "26_10" | "01_15";
type Workweek = "monfri" | "monsat" | "suntue";

const GREEN = "#0C7A43";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

function Check() {
  return (
    <svg viewBox="0 0 12 10" className="h-[9px] w-[11px]" fill="none" aria-hidden="true">
      <path d="M1 5.2 4.4 8.6 11 1.4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Choice({
  selected,
  title,
  sub,
  badge,
  onSelect,
}: {
  selected: boolean;
  title: string;
  sub: string;
  badge?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-4 rounded-[14px] border px-5 py-4 text-left transition-colors ${
        selected
          ? "border-[#0C7A43] bg-[#F4FAF6]"
          : "border-[#D4D4CB] hover:border-[#131310]"
      }`}
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15.5px] font-semibold tracking-[-0.01em]">{title}</span>
          {badge ? (
            <span className="rounded-full bg-[#EAF4EE] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#0C7A43]">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[13px] leading-[1.5] text-[#75756C]">{sub}</span>
      </span>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          selected ? "border-[#0C7A43] bg-[#0C7A43]" : "border-[#D4D4CB]"
        }`}
        aria-hidden="true"
      >
        {selected ? <Check /> : null}
      </span>
    </button>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-4" aria-label={`Step ${step} of 4`}>
      <div className="h-[2px] flex-1 overflow-hidden rounded-full bg-[#E8E8E2]">
        <div
          className="h-full rounded-full bg-[#0C7A43] transition-[width] duration-300"
          style={{ width: `${(step / 4) * 100}%` }}
        />
      </div>
      <span className="shrink-0 text-[12.5px] text-[#75756C]">{step} of 4</span>
    </div>
  );
}

function Nav({
  onBack,
  onNext,
  nextLabel = "Continue",
  backDisabled = false,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  backDisabled?: boolean;
}) {
  return (
    <div className="mt-9 flex items-center justify-between">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          disabled={backDisabled}
          className={`text-[13.5px] text-[#75756C] underline decoration-[#D4D4CB] underline-offset-4 hover:text-[#131310] ${
            backDisabled ? "invisible" : ""
          }`}
        >
          Back
        </button>
      ) : (
        <span />
      )}
      {onNext ? (
        <button
          type="button"
          onClick={onNext}
          className="rounded-full bg-[#0C7A43] px-7 py-3 text-[14.5px] font-semibold text-white transition hover:brightness-95 active:scale-[0.99]"
        >
          {nextLabel}
        </button>
      ) : null}
    </div>
  );
}

export function OnboardingFlow({
  companyName,
  employeeCount,
  year,
  error,
  restarted,
}: {
  companyName: string;
  employeeCount: number;
  year: number;
  error?: string;
  restarted?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [divisor, setDivisor] = useState(26);
  const [pattern, setPattern] = useState<Pattern>("26_10");
  const [workweek, setWorkweek] = useState<Workweek>("monfri");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("17:00");
  const [breakMinutes, setBreakMinutes] = useState(60);

  const sample = 30000;
  const daily = sample / divisor;
  const hourly = daily / 8;

  const workweekLabel =
    workweek === "monsat" ? "Monday to Saturday" : workweek === "suntue" ? "Sunday to Thursday" : "Monday to Friday";

  return (
    <div className="min-h-screen bg-white font-instrument text-[#131310]">
      <div className="mx-auto w-full max-w-[720px] px-6 py-7 sm:py-10">
        <header className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[14.5px] font-bold tracking-[-0.01em]">
            <span className="h-2 w-2 rounded-full" style={{ background: GREEN }} aria-hidden="true" />
            ECE
          </span>
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#75756C]">
            Payroll setup
          </span>
        </header>

        {error ? (
          <div
            role="alert"
            className="mt-6 rounded-[12px] border border-[#E8C9C9] bg-[#FDF1F1] px-4 py-3 text-[13px] text-[#8C2F2F]"
          >
            {decodeURIComponent(error)}
          </div>
        ) : null}

        {restarted ? (
          <div className="mt-6 rounded-[12px] border border-[#E8E8E2] bg-[#F7F7F3] px-4 py-3 text-[12.5px] text-[#3C3C37]">
            The previous calendar and schedules were archived. Build the new setup below.
          </div>
        ) : null}

        <div key={step} className="onboard-step">
          {step === 0 ? (
            <div className="pt-14 sm:pt-20">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#75756C]">
                Payroll setup · {year}
              </p>
              <h1 className="mt-5 max-w-[16ch] font-instrument-serif text-[clamp(2.6rem,7vw,4.1rem)] leading-[1.02] tracking-[-0.03em]">
                Let&apos;s open payroll the right way.
              </h1>
              <p className="mt-6 max-w-[48ch] text-[16px] leading-[1.65] text-[#3C3C37]">
                Three answers — the divisor, the cutoff and the workweek. We build the calendar and
                schedule before you see a register.
              </p>

              <div className="mt-10 flex flex-wrap gap-x-12 gap-y-5 border-t border-[#E8E8E2] pt-6">
                <div>
                  <p className="text-[19px] font-bold tracking-[-0.02em]">{companyName}</p>
                  <p className="text-[12.5px] text-[#75756C]">Company</p>
                </div>
                <div>
                  <p className="text-[19px] font-bold tracking-[-0.02em]">{employeeCount}</p>
                  <p className="text-[12.5px] text-[#75756C]">Employees on file</p>
                </div>
                <div>
                  <p className="text-[19px] font-bold tracking-[-0.02em]">About a minute</p>
                  <p className="text-[12.5px] text-[#75756C]">No payroll runs yet</p>
                </div>
              </div>

              <div className="mt-10 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-full bg-[#0C7A43] px-8 py-3.5 text-[14.5px] font-semibold text-white transition hover:brightness-95 active:scale-[0.99]"
                >
                  Start setup
                </button>
                <a
                  href="/admin/setup"
                  className="text-[13.5px] text-[#75756C] underline decoration-[#D4D4CB] underline-offset-4 hover:text-[#131310]"
                >
                  Set up in Admin instead
                </a>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="pt-12">
              <Progress step={1} />
              <h2 className="mt-9 text-[clamp(1.7rem,4vw,2.3rem)] font-bold leading-[1.08] tracking-[-0.025em]">
                How should a month become a day?
              </h2>
              <p className="mt-3 max-w-[46ch] text-[14px] leading-[1.6] text-[#75756C]">
                The divisor sets every daily and hourly rate — absences, late minutes, overtime and
                premium hours all inherit it.
              </p>

              <div role="radiogroup" aria-label="Salary divisor" className="mt-7 grid gap-3">
                <Choice
                  selected={divisor === 26}
                  onSelect={() => setDivisor(26)}
                  title="26 days"
                  sub="The common semi-monthly divisor. A ₱30,000 salary is ₱1,153.85 a day."
                  badge="Recommended"
                />
                <Choice
                  selected={divisor === 22}
                  onSelect={() => setDivisor(22)}
                  title="22 days"
                  sub="Uses working days only. A ₱30,000 salary is ₱1,363.64 a day."
                />
                <Choice
                  selected={divisor === 30}
                  onSelect={() => setDivisor(30)}
                  title="30 days"
                  sub="Calendar days. A ₱30,000 salary is ₱1,000.00 a day."
                />
              </div>

              <div className="mt-6 rounded-[14px] border border-[#E8E8E2] bg-[#F7F7F3] px-5 py-4">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[#75756C]">
                  Live check · ₱30,000 monthly
                </p>
                <div className="mt-2 flex flex-wrap gap-8">
                  <span className="text-[15.5px] font-semibold">
                    {peso.format(daily)} <span className="text-[12.5px] font-normal text-[#75756C]">per day</span>
                  </span>
                  <span className="text-[15.5px] font-semibold">
                    {peso.format(hourly)} <span className="text-[12.5px] font-normal text-[#75756C]">per hour</span>
                  </span>
                </div>
              </div>

              <Nav onBack={() => setStep(0)} onNext={() => setStep(2)} />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="pt-12">
              <Progress step={2} />
              <h2 className="mt-9 text-[clamp(1.7rem,4vw,2.3rem)] font-bold leading-[1.08] tracking-[-0.025em]">
                When does the cutoff close?
              </h2>
              <p className="mt-3 max-w-[46ch] text-[14px] leading-[1.6] text-[#75756C]">
                Coverage dates are inclusive, and the payday stays separate from the cutoff.
              </p>

              <div role="radiogroup" aria-label="Cutoff pattern" className="mt-7 grid gap-3">
                <Choice
                  selected={pattern === "26_10"}
                  onSelect={() => setPattern("26_10")}
                  title="26–10, then 11–25"
                  sub="First cutoff runs from the 26th of the previous month to the 10th. Second runs 11–25."
                  badge="Recommended"
                />
                <Choice
                  selected={pattern === "01_15"}
                  onSelect={() => setPattern("01_15")}
                  title="1–15, then 16–month end"
                  sub="First cutoff is the 1st to the 15th. Second closes at the end of the month."
                />
              </div>

              <div className="mt-6 grid gap-3 rounded-[14px] border border-[#E8E8E2] px-5 py-4 text-[13px] text-[#3C3C37] sm:grid-cols-2">
                <p>
                  <span className="block text-[11px] uppercase tracking-[0.1em] text-[#75756C]">First cutoff</span>
                  {pattern === "26_10" ? "26th previous month → 10th" : "1st → 15th"}
                </p>
                <p>
                  <span className="block text-[11px] uppercase tracking-[0.1em] text-[#75756C]">Second cutoff</span>
                  {pattern === "26_10" ? "11th → 25th" : "16th → end of month"}
                </p>
                <p className="sm:col-span-2 text-[12.5px] text-[#75756C]">
                  We generate 24 cutoffs for {year}. The cycle label always uses the cutoff-ending month.
                </p>
              </div>

              <Nav onBack={() => setStep(1)} onNext={() => setStep(3)} />
            </div>
          ) : null}

          {step === 3 ? (
            <div className="pt-12">
              <Progress step={3} />
              <h2 className="mt-9 text-[clamp(1.7rem,4vw,2.3rem)] font-bold leading-[1.08] tracking-[-0.025em]">
                Which days does the team work?
              </h2>
              <p className="mt-3 max-w-[46ch] text-[14px] leading-[1.6] text-[#75756C]">
                Rest days are kept as rest days, not as zero-hour workdays.
              </p>

              <div role="radiogroup" aria-label="Workweek" className="mt-7 grid gap-3">
                <Choice
                  selected={workweek === "monfri"}
                  onSelect={() => setWorkweek("monfri")}
                  title="Monday to Friday"
                  sub="The usual office week."
                  badge="Recommended"
                />
                <Choice
                  selected={workweek === "monsat"}
                  onSelect={() => setWorkweek("monsat")}
                  title="Monday to Saturday"
                  sub="Six working days, Saturday at the normal rate."
                />
                <Choice
                  selected={workweek === "suntue"}
                  onSelect={() => setWorkweek("suntue")}
                  title="Sunday to Thursday"
                  sub="For teams that operate on a Sunday–Thursday week."
                />
              </div>

              <div className="mt-6 grid gap-4 rounded-[14px] border border-[#E8E8E2] px-5 py-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="onboard-start" className="block text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[#75756C]">
                    Start
                  </label>
                  <input
                    id="onboard-start"
                    type="time"
                    value={startTime}
                    onChange={(event) => setStartTime(event.target.value)}
                    className="mt-1.5 h-10 w-full rounded-[10px] border border-[#D4D4CB] bg-white px-3 text-[14px] outline-none focus:border-[#0C7A43] focus:ring-2 focus:ring-[#0C7A43]/20"
                  />
                </div>
                <div>
                  <label htmlFor="onboard-end" className="block text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[#75756C]">
                    End
                  </label>
                  <input
                    id="onboard-end"
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    className="mt-1.5 h-10 w-full rounded-[10px] border border-[#D4D4CB] bg-white px-3 text-[14px] outline-none focus:border-[#0C7A43] focus:ring-2 focus:ring-[#0C7A43]/20"
                  />
                </div>
                <div>
                  <label htmlFor="onboard-break" className="block text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[#75756C]">
                    Unpaid break
                  </label>
                  <input
                    id="onboard-break"
                    type="number"
                    min={0}
                    max={240}
                    value={breakMinutes}
                    onChange={(event) => setBreakMinutes(Number(event.target.value))}
                    className="mt-1.5 h-10 w-full rounded-[10px] border border-[#D4D4CB] bg-white px-3 text-[14px] tabular-nums outline-none focus:border-[#0C7A43] focus:ring-2 focus:ring-[#0C7A43]/20"
                  />
                </div>
              </div>

              <Nav onBack={() => setStep(2)} onNext={() => setStep(4)} />
            </div>
          ) : null}

          {step === 4 ? (
            <div className="pt-12">
              <Progress step={4} />
              <h2 className="mt-9 text-[clamp(1.7rem,4vw,2.3rem)] font-bold leading-[1.08] tracking-[-0.025em]">
                Ready to open payroll.
              </h2>
              <p className="mt-3 max-w-[48ch] text-[14px] leading-[1.6] text-[#75756C]">
                This creates the calendar and schedule for {companyName}. Everything stays editable
                in Admin.
              </p>

              <dl className="mt-7 divide-y divide-[#E8E8E2] rounded-[14px] border border-[#E8E8E2]">
                {[
                  ["Company", companyName],
                  ["Salary divisor", `${divisor} days · ${peso.format(daily)} per day`],
                  ["Cutoff", pattern === "26_10" ? "26–10 and 11–25" : "1–15 and 16–month end"],
                  ["Workweek", `${workweekLabel} · ${startTime} to ${endTime}`],
                  ["Unpaid break", `${breakMinutes} minutes`],
                  ["Employees", `${employeeCount} on file`],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 px-5 py-3">
                    <dt className="text-[12px] uppercase tracking-[0.08em] text-[#75756C]">{label}</dt>
                    <dd className="text-right text-[14px] font-medium">{value}</dd>
                  </div>
                ))}
              </dl>

              {employeeCount === 0 ? (
                <p className="mt-4 text-[12.5px] leading-[1.6] text-[#75756C]">
                  No employees yet — finish setup, then add them from Admin → Employees.
                </p>
              ) : null}

              <form action={completeOnboarding} className="mt-8">
                <input type="hidden" name="divisor" value={divisor} />
                <input type="hidden" name="pattern" value={pattern} />
                <input type="hidden" name="workweek" value={workweek} />
                <input type="hidden" name="startTime" value={startTime} />
                <input type="hidden" name="endTime" value={endTime} />
                <input type="hidden" name="breakMinutes" value={breakMinutes} />

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="text-[13.5px] text-[#75756C] underline decoration-[#D4D4CB] underline-offset-4 hover:text-[#131310]"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="rounded-full bg-[#0C7A43] px-8 py-3.5 text-[14.5px] font-semibold text-white transition hover:brightness-95 active:scale-[0.99]"
                  >
                    Finish setup
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </div>

        <footer className="mt-16 border-t border-[#E8E8E2] pt-5 text-[12px] text-[#75756C]">
          Payroll setup · {year} · You can change any answer later in Admin.
        </footer>
      </div>
    </div>
  );
}
