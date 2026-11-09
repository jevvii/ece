"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyMappingV2,
  premiumCodes,
  type ImportMode,
  type MappingV2,
  type V2Unit,
} from "@/lib/import/apply-v2";
import { confirmImport } from "../actions";

type Employee = { id: string; employeeCode: string; lastName: string; firstName: string };
type Selection = { kind: "column" | "range" | "row"; start: number; end: number };

const ROW_HEIGHT = 30;
const COL_WIDTH = 112;
const WINDOW_ROWS = 26;

const tintClass: Record<string, string> = {
  code: "bg-[#0c7a43]/10",
  name: "bg-[#1d4e89]/10",
  days: "bg-[#956400]/12",
  bucket: "bg-[#a4552f]/12",
  late: "bg-[#3c3c37]/10",
};

const tintDot: Record<string, string> = {
  code: "bg-[#0c7a43]",
  name: "bg-[#1d4e89]",
  days: "bg-[#956400]",
  bucket: "bg-[#a4552f]",
  late: "bg-[#3c3c37]",
};

function colLetter(index: number) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function normalizeBuckets(buckets: MappingV2["buckets"]): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const [code, value] of Object.entries(buckets)) {
    result[code] = Array.isArray(value) ? [...value] : [value];
  }
  return result;
}

export function MappingGrid({
  runId,
  grid,
  detected,
  employees,
  unknownCodes,
  coverageStart,
  coverageEnd,
  profileName,
}: {
  runId: string;
  grid: string[][];
  detected: MappingV2;
  employees: Employee[];
  unknownCodes: Array<{ code: string; name: string }>;
  coverageStart: string;
  coverageEnd: string;
  profileName: string;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dataStart, setDataStart] = useState(detected.dataStartRow);
  const [mode, setMode] = useState<ImportMode>(detected.mode);
  const [assign, setAssign] = useState(() => ({
    code: detected.employeeCode,
    name: detected.employeeName,
    dayStart: detected.dayStart,
    dayEnd: detected.dayEnd,
    buckets: normalizeBuckets(detected.buckets),
    periodLate: detected.periodLate?.index ?? null,
  }));
  const [units, setUnits] = useState<Record<string, V2Unit>>(detected.dayUnits);
  const [periodLateUnit, setPeriodLateUnit] = useState<V2Unit>(detected.periodLate?.unit ?? "minutes");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);

  const rowCount = Math.min(500, grid.length);
  const colCount = Math.min(200, Math.max(0, ...grid.map((row) => row.length)));
  const columns = Array.from({ length: colCount }, (_, index) => index);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(null);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const tint = useMemo(() => {
    const map = new Map<number, string>();
    if (assign.code != null) map.set(assign.code, "code");
    if (assign.name != null) map.set(assign.name, "name");
    if (assign.dayStart != null && assign.dayEnd != null) {
      for (let index = assign.dayStart; index <= assign.dayEnd; index += 1) map.set(index, "days");
    }
    for (const indexes of Object.values(assign.buckets)) {
      for (const index of indexes) map.set(index, "bucket");
    }
    if (assign.periodLate != null) map.set(assign.periodLate, "late");
    return map;
  }, [assign]);

  const selectedColumns = useMemo(() => {
    if (!selection || selection.kind === "row") return new Set<number>();
    const set = new Set<number>();
    for (let index = Math.min(selection.start, selection.end); index <= Math.max(selection.start, selection.end); index += 1) {
      set.add(index);
    }
    return set;
  }, [selection]);

  function detach(state: typeof assign, column: number): typeof assign {
    const buckets: Record<string, number[]> = {};
    for (const [code, indexes] of Object.entries(state.buckets)) {
      const kept = indexes.filter((index) => index !== column);
      if (kept.length > 0) buckets[code] = kept;
    }
    const inRange =
      state.dayStart != null && state.dayEnd != null && column >= state.dayStart && column <= state.dayEnd;
    return {
      ...state,
      buckets,
      code: state.code === column ? null : state.code,
      name: state.name === column ? null : state.name,
      periodLate: state.periodLate === column ? null : state.periodLate,
      dayStart: inRange ? null : state.dayStart,
      dayEnd: inRange ? null : state.dayEnd,
    };
  }

  function assignTarget(key: string) {
    if (!selection) return;

    if (key === "data") {
      setDataStart(selection.start);
      return;
    }

    if (key === "days") {
      const start = Math.min(selection.start, selection.end);
      const end = Math.max(selection.start, selection.end);
      let next = assign;
      for (let index = start; index <= end; index += 1) next = detach(next, index);
      setAssign({ ...next, dayStart: start, dayEnd: end });
      setUnits((current) => {
        const updated = { ...current };
        for (let index = start; index <= end; index += 1) {
          updated[String(index)] = updated[String(index)] ?? (mode === "late" ? "minutes" : "hours");
        }
        return updated;
      });
      return;
    }

    if (selection.kind !== "column") return;
    const column = selection.start;

    if (key.startsWith("bucket:")) {
      const code = key.slice("bucket:".length);
      const next = detach(assign, column);
      const existing = next.buckets[code] ?? [];
      setAssign({ ...next, buckets: { ...next.buckets, [code]: [...new Set([...existing, column])] } });
      return;
    }

    let next = detach(assign, column);
    if (key === "code") next = { ...next, code: column };
    if (key === "name") next = { ...next, name: column };
    if (key === "late") next = { ...next, periodLate: column };
    setAssign(next);
  }

  const targets = useMemo(() => {
    if (!selection) return [];
    if (selection.kind === "row") return [{ key: "data", label: "First data row" }];
    if (selection.kind === "range") return [{ key: "days", label: "Day / date range" }];
    return [
      { key: "code", label: "Employee code" },
      { key: "name", label: "Employee name" },
      { key: "days", label: "Day column" },
      { key: "late", label: "Period late total" },
      ...premiumCodes.map((code) => ({ key: `bucket:${code}`, label: code })),
    ];
  }, [selection]);

  const chips: Array<{ id: string; label: string; detail: string; clear: () => void }> = [];
  if (assign.code != null) {
    chips.push({ id: "code", label: "Employee code", detail: colLetter(assign.code), clear: () => setAssign({ ...assign, code: null }) });
  }
  if (assign.name != null) {
    chips.push({ id: "name", label: "Employee name", detail: colLetter(assign.name), clear: () => setAssign({ ...assign, name: null }) });
  }
  if (assign.dayStart != null && assign.dayEnd != null) {
    chips.push({
      id: "days",
      label: "Day range",
      detail: `${colLetter(assign.dayStart)}–${colLetter(assign.dayEnd)}`,
      clear: () => setAssign({ ...assign, dayStart: null, dayEnd: null }),
    });
  }
  for (const [code, indexes] of Object.entries(assign.buckets)) {
    chips.push({
      id: `bucket:${code}`,
      label: code,
      detail: indexes.map(colLetter).join(", "),
      clear: () => {
        const buckets = { ...assign.buckets };
        delete buckets[code];
        setAssign({ ...assign, buckets });
      },
    });
  }
  if (assign.periodLate != null) {
    chips.push({
      id: "late",
      label: "Period late",
      detail: colLetter(assign.periodLate),
      clear: () => setAssign({ ...assign, periodLate: null }),
    });
  }

  const rangeStart = assign.dayStart == null ? null : Math.min(assign.dayStart, assign.dayEnd ?? assign.dayStart);
  const rangeEnd = assign.dayEnd == null ? null : Math.max(assign.dayStart ?? assign.dayEnd, assign.dayEnd);
  const rangeColumns =
    rangeStart != null && rangeEnd != null
      ? Array.from({ length: rangeEnd - rangeStart + 1 }, (_, offset) => rangeStart + offset)
      : [];
  const defaultUnit: V2Unit = mode === "late" ? "minutes" : "hours";

  const mapping: MappingV2 = useMemo(
    () => ({
      ...detected,
      mode,
      dataStartRow: dataStart,
      employeeCode: assign.code,
      employeeName: assign.name,
      dayStart: rangeStart,
      dayEnd: rangeEnd,
      dayUnits: units,
      buckets: assign.buckets,
      periodLate: assign.periodLate == null ? null : { index: assign.periodLate, unit: periodLateUnit },
    }),
    [detected, mode, dataStart, assign, rangeStart, rangeEnd, units, periodLateUnit],
  );

  const preview = useMemo(() => {
    try {
      const sheet = {
        name: detected.sheetName,
        rows: grid.slice(0, rowCount).map((row) =>
          Array.from({ length: colCount }, (_, index) => {
            const text = row[index] ?? "";
            return { text, value: /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null };
          }),
        ),
      };
      return applyMappingV2({
        sheet,
        mapping,
        period: { coverageStart, coverageEnd },
        employees,
        externalIds: [],
        schedules: {},
      });
    } catch {
      return null;
    }
  }, [grid, rowCount, colCount, detected.sheetName, mapping, coverageStart, coverageEnd, employees]);

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
  const endRow = Math.min(rowCount, startRow + WINDOW_ROWS + 8);
  const topPad = startRow * ROW_HEIGHT;
  const bottomPad = Math.max(0, (rowCount - endRow) * ROW_HEIGHT);
  const visible = Array.from({ length: Math.max(0, endRow - startRow) }, (_, offset) => startRow + offset);

  const ready =
    assign.code != null &&
    rangeStart != null &&
    rangeEnd != null &&
    preview != null;

  return (
    <form action={confirmImport} className="mt-6">
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="codeColumn" value={assign.code ?? ""} />
      <input type="hidden" name="nameColumn" value={assign.name ?? ""} />
      <input type="hidden" name="dayStart" value={rangeStart ?? ""} />
      <input type="hidden" name="dayEnd" value={rangeEnd ?? ""} />
      <input type="hidden" name="periodLateColumn" value={assign.periodLate ?? ""} />
      <input type="hidden" name="periodLateUnit" value={periodLateUnit} />
      <input type="hidden" name="unknownCount" value={unknownCodes.length} />
      {unknownCodes.map((entry, index) => (
        <input key={entry.code} type="hidden" name={`unknownCode-${index}`} value={entry.code} />
      ))}
      {rangeColumns.map((index) => (
        <input key={`unit-${index}`} type="hidden" name={`unit-${index}`} value={units[String(index)] ?? defaultUnit} />
      ))}
      {Object.entries(assign.buckets).flatMap(([code, indexes]) =>
        indexes.map((index, position) => (
          <input key={`bucket-${code}-${position}`} type="hidden" name={`bucket-${code}`} value={index} />
        )),
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" role="radiogroup" aria-label="Import mode">
          {(["days", "late"] as ImportMode[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={`h-9 rounded-full border px-4 text-[12.5px] font-semibold transition-colors duration-150 ${
                mode === value
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-rule-strong text-ink-2 hover:bg-surface-2"
              }`}
            >
              {value === "days" ? "Day hours worked" : "Lateness"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setReviewOpen(true)}
          disabled={!ready}
          className="h-9 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white transition-colors duration-150 hover:brightness-95 disabled:opacity-40"
        >
          Review mapping
        </button>
      </div>

      <div
        aria-live="polite"
        className={`mt-3 rounded-[12px] border border-rule bg-surface-2 px-4 py-2.5 text-[12.5px] text-ink-2 ${
          selection ? "palette-in" : "hidden"
        }`}
      >
        {selection ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">
              {selection.kind === "row"
                ? `Row ${selection.start + 1}`
                : selection.start === selection.end
                  ? `Column ${colLetter(selection.start)}`
                  : `Columns ${colLetter(Math.min(selection.start, selection.end))}–${colLetter(Math.max(selection.start, selection.end))}`}
            </span>
            {targets.map((target) => (
              <button
                key={target.key}
                type="button"
                onClick={() => assignTarget(target.key)}
                className="h-8 rounded-full border border-rule-strong bg-surface px-3 text-[12px] font-semibold transition-colors duration-150 hover:border-accent hover:text-accent"
              >
                {target.label}
              </button>
            ))}
            <button type="button" onClick={() => setSelection(null)} className="ml-auto text-[11.5px] text-muted underline underline-offset-4">
              Clear
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={chip.clear}
            title="Remove assignment"
            className="chip-in flex items-center gap-2 rounded-full border border-rule bg-surface px-3 py-1.5 text-[11.5px] transition-colors duration-150 hover:border-[#9f2f2d]/40"
          >
            <span className={`h-2 w-2 rounded-full ${tintDot[chip.id.startsWith("bucket:") ? "bucket" : chip.id]}`} aria-hidden="true" />
            <span className="font-semibold">{chip.label}</span>
            <span className="figure text-muted">{chip.detail}</span>
            <span aria-hidden="true" className="text-muted">×</span>
          </button>
        ))}
      </div>

      <div
        className="mt-3 max-h-[560px] overflow-auto rounded-[14px] border border-rule bg-surface select-none"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <table className="border-collapse text-left" style={{ width: 44 + colCount * COL_WIDTH }}>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 w-[44px] border-b border-r border-rule bg-surface" />
              {columns.map((column) => {
                const family = tint.get(column);
                const active = selectedColumns.has(column);
                return (
                  <th
                    key={column}
                    scope="col"
                    style={{ width: COL_WIDTH }}
                    onClick={(event) => {
                      if (event.shiftKey && selection && selection.kind !== "row") {
                        setSelection({ kind: "range", start: selection.start, end: column });
                      } else {
                        setSelection({ kind: "column", start: column, end: column });
                      }
                    }}
                    className={`sticky top-0 z-20 cursor-pointer border-b border-r border-rule px-2 py-1.5 text-center text-[11px] font-semibold tracking-[0.06em] text-muted transition-colors duration-150 hover:bg-surface-2 ${
                      family ? tintClass[family] : "bg-surface"
                    } ${active ? "shadow-[inset_0_0_0_2px_#0c7a43]" : ""}`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      {family ? <span className={`h-1.5 w-1.5 rounded-full ${tintDot[family]}`} aria-hidden="true" /> : null}
                      {colLetter(column)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {topPad > 0 ? (
              <tr style={{ height: topPad }}>
                <td colSpan={colCount + 1} />
              </tr>
            ) : null}
            {visible.map((rowIndex) => {
              const row = grid[rowIndex] ?? [];
              const isHeader = rowIndex < dataStart;
              const rowSelected = selection?.kind === "row" && selection.start === rowIndex;
              return (
                <tr key={rowIndex} className={isHeader ? "text-muted" : "text-ink"} style={{ height: ROW_HEIGHT }}>
                  <td
                    onClick={() => setSelection({ kind: "row", start: rowIndex, end: rowIndex })}
                    className={`sticky left-0 z-10 cursor-pointer border-b border-r border-rule px-1 text-center text-[10.5px] transition-colors duration-150 ${
                      rowSelected ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted hover:bg-surface"
                    } ${rowIndex === dataStart ? "shadow-[inset_0_2px_0_#0c7a43]" : ""}`}
                  >
                    {rowIndex + 1}
                  </td>
                  {columns.map((column) => {
                    const text = row[column] ?? "";
                    const family = tint.get(column);
                    const active = selectedColumns.has(column);
                    return (
                      <td
                        key={column}
                        title={text}
                        onMouseDown={() => {
                          setSelection({ kind: "range", start: column, end: column });
                          setDragging(true);
                        }}
                        onMouseEnter={() => {
                          if (dragging) {
                            setSelection((current) =>
                              current && current.kind !== "row"
                                ? { kind: "range", start: current.start, end: column }
                                : current,
                            );
                          }
                        }}
                        className={`max-w-[112px] cursor-cell truncate border-b border-r border-rule px-2 text-[11.5px] transition-colors duration-150 ${
                          family ? tintClass[family] : ""
                        } ${active ? "shadow-[inset_0_0_0_2px_#0c7a43]" : ""}`}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {bottomPad > 0 ? (
              <tr style={{ height: bottomPad }}>
                <td colSpan={colCount + 1} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11.5px] text-muted">
        <span>{rowCount} rows · {colCount} columns</span>
        <span>Data starts at row {dataStart + 1} {dataStart === detected.dataStartRow ? "(detected)" : "(set)"}</span>
        <span>Click a column letter, drag cells, or click a row number. Esc clears.</span>
      </div>

      {rangeColumns.length > 0 ? (
        <details className="mt-3 rounded-[14px] border border-rule bg-surface-2 px-4 py-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold marker:hidden">
            Per-day units · {rangeColumns.length} columns
          </summary>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-[12px] text-muted">Set all to</span>
            {(["hours", "minutes"] as V2Unit[]).map((unit) => (
              <button
                key={unit}
                type="button"
                onClick={() =>
                  setUnits((current) => {
                    const updated = { ...current };
                    for (const index of rangeColumns) updated[String(index)] = unit;
                    return updated;
                  })
                }
                className="h-8 rounded-full border border-rule-strong px-3 text-[12px] font-semibold hover:bg-surface"
              >
                {mode === "late" ? (unit === "hours" ? "Late hours" : "Late minutes") : unit === "hours" ? "Day hours" : "Day minutes"}
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {rangeColumns.map((index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="figure w-8 shrink-0 text-[11.5px] text-muted">{colLetter(index)}</span>
                <select
                  aria-label={`Unit for column ${colLetter(index)}`}
                  value={units[String(index)] ?? defaultUnit}
                  onChange={(event) =>
                    setUnits((current) => ({ ...current, [String(index)]: event.target.value as V2Unit }))
                  }
                  className="h-8 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12px]"
                >
                  <option value="hours">{mode === "late" ? "Late hours" : "Day hours"}</option>
                  <option value="minutes">{mode === "late" ? "Late minutes" : "Day minutes"}</option>
                </select>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {unknownCodes.length > 0 ? (
        <details id="resolve" className="mt-3 rounded-[14px] border border-[#e8c98a] bg-[#fbf3db] px-4 py-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-[#956400] marker:hidden">
            Unbound employee codes · {unknownCodes.length}
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {unknownCodes.slice(0, 60).map((entry, index) => (
              <div key={entry.code} className="flex items-center gap-2">
                <span className="figure w-[96px] shrink-0 truncate text-[12px]" title={entry.code}>{entry.code}</span>
                <span className="w-[120px] shrink-0 truncate text-[12px] text-muted" title={entry.name}>{entry.name || "—"}</span>
                <select name={`alias-${index}`} defaultValue="" className="h-8 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12px]">
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
        </details>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-[14px] border border-rule bg-surface p-4">
        <div className="min-w-[240px] flex-1">
          <label htmlFor="profileName" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            Save profile as
          </label>
          <input id="profileName" name="profileName" defaultValue={profileName} className="mt-1.5 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]" />
        </div>
        <button
          type="submit"
          disabled={!ready}
          className="h-10 rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors duration-150 hover:brightness-95 disabled:opacity-40"
        >
          Confirm mapping and import
        </button>
      </div>

      {reviewOpen ? (
        <div className="fixed inset-0 z-40 bg-ink/20" onClick={() => setReviewOpen(false)}>
          <aside
            className="panel-in absolute right-0 top-0 h-full w-full max-w-[560px] overflow-auto bg-surface p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Review mapping</p>
                <h2 className="mt-2 font-serif text-[26px] leading-[1.1] tracking-[-0.02em]">{detected.sheetName}</h2>
              </div>
              <button type="button" onClick={() => setReviewOpen(false)} className="h-8 rounded-full border border-rule-strong px-3 text-[12px]">
                Back
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-px border border-rule bg-rule">
              {[
                ["Employees", String(preview?.matchedEmployees ?? 0)],
                ["Day records", String(preview?.days.length ?? 0)],
                ["Buckets", String(preview?.buckets.length ?? 0)],
                ["Late minutes", String((preview?.totals.reduce((sum, total) => sum + total.minutes, 0) ?? 0) + (preview?.days.reduce((sum, day) => sum + day.lateMinutes, 0) ?? 0))],
              ].map(([labelText, value]) => (
                <div key={labelText} className="bg-surface px-4 py-3">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{labelText}</p>
                  <p className="figure mt-1 text-[15px]">{value}</p>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[11.5px] leading-[1.6] text-muted">
              Preview computed with an eight-hour fallback schedule; the import uses each employee's real work schedule.
            </p>

            <div className="mt-5 rounded-[14px] border border-rule">
              <div className="border-b border-rule px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                First employees
              </div>
              <div className="max-h-[260px] overflow-auto">
                <table className="w-full border-collapse text-left">
                  <tbody>
                    {Array.from(
                      new Map(
                        (preview?.days ?? []).map((day) => [day.employeeId, day]),
                      ).values(),
                    )
                      .slice(0, 8)
                      .map((day) => {
                        const employee = employees.find((candidate) => candidate.id === day.employeeId);
                        return (
                          <tr key={day.employeeId} className="border-b border-rule last:border-b-0">
                            <td className="figure px-3 py-2 text-[11.5px] text-muted">{employee?.employeeCode}</td>
                            <td className="px-3 py-2 text-[12px]">{employee ? `${employee.lastName}, ${employee.firstName}` : "—"}</td>
                            <td className="figure px-3 py-2 text-right text-[12px]">{day.hours.toFixed(2)} h</td>
                            <td className="figure px-3 py-2 text-right text-[11.5px] text-muted">{day.lateMinutes} min</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            {preview && preview.issues.length > 0 ? (
              <div className="mt-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-warn">
                  {preview.issues.length} issue{preview.issues.length === 1 ? "" : "s"}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {preview.issues.slice(0, 10).map((issue, index) => (
                    <li key={index} className="text-[12px] text-ink-2">
                      <span className="figure mr-2 text-[11px] text-muted">r{issue.row}</span>
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!ready}
              className="mt-6 h-10 w-full rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors duration-150 hover:brightness-95 disabled:opacity-40"
            >
              Confirm mapping and import
            </button>
          </aside>
        </div>
      ) : null}
    </form>
  );
}
