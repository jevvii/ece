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
import { useFormStatus } from "react-dom";
import { validateMappingV2 } from "@/lib/import/review";
import type { Sheet } from "@/lib/import/types";
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
  previousImports,
  payrollApproved,
  sheet,
  detected,
  employees,
  externalIds,
  schedules,
  canWrite,
  coverageStart,
  coverageEnd,
  profileName,
  fileName,
  periodLabel,
  error,
}: {
  runId: string;
  previousImports: Array<{ id: string; fileName: string }>;
  payrollApproved: boolean;
  sheet: Sheet;
  detected: MappingV2;
  employees: Employee[];
  externalIds: Array<{ code: string; employeeId: string }>;
  schedules: Record<string, Record<number, number>>;
  canWrite: boolean;
  coverageStart: string;
  coverageEnd: string;
  profileName: string;
  fileName: string;
  periodLabel: string;
  error?: string;
}) {
  const grid = useMemo(() => sheet.rows.map((row) => row.map((cell) => cell.text)), [sheet]);
  const [replacePrevious, setReplacePrevious] = useState(false);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
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
    if (menu) menuRef.current?.querySelector("button")?.focus();
  }, [menu]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelection(null);
        setMenu(null);
        menuTrigger.current?.focus();
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
    setPremiumOpen(false);
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 300)),
      y: Math.max(8, Math.min(y + 10, window.innerHeight - 420)),
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
    if (!selection) return [] as Array<{ key: string; label: string; chip: string | null }>;
    if (selection.kind === "row") return [{ key: "data", label: "First data row", chip: null }];
    const many = selection.start !== selection.end;
    return [
      {
        key: "days",
        label: many ? "Date range" : "Date column",
        chip: mode === "late" ? "Late" : "Day",
      },
      ...(many
        ? []
        : [
            { key: "code", label: "Employee code", chip: null },
            { key: "name", label: "Employee name", chip: null },
            { key: "late", label: "Period late total", chip: null },
          ]),
    ];
  }, [selection, mode]);

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

  const mappingProblem = validateMappingV2(mapping, sheet);
  const basePreview = useMemo(() => {
    if (mappingProblem) return null;
    return applyMappingV2({ sheet, mapping, period: { coverageStart, coverageEnd }, employees, externalIds, schedules });
  }, [sheet, mapping, mappingProblem, coverageStart, coverageEnd, employees, externalIds, schedules]);
  const unknownCodes = (basePreview?.unknownCodes ?? []).map((code) => {
    const issue = basePreview?.issues.find((entry) => entry.kind === "unknown_employee" && entry.code === code);
    const name = issue && mapping.employeeName != null ? sheet.rows[issue.row - 1]?.[mapping.employeeName]?.text ?? "" : "";
    return { code, name };
  });
  const reviewedAliases = unknownCodes.flatMap(({ code }) => bindings[code] ? [{ code, employeeId: bindings[code]! }] : []);
  const preview = useMemo(() => {
    if (mappingProblem) return null;
    const reviewed = (basePreview?.unknownCodes ?? []).flatMap((code) => bindings[code] ? [{ code, employeeId: bindings[code]! }] : []);
    return applyMappingV2({ sheet, mapping, period: { coverageStart, coverageEnd }, employees,
      externalIds: [...externalIds, ...reviewed], schedules });
  }, [sheet, mapping, mappingProblem, coverageStart, coverageEnd, employees, externalIds, schedules, bindings, basePreview]);

  const reviewRows = useMemo(() => {
    const summary = new Map<string, { days: number; hours: number; late: number }>();
    const order: string[] = [];
    for (const day of preview?.days ?? []) {
      if (!summary.has(day.employeeId)) order.push(day.employeeId);
      const entry = summary.get(day.employeeId) ?? { days: 0, hours: 0, late: 0 };
      entry.days += 1;
      entry.hours += day.hours;
      entry.late += day.lateMinutes;
      summary.set(day.employeeId, entry);
    }
    for (const total of preview?.totals ?? []) {
      const entry = summary.get(total.employeeId);
      if (entry) entry.late += total.minutes;
    }
    return order.map((id) => ({
      id,
      employee: employees.find((candidate) => candidate.id === id),
      ...(summary.get(id) ?? { days: 0, hours: 0, late: 0 }),
    }));
  }, [preview, employees]);

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
  const endRow = Math.min(rowCount, startRow + WINDOW_ROWS + 8);
  const topPad = startRow * ROW_HEIGHT;
  const bottomPad = Math.max(0, (rowCount - endRow) * ROW_HEIGHT);
  const visible = Array.from({ length: Math.max(0, endRow - startRow) }, (_, offset) => startRow + offset);

  const ready = !mappingProblem && preview != null;
  const canImport = canWrite && !payrollApproved && (!previousImports.length || replacePrevious) && ready && preview.blockingIssueCount === 0 && preview.days.length > 0;

  return (
    <div className="flex h-dvh flex-col bg-paper font-instrument text-ink">

      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-rule px-4 py-2">
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
                onClick={() => {
                  setMode(value);
                  // Late values are minutes by default; day values are hours.
                  // Carrying the previous units across a mode switch silently
                  // turned "9" into nine late hours.
                  setUnits((current) => {
                    const updated = { ...current };
                    if (rangeStart != null && rangeEnd != null) {
                      for (let index = rangeStart; index <= rangeEnd; index += 1) {
                        updated[String(index)] = value === "late" ? "minutes" : "hours";
                      }
                    }
                    return updated;
                  });
                }}
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

      <div className="flex shrink-0 items-center gap-3 border-b border-rule px-4 py-2">
        <div className="h-[2px] flex-1 overflow-hidden rounded-full bg-rule">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${((reviewOpen ? 2 : 1) / 2) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-[11.5px] text-muted">
          Step {reviewOpen ? 2 : 1} of 2 · {reviewOpen ? "Review attendance" : "Check columns"}
        </span>
      </div>

      {error ? (
        <div role="alert" className="shrink-0 border-b border-[#9f2f2d]/25 bg-[#fdebec] px-4 py-2 text-[12px] text-[#7c2523]">
          {error}
        </div>
      ) : null}

      {mappingProblem ? <p role="status" className="border-b border-rule bg-surface-2 px-4 py-2 text-[13px] text-warn">{mappingProblem}</p> : null}
      <form action={confirmImport} onSubmit={(event) => { if (!reviewOpen || !canImport) event.preventDefault(); }} className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="dataStartRow" value={dataStart} />
        <input type="hidden" name="codeColumn" value={assign.code ?? ""} />
        <input type="hidden" name="nameColumn" value={assign.name ?? ""} />
        <input type="hidden" name="dayStart" value={rangeStart ?? ""} />
        <input type="hidden" name="dayEnd" value={rangeEnd ?? ""} />
        <input type="hidden" name="periodLateColumn" value={assign.periodLate ?? ""} />
        <input type="hidden" name="periodLateUnit" value={periodLateUnit} />
        <input type="hidden" name="previousImports" value={JSON.stringify(previousImports.map((run) => run.id).sort())} />
        <input type="hidden" name="aliases" value={JSON.stringify(reviewedAliases)} />
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
              <button
                type="button"
                onClick={() => setReviewOpen(false)}
                className="mb-5 flex items-center gap-2 text-[12.5px] text-muted transition-colors duration-150 hover:text-ink"
              >
                ← Back to grid
              </button>
              <h1 className="mt-3 font-serif text-[32px] sm:text-[36px] leading-[1.05] tracking-[-0.03em]">
                Review attendance
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
                Uses saved employee matches and assigned work schedules. Nothing is saved until you confirm.
              </p>

              {preview?.issues.some((issue) => issue.kind === "day_mismatch") ? (
                <p className="mt-3 rounded-[10px] border border-warn/25 bg-[#fbf3db] px-3 py-2 text-[11.5px] leading-[1.6] text-[#7a5a14]">
                  The file&apos;s day numbers do not line up with the selected cutoff. Dates are assigned
                  sequentially from the cutoff start, so check the first and last date columns, or choose a
                  cutoff that matches the file&apos;s period.
                </p>
              ) : null}

              <div className="scroll-x mt-6 border-y border-rule">
                <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">First employees</span>
                  <span className="text-[10.5px] text-muted">totals across the mapped dates</span>
                </div>
                <div className="max-h-[280px] overflow-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-rule">
                        {["Code", "Employee", "Days", "Hours", "Late"].map((heading) => (
                          <th
                            key={heading}
                            className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted ${
                              heading === "Days" || heading === "Hours" || heading === "Late" ? "text-right" : ""
                            }`}
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reviewRows.length === 0 ? <tr><td colSpan={5} className="px-3 py-5 text-[13px] text-muted">No matched attendance yet. Match employee codes below or check the column settings.</td></tr> : null}
                      {reviewRows.slice(0, 10).map((row) => (
                        <tr key={row.id} className="border-b border-rule last:border-b-0">
                          <td className="figure px-3 py-2 text-[11.5px] text-muted">{row.employee?.employeeCode ?? "—"}</td>
                          <td className="px-3 py-2 text-[12px]">
                            {row.employee ? `${row.employee.lastName}, ${row.employee.firstName}` : "—"}
                          </td>
                          <td className="figure px-3 py-2 text-right text-[11.5px] text-muted">{row.days}</td>
                          <td className="figure px-3 py-2 text-right text-[12px]">{row.hours.toFixed(2)}</td>
                          <td className="figure px-3 py-2 text-right text-[11.5px] text-muted">{row.late}</td>
                        </tr>
                      ))}
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
                <details open className="mt-4 rounded-[14px] border border-[#e8c98a] bg-[#fbf3db] px-4 py-3">
                  <summary className="cursor-pointer text-[12.5px] font-semibold text-[#956400] marker:hidden">Match employee codes · {unknownCodes.length}</summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {unknownCodes.map((entry) => (
                      <div key={entry.code} className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="figure w-[96px] shrink-0 truncate text-[12px]" title={entry.code}>{entry.code}</span>
                        <span className="w-[110px] shrink-0 truncate text-[12px] text-muted" title={entry.name}>{entry.name || "—"}</span>
                        <select aria-label={`Match employee ${entry.code}`} value={bindings[entry.code] ?? ""} onChange={(event) => setBindings((current) => ({ ...current, [entry.code]: event.target.value }))} className="h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12px]">
                          <option value="">Choose employee…</option>
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
                      <li key={index} className="break-words text-[13px] text-ink-2"><span className="figure mr-2 text-[11px] text-muted">Row {issue.row}{issue.column == null ? "" : ` · ${colLetter(issue.column)}`}</span>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {payrollApproved ? <p role="alert" className="mt-5 rounded-[10px] border border-rule bg-surface-2 p-4 text-[13px] text-ink-2">Payroll for this cutoff is approved. Attendance can no longer be changed.</p> : previousImports.length > 0 ? (
                <div className="mt-6 border-y border-rule py-4">
                  <p className="text-[13px] font-semibold">Attendance already exists for this cutoff</p>
                  <p className="mt-1 break-words text-[12.5px] text-muted">{previousImports.map((run) => run.fileName).join(", ")} will remain in history. Recalculate any draft payroll after replacing attendance.</p>
                  <label className="mt-3 flex items-start gap-2 text-[13px]">
                    <input type="checkbox" name="replacePrevious" checked={replacePrevious} onChange={(event) => setReplacePrevious(event.target.checked)} className="mt-1 h-4 w-4 accent-accent" />
                    Replace the previous attendance import for this cutoff
                  </label>
                </div>
              ) : null}
              {!canImport && !payrollApproved && (!previousImports.length || replacePrevious) ? (
                <p role="status" className="mt-5 text-[13px] text-warn">
                  {!canWrite ? "Your role cannot import time reports." : preview?.blockingIssueCount
                    ? `Resolve ${preview.blockingIssueCount} issue${preview.blockingIssueCount === 1 ? "" : "s"} before importing.`
                    : "No attendance days to import. Check the mapped columns and first data row."}
                </p>
              ) : null}
              <div className="mt-8 flex flex-wrap items-end gap-3 border-t border-rule pt-5">
                <div className="min-w-[240px] flex-1">
                  <label htmlFor="profileName" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Save profile as</label>
                  <input id="profileName" name="profileName" defaultValue={profileName} className="mt-1.5 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px]" />
                </div>
                <ConfirmButton disabled={!canImport} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <details className="shrink-0 border-b border-rule px-4 py-3">
              <summary className="cursor-pointer text-[13px] font-semibold">Column settings</summary>
              <p className="mt-2 text-[12.5px] text-muted">Use these fields or select columns in the sheet to change assignments.</p>
              <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
                {([
                  ["Employee code", "code"], ["Employee name", "name"],
                  ["First day column", "dayStart"], ["Last day column", "dayEnd"],
                ] as const).map(([label, field]) => <label key={field} className="text-[12px] font-medium">
                  {label}
                  <select aria-label={label} value={assign[field] ?? ""}
                    onChange={(event) => setAssign((current) => ({ ...current, [field]: event.target.value === "" ? null : Number(event.target.value) }))}
                    className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[13px]">
                    <option value="">Not mapped</option>
                    {columns.map((column) => <option key={column} value={column}>{colLetter(column)} · {grid[detected.headerRow]?.[column] || "Column"}</option>)}
                  </select>
                </label>)}
                <label className="text-[12px] font-medium">First data row
                  <input aria-label="First data row" type="number" min={detected.headerRow + 2} max={rowCount} value={dataStart + 1}
                    onChange={(event) => setDataStart(Number(event.target.value) - 1)}
                    className="mt-1 h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[13px]" />
                </label>
              </div>
            </details>
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
                            tabIndex={0}
                            aria-label={`Map column ${colLetter(column)}`}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              menuTrigger.current = event.currentTarget;
                              const rect = event.currentTarget.getBoundingClientRect();
                              setSelection({ kind: "column", start: column, end: column });
                              openMenuAt(rect.left, rect.bottom);
                            }}
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
                      const beforeHeader = rowIndex < detected.headerRow;
                      const isHeaderRow = rowIndex === detected.headerRow;
                      const rowSelected = selection?.kind === "row" && selection.start === rowIndex;
                      return (
                        <tr
                          key={rowIndex}
                          className={`${beforeHeader ? "text-muted opacity-50" : isHeader ? "text-muted" : "text-ink"} ${
                            isHeaderRow ? "shadow-[inset_0_2px_0_#0c7a43]" : ""
                          }`}
                          style={{ height: ROW_HEIGHT }}
                        >
                          <td
                            role="button" tabIndex={0} aria-label={`Choose row ${rowIndex + 1}`}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              menuTrigger.current = event.currentTarget;
                              const rect = event.currentTarget.getBoundingClientRect();
                              setSelection({ kind: "row", start: rowIndex, end: rowIndex });
                              openMenuAt(rect.right, rect.top);
                            }}
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
                {rowCount} rows · {colCount} columns · header detected at row {detected.headerRow + 1} · row numbers set the data start
              </span>
            </div>
          </div>
        )}
      </form>

      {menu && selection && !reviewOpen ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div ref={menuRef} role="dialog" aria-label="Column assignment" className="palette-in fixed z-50 w-[290px] rounded-[14px] border border-rule bg-surface p-3 shadow-lg" style={{ left: menu.x, top: menu.y }}>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">
              {selection.kind === "row"
                ? `Row ${selection.start + 1}`
                : selection.start === selection.end
                  ? `Column ${colLetter(selection.start)}`
                  : `Columns ${colLetter(Math.min(selection.start, selection.end))}–${colLetter(Math.max(selection.start, selection.end))}`}
            </p>
            <div className="mt-2 grid gap-1">
              {targets.map((target) => (
                <button
                  key={target.key}
                  type="button"
                  onClick={() => assignTarget(target.key)}
                  className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] transition-colors duration-150 hover:bg-surface-2"
                >
                  <span className={`h-2 w-2 rounded-full ${tintDot[target.key] ?? "bg-muted"}`} aria-hidden="true" />
                  {target.label}
                  {target.chip ? (
                    <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                      {target.chip}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {Object.keys(assign.buckets).length > 0 ? (
              <div className="mt-2 border-t border-rule pt-2">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-muted">Assigned premium</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(assign.buckets).map(([code, indexes]) => (
                    <span key={code} className="flex items-center gap-1 rounded-full bg-[#a4552f]/12 px-2 py-0.5 text-[10.5px] font-semibold">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#a4552f]" aria-hidden="true" />
                      {code}
                      <span className="figure font-normal text-muted">{indexes.map(colLetter).join(",")}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => setPremiumOpen((current) => !current)}
              className="mt-2 flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-left text-[12px] font-semibold transition-colors duration-150 hover:bg-surface-2"
            >
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#a4552f]" aria-hidden="true" />
                Premium codes ({premiumCodes.length})
              </span>
              <span aria-hidden="true">{premiumOpen ? "▾" : "▸"}</span>
            </button>
            {premiumOpen ? (
              <div className="mt-1 grid grid-cols-3 gap-1">
                {premiumCodes.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => assignTarget(`bucket:${code}`)}
                    className="rounded-[8px] border border-rule px-2 py-1 text-[10.5px] font-semibold transition-colors duration-150 hover:border-accent hover:text-accent"
                  >
                    {code}
                  </button>
                ))}
              </div>
            ) : null}
            <button type="button" onClick={() => { setMenu(null); setSelection(null); }} className="mt-2 w-full rounded-[8px] px-2 py-1.5 text-left text-[11px] text-muted hover:bg-surface-2">
              Clear selection
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ConfirmButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={disabled || pending} className="h-10 rounded-full bg-accent px-5 text-[13px] font-semibold text-white transition-colors duration-150 hover:brightness-95 disabled:opacity-40">
    {pending ? "Importing attendance…" : "Confirm and import"}
  </button>;
}
