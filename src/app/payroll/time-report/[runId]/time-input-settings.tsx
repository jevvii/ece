import type { ImportMode, V2Unit } from "@/lib/import/apply-v2";

const selectClass = "mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[13px] text-ink";

export function TimeInputSettings({ mode, units, columns, coverageStart, lateColumn, lateUnit,
  onModeChange, onUnitsChange, onLateUnitChange,
}: {
  mode: ImportMode;
  units: Record<string, V2Unit>;
  columns: number[];
  coverageStart: string;
  lateColumn: number | null;
  lateUnit: V2Unit;
  onModeChange: (mode: ImportMode) => void;
  onUnitsChange: (units: Record<string, V2Unit>) => void;
  onLateUnitChange: (unit: V2Unit) => void;
}) {
  const defaultUnit = mode === "late" ? "minutes" : "hours";
  const unitFor = (column: number) => units[String(column)] ?? defaultUnit;
  const allUnits = new Set(columns.map(unitFor));
  const commonUnit = allUnits.size > 1 ? "mixed" : allUnits.values().next().value ?? defaultUnit;
  return (
    <section aria-label="Time input settings" className="max-h-[45dvh] shrink-0 overflow-auto border-b border-rule bg-surface-2 px-4 py-3">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="w-40 text-[12px] font-semibold"><label htmlFor="date-values">Date values</label>
          <select id="date-values" value={mode} onChange={(event) => onModeChange(event.target.value as ImportMode)} className={selectClass}>
            <option value="days">Worked time</option>
            <option value="late">Lateness</option>
          </select>
        </div>
        <div className="w-36 text-[12px] font-semibold"><label htmlFor="date-units">Date units</label>
          <select id="date-units" value={commonUnit} disabled={!columns.length} onChange={(event) => {
            const updated = { ...units };
            for (const column of columns) updated[String(column)] = event.target.value as V2Unit;
            onUnitsChange(updated);
          }} className={selectClass}>
            <option value="hours">Hours</option>
            <option value="minutes">Minutes</option>
            <option value="mixed" disabled>Mixed units</option>
          </select>
        </div>
        {lateColumn != null ? <div className="w-44 text-[12px] font-semibold"><label htmlFor="cutoff-late-units">Cutoff lateness units</label>
          <select id="cutoff-late-units" value={lateUnit} onChange={(event) => onLateUnitChange(event.target.value as V2Unit)} className={selectClass}>
            <option value="hours">Hours</option>
            <option value="minutes">Minutes</option>
          </select>
        </div> : null}
        <p className="max-w-[65ch] text-[12px] leading-relaxed text-ink-2">
          {mode === "late"
            ? "All dates contain lateness, subtracted from each employee’s scheduled hours. Blank cells mean no lateness."
            : "All dates contain worked time. Blank cells create no attendance record."}
          {lateColumn != null && mode === "late" ? " The cutoff lateness total must equal the daily sum; it is counted once." : ""}
        </p>
      </div>
      <p className="mt-2 text-[12px] text-ink-2">Special pays use accumulated hours for the cutoff, regardless of date settings.</p>
      {columns.length > 0 ? <details className="mt-2">
        <summary className="w-fit cursor-pointer text-[12px] font-semibold">Individual column units</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {columns.map((column, offset) => {
            const date = new Date(`${coverageStart}T00:00:00Z`);
            date.setUTCDate(date.getUTCDate() + offset);
            const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
            return <label key={column} className="text-[12px] font-medium">{label}
              <select aria-label={`Units for ${label}`} value={unitFor(column)} onChange={(event) => onUnitsChange({ ...units, [String(column)]: event.target.value as V2Unit })} className={selectClass}>
                <option value="hours">Hours</option><option value="minutes">Minutes</option>
              </select>
            </label>;
          })}
        </div>
      </details> : null}
    </section>
  );
}
