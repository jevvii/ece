"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { parseEmployeeFileAction, type ParseWorkbookState } from "@/lib/setup/actions";
import {
  blankDraft,
  dateOrderLabel,
  inferDateOrder,
  normaliseDate,
  normaliseRate,
  type DateOrder,
  type EmployeeDraft,
} from "./employee-row";

const initial: ParseWorkbookState = { status: "idle" };

type FieldKey =
  | "ignore"
  | "employeeCode"
  | "employeeName"
  | "lastName"
  | "firstName"
  | "tin"
  | "birthday"
  | "address"
  | "hireDate"
  | "separationDate"
  | "monthlyRate";

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "ignore", label: "Ignore" },
  { key: "employeeCode", label: "Employee ID / code" },
  { key: "employeeName", label: "Employee name (Last, First)" },
  { key: "lastName", label: "Last name" },
  { key: "firstName", label: "First name" },
  { key: "tin", label: "TIN" },
  { key: "birthday", label: "Birthday" },
  { key: "address", label: "Address" },
  { key: "hireDate", label: "Date hired" },
  { key: "separationDate", label: "Date terminated" },
  { key: "monthlyRate", label: "Monthly rate" },
];

const ALIASES: Record<string, FieldKey> = {
  employeeid: "employeeCode",
  employeeidnumber: "employeeCode",
  employeecode: "employeeCode",
  code: "employeeCode",
  id: "employeeCode",
  employeename: "employeeName",
  fullname: "employeeName",
  name: "employeeName",
  lastname: "lastName",
  surname: "lastName",
  firstname: "firstName",
  givenname: "firstName",
  tin: "tin",
  birthday: "birthday",
  birthdate: "birthday",
  dateofbirth: "birthday",
  address: "address",
  datehired: "hireDate",
  hiredate: "hireDate",
  hired: "hireDate",
  dateterminated: "separationDate",
  separationdate: "separationDate",
  terminated: "separationDate",
  monthlyrate: "monthlyRate",
  rate: "monthlyRate",
  salary: "monthlyRate",
  basicsalary: "monthlyRate",
};

function normaliseHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function matchHeader(value: string): FieldKey {
  return ALIASES[normaliseHeader(value)] ?? "ignore";
}

function autoMap(header: string[]): FieldKey[] {
  const mapping = header.map(matchHeader);
  // A single name column wins over separate last/first columns.
  if (mapping.includes("lastName") || mapping.includes("firstName")) {
    const single = mapping.indexOf("employeeName");
    if (single >= 0) {
      mapping[single] = "employeeName";
    }
  }
  return mapping;
}

