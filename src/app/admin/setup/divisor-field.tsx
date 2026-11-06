"use client";

import { useState } from "react";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function DivisorField({ defaultValue }: { defaultValue: number }) {
  const [divisor, setDivisor] = useState(defaultValue);
  const [sample, setSample] = useState(30000);

  const daily = sample / divisor;
  const hourly = daily / 8;

  return (
    <div className="grid gap-4 sm:grid-cols-[240px_1fr]">
      <div>
        <p id="divisor-label" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          Salary divisor
        </p>
        <input type="hidden" name="salaryDivisor" value={divisor} />
        <div role="radiogroup" aria-labelledby="divisor-label" className="mt-2 grid grid-cols-3 gap-2">
          {[22, 26, 30].map((days) => {
            const active = divisor === days;
            return (
              <button
                key={days}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDivisor(days)}
                className={`h-10 rounded-full border text-[13px] font-semibold transition-colors ${
                  active
                    ? "border-accent bg-accent text-white"
                    : "border-rule-strong text-ink-2 hover:border-ink-2 hover:text-ink"
                }`}
              >
                {days} days
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-[14px] border border-rule bg-surface-2 px-4 py-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="min-w-[180px] flex-1">
            <label htmlFor="sampleRate" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              Check against a monthly salary
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-[12.5px] text-muted">₱</span>
              <input
                id="sampleRate"
                type="number"
                min={0}
                step={500}
                value={sample}
                onChange={(event) => setSample(Number(event.target.value) || 0)}
                className="h-8 w-[130px] rounded-[10px] border border-rule-strong bg-surface px-2 text-[13.5px] tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </div>
          </div>
          <dl className="flex gap-6">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Per day</dt>
              <dd className="figure mt-1 text-[14.5px]">{peso.format(daily)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Per hour</dt>
              <dd className="figure mt-1 text-[14.5px]">{peso.format(hourly)}</dd>
            </div>
          </dl>
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          The divisor changes every absence, late deduction and daily-rate conversion. It is a
          company setting, not a global default.
        </p>
      </div>
    </div>
  );
}
