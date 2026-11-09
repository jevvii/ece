"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  fileName,
  periodLabel,
  isNew,
  error,
}: {
  runId: string;
  grid: string[][];
  detected: MappingV2;
  employees: Employee[];
  unknownCodes: Array<{ code: string; name: string }>;
  coverageStart: string;
  coverageEnd: string;
  profileName: string;
  fileName: string;
  periodLabel: string;
  isNew: boolean;
  error?: string;
}) {
  const [booting, setBooting] = useState(isNew);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
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

  useEffect(() => {
    if (!isNew) return;
    const timer = window.setTimeout(() => setBooting(false), 700);
    window.history.replaceState(null, "", window.location.pathname);
    return () => window.clearTimeout(timer);
  }, [isNew]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelection(null);
        setMenu(null);
      }
    };
    const onMove = (event: MouseEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const onUp = () => {
      if (!dragging) return;
      setDragging(false);
      openMenuAt(pointer.current.x, pointer.current.y);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  function openMenuAt(x: number, y: number) {
    if (typeof window === "undefined") return;
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 300)),
      y: Math.max(8, Math.min(y + 10, window.innerHeight - 380)),
    });
  }

  const rowCount = Math.min(500, grid.length);
  const colCount = Math.min(200, Math.max(0, ...grid.map((row) => row.length)));
  const columns = Array.from({ length: colCount }, (_, index) => index);

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
    setMenu(null);

    if (key === "data") {
      setDataStart(selection.start);
      return;
    }

    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);

    if (key === "days") {
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

    if (key.startsWith("bucket:")) {
      const code = key.slice("bucket:".length);
      let next = assign;
      for (let index = start; index <= end; index += 1) next = detach(next, index);
      const existing = next.buckets[code] ?? [];
      const merged = [...new Set([...existing, ...Array.from({ length: end - start + 1 }, (_, offset) => start + offset)])].sort((a, b) => a - b);
      setAssign({ ...next, buckets: { ...next.buckets, [code]: merged } });
      return;
    }

    if (start !== end) return;
    let next = detach(assign, start);
    if (key === "code") next = { ...next, code: start };
    if (key === "name") next = { ...next, name: start };
    if (key === "late") next = { ...next, periodLate: start };
    setAssign(next);
  }

  const targets = useMemo(() => {
    if (!selection) return [];
    if (selection.kind === "row") return [{ key: "data", label: "First data row" }];
    const many = selection.start !== selection.end;
    return [
      { key: "days", label: many ? "Day / date range" : "Day column" },
      ...premiumCodes.map((code) => ({ key: `bucket:${code}`, label: code })),
      ...(many
        ? []
        : [
            { key: "code", label: "Employee code" },
            { key: "name", label: "Employee name" },
            { key: "late", label: "Period late total" },
          ]),
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

  const ready = assign.code != null && rangeStart != null && rangeEnd != null && preview != null;

  return (
    <div className="flex h-screen flex-col bg-paper font-instrument text-ink">
      {booting ? (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-paper">
          <span className="flex items-center gap-2 text-[14.5px] font-bold tracking-[-0.01em]">
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
            ECE
          </span>
          <p className="mt-8 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted">Reading sheet</p>
          <h2 className="mt-3 max-w-[80vw] truncate font-serif text-[clamp(1.8rem,4vw,2.6rem)] tracking-[-0.02em]">{fileName}</h2>
          <p className="mt-2 text-[13px] text-ink-2">{rowCount} rows · {colCount} columns</p>
          <div className="mt-8 h-[2px] w-[240px] overflow-hidden rounded-full bg-rule">
            <div className="h-full rounded-full bg-accent" style={{ animation: "boot-line 700ms cubic-bezier(0.16,1,0.3,1) forwards" }} />
          </div>
        </div>
      ) : null}

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-rule px-4">
        <Link href="/payroll/time-report" aria-label="Back to time report" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-rule-strong text-muted transition-colors duration-150 hover:text-ink">
          ←
        </Link>
        <div className="min-w-0">
          <p className="max-w-[38ch] truncate font-mono text-[12px] text-ink-2">{fileName}</p>
          <p className="max-w-[46ch] truncate text-[11px] text-muted">{periodLabel}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="radiogroup" aria-label="Import mode">
            {(["days", "late"] as ImportMode[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={`h-8 rounded-full border px-3 text-[12px] font-semibold transition-colors duration-150 ${
                  mode === value ? "border-accent bg-accent-soft text-accent" : "border-rule-strong text-ink-2 hover:bg-surface-2"
                }`}
              >
                {value === "days" ? "Day hours" : "Lateness"}
              </button>
            ))}
          </div>
          {reviewOpen ? (
            <button type="button" onClick={() => setReviewOpen(false)} className="h-8 rounded-full border border-rule-strong px-3 text-[12px] font-semibold hover:bg-surface-2">
              Back to grid
            </button>
          ) : (
            <button type="button" onClick={() => setReviewOpen(true)} disabled={!ready} className="h-8 rounded-full bg-accent px-4 text-[12px] font-semibold text-white transition-colors duration-150 hover:brightness-95 disabled:opacity-40">
              Review mapping
            </button>
          )}
        </div>
      </header>

      {error ? (
        <div role="alert" className="shrink-0 border-b border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-2 text-[12px] text-[#7c2523]">
          {error}
        </div>
      ) : null}

      <form action={confirmImport} className="flex min-h-0 flex-1 flex-col">
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

        {reviewOpen ? (
          <div className="panel-in min-h-0 flex-1 overflow-auto px-6 py-8">
            <div className="mx-auto w-full max-w-[920px]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Review mapping</p>
              <h1 className="mt-3 font-serif text-[clamp(2rem,4vw,2.8rem)] leading-[1.05] tracking-[-0.03em]">
                {detected.sheetName}
              </h1>
              <div className="mt-6 grid grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
                {[
                  ["Employees", String(preview?.matchedEmployees ?? 0)],
                  ["Day records", String(preview?.days.length ?? 0)],
                  ["Buckets", String(preview?.buckets.length ?? 0)],
                  ["Issues", String(preview?.issues.length ?? 0)],
                ].map(([labelText, value]) => (
                  <div key={labelText} className="bg-surface px-4 py-3">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{labelText}</p>
                    <p className="figure mt-1 text-[15px]">{value}</p>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[11.5px] text-muted">
                Preview uses an eight-hour fallback schedule; the import uses each employee's real schedule.
              </p>

              <div className="mt-6 rounded-[14px] border border-rule">
                <div className="border-b border-rule px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">First employees</div>
                <div className="max-h-[280px] overflow-auto">
                  <table className="w-full border-collapse text-left">
                    <tbody>
                      {Array.from(new Map((preview?.days ?? []).map((day) => [day.employeeId, day])).values())
                        .slice(0, 10)
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

              {rangeColumns.length > 0 ? (
                <details className="mt-4 rounded-[14px] border border-rule bg-surface-2 px-4 py-3">
                  <summary className="cursor-pointer text-[12.5px] font-semibold marker:hidden">Per-day units · {rangeColumns.length} columns</summary>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-muted">Set all to</span>
                    {(["hours", "minutes"] as V2Unit[]).map((unit) => (
                      <button key={unit} type="button" onClick={() => setUnits((current) => { const updated = { ...current }; for (const index of rangeColumns) updated[String(index)] = unit; return updated; })} className="h-8 rounded-full border border-rule-strong px-3 text-[12px] font-semibold hover:bg-surface">
                        {mode === "late" ? (unit === "hours" ? "Late hours" : "Late minutes") : unit === "hours" ? "Day hours" : "Day minutes"}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {rangeColumns.map((index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="figure w-8 shrink-0 text-[11.5px] text-muted">{colLetter(index)}</span>
                        <select aria-label={`Unit for column ${colLetter(index)}`} value={units[String(index)] ?? defaultUnit} onChange={(event) => setUnits((current) => ({ ...current, [String(index)]: event.target.value as V2Unit }))} className="h-8 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12px]">
                          <option value="hours">{mode === "late" ? "Late hours" : "Day hours"}</option>
                          <option value="minutes">{mode === "late" ? "Late minutes" : "Day minutes"}</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {unknownCodes.length > 0 ? (
                <details className="mt-4 rounded-[14px] border border-[#e8c98a] bg-[#fbf3db] px-4 py-3">
                  <summary className="cursor-pointer text-[12.5px] font-semibold text-[#956400] marker:hidden">Unbound employee codes · {unknownCodes.length}</summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {unknownCodes.slice(0, 60).map((entry, index) => (
                      <div key={entry.code} className="flex items-center gap-2">
                        <span className="figure w-[96px] shrink-0 truncate text-[12px]" title={entry.code}>{entry.code}</span>
                        <span className="w-[110px] shrink-0 truncate text-[12px] text-muted" title={entry.name}>{entry.name || "—"}</span>
                        <select name={`alias-${index}`} defaultValue="" className="h-8 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12px]">
                          <option value="">Leave unbound</option>
                          {employees.map((employee) => (
                            <option key={employee.id} value={employee.id}>{employee.employeeCode} · {employee.lastName}, {employee.firstName}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {preview && preview.issues.length > 0 ? (
                <div className="mt-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-warn">{preview.issues.length} issue{preview.issues.length === 1 ? "" : "s"}</p>
                  <ul className="mt-2 space-y-1.5">
                    {preview.issues.slice(0, 12).map((issue, index) => (
                      <li key={index} className="text-[12px] text-ink-2"><span className="figure mr-2 text-[11px] text-muted">r{issue.row}</span>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-8 flex flex-wrap items-end gap-3 border-t border-rule pt-5">
                <div className="min-w-[240px] flex-1">
                  <label htmlFor="profileName" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Save profile as</label>
                  <input id="profileName" name="profileName" defaultValue={profileName} className="mt-1.5 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]" />
                </div>
                <button type="submit" disabled={!ready} className="h-10 rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors duration-150 hover:brightness-95 disabled:opacity-40">
                  Confirm mapping and import
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="onboard-step flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 p-4">
              <div className="h-full overflow-auto rounded-[14px] border border-rule bg-surface select-none" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
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
                            onMouseDown={(event) => {
                              event.preventDefault();
                              pointer.current = { x: event.clientX, y: event.clientY };
                              if (event.shiftKey && selection && selection.kind !== "row") {
                                setSelection({ kind: "range", start: selection.start, end: column });
                              } else {
                                setSelection({ kind: "column", start: column, end: column });
                              }
                              setDragging(true);
                            }}
                            onMouseEnter={() => {
                              if (dragging) setSelection((current) => (current && current.kind !== "row" ? { kind: "range", start: current.start, end: column } : current));
                            }}
                            className={`sticky top-0 z-20 cursor-pointer border-b border-r border-rule px-2 py-1.5 text-center text-[11px] font-semibold tracking-[0.06em] text-muted transition-colors duration-150 hover:bg-surface-2 ${family ? tintClass[family] : "bg-surface"} ${active ? "shadow-[inset_0_0_0_2px_#0c7a43]" : ""}`}
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
                    {topPad > 0 ? <tr style={{ height: topPad }}><td colSpan={colCount + 1} /></tr> : null}
                    {visible.map((rowIndex) => {
                      const row = grid[rowIndex] ?? [];
                      const isHeader = rowIndex < dataStart;
                      const rowSelected = selection?.kind === "row" && selection.start === rowIndex;
                      return (
                        <tr key={rowIndex} className={isHeader ? "text-muted" : "text-ink"} style={{ height: ROW_HEIGHT }}>
                          <td
                            onMouseDown={(event) => {
                              pointer.current = { x: event.clientX, y: event.clientY };
                              setSelection({ kind: "row", start: rowIndex, end: rowIndex });
                              setDragging(true);
                            }}
                            className={`sticky left-0 z-10 cursor-pointer border-b border-r border-rule px-1 text-center text-[10.5px] transition-colors duration-150 ${rowSelected ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted hover:bg-surface"} ${rowIndex === dataStart ? "shadow-[inset_0_2px_0_#0c7a43]" : ""}`}
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
                                onMouseDown={(event) => {
                                  pointer.current = { x: event.clientX, y: event.clientY };
                                  if (event.shiftKey && selection && selection.kind !== "row") {
                                    setSelection({ kind: "range", start: selection.start, end: column });
                                  } else {
                                    setSelection({ kind: "column", start: column, end: column });
                                  }
                                  setDragging(true);
                                }}
                                onMouseEnter={() => {
                                  if (dragging) setSelection((current) => (current && current.kind !== "row" ? { kind: "range", start: current.start, end: column } : current));
                                }}
                                className={`max-w-[112px] cursor-cell truncate border-b border-r border-rule px-2 text-[11.5px] transition-colors duration-150 ${family ? tintClass[family] : ""} ${active ? "shadow-[inset_0_0_0_2px_#0c7a43]" : ""}`}
                              >
                                {text}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {bottomPad > 0 ? <tr style={{ height: bottomPad }}><td colSpan={colCount + 1} /></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-rule px-4 py-2">
              {chips.map((chip) => (
                <button key={chip.id} type="button" onClick={chip.clear} title="Remove assignment" className="chip-in flex items-center gap-2 rounded-full border border-rule bg-surface px-2.5 py-1 text-[11px] transition-colors duration-150 hover:border-[#9f2f2d]/40">
                  <span className={`h-2 w-2 rounded-full ${tintDot[chip.id.startsWith("bucket:") ? "bucket" : chip.id]}`} aria-hidden="true" />
                  <span className="font-semibold">{chip.label}</span>
                  <span className="figure text-muted">{chip.detail}</span>
                  <span aria-hidden="true" className="text-muted">×</span>
                </button>
              ))}
              <span className="ml-auto text-[11px] text-muted">
                {rowCount} rows · {colCount} columns · data starts at row {dataStart + 1} · click a letter, drag across headers or cells
              </span>
            </div>
          </div>
        )}
      </form>

      {menu && selection && !reviewOpen ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div className="palette-in fixed z-50 w-[290px] rounded-[14px] border border-rule bg-surface p-3 shadow-lg" style={{ left: menu.x, top: menu.y }}>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">
              {selection.kind === "row"
                ? `Row ${selection.start + 1}`
                : selection.start === selection.end
                  ? `Column ${colLetter(selection.start)}`
                  : `Columns ${colLetter(Math.min(selection.start, selection.end))}–${colLetter(Math.max(selection.start, selection.end))}`}
            </p>
            <div className="mt-2 grid gap-1">
              {targets.map((target) => {
                const family = target.key.startsWith("bucket:") ? "bucket" : target.key;
                return (
                  <button
                    key={target.key}
                    type="button"
                    onClick={() => assignTarget(target.key)}
                    className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] transition-colors duration-150 hover:bg-surface-2"
                  >
                    <span className={`h-2 w-2 rounded-full ${tintDot[family] ?? "bg-muted"}`} aria-hidden="true" />
                    {target.label}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => { setMenu(null); setSelection(null); }} className="mt-2 w-full rounded-[8px] px-2 py-1.5 text-left text-[11px] text-muted hover:bg-surface-2">
              Clear selection
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