function findHeaderRow(rows: string[][]) {
  let best = 0;
  let bestScore = -1;
  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const score = (rows[index] ?? []).filter((cell) => matchHeader(cell) !== "ignore").length;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

const select =
  "h-9 w-full rounded-[10px] border border-rule-strong bg-surface px-2 text-[12.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";

export function EmployeeImport({
  onRows,
  canSetup,
}: {
  onRows: (rows: EmployeeDraft[]) => void;
  canSetup: boolean;
}) {
  const [state, formAction, pending] = useActionState(parseEmployeeFileAction, initial);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [dateOrder, setDateOrder] = useState<DateOrder>("mdy");
  const [added, setAdded] = useState<number | null>(null);

  const sheets = state.status === "ok" ? state.sheets ?? [] : [];
  const sheet = sheets[sheetIndex];

  useEffect(() => {
    if (state.status !== "ok") return;
    setSheetIndex(0);
    setAdded(null);
  }, [state]);

  useEffect(() => {
    if (!sheet) {
      setMapping([]);
      return;
    }
    setHeaderRow(findHeaderRow(sheet.rows));
  }, [sheet]);

  useEffect(() => {
    if (!sheet) return;
    setMapping(autoMap(sheet.rows[headerRow] ?? []));
  }, [sheet, headerRow]);

  useEffect(() => {
    if (!sheet) return;
    const samples: string[] = [];
    for (const row of sheet.rows.slice(headerRow + 1, headerRow + 40)) {
      for (const cell of row) {
        if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(cell.trim())) samples.push(cell);
      }
    }
    setDateOrder(inferDateOrder(samples));
  }, [sheet, headerRow]);

  const preview = useMemo(() => {
    if (!sheet) return [] as EmployeeDraft[];
    const header = sheet.rows[headerRow] ?? [];

    return sheet.rows
      .slice(headerRow + 1)
      .map((row) => {
        const values: Partial<Record<FieldKey, string>> = {};
        mapping.forEach((field, column) => {
          if (field === "ignore") return;
          const value = (row[column] ?? "").trim();
          if (value) values[field] = value;
        });

        const draft = blankDraft();
        draft.employeeCode = values.employeeCode ?? "";

        const last = values.lastName ?? "";
        const first = values.firstName ?? "";
        draft.employeeName =
          values.employeeName ?? (last && first ? `${last}, ${first}` : last || first);

        draft.tin = values.tin ?? "";
        draft.address = values.address ?? "";
        draft.birthday = normaliseDate(values.birthday ?? "", dateOrder);
        draft.hireDate = normaliseDate(values.hireDate ?? "", dateOrder);
        draft.separationDate = normaliseDate(values.separationDate ?? "", dateOrder);
        draft.monthlyRate = normaliseRate(values.monthlyRate ?? "");
        return draft;
      })
      .filter((row) => row.employeeCode || row.employeeName);
  }, [sheet, headerRow, mapping, dateOrder]);

  const missingRequired =
    !mapping.includes("employeeCode") ||
    (!mapping.includes("employeeName") &&
      !mapping.includes("lastName") &&
      !mapping.includes("firstName"));

  return (
    <details className="mt-3 rounded-[14px] border border-rule bg-surface-2 px-4 py-3">
      <summary className="cursor-pointer text-[12.5px] font-semibold marker:hidden">
        Import from a spreadsheet
      </summary>

      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label htmlFor="employee-file" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            CSV, XLSX or ODS
          </label>
          <input
            id="employee-file"
            name="file"
            type="file"
            accept=".csv,.xlsx,.ods"
            required
            className="mt-1.5 block w-full text-[12.5px] file:mr-3 file:h-9 file:rounded-full file:border-0 file:bg-ink file:px-4 file:text-[12px] file:font-semibold file:text-white"
          />
        </div>
        <button
          type="submit"
          disabled={!canSetup || pending}
          className="h-9 rounded-full bg-ink px-4 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Reading…" : "Read file"}
        </button>
      </form>

      {state.status === "error" ? (
        <p role="alert" className="mt-3 text-[12px] text-[#7c2523]">{state.error}</p>
      ) : null}

      {sheet ? (
        <div className="mt-4">
          <p className="text-[12px] text-muted">
            {state.fileName} · {preview.length} data rows found
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="import-sheet" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Sheet
              </label>
              <select
                id="import-sheet"
                value={sheetIndex}
                onChange={(event) => setSheetIndex(Number(event.target.value))}
                className={select}
              >
                {sheets.map((entry, index) => (
                  <option key={`${entry.name}-${index}`} value={index}>{entry.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="import-header" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Header row
              </label>
              <select
                id="import-header"
                value={headerRow}
                onChange={(event) => setHeaderRow(Number(event.target.value))}
                className={select}
              >
                {sheet.rows.slice(0, Math.min(sheet.rows.length, 25)).map((row, index) => (
                  <option key={index} value={index}>
                    Row {index + 1}{row.slice(0, 3).join(" · ") ? ` · ${row.slice(0, 3).join(" · ").slice(0, 40)}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="import-dates" className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                Date order
              </label>
              <select
                id="import-dates"
                value={dateOrder}
                onChange={(event) => setDateOrder(event.target.value as DateOrder)}
                className={select}
              >
                {(Object.keys(dateOrderLabel) as DateOrder[]).map((order) => (
                  <option key={order} value={order}>{dateOrderLabel[order]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="scroll-x mt-4 rounded-[14px] border border-rule bg-surface">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule">
                  {["Column", "Sample", "Map to"].map((heading) => (
                    <th key={heading} scope="col" className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(sheet.rows[headerRow] ?? []).map((cell, column) => (
                  <tr key={column} className="border-b border-rule last:border-b-0">
                    <td className="px-3 py-2 text-[12.5px] font-medium">{cell || `Column ${column + 1}`}</td>
                    <td className="px-3 py-2 text-[12px] text-muted">
                      {(sheet.rows[headerRow + 1]?.[column] ?? "").slice(0, 40)}
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        aria-label={`Map ${cell || `column ${column + 1}`}`}
                        value={mapping[column] ?? "ignore"}
                        onChange={(event) =>
                          setMapping((current) =>
                            current.map((value, position) =>
                              position === column ? (event.target.value as FieldKey) : value,
                            ),
                          )
                        }
                        className={select}
                      >
                        {FIELDS.map((field) => (
                          <option key={field.key} value={field.key}>{field.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {missingRequired ? (
            <p className="mt-3 text-[12px] text-[#7c2523]">
              Map a column to Employee ID and one to Employee Name (or Last and First name).
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-muted">
              Nothing is saved until you review the rows and press Save.
            </p>
            <button
              type="button"
              disabled={missingRequired || preview.length === 0 || !canSetup}
              onClick={() => {
                onRows(preview);
                setAdded(preview.length);
              }}
              className="h-9 rounded-full border border-rule-strong px-4 text-[12.5px] font-semibold hover:bg-surface disabled:opacity-40"
            >
              Add {preview.length} row{preview.length === 1 ? "" : "s"} to preview
            </button>
          </div>

          {added !== null ? (
            <p className="mt-2 text-[12px] text-accent">
              Added {added} row{added === 1 ? "" : "s"}. Review them below, then save.
            </p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
