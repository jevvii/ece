"use client";

import { useState } from "react";
import type { ImportMode, MappingV2, V2Unit } from "@/lib/import/mapping-v2";
import { confirmImport } from "../actions";

type Column = { index: number; header: string; sample: string };
type Employee = { id: string; employeeCode: string; lastName: string; firstName: string };

const select =
  "h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";
const label = "block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted";

function dateAt(start: string, offset: number) {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function MappingForm({
  runId,
  columns,
  detected,
  premiumCodes,
  employees,
  unknownCodes,
  coverageStart,
  coverageEnd,
  profileName,
}: {
  runId: string;
  columns: Column[];
  detected: MappingV2;
  premiumCodes: string[];
  employees: Employee[];
  unknownCodes: Array<{ code: string; name: string }>;
  coverageStart: string;
  coverageEnd: string;
  profileName: string;
}) {
  const [mode, setMode] = useState<ImportMode>(detected.mode);
  const [codeColumn, setCodeColumn] = useState(detected.employeeCode == null ? "" : String(detected.employeeCode));
  const [nameColumn, setNameColumn] = useState(detected.employeeName == null ? "" : String(detected.employeeName));
  const [dayStart, setDayStart] = useState(detected.dayStart == null ? "" : String(detected.dayStart));
  const [dayEnd, setDayEnd] = useState(detected.dayEnd == null ? "" : String(detected.dayEnd));
  const [units, setUnits] = useState<Record<string, V2Unit>>(detected.dayUnits);
  const [buckets, setBuckets] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(detected.buckets).map(([code, index]) => [code, String(index)])),
  );
  const [periodLate, setPeriodLate] = useState(
    detected.periodLate == null ? "" : String(detected.periodLate.index),
  );
  const [periodLateUnit, setPeriodLateUnit] = useState<V2Unit>(detected.periodLate?.unit ?? "minutes");

  const defaultUnit: V2Unit = mode === "late" ? "minutes" : "hours";
  const unitLabel = mode === "late"
    ? { minutes: "Late minutes", hours: "Late hours" }
    : { minutes: "Day minutes", hours: "Day hours" };

  const start = Number(dayStart);
  const end = Number(dayEnd);
  const rangeValid = dayStart !== "" && dayEnd !== "" && Number.isInteger(start) && Number.isInteger(end) && start <= end;
  const range = rangeValid
    ? Array.from({ length: end - start + 1 }, (_, offset) => ({
        index: start + offset,
        date: dateAt(coverageStart, offset),
        header: columns.find((column) => column.index === start + offset)?.header ?? "",
      }))
    : [];

  const used = new Set<number>();
  if (codeColumn !== "") used.add(Number(codeColumn));
  if (nameColumn !== "") used.add(Number(nameColumn));
  for (const column of range) used.add(column.index);
  for (const index of Object.values(buckets)) if (index !== "") used.add(Number(index));
  if (periodLate !== "") used.add(Number(periodLate));

  const ignored = columns.filter((column) => !used.has(column.index));
  const ready = codeColumn !== "" && rangeValid;

  return (
    <form action={confirmImport} className="mt-6">
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="unknownCount" value={unknownCodes.length} />
      {unknownCodes.map((entry, index) => (
        <input key={entry.code} type="hidden" name={`unknownCode-${index}`} value={entry.code} />
      ))}

      <section className="rounded-[14px] border border-rule bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">What the sheet holds</h2>
          <div className="flex gap-2" role="radiogroup" aria-label="Import mode">
            {(["days", "late"] as ImportMode[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={`h-9 rounded-full border px-4 text-[12.5px] font-semibold transition-colors ${
                  mode === value
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-rule-strong text-ink-2 hover:bg-surface-2"
                }`}
              >
                {value === "days" ? "Day hours worked" : "Lateness"}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 max-w-[70ch] text-[12px] leading-[1.6] text-muted">
          {mode === "days"
            ? "Each date column holds hours or minutes worked. Blank cells are skipped."
            : "Each date column holds lateness. A blank cell means the full scheduled day was worked; the schedule supplies the hours."}
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="codeColumn" className={label}>Employee code · required</label>
            <select id="codeColumn" name="codeColumn" value={codeColumn} onChange={(event) => setCodeColumn(event.target.value)} className={`${select} mt-1.5`}>
              <option value="">Choose a column</option>
              {columns.map((column) => (
                <option key={column.index} value={column.index}>
                  #{column.index} · {column.header || "(no header)"} · {column.sample || "—"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="nameColumn" className={label}>Employee name · optional</label>
            <select id="nameColumn" name="nameColumn" value={nameColumn} onChange={(event) => setNameColumn(event.target.value)} className={`${select} mt-1.5`}>
              <option value="">Not mapped</option>
              {columns.map((column) => (
                <option key={column.index} value={column.index}>
                  #{column.index} · {column.header || "(no header)"} · {column.sample || "—"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dayStart" className={label}>First day column · required</label>
            <select id="dayStart" name="dayStart" value={dayStart} onChange={(event) => setDayStart(event.target.value)} className={`${select} mt-1.5`}>
              <option value="">Choose a column</option>
              {columns.map((column) => (
                <option key={column.index} value={column.index}>
                  #{column.index} · {column.header || "(no header)"} · {column.sample || "—"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dayEnd" className={label}>Last day column · required</label>
            <select id="dayEnd" name="dayEnd" value={dayEnd} onChange={(event) => setDayEnd(event.target.value)} className={`${select} mt-1.5`}>
              <option value="">Choose a column</option>
              {columns.map((column) => (
                <option key={column.index} value={column.index}>
                  #{column.index} · {column.header || "(no header)"} · {column.sample || "—"}
                </option>
              ))}
            </select>
          </div>
        </div>

        {rangeValid ? (
          <p className="mt-3 text-[12px] text-ink-2">
            {range.length} date column{range.length === 1 ? "" : "s"} · {range[0]?.date} → {range[range.length - 1]?.date} · from the cutoff
            {range[range.length - 1] && range[range.length - 1]!.date > coverageEnd ? (
              <span className="text-[#7c2523]"> · beyond the cutoff ({coverageEnd}); extra columns are skipped</span>
            ) : null}
          </p>
        ) : (
          <p role="alert" className="mt-3 text-[12px] text-[#7c2523]">
            Map an employee code and a first/last day column. A period total alone cannot produce days.
          </p>
        )}

        {range.length > 0 ? (
          <details className="mt-4 rounded-[14px] border border-rule bg-surface-2 px-4 py-3">
            <summary className="cursor-pointer text-[12.5px] font-semibold marker:hidden">
              Per-day units · {range.length} columns
            </summary>
            <p className="mt-2 text-[12px] text-muted">
              Default is {unitLabel[defaultUnit]} for every column. Override any date that holds a different unit.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {range.map((column) => (
                <div key={column.index} className="flex items-center gap-3">
                  <span className="figure w-[86px] shrink-0 text-[11.5px] text-muted">{column.date}</span>
                  <span className="w-[70px] shrink-0 truncate text-[12px] text-ink-2" title={column.header}>
                    {column.header || `#${column.index}`}
                  </span>
                  <select
                    aria-label={`Unit for ${column.date}`}
                    name={`unit-${column.index}`}
                    value={units[String(column.index)] ?? defaultUnit}
                    onChange={(event) =>
                      setUnits((current) => ({ ...current, [String(column.index)]: event.target.value as V2Unit }))
                    }
                    className={select}
                  >
                    <option value="hours">{unitLabel.hours}</option>
                    <option value="minutes">{unitLabel.minutes}</option>
                  </select>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="mt-4 rounded-[14px] border border-rule bg-surface p-5">
        <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em]">Premium buckets · optional</h2>
        <p className="mt-1.5 text-[12px] text-muted">Values are hours. Only the codes the payroll engine prices are listed.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {premiumCodes.map((code) => (
            <div key={code} className="flex items-center gap-2">
              <span className="figure w-[110px] shrink-0 text-[11.5px] text-ink-2">{code}</span>
              <select
                aria-label={`Source column for ${code}`}
                name={`bucket-${code}`}
                value={buckets[code] ?? ""}
                onChange={(event) =>
                  setBuckets((current) => ({ ...current, [code]: event.target.value }))
                }
                className={select}
              >
                <option value="">Not mapped</option>
                {columns.map((column) => (
                  <option key={column.index} value={column.index}>
                    #{column.index} · {column.header || "(no header)"}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 border-t border-rule pt-4 sm:grid-cols-2">
          <div>
            <label htmlFor="periodLateColumn" className={label}>Period late total · optional</label>
            <select
              id="periodLateColumn"
              name="periodLateColumn"
              value={periodLate}
              onChange={(event) => setPeriodLate(event.target.value)}
              className={`${select} mt-1.5`}
            >
              <option value="">Not mapped</option>
              {columns.map((column) => (
                <option key={column.index} value={column.index}>
                  #{column.index} · {column.header || "(no header)"} · {column.sample || "—"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="periodLateUnit" className={label}>Period total unit</label>
            <select
              id="periodLateUnit"
              name="periodLateUnit"
              value={periodLateUnit}
              onChange={(event) => setPeriodLateUnit(event.target.value as V2Unit)}
              className={`${select} mt-1.5`}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
            </select>
          </div>
        </div>
      </section>

      {unknownCodes.length > 0 ? (
        <section id="resolve" className="mt-4 border border-[#e8c98a] bg-[#fbf3db] p-5">
          <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-[#956400]">
            Unbound employee codes · {unknownCodes.length}
          </h2>
          <p className="mt-1.5 max-w-[70ch] text-[12.5px] leading-[1.6] text-[#7a5a14]">
            These codes are not in the employee master, and names never create an employee. Bind each one once.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {unknownCodes.slice(0, 60).map((entry, index) => (
              <div key={entry.code} className="flex items-center gap-2">
                <span className="figure w-[110px] shrink-0 truncate text-[12px]" title={entry.code}>{entry.code}</span>
                <span className="w-[130px] shrink-0 truncate text-[12px] text-muted" title={entry.name}>{entry.name || "—"}</span>
                <select name={`alias-${index}`} defaultValue="" className={select}>
                  <option value="">Leave unbound</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.employeeCode} · {employee.lastName}, {employee.firstName}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-4 rounded-[14px] border border-rule bg-surface p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label htmlFor="profileName" className={label}>Save profile as</label>
            <input id="profileName" name="profileName" defaultValue={profileName} className={`${select} mt-1.5`} />
          </div>
          <div className="text-[12px] text-muted">
            {ignored.length} column{ignored.length === 1 ? "" : "s"} ignored automatically
            {ignored.length > 0 ? ` · ${ignored.slice(0, 6).map((column) => column.header || `#${column.index}`).join(", ")}${ignored.length > 6 ? "…" : ""}` : ""}
          </div>
          <button
            type="submit"
            disabled={!ready}
            className="h-10 rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-40"
          >
            Confirm mapping and import
          </button>
        </div>
      </section>
    </form>
  );
}
