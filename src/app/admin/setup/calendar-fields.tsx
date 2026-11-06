"use client";

import { useState } from "react";

type Pattern = "26_10" | "01_15" | "custom";

type Spec = {
  cutoff1Start: number;
  cutoff1End: number;
  cutoff2Start: number;
  cutoff2End: number | null;
};

const presets: Record<Exclude<Pattern, "custom">, Spec> = {
  "26_10": { cutoff1Start: 26, cutoff1End: 10, cutoff2Start: 11, cutoff2End: 25 },
  "01_15": { cutoff1Start: 1, cutoff1End: 15, cutoff2Start: 16, cutoff2End: null },
};

const descriptions: Record<Pattern, string> = {
  "26_10": "Pay 26–10, then 11–25. The payday for the first cutoff is the 15th; the second closes the month.",
  "01_15": "Pay 1–15, then 16 to month end. The payday for the first cutoff is the 20th; the second pays on the 5th.",
  custom: "Set your own boundaries. Leave the second end day blank when the cutoff closes the month.",
};

export function CalendarFields({ year }: { year: number }) {
  const [pattern, setPattern] = useState<Pattern>("26_10");
  const [spec, setSpec] = useState<Spec>(presets["26_10"]);

  function choose(next: Pattern) {
    setPattern(next);
    if (next !== "custom") setSpec(presets[next]);
  }

  return (
    <>
      <fieldset>
        <legend className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Cutoff pattern</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(["26_10", "01_15", "custom"] as Pattern[]).map((key) => {
            const active = pattern === key;
            return (
              <label
                key={key}
                className={`flex cursor-pointer items-start justify-between gap-3 rounded-[14px] border px-4 py-3 transition-colors ${
                  active ? "border-accent bg-accent-soft" : "border-rule hover:border-ink-2"
                }`}
              >
                <span className="min-w-0">
                  <span className="text-[13.5px] font-semibold tracking-[-0.01em]">
                    {key === "26_10" ? "26–10 / 11–25" : key === "01_15" ? "1–15 / 16–EOM" : "Custom"}
                  </span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-muted">
                    {key === "26_10"
                      ? "Common for retail and logistics"
                      : key === "01_15"
                        ? "Common for offices and schools"
                        : "Any two boundaries"}
                  </span>
                </span>
                <input
                  type="radio"
                  name="pattern"
                  value={key}
                  checked={active}
                  onChange={() => choose(key)}
                  className="sr-only"
                />
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    active ? "border-accent bg-accent" : "border-rule-strong"
                  }`}
                  aria-hidden="true"
                >
                  {active ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-muted">{descriptions[pattern]}</p>
      </fieldset>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { name: "cutoff1Start", label: "Cutoff 1 starts", value: spec.cutoff1Start, allowNull: false },
          { name: "cutoff1End", label: "Cutoff 1 ends", value: spec.cutoff1End, allowNull: false },
          { name: "cutoff2Start", label: "Cutoff 2 starts", value: spec.cutoff2Start, allowNull: false },
          { name: "cutoff2End", label: "Cutoff 2 ends", value: spec.cutoff2End, allowNull: true },
        ].map((field) => (
          <div key={field.name}>
            <label htmlFor={field.name} className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              {field.label}
            </label>
            <input
              id={field.name}
              name={field.name}
              type="number"
              min={1}
              max={31}
              readOnly={pattern !== "custom"}
              value={field.value ?? ""}
              placeholder={field.allowNull ? "End of month" : undefined}
              onChange={(event) => {
                const raw = event.target.value === "" ? null : Number(event.target.value);
                setSpec((current) => ({ ...current, [field.name]: raw }) as Spec);
              }}
              className="mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[13.5px] tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 read-only:bg-surface-2 read-only:text-muted"
            />
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="paydayRule" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Payday rule
          </label>
          <select
            id="paydayRule"
            name="paydayRule"
            defaultValue="same_day"
            className="mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[13.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          >
            <option value="same_day">No shift</option>
            <option value="earlier_business_day">Earlier business day</option>
            <option value="later_business_day">Later business day</option>
          </select>
        </div>
        <div>
          <label htmlFor="paydayOffsetDays" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Shift by (days)
          </label>
          <input
            id="paydayOffsetDays"
            name="paydayOffsetDays"
            type="number"
            min={0}
            max={7}
            defaultValue={0}
            className="mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[13.5px] tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
        </div>
        <div>
          <label htmlFor="year" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Generate periods for
          </label>
          <input
            id="year"
            name="year"
            type="number"
            min={2020}
            max={2100}
            defaultValue={year}
            className="mt-2 h-10 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[13.5px] tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
        </div>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-muted">
        Dates are inclusive. Coverage start and end are separate from the payday, and the cycle
        label always uses the cutoff-ending month — a December run never silently becomes January.
      </p>
    </>
  );
}
